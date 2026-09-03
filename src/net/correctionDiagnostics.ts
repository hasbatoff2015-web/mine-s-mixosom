import { FIXED_DT, WALK_SPEED } from '../core/constants';
import type { PlayerController, PlayerMovementState } from '../player/PlayerController';
import type { PlayerSnapshot } from '../../shared/protocol';
import type { AckRejectReason } from './localMotionDiagnostics';

interface PredictedMoveLike {
  readonly seq: number;
  readonly forward: number;
  readonly right: number;
  readonly jump: boolean;
  readonly sneak: boolean;
  readonly sprint: boolean;
  readonly descend: boolean;
  readonly flySprint: boolean;
  readonly yaw: number;
  readonly pitch: number;
}

interface PredictionBufferLike {
  readonly lastAckedSeq: number;
  readonly entries: ReadonlyArray<{ readonly seq: number; readonly input: PredictedMoveLike }>;
}

interface PredictionErrorLike {
  readonly xz: number;
  readonly y: number;
  readonly speed: number;
}

function queryFlag(name: string, search = typeof location === 'undefined' ? '' : location.search): boolean {
  if (!search) return false;
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const value = params.get(name);
  return value === '1' || value === 'true';
}

export function isCorrDiagQueryEnabled(search = typeof location === 'undefined' ? '' : location.search): boolean {
  return queryFlag('corrDiag', search)
    || queryFlag('corrdiag', search)
    || queryFlag('motionDiag', search)
    || queryFlag('motiondiag', search);
}

export interface CorrectionWorldHint {
  readonly feetBlock: string;
  readonly belowBlock: string;
  readonly aheadBlock: string;
  readonly msSinceBlockMutation: number;
  readonly msSinceChunkUpdate: number;
  readonly ticksThisFrame: number;
  readonly onGroundBefore: boolean;
  readonly onGroundAfterPredicted: boolean;
  readonly jump: boolean;
  readonly flyingToggle: boolean;
  readonly descend: boolean;
}

export interface CorrectionDiag {
  readonly inputSeq: number;
  readonly lastAckedSeq: number;
  readonly seqGap: number;
  readonly serverTick: number | undefined;
  readonly lastStateTick: number;
  readonly tickGap: number;
  readonly reject: AckRejectReason;
  readonly error: PredictionErrorLike;
  readonly input: PredictedMoveLike | undefined;
  readonly predicted: PlayerMovementState | undefined;
  readonly snapshot: {
    readonly x: number; readonly y: number; readonly z: number;
    readonly vx: number; readonly vy: number; readonly vz: number;
    readonly onGround: boolean;
    readonly sneaking: boolean;
    readonly sprinting: boolean;
    readonly flying: boolean | undefined;
  };
  readonly liveBefore: {
    readonly x: number; readonly y: number; readonly z: number;
    readonly vx: number; readonly vy: number; readonly vz: number;
    readonly px: number; readonly py: number; readonly pz: number;
    readonly onGround: boolean;
    readonly sneaking: boolean;
    readonly sprinting: boolean;
    readonly isFlying: boolean;
    readonly jumpHeld: boolean;
  };
  readonly pending: number;
  readonly latestClientSeq: number;
  readonly world: CorrectionWorldHint;
  readonly hypotheses: readonly string[];
  readonly physicsTicks?: number;
  readonly firstDiff?: string;
}

const WALK_STEP = WALK_SPEED * FIXED_DT;

function fmt3(value: number): string {
  return value.toFixed(3);
}

