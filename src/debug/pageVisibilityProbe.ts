/**
 * DEV-only page visibility / hidden-tab motion probe.
 *
 * Proves whether RAF, prediction, input send, and player_state continue while
 * the game tab is hidden — and whether resume dumps a snapshot/input burst
 * into the local player.
 */

import type { PlayerSnapshot } from '../../shared/protocol';
import {
  type HiddenTabCorrection,
  type HiddenTabPacketSample,
  type HiddenTabResumeWindow,
  type HiddenTabVisibilitySnapshot,
  beginResumeWindow,
  hiddenTabPacketSample,
  noteResumePacket,
  summarizeResumeWindow,
} from '../net/hiddenTabMotion';

export const VISIBILITY_PROBE_WINDOW_MS = 500;
export const VISIBILITY_PROBE_FIRST_FRAMES = 20;

export interface PageVisibilityHud {
  visibility: 'visible' | 'hidden';
  focused: boolean;
  hiddenDurationMs: number;
  resumeTicks: number;
  resumeSnapshots: number;
  hiddenInputs: number;
  hiddenTicks: number;
  hiddenSnapshots: number;
  lastHiddenFrameDeltaMs: number;
  lastVisibleFrameDeltaMs: number;
  resumeFrameDeltas: number[];
}

export class PageVisibilityProbe {
  visibility: 'visible' | 'hidden' = 'visible';
  focused = true;
  hiddenAtMs: number | null = null;
  visibleAtMs: number | null = null;
  lastHiddenDurationMs = 0;

  inputsWhileHidden = 0;
  ticksWhileHidden = 0;
  snapshotsWhileHidden = 0;
  ticksAfterResume = 0;
  snapshotsAfterResume = 0;
  lastHiddenFrameDeltaMs = 0;
  lastVisibleFrameDeltaMs = 0;
  resumeFrameDeltas: number[] = [];
  lastResumeWindow: HiddenTabResumeWindow | null = null;
  lastResumeSummary: ReturnType<typeof summarizeResumeWindow> | null = null;

  localPredSeq = 0;
  lastAckSeq = 0;
  pendingHistory = 0;
  accumulator = 0;
  alpha = 0;
  lastSnapshotAt = 0;
  lastLog = '';

  private resumeUntilMs = 0;
  private capturingResumeFrames = 0;

  resetSession(): void {
    this.visibility = 'visible';
    this.focused = true;
    this.hiddenAtMs = null;
    this.visibleAtMs = null;
    this.lastHiddenDurationMs = 0;
    this.inputsWhileHidden = 0;
    this.ticksWhileHidden = 0;
    this.snapshotsWhileHidden = 0;
    this.ticksAfterResume = 0;
    this.snapshotsAfterResume = 0;
    this.lastHiddenFrameDeltaMs = 0;
    this.lastVisibleFrameDeltaMs = 0;
    this.resumeFrameDeltas = [];
    this.lastResumeWindow = null;
    this.lastResumeSummary = null;
    this.resumeUntilMs = 0;
    this.capturingResumeFrames = 0;
    this.lastLog = '';
  }

  snapshotNow(now = nowMs()): HiddenTabVisibilitySnapshot {
    return {
      visibility: this.visibility,
      focused: this.focused,
      hiddenDurationMs:
        this.visibility === 'hidden' && this.hiddenAtMs != null
          ? Math.round(now - this.hiddenAtMs)
          : this.lastHiddenDurationMs,
    };
  }

  noteFrame(elapsedSeconds: number, now = nowMs()): void {
    const deltaMs = elapsedSeconds * 1000;
    if (this.visibility === 'hidden') {
      this.lastHiddenFrameDeltaMs = deltaMs;
      return;
    }
    this.lastVisibleFrameDeltaMs = deltaMs;
    if (this.capturingResumeFrames > 0) {
      this.resumeFrameDeltas.push(Math.round(deltaMs * 10) / 10);
      this.capturingResumeFrames -= 1;
    }
    void now;
  }

