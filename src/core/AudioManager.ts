import { getBlockDefinition, type BlockId } from '../blocks';
import {
  catalogFiles,
  resolveCatalogEvent,
  sfxAssetBaseUrl,
} from '../audio/soundCatalog';
import {
  GLOBAL_MAX_SOURCES,
  canStartVoice,
  chooseVariantIndex,
  clampVolume,
  distanceBetween,
  linearAttenuation,
  samplePitch,
  shouldSkipDistant,
  stereoPan,
} from '../audio/audioMath';
import {
  materialSoundEvent,
  type AudioListenerPose,
  type AudioVec3,
  type BlockSoundAction,
  type PlaySoundOptions,
  type SoundBus,
  type SoundEventId,
} from '../audio/soundEvents';

interface ActiveVoice {
  readonly bus: SoundBus;
  readonly priority: number;
  readonly source: AudioBufferSourceNode;
  readonly nodes: Array<{ disconnect(): void }>;
}

export interface AudioPlayRecord {
  readonly event: SoundEventId;
  readonly file: string;
  readonly pitch: number;
  readonly volume: number;
  readonly positional: boolean;
}

export type AudioDropReason = 'muted' | 'paused' | 'volume_zero' | 'context_not_running'
  | 'too_far' | 'bus_saturated' | 'global_saturated'
  | 'asset_permanent_missing' | 'asset_transient_failure' | 'pending_cap' | 'playback_failed';

export interface AudioDropRecord {
  readonly event: SoundEventId;
  readonly file: string;
  readonly reason: AudioDropReason;
  readonly contextState: string;
  readonly bus: SoundBus;
  readonly busActive: number;
  readonly busLimit: number;
  readonly priority: number;
  readonly lowestBusPriority?: number;
  readonly globalActive: number;
  readonly lowestGlobalPriority?: number;
}

export interface AudioTransientFailure {
  readonly file: string;
  readonly failureCount: number;
  readonly lastFailureAt: number;
  readonly nextRetryAt: number;
}

export interface AudioDebugSnapshot {
  readonly bufferCount: number;
  readonly catalogFiles: number;
  readonly voiceCount: number;
  readonly paused: boolean;
  readonly muted: boolean;
  readonly masterVolume: number;
  readonly contextState: string;
  readonly missingFiles: readonly string[];
  readonly permanentMissingFiles: readonly string[];
  readonly transientFailures: readonly AudioTransientFailure[];
  readonly missingEvents: readonly string[];
  readonly recentPlays: readonly AudioPlayRecord[];
  readonly recentDrops: readonly AudioDropRecord[];
}

const RECENT_PLAY_CAP = 24;
const RECENT_DROP_CAP = 24;
const PENDING_START_CAP = 64;
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 30_000;

export interface AudioManagerOptions {
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly random?: () => number;
  readonly isDev?: boolean;
  readonly now?: () => number;
  readonly audioContextFactory?: () => AudioContext;
}

/**
 * Canonical game audio. Decoded AudioBuffers are cached and reused.
 * Procedural `playTone` remains a DEV/debug fallback only.
 */
export class AudioManager {
  masterVolume = 0.7;
  muted = false;
  private context?: AudioContext;
  private masterGain?: GainNode;
  private paused = false;
  private readonly raw = new Map<string, ArrayBuffer>();
  private readonly fetching = new Map<string, Promise<ArrayBuffer | undefined>>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly decoding = new Map<string, Promise<AudioBuffer | undefined>>();
  /** Only confirmed missing HTTP assets or invalid encoded samples go here. */
  private readonly missingFiles = new Set<string>();
  private readonly transientFailures = new Map<string, AudioTransientFailure>();
  private readonly missingEvents = new Set<string>();
  private readonly voices: ActiveVoice[] = [];
  private readonly busActive: Record<SoundBus, number> = {
    blockHit: 0,
    blockBreak: 0,
    blockPlace: 0,
    footstep: 0,
    explosion: 0,
    combat: 0,
    ui: 0,
    world: 0,
  };
  private preloadTask?: Promise<void>;
  private pendingStarts = 0;
  private readonly recentPlays: AudioPlayRecord[] = [];
  private readonly recentDrops: AudioDropRecord[] = [];
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly isDev: boolean;
  private readonly contextFactory?: () => AudioContext;

  constructor(options: AudioManagerOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    this.baseUrl = options.baseUrl ?? sfxAssetBaseUrl(import.meta.env.BASE_URL);
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.isDev = options.isDev ?? (typeof import.meta !== 'undefined' && import.meta.env?.DEV === true);
    this.contextFactory = options.audioContextFactory;
  }