function classify(diag: Omit<CorrectionDiag, 'hypotheses'>): string[] {
  const out: string[] = [];
  if (diag.seqGap > 1) out.push('B skipped/intermediate inputs (seq gap)');
  if (diag.tickGap > 1) out.push('A missed player_state / timing (tick gap)');
  if (diag.seqGap <= 1 && diag.tickGap <= 1 && (diag.physicsTicks ?? 1) <= 1) {
    out.push('check 1:1 tick still mismatched');
  }
  if ((diag.physicsTicks ?? 1) > 1) {
    out.push('A catch-up snapshot (physicsTicks>1) vs 1-tick history[N]');
  }
  if (Math.abs(diag.error.xz - WALK_STEP) < 0.08 || Math.abs(diag.error.xz - WALK_STEP * 2) < 0.08) {
    out.push('B extra predicted walk step vs latest-input server tick');
  }
  if (diag.predicted && diag.predicted.onGround !== diag.snapshot.onGround) out.push('E/ground transition');
  if (diag.input?.jump) out.push('E jump');
  if (diag.world.flyingToggle || (diag.predicted && diag.snapshot.flying !== undefined && diag.predicted.isFlying !== diag.snapshot.flying)) {
    out.push('F flying');
  }
  if (diag.input && Math.abs(diag.input.yaw) + Math.abs(diag.input.pitch) > 0 && diag.seqGap > 1) {
    out.push('G yaw/pitch timing with coalesced seqs');
  }
  if (diag.world.msSinceBlockMutation >= 0 && diag.world.msSinceBlockMutation < 250) out.push('D block mutation');
  if (diag.world.msSinceChunkUpdate >= 0 && diag.world.msSinceChunkUpdate < 250) out.push('D chunk update');
  if (diag.world.ticksThisFrame > 1) out.push('A client catch-up ticks this frame');
  if (out.length === 0) out.push('H/I unknown — inspect dump');
  return out;
}

export function buildCorrectionDiag(input: {
  readonly snapshot: PlayerSnapshot;
  readonly buffer: PredictionBufferLike;
  readonly predicted: PlayerMovementState | undefined;
  readonly predictedInput: PredictedMoveLike | undefined;
  readonly player: PlayerController;
  readonly error: PredictionErrorLike;
  readonly reject: AckRejectReason;
  readonly serverTick?: number;
  readonly lastStateTick: number;
  readonly physicsTicks?: number;
  readonly firstDiff?: string;
  readonly world: CorrectionWorldHint;
}): CorrectionDiag {
  const lastAckedSeq = input.buffer.lastAckedSeq;
  const inputSeq = input.snapshot.inputSeq ?? Number.NaN;
  const seqGap = Number.isFinite(inputSeq) ? inputSeq - lastAckedSeq : 0;
  const tickGap = input.serverTick !== undefined ? input.serverTick - input.lastStateTick : 0;
  const latestClientSeq = input.buffer.entries.length > 0
    ? input.buffer.entries[input.buffer.entries.length - 1]!.seq
    : lastAckedSeq;
  const live = input.player.captureMovementState();
  const base = {
    inputSeq,
    lastAckedSeq,
    seqGap,
    serverTick: input.serverTick,
    lastStateTick: input.lastStateTick,
    tickGap,
    reject: input.reject,
    error: input.error,
    input: input.predictedInput,
    predicted: input.predicted,
    snapshot: {
      x: input.snapshot.x, y: input.snapshot.y, z: input.snapshot.z,
      vx: input.snapshot.vx, vy: input.snapshot.vy, vz: input.snapshot.vz,
      onGround: input.snapshot.onGround,
      sneaking: input.snapshot.sneaking,
      sprinting: input.snapshot.sprinting,
      flying: input.snapshot.flying,
    },
    liveBefore: {
      x: live.x, y: live.y, z: live.z,
      vx: live.vx, vy: live.vy, vz: live.vz,
      px: input.player.previousPosition.x,
      py: input.player.previousPosition.y,
      pz: input.player.previousPosition.z,
      onGround: live.onGround,
      sneaking: live.sneaking,
      sprinting: live.sprinting,
      isFlying: live.isFlying,
      jumpHeld: live.jumpHeld,
    },
    pending: input.buffer.entries.length,
    latestClientSeq,
    world: input.world,
    physicsTicks: input.physicsTicks,
    firstDiff: input.firstDiff,
  };
  return { ...base, hypotheses: classify(base) };
}