  noteInputSent(now = nowMs()): void {
    if (this.visibility === 'hidden') this.inputsWhileHidden += 1;
    void now;
  }

  noteTick(now = nowMs()): void {
    if (this.visibility === 'hidden') {
      this.ticksWhileHidden += 1;
      return;
    }
    if (now <= this.resumeUntilMs) this.ticksAfterResume += 1;
  }

  noteSnapshot(
    snapshot: PlayerSnapshot,
    now = nowMs(),
    extras?: { physicsTicks?: number; history?: { x: number; y: number; z: number } | null },
  ): void {
    this.lastSnapshotAt = now;
    if (this.visibility === 'hidden') {
      this.snapshotsWhileHidden += 1;
      return;
    }
    if (now <= this.resumeUntilMs && this.lastResumeWindow) {
      this.snapshotsAfterResume += 1;
      noteResumePacket(this.lastResumeWindow, hiddenTabPacketSample({
        receivedAt: now,
        snapshot,
        history: extras?.history ?? null,
        physicsTicks: extras?.physicsTicks,
        correction: 'pending',
      }));
    }
  }

  noteResumeSample(sample: HiddenTabPacketSample): void {
    if (!this.lastResumeWindow) return;
    this.snapshotsAfterResume += 1;
    noteResumePacket(this.lastResumeWindow, sample);
  }

  noteCorrection(correction: HiddenTabCorrection, now = nowMs()): void {
    if (now <= this.resumeUntilMs && this.lastResumeWindow) {
      this.lastResumeWindow.corrections.push(correction);
    }
  }

  notifyHidden(
    now: number,
    context: {
      predSeq: number;
      ackSeq: number;
      pending: number;
      accumulator: number;
      alpha: number;
    },
  ): void {
    if (this.visibility === 'hidden') return;
    this.visibility = 'hidden';
    this.hiddenAtMs = now;
    this.inputsWhileHidden = 0;
    this.ticksWhileHidden = 0;
    this.snapshotsWhileHidden = 0;
    this.localPredSeq = context.predSeq;
    this.lastAckSeq = context.ackSeq;
    this.pendingHistory = context.pending;
    this.accumulator = context.accumulator;
    this.alpha = context.alpha;
    this.lastLog = this.formatTransitionLog('visible -> hidden', now);
    this.emit(this.lastLog);
  }

  notifyVisible(
    now: number,
    context: {
      predSeq: number;
      ackSeq: number;
      pending: number;
      accumulator: number;
      alpha: number;
    },
  ): HiddenTabResumeWindow {
    if (this.visibility === 'visible' && this.lastResumeWindow) return this.lastResumeWindow;
    const hiddenMs =
      this.hiddenAtMs != null ? Math.round(now - this.hiddenAtMs) : 0;
    this.visibility = 'visible';
    this.visibleAtMs = now;
    this.lastHiddenDurationMs = hiddenMs;
    this.ticksAfterResume = 0;
    this.snapshotsAfterResume = 0;
    this.resumeFrameDeltas = [];
    this.capturingResumeFrames = VISIBILITY_PROBE_FIRST_FRAMES;
    this.resumeUntilMs = now + VISIBILITY_PROBE_WINDOW_MS;
    this.lastResumeWindow = beginResumeWindow(now, VISIBILITY_PROBE_WINDOW_MS);
    this.localPredSeq = context.predSeq;
    this.lastAckSeq = context.ackSeq;
    this.pendingHistory = context.pending;
    this.accumulator = context.accumulator;
    this.alpha = context.alpha;
    this.lastLog = this.formatTransitionLog('hidden -> visible', now);
    this.emit(this.lastLog);
    return this.lastResumeWindow;
  }