  setVolume(volume: number): void {
    this.masterVolume = clampVolume(volume);
    this.syncMasterGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.syncMasterGain();
  }

  pause(): void {
    this.paused = true;
    void this.context?.suspend();
  }

  resume(): void {
    this.paused = false;
    this.ensureContext();
    void this.context?.resume();
    this.syncMasterGain();
    void this.decodePending();
  }

  /** Fetch all catalog files concurrently. Decode when an AudioContext exists. Never throws. */
  preload(): Promise<void> {
    this.preloadTask ??= this.loadCatalog().catch((error) => {
      this.warn('Core SFX preload failed; gameplay continues without samples.', error);
    });
    return this.preloadTask;
  }

  play(event: SoundEventId, options?: PlaySoundOptions): void {
    this.playInternal(event, undefined, undefined, options);
  }

  playAt(
    event: SoundEventId,
    worldPosition: AudioVec3,
    listener?: AudioListenerPose,
    options?: PlaySoundOptions,
  ): void {
    this.playInternal(event, worldPosition, listener, options);
  }

  debugSnapshot(): AudioDebugSnapshot {
    return {
      bufferCount: this.buffers.size,
      catalogFiles: catalogFiles().length,
      voiceCount: this.voices.length,
      paused: this.paused,
      muted: this.muted,
      masterVolume: this.masterVolume,
      contextState: this.context?.state ?? 'none',
      missingFiles: [...this.missingFiles],
      permanentMissingFiles: [...this.missingFiles],
      transientFailures: [...this.transientFailures.values()],
      missingEvents: [...this.missingEvents],
      recentPlays: this.recentPlays.slice(),
      recentDrops: this.recentDrops.slice(),
    };
  }

  playBlock(
    action: BlockSoundAction,
    blockId: BlockId,
    worldPosition?: AudioVec3,
    listener?: AudioListenerPose,
    options?: PlaySoundOptions,
  ): void {
    let group: ReturnType<typeof getBlockDefinition>['soundGroup'];
    try {
      group = getBlockDefinition(blockId).soundGroup;
    } catch {
      return;
    }
    if (!group) return;
    const event = action === 'break' && group === 'glass'
      ? 'glass.break'
      : materialSoundEvent(action, group);
    this.playInternal(event, worldPosition, listener, options);
  }

  /**
   * DEV/debug oscillator path. Production gameplay uses decoded samples.
   * Kept so existing tests and fallback callers do not crash.
   */
  playTone(frequency: number, duration = 0.06, gain = 0.035): void {
    if (this.muted || this.paused || this.masterVolume <= 0) return;
    const context = this.ensureContext();
    if (!context) return;
    try {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const now = context.currentTime;
      oscillator.type = 'square';
      oscillator.frequency.value = frequency;
      envelope.gain.setValueAtTime(gain * this.masterVolume, now);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(envelope);
      envelope.connect(this.masterGain ?? context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration);
      oscillator.onended = () => {
        try { oscillator.disconnect(); envelope.disconnect(); } catch { /* already gone */ }
      };
    } catch {
      // Unsupported AudioContext graph must never break the sim.
    }
  }

