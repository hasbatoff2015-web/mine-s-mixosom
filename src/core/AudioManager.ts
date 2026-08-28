import { getBlockDefinition, type BlockId } from '../blocks';
import {
  SFX_BASE_PATH,
  catalogFiles,
  resolveCatalogEvent,
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

export interface AudioDebugSnapshot {
  readonly bufferCount: number;
  readonly catalogFiles: number;
  readonly voiceCount: number;
  readonly paused: boolean;
  readonly muted: boolean;
  readonly masterVolume: number;
  readonly contextState: string;
  readonly missingFiles: readonly string[];
  readonly missingEvents: readonly string[];
  readonly recentPlays: readonly AudioPlayRecord[];
}

const RECENT_PLAY_CAP = 24;

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
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly decoding = new Map<string, Promise<AudioBuffer | undefined>>();
  private readonly missingFiles = new Set<string>();
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
  private readonly recentPlays: AudioPlayRecord[] = [];
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly random: () => number;
  private readonly isDev: boolean;
  private readonly contextFactory?: () => AudioContext;

  constructor(options: AudioManagerOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    this.baseUrl = options.baseUrl ?? SFX_BASE_PATH;
    this.random = options.random ?? Math.random;
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
      missingEvents: [...this.missingEvents],
      recentPlays: this.recentPlays.slice(),
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
    if (this.muted || this.paused || this.masterVolume <= 0) return;
    const profile = resolveCatalogEvent(event);
    if (!profile) {
      this.warnMissingEvent(event);
      return;
    }
    const positional = options?.positional ?? profile.positional;
    if (positional && worldPosition && listener) {
      const distance = distanceBetween(worldPosition, listener);
      if (shouldSkipDistant(distance, profile.maxDistance)) return;
      if (linearAttenuation(distance, profile.refDistance, profile.maxDistance) <= 0.008) return;
    }

    const lowest = this.voices.reduce((min, voice) => Math.min(min, voice.priority), 100);
    const admission = canStartVoice({
      globalActive: this.voices.length,
      busActive: this.busActive[profile.bus],
      busLimit: profile.maxConcurrent,
      priority: profile.priority,
      lowestActivePriority: lowest,
    });
    if (!admission.play) return;
    if (admission.steal) this.stealVoice(profile.bus, profile.priority);

    const context = this.ensureContext();
    if (!context) {
      if (this.isDev) this.playTone(320, 0.04, 0.02);
      return;
    }
    void context.resume();

    const file = profile.files[chooseVariantIndex(profile.files.length, this.random)];
    if (!file) {
      this.warnMissingEvent(event);
      return;
    }
    const buffer = this.buffers.get(file);
    if (!buffer) {
      void this.decodeFile(file);
      if (this.isDev && this.raw.has(file) === false) this.warnMissingEvent(event);
      return;
    }

    try {
      this.startBuffer(context, buffer, file, profile, worldPosition, listener, options, positional);
    } catch (error) {
      this.warn('SFX playback failed.', error);
    }
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
    this.recentPlays.push({
      event: profile.event,
      file,
      pitch: source.playbackRate.value,
      volume,
      positional,
    });
    if (this.recentPlays.length > RECENT_PLAY_CAP) this.recentPlays.shift();
    source.onended = () => this.releaseVoice(voice);
    source.start(0);
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

  private stealVoice(bus: SoundBus, incomingPriority: number): void {
    let index = -1;
    let best = incomingPriority;
    for (let i = 0; i < this.voices.length; i += 1) {
      const voice = this.voices[i]!;
      if (voice.bus === bus || voice.priority < best) {
        index = i;
        best = voice.priority;
        if (voice.bus === bus && voice.priority <= incomingPriority) break;
      }
    }
    if (index < 0) return;
    const voice = this.voices[index]!;
    try { voice.source.stop(); } catch { /* already stopped */ }
    this.releaseVoice(voice);
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
    await Promise.all(files.map(async (file) => {
      if (this.raw.has(file) || this.buffers.has(file)) return;
      try {
        const response = await this.fetchImpl(this.assetUrl(file));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.raw.set(file, await response.arrayBuffer());
      } catch (error) {
        this.warnMissingFile(file, error);
      }
    }));
    await this.decodePending();
  }

  private async decodePending(): Promise<void> {
    this.ensureContext();
    if (!this.context) return;
    await Promise.all([...this.raw.keys()].map((file) => this.decodeFile(file)));
  }

  private decodeFile(file: string): Promise<AudioBuffer | undefined> {
    const existing = this.buffers.get(file);
    if (existing) return Promise.resolve(existing);
    const inflight = this.decoding.get(file);
    if (inflight) return inflight;
    const task = this.decodeFileNow(file);
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
      return decoded;
    } catch (error) {
      this.warnMissingFile(file, error);
      return undefined;
    } finally {
      this.decoding.delete(file);
    }
  }

  private assetUrl(file: string): string {
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
    return `${base}${file}`;
  }

  private warnMissingFile(file: string, error?: unknown): void {
    if (this.missingFiles.has(file)) return;
    this.missingFiles.add(file);
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