  notifyFocus(focused: boolean, now = nowMs()): void {
    this.focused = focused;
    this.emit(
      `[vis] ${focused ? 'focus' : 'blur'} t=${now.toFixed(1)} vis=${this.visibility}`,
    );
  }

  closeResumeWindow(now = nowMs()): void {
    if (!this.lastResumeWindow || this.resumeUntilMs === 0 || now < this.resumeUntilMs) return;
    this.lastResumeSummary = summarizeResumeWindow(this.lastResumeWindow);
    const rates = this.hiddenRates(this.lastHiddenDurationMs);
    this.emit(
      `[vis-resume] hiddenMs=${this.lastHiddenDurationMs} ` +
        `hidIn=${this.inputsWhileHidden} (${rates.inputsPerSec.toFixed(1)}/s) ` +
        `hidTick=${this.ticksWhileHidden} (${rates.ticksPerSec.toFixed(1)}/s) ` +
        `hidSnap=${this.snapshotsWhileHidden} (${rates.snapsPerSec.toFixed(1)}/s) ` +
        `resumeTk=${this.ticksAfterResume} resumeSnap=${this.snapshotsAfterResume} ` +
        `burst=${this.lastResumeSummary.snapshotBurst} uniqueSeq=${this.lastResumeSummary.uniqueInputSeqs.join(',')} ` +
        `firstCorr=${this.lastResumeSummary.firstCorrection?.reason ?? 'none'} ` +
        `frames=${this.resumeFrameDeltas.slice(0, 8).join(',')}`,
    );
    this.resumeUntilMs = 0;
  }

  formatHud(): string {
    const vis = this.visibility;
    const foc = this.focused ? 1 : 0;
    const hidMs =
      vis === 'hidden' && this.hiddenAtMs != null
        ? Math.round(nowMs() - this.hiddenAtMs)
        : this.lastHiddenDurationMs;
    return (
      `visibility=${vis} focus=${foc} hiddenDurationMs=${hidMs}\n` +
      `resumeTicks=${this.ticksAfterResume} resumeSnapshots=${this.snapshotsAfterResume}`
    );
  }

  hiddenRates(hiddenMs: number): { inputsPerSec: number; ticksPerSec: number; snapsPerSec: number } {
    const seconds = Math.max(0.001, hiddenMs / 1000);
    return {
      inputsPerSec: this.inputsWhileHidden / seconds,
      ticksPerSec: this.ticksWhileHidden / seconds,
      snapsPerSec: this.snapshotsWhileHidden / seconds,
    };
  }

  private formatTransitionLog(kind: string, now: number): string {
    return (
      `[vis] ${kind} t=${now.toFixed(1)} hidden=${this.visibility === 'hidden'} ` +
      `predSeq=${this.localPredSeq} ackSeq=${this.lastAckSeq} pending=${this.pendingHistory} ` +
      `acc=${this.accumulator.toFixed(4)} alpha=${this.alpha.toFixed(3)} lastSnap=${this.lastSnapshotAt.toFixed(1)} ` +
      `hidSnap=${this.snapshotsWhileHidden} hidIn=${this.inputsWhileHidden} hidTick=${this.ticksWhileHidden}`
    );
  }

  private emit(line: string): void {
    if (typeof console === 'undefined') return;
    console.debug(line);
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function attachPageVisibilityListeners(
  probe: PageVisibilityProbe,
  onHidden: (now: number) => void,
  onVisible: (now: number) => void,
): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => undefined;
  }
  const onVisibility = (): void => {
    const now = nowMs();
    const hidden = document.hidden || document.visibilityState === 'hidden';
    if (hidden && probe.visibility !== 'hidden') onHidden(now);
    if (!hidden && probe.visibility === 'hidden') onVisible(now);
  };
  const onFocus = (): void => probe.notifyFocus(true);
  const onBlur = (): void => probe.notifyFocus(false);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  probe.visibility = document.hidden ? 'hidden' : 'visible';
  probe.focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
  };
}