  private playInternal(
    event: SoundEventId,
    worldPosition: AudioVec3 | undefined,
    listener: AudioListenerPose | undefined,
    options: PlaySoundOptions | undefined,
  ): void {
    const profile = resolveCatalogEvent(event);
    if (!profile) {
      this.warnMissingEvent(event);
      return;
    }
    const file = profile.files[chooseVariantIndex(profile.files.length, this.random)];
    if (!file) {
      this.warnMissingEvent(event);
      return;
    }
    const drop = (reason: AudioDropReason): void => this.recordDrop(event, file, profile, reason);
    if (this.muted) { drop('muted'); return; }
    if (this.paused) { drop('paused'); return; }
    if (this.masterVolume <= 0) { drop('volume_zero'); return; }
    const positional = options?.positional ?? profile.positional;
    if (positional && worldPosition && listener) {
      const distance = distanceBetween(worldPosition, listener);
      if (shouldSkipDistant(distance, profile.maxDistance)
        || linearAttenuation(distance, profile.refDistance, profile.maxDistance) <= 0.008) {
        drop('too_far'); return;
      }
    }

    const context = this.ensureContext();
    if (!context) {
      drop('context_not_running');
      if (this.isDev) this.playTone(320, 0.04, 0.02);
      return;
    }
    const resumeTask = context.state === 'running'
      ? undefined : context.resume().catch(() => { /* gesture may not yet be available */ });

    const position = worldPosition && { ...worldPosition };
    const listenerPose = listener && { ...listener };
    const playOptions = options && { ...options };
    const startReady = (buffer: AudioBuffer): void => {
      if (this.muted) { drop('muted'); return; }
      if (this.paused) { drop('paused'); return; }
      if (this.masterVolume <= 0) { drop('volume_zero'); return; }
      if (context.state !== 'running') { drop('context_not_running'); return; }
      if (positional && position && listenerPose) {
        const distance = distanceBetween(position, listenerPose);
        if (shouldSkipDistant(distance, profile.maxDistance)
          || linearAttenuation(distance, profile.refDistance, profile.maxDistance) <= 0.008) {
          drop('too_far'); return;
        }
      }
      const lowest = this.lowestVoicePriority();
      const admission = canStartVoice({
        globalActive: this.voices.length,
        busActive: this.busActive[profile.bus],
        busLimit: profile.maxConcurrent,
        priority: profile.priority,
        lowestActivePriority: lowest,
        lowestBusPriority: this.lowestVoicePriority(profile.bus),
      });
      if (!admission.play) { drop(admission.rejectReason!); return; }
      if (admission.stealScope && !this.stealVoice(admission.stealScope, profile.bus, profile.priority)) {
        drop(admission.stealScope === 'bus' ? 'bus_saturated' : 'global_saturated');
        return;
      }
      try {
        this.startBuffer(context, buffer, file, profile, position, listenerPose, playOptions, positional);
      } catch (error) {
        drop('playback_failed');
        this.warn('SFX playback failed.', error);
      }
    };
    const buffer = this.buffers.get(file);
    if (buffer) {
      if (resumeTask) {
        if (this.pendingStarts >= PENDING_START_CAP) { drop('pending_cap'); return; }
        this.pendingStarts += 1;
        void resumeTask.then(() => startReady(buffer)).finally(() => { this.pendingStarts -= 1; });
      }
      else startReady(buffer);
      return;
    }
    if (this.missingFiles.has(file)) { drop('asset_permanent_missing'); return; }
    if (this.retryCoolingDown(file)) { drop('asset_transient_failure'); return; }
    if (this.pendingStarts >= PENDING_START_CAP) { drop('pending_cap'); return; }
    this.pendingStarts += 1;
    void this.ensureFileReady(file).then(async (decoded) => {
      if (!decoded) {
        drop(this.missingFiles.has(file) ? 'asset_permanent_missing'
          : this.transientFailures.has(file) ? 'asset_transient_failure' : 'context_not_running');
        return;
      }
      if (resumeTask) await resumeTask;
      startReady(decoded);
    })
      .catch((error) => {
        this.recordTransientFailure(file, error);
        drop('asset_transient_failure');
      })
      .finally(() => { this.pendingStarts -= 1; });
  }

  private startBuffer(
    context: AudioContext,
    buffer: AudioBuffer,
    file: string,
    profile: NonNullable<ReturnType<typeof resolveCatalogEvent>>,
    worldPosition: AudioVec3 | undefined,
    listener: AudioListenerPose | undefined,
    options: PlaySoundOptions | undefined,
    positional: boolean,
  ): void {
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = options?.pitch ?? samplePitch(profile, this.random);
    const volume = clampVolume(profile.volume * (options?.volume ?? 1));
    gain.gain.value = volume;

    const nodes: Array<{ disconnect(): void }> = [source, gain];
    source.connect(gain);
    let output: AudioNode = gain;

    if (positional && worldPosition) {
      const panner = this.createPanner(context, worldPosition, listener, profile.maxDistance, profile.refDistance);
      if (panner) {
        gain.connect(panner);
        output = panner;
        nodes.push(panner);
      } else if (listener && typeof context.createStereoPanner === 'function') {
        const stereo = context.createStereoPanner();
        stereo.pan.value = stereoPan(worldPosition, listener);
        const distance = distanceBetween(worldPosition, listener);
        gain.gain.value = volume * linearAttenuation(distance, profile.refDistance, profile.maxDistance);
        gain.connect(stereo);
        output = stereo;
        nodes.push(stereo);
      } else if (listener) {
        const distance = distanceBetween(worldPosition, listener);
        gain.gain.value = volume * linearAttenuation(distance, profile.refDistance, profile.maxDistance);
      }
    }

    output.connect(this.masterGain ?? context.destination);
    const voice: ActiveVoice = { bus: profile.bus, priority: profile.priority, source, nodes };
    this.voices.push(voice);
    this.busActive[profile.bus] += 1;
    source.onended = () => this.releaseVoice(voice);
    try { source.start(0); }
    catch (error) { this.releaseVoice(voice); throw error; }
    this.recentPlays.push({
      event: profile.event,
      file,
      pitch: source.playbackRate.value,
      volume,
      positional,
    });
    if (this.recentPlays.length > RECENT_PLAY_CAP) this.recentPlays.shift();
  }

