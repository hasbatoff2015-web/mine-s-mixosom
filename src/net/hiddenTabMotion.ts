/**
 * Hidden-tab / Page Visibility motion policy for Online Anarchy.
 *
 * Proven failure (single game tab, no duplicate session):
 *   GameLifecycle BACKGROUND zeroes the accumulator and skips tickOnline, so
 *   the client sends 0 inputs and predicts 0 ticks while hidden. The server
 *   keeps applying lastInput at 20 TPS. Returning visible then either ignores
 *   duplicate-seq snapshots or catch-up-ticks from a stale pose — jitter.
 *
 * Resume policy (does not change walk physics, tolerances, or TPS):
 *   hide  → one idle input so the server stops walking
 *   show  → discard wall-clock catch-up; snap local player to latest snapshot
 */

import { FIXED_DT, MAX_CATCH_UP_TICKS, WALK_SPEED } from '../core/constants';
import { worldSimulationActive } from '../core/gameplayModal';
import type { LifecycleState } from '../core/lifecycleTypes';
import { PlayerController } from '../player/PlayerController';
import type { PlayerSnapshot } from '../../shared/protocol';
import {
  resetPredictionBuffer,
  restoreAuthoritativePlayer,
  type PredictionBuffer,
  type ReconcileResult,
} from './localPlayerPrediction';

export const HIDDEN_TAB_RESUME_WINDOW_MS = 500;

export interface HiddenTabVisibilitySnapshot {
  visibility: 'visible' | 'hidden';
  focused: boolean;
  hiddenDurationMs: number;
}

export interface HiddenTabPacketSample {
  receivedAt: number;
  inputSeq: number;
  physicsTicks?: number;
  authoritative: { x: number; y: number; z: number };
  history: { x: number; y: number; z: number } | null;
  correction: ReconcileResult | 'pending' | 'forced-resync';
}

export interface HiddenTabCorrection {
  at: number;
  dx: number;
  dz: number;
  reason: string;
}

export interface HiddenTabResumeWindow {
  startedAt: number;
  until: number;
  packets: HiddenTabPacketSample[];
  corrections: HiddenTabCorrection[];
}

export interface HiddenTabResumeDecision {
  sendIdleOnHide: boolean;
  resetClockOnResume: boolean;
  forceAuthoritativeResync: boolean;
  reason: string;
}

export function evaluateHiddenTabResume(args: {
  previousLifecycle: LifecycleState;
  nextLifecycle: LifecycleState;
  online: boolean;
}): HiddenTabResumeDecision {
  if (!args.online) {
    return {
      sendIdleOnHide: false,
      resetClockOnResume: args.previousLifecycle === 'BACKGROUND',
      forceAuthoritativeResync: false,
      reason: 'offline',
    };
  }
  if (args.nextLifecycle === 'BACKGROUND' && worldSimulationActive(args.previousLifecycle)) {
    return {
      sendIdleOnHide: true,
      resetClockOnResume: false,
      forceAuthoritativeResync: false,
      reason: 'hide-idle',
    };
  }
  if (args.previousLifecycle === 'BACKGROUND') {
    return {
      sendIdleOnHide: false,
      resetClockOnResume: true,
      forceAuthoritativeResync: args.nextLifecycle === 'PLAYING',
      reason: args.nextLifecycle === 'PLAYING' ? 'resume-resync' : 'resume-clock',
    };
  }
  return {
    sendIdleOnHide: false,
    resetClockOnResume: false,
    forceAuthoritativeResync: false,
    reason: 'no-op',
  };
}

export function beginResumeWindow(
  now: number,
  durationMs = HIDDEN_TAB_RESUME_WINDOW_MS,
): HiddenTabResumeWindow {
  return {
    startedAt: now,
    until: now + durationMs,
    packets: [],
    corrections: [],
  };
}

export function noteResumePacket(
  window: HiddenTabResumeWindow,
  sample: HiddenTabPacketSample,
): void {
  if (sample.receivedAt > window.until) return;
  window.packets.push(sample);
}

export function summarizeResumeWindow(window: HiddenTabResumeWindow): {
  snapshotBurst: number;
  uniqueInputSeqs: number[];
  firstCorrection: HiddenTabCorrection | null;
  maxPoseGap: number;
} {
  const seqs = new Set(window.packets.map((packet) => packet.inputSeq));
  let maxPoseGap = 0;
  for (const packet of window.packets) {
    if (!packet.history) continue;
    const dx = packet.authoritative.x - packet.history.x;
    const dz = packet.authoritative.z - packet.history.z;
    maxPoseGap = Math.max(maxPoseGap, Math.hypot(dx, dz));
  }
  return {
    snapshotBurst: window.packets.length,
    uniqueInputSeqs: [...seqs].sort((a, b) => a - b),
    firstCorrection: window.corrections[0] ?? null,
    maxPoseGap,
  };
}

/** Expected server travel while the client is frozen and lastInput stays W. */
export function hiddenServerTravelMeters(hiddenSeconds: number, speed = WALK_SPEED): number {
  return speed * hiddenSeconds;
}

export function maxResumeCatchUpTicks(): number {
  return MAX_CATCH_UP_TICKS;
}

export function resumeCatchUpSeconds(): number {
  return MAX_CATCH_UP_TICKS * FIXED_DT;
}

export function shouldPausePrediction(lifecycle: LifecycleState): boolean {
  return !worldSimulationActive(lifecycle);
}

/**
 * Snap local movement to the latest authoritative snapshot after a hidden tab.
 * Camera yaw/pitch are preserved (restoreAuthoritativePlayer does not write look).
 * History is wiped so the next input starts a fresh prediction timeline.
 */
export function resyncLocalPlayerAfterHiddenTab(args: {
  player: PlayerController;
  buffer: PredictionBuffer;
  snapshot: PlayerSnapshot;
  inputSeq: number;
}): { lastAckedSeq: number; nextInputSeq: number } {
  restoreAuthoritativePlayer(args.player, args.snapshot, undefined);
  resetPredictionBuffer(args.buffer);
  const ackSeq = Number.isFinite(args.snapshot.inputSeq) ? args.snapshot.inputSeq! : -1;
  args.buffer.lastAckedSeq = ackSeq;
  return {
    lastAckedSeq: ackSeq,
    nextInputSeq: Math.max(args.inputSeq, ackSeq),
  };
}

export function hiddenTabPacketSample(args: {
  receivedAt: number;
  snapshot: PlayerSnapshot;
  history: { x: number; y: number; z: number } | null;
  physicsTicks?: number;
  correction: HiddenTabPacketSample['correction'];
}): HiddenTabPacketSample {
  return {
    receivedAt: args.receivedAt,
    inputSeq: args.snapshot.inputSeq ?? -1,
    physicsTicks: args.physicsTicks,
    authoritative: { x: args.snapshot.x, y: args.snapshot.y, z: args.snapshot.z },
    history: args.history,
    correction: args.correction,
  };
}