export function formatCorrectionDiag(diag: CorrectionDiag): string {
  const predicted = diag.predicted;
  const input = diag.input;
  const dx = predicted ? diag.snapshot.x - predicted.x : Number.NaN;
  const dy = predicted ? diag.snapshot.y - predicted.y : Number.NaN;
  const dz = predicted ? diag.snapshot.z - predicted.z : Number.NaN;
  const dvx = predicted ? diag.snapshot.vx - predicted.vx : Number.NaN;
  const dvy = predicted ? diag.snapshot.vy - predicted.vy : Number.NaN;
  const dvz = predicted ? diag.snapshot.vz - predicted.vz : Number.NaN;
  const lines = [
    `[corrDiag] seq=${diag.inputSeq} lastAck=${diag.lastAckedSeq} gap=${diag.seqGap} `
    + `tick=${diag.serverTick ?? '—'} tickGap=${diag.tickGap} physicsTicks=${diag.physicsTicks ?? 1} `
    + `firstDiff=${diag.firstDiff ?? '—'} reject=${diag.reject} `
    + `xz=${diag.error.xz.toFixed(4)} y=${diag.error.y.toFixed(4)} speed=${diag.error.speed.toFixed(4)} `
    + `walkStep=${WALK_STEP.toFixed(4)}`,
    `  hist ${predicted
      ? `${fmt3(predicted.x)} ${fmt3(predicted.y)} ${fmt3(predicted.z)} v=${fmt3(predicted.vx)} ${fmt3(predicted.vy)} ${fmt3(predicted.vz)} `
        + `ground=${predicted.onGround} sneak=${predicted.sneaking} sprint=${predicted.sprinting} `
        + `fly=${predicted.isFlying} jumpHeld=${predicted.jumpHeld}`
      : 'MISSING'}`,
    `  snap ${fmt3(diag.snapshot.x)} ${fmt3(diag.snapshot.y)} ${fmt3(diag.snapshot.z)} `
    + `v=${fmt3(diag.snapshot.vx)} ${fmt3(diag.snapshot.vy)} ${fmt3(diag.snapshot.vz)} `
    + `ground=${diag.snapshot.onGround} sneak=${diag.snapshot.sneaking} sprint=${diag.snapshot.sprinting} `
    + `fly=${diag.snapshot.flying}`,
    `  dpos ${fmt3(dx)} ${fmt3(dy)} ${fmt3(dz)} dv ${fmt3(dvx)} ${fmt3(dvy)} ${fmt3(dvz)}`,
    `  live ${fmt3(diag.liveBefore.x)} ${fmt3(diag.liveBefore.y)} ${fmt3(diag.liveBefore.z)} `
    + `prev ${fmt3(diag.liveBefore.px)} ${fmt3(diag.liveBefore.py)} ${fmt3(diag.liveBefore.pz)} `
    + `|pos-prev|=${Math.hypot(
      diag.liveBefore.x - diag.liveBefore.px,
      diag.liveBefore.y - diag.liveBefore.py,
      diag.liveBefore.z - diag.liveBefore.pz,
    ).toFixed(4)}`,
    `  pending=${diag.pending} latestClientSeq=${diag.latestClientSeq} latestServerSeq=${diag.inputSeq} `
    + `firstDiff=${diag.firstDiff ?? '—'} physicsTicks=${diag.physicsTicks ?? 1}`,
    `  input ${input
      ? `f=${input.forward} r=${input.right} jump=${input.jump} sneak=${input.sneak} sprint=${input.sprint} `
        + `desc=${input.descend} flySprint=${input.flySprint} yaw=${input.yaw.toFixed(3)} pitch=${input.pitch.toFixed(3)}`
      : 'MISSING'}`,
    `  world feet=${diag.world.feetBlock} below=${diag.world.belowBlock} ahead=${diag.world.aheadBlock} `
    + `blockMs=${diag.world.msSinceBlockMutation} chunkMs=${diag.world.msSinceChunkUpdate} `
    + `ticksThisFrame=${diag.world.ticksThisFrame} jump=${diag.world.jump} descend=${diag.world.descend}`,
    `  why ${diag.hypotheses.join('; ')}`,
  ];
  return lines.join('\n');
}

export function logCorrectionDiag(diag: CorrectionDiag): void {
  if (typeof console === 'undefined') return;
  console.info(formatCorrectionDiag(diag));
}