  private lowestVoicePriority(bus?: SoundBus): number {
    let lowest = Infinity;
    for (const voice of this.voices) {
      if (bus === undefined || voice.bus === bus) lowest = Math.min(lowest, voice.priority);
    }
    return lowest;
  }

  private recordDrop(
    event: SoundEventId,
    file: string,
    profile: NonNullable<ReturnType<typeof resolveCatalogEvent>>,
    reason: AudioDropReason,
  ): void {
    const lowestBus = this.lowestVoicePriority(profile.bus);
    const lowestGlobal = this.lowestVoicePriority();
    this.recentDrops.push({
      event, file, reason,
      contextState: this.context?.state ?? 'none',
      bus: profile.bus,
      busActive: this.busActive[profile.bus],
      busLimit: profile.maxConcurrent,
      priority: profile.priority,
      ...(Number.isFinite(lowestBus) ? { lowestBusPriority: lowestBus } : {}),
      globalActive: this.voices.length,
      ...(Number.isFinite(lowestGlobal) ? { lowestGlobalPriority: lowestGlobal } : {}),
    });
    if (this.recentDrops.length > RECENT_DROP_CAP) this.recentDrops.shift();
  }

  private createPanner(
    context: AudioContext,
    position: AudioVec3,
    listener: AudioListenerPose | undefined,
    maxDistance: number,
    refDistance: number,
  ): PannerNode | undefined {
    if (typeof context.createPanner !== 'function') return undefined;
    const panner = context.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'linear';
    panner.refDistance = refDistance;
    panner.maxDistance = maxDistance;
    panner.rolloffFactor = 1;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;
    if (listener) this.applyListener(context, listener);
    return panner;
  }

  private applyListener(context: AudioContext, listener: AudioListenerPose): void {
    const node = context.listener;
    if (!node) return;
    node.positionX.value = listener.x;
    node.positionY.value = listener.y;
    node.positionZ.value = listener.z;
    const yaw = listener.yaw ?? 0;
    const pitch = listener.pitch ?? 0;
    const fx = -Math.sin(yaw) * Math.cos(pitch);
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * Math.cos(pitch);
    node.forwardX.value = fx;
    node.forwardY.value = fy;
    node.forwardZ.value = fz;
    node.upX.value = 0;
    node.upY.value = 1;
    node.upZ.value = 0;
  }

  private stealVoice(scope: 'bus' | 'global', bus: SoundBus, incomingPriority: number): boolean {
    let index = -1;
    let best = incomingPriority;
    for (let i = 0; i < this.voices.length; i += 1) {
      const voice = this.voices[i]!;
      if ((scope === 'global' || voice.bus === bus) && voice.priority < best) {
        index = i;
        best = voice.priority;
      }
    }
    if (index < 0) return false;
    const voice = this.voices[index]!;
    try { voice.source.stop(); } catch { /* already stopped */ }
    this.releaseVoice(voice);
    return true;
  }

  private releaseVoice(voice: ActiveVoice): void {
    const index = this.voices.indexOf(voice);
    if (index < 0) return;
    this.voices.splice(index, 1);
    this.busActive[voice.bus] = Math.max(0, this.busActive[voice.bus] - 1);
    for (const node of voice.nodes) {
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
  }

  private ensureContext(): AudioContext | undefined {
    if (this.context) return this.context;
    try {
      if (this.contextFactory) {
        this.context = this.contextFactory();
      } else {
        const AudioContextClass = (typeof window !== 'undefined'
          ? (window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
          : undefined);
        if (!AudioContextClass) return undefined;
        this.context = new AudioContextClass();
      }
      this.masterGain = this.context.createGain();
      this.masterGain.connect(this.context.destination);
      this.syncMasterGain();
      void this.decodePending();
      return this.context;
    } catch {
      this.context = undefined;
      return undefined;
    }
  }

  private syncMasterGain(): void {
    if (!this.masterGain) return;
    this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
  }

  private async loadCatalog(): Promise<void> {
    const files = catalogFiles();
    await Promise.all(files.map((file) => this.fetchFile(file)));
    await this.decodePending();
  }

  private fetchFile(file: string): Promise<ArrayBuffer | undefined> {
    const cached = this.raw.get(file);
    if (cached) return Promise.resolve(cached);
    if (this.missingFiles.has(file)) return Promise.resolve(undefined);
    if (this.retryCoolingDown(file)) return Promise.resolve(undefined);
    const inflight = this.fetching.get(file);
    if (inflight) return inflight;
    // Register before invoking fetch, including implementations that fail synchronously.
    const task = Promise.resolve().then(async () => {
      try {
        const response = await this.fetchImpl(this.assetUrl(file));
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          if (response.status === 404 || response.status === 410) this.markPermanentMissingFile(file, error);
          else this.recordTransientFailure(file, error);
          return undefined;
        }
        const data = await response.arrayBuffer();
        this.raw.set(file, data);
        this.transientFailures.delete(file);
        return data;
      } catch (error) {
        this.recordTransientFailure(file, error);
        return undefined;
      }
    }).finally(() => { this.fetching.delete(file); });
    this.fetching.set(file, task);
    return task;
  }

  private async ensureFileReady(file: string): Promise<AudioBuffer | undefined> {
    if (this.missingFiles.has(file)) return undefined;
    if (this.retryCoolingDown(file)) return undefined;
    if (!this.raw.has(file) && !await this.fetchFile(file)) return undefined;
    return this.decodeFile(file);
  }

  private async decodePending(): Promise<void> {
    this.ensureContext();
    if (!this.context) return;
    await Promise.all([...this.raw.keys()].map((file) => this.decodeFile(file)));
  }

  private decodeFile(file: string): Promise<AudioBuffer | undefined> {
    const existing = this.buffers.get(file);
    if (existing) return Promise.resolve(existing);
    if (this.missingFiles.has(file)) return Promise.resolve(undefined);
    if (this.retryCoolingDown(file)) return Promise.resolve(undefined);
    const inflight = this.decoding.get(file);
    if (inflight) return inflight;
    // Schedule after registering the promise so even an immediate failure clears it.
    const task = Promise.resolve().then(() => this.decodeFileNow(file))
      .finally(() => { this.decoding.delete(file); });
    this.decoding.set(file, task);
    return task;
  }

  private async decodeFileNow(file: string): Promise<AudioBuffer | undefined> {
    const context = this.ensureContext();
    const data = this.raw.get(file);
    if (!context || !data) return undefined;
    try {
      const copy = data.slice(0);
      const decoded = await context.decodeAudioData(copy);
      this.buffers.set(file, decoded);
      this.transientFailures.delete(file);
      return decoded;
    } catch (error) {
      const name = error instanceof Error ? error.name : undefined;
      if (name === 'EncodingError' || name === 'DataError') this.markPermanentMissingFile(file, error);
      else this.recordTransientFailure(file, error);
      return undefined;
    }
  }

  private assetUrl(file: string): string {
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
    return `${base}${file}`;
  }

  private retryCoolingDown(file: string): boolean {
    const failure = this.transientFailures.get(file);
    return failure !== undefined && this.now() < failure.nextRetryAt;
  }

  private recordTransientFailure(file: string, error?: unknown): void {
    const previous = this.transientFailures.get(file);
    const failureCount = (previous?.failureCount ?? 0) + 1;
    const lastFailureAt = this.now();
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(failureCount - 1, 7));
    this.transientFailures.set(file, { file, failureCount, lastFailureAt, nextRetryAt: lastFailureAt + delay });
    this.warn(`Temporary SFX failure; retry after ${delay} ms: ${file}`, error);
  }

  private markPermanentMissingFile(file: string, error?: unknown): void {
    if (this.missingFiles.has(file)) return;
    this.missingFiles.add(file);
    this.transientFailures.delete(file);
    this.raw.delete(file);
    this.warn(`Missing or undecodable SFX file: ${file}`, error);
  }

  private warnMissingEvent(event: string): void {
    if (this.missingEvents.has(event)) return;
    this.missingEvents.add(event);
    this.warn(`No sample mapped for sound event: ${event}`);
  }

  private warn(message: string, error?: unknown): void {
    if (!this.isDev) return;
    if (error !== undefined) console.warn(message, error);
    else console.warn(message);
  }
}
