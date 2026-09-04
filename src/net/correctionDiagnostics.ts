import { CHUNK_SIZE, FIXED_DT, WALK_SPEED, floorDiv } from '../core/constants';
import type { PlayerController, PlayerMovementState } from '../player/PlayerController';
import type { PredictionFlightTrace } from './localPlayerPrediction';
import type { PlayerSnapshot } from '../../shared/protocol';
import type { AckRejectReason } from './localMotionDiagnostics';

type SnapshotComparePath = 'applied-timeline' | 'checkpoint' | 'history[N]' | 'history[N]+extra' | 'live' | 'none';

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
  readonly lastAckedServerTick?: number;
  readonly lastAckedState?: PlayerMovementState | null;
  readonly lastAckedPredTick?: number;
  readonly entries: ReadonlyArray<{
    readonly seq: number;
    readonly predTick?: number;
    readonly input: PredictedMoveLike;
    readonly state?: PlayerMovementState;
  }>;
}

interface PredictionErrorLike {
  readonly xz: number;
  readonly y: number;
  readonly speed: number;
  readonly distSq?: number;
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
  readonly aabbBlocks?: string;
  readonly chunkKey?: string;
  readonly chunkLoaded?: boolean;
  readonly mutationMarks?: number;
  readonly visibility?: string;
}

export interface CorrectionTiming {
  readonly clientSentAt?: number;
  readonly serverRecvAt?: number;
  readonly serverSimAt?: number;
  readonly serverSendAt?: number;
  readonly clientRecvAt?: number;
  readonly applyAt?: number;
}

export interface CorrectionPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly onGround?: boolean;
  readonly sneaking?: boolean;
  readonly sprinting?: boolean;
  readonly flying?: boolean;
  readonly jumpHeld?: boolean;
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
  readonly history?: PlayerMovementState;
  readonly comparable?: PlayerMovementState;
  readonly extraTicks: number;
  readonly comparePath: SnapshotComparePath | 'none';
  readonly simTicks?: number;
  readonly lastAckedServerTick?: number;
  readonly extraAssignSite?: string;
  readonly extraOldFormula?: number;
  readonly pendingOverwrites?: number;
  readonly appliedTicks?: ReadonlyArray<{
    readonly tick: number;
    readonly seq: number;
    readonly forward: number;
    readonly right: number;
    readonly jump: boolean;
    readonly sneak: boolean;
    readonly descend: boolean;
    readonly flySprint: boolean;
    readonly y: number;
    readonly vy: number;
    readonly flying: boolean;
    readonly onGround: boolean;
  }>;
  readonly clientPredTicks?: ReadonlyArray<{ readonly predTick: number; readonly seq: number }>;
  readonly lastAckedPose?: PlayerMovementState;
  readonly pendingSeqs: readonly number[];
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
    readonly creativeFlightAllowed?: boolean;
  };
  readonly pending: number;
  readonly latestClientSeq: number;
  readonly world: CorrectionWorldHint;
  readonly hypotheses: readonly string[];
  readonly ownerCategory: string;
  readonly physicsTicks?: number;
  readonly physicsTicksThisLoop?: number;
  readonly firstDiff?: string;
  readonly rawFirstDiff?: string;
  readonly timing?: CorrectionTiming;
  readonly flight?: PredictionFlightTrace;
}

const WALK_STEP = WALK_SPEED * FIXED_DT;

function fmt3(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : 'NaN';
}

function fmtMs(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) ? value.toFixed(1) : '—';
}

function poseLine(label: string, pose: CorrectionPose | PlayerMovementState | undefined, flying?: boolean): string {
  if (!pose) return `  ${label} MISSING`;
  const fly = 'isFlying' in pose ? pose.isFlying : flying;
  const jump = 'jumpHeld' in pose ? pose.jumpHeld : undefined;
  return (
    `  ${label} ${fmt3(pose.x)} ${fmt3(pose.y)} ${fmt3(pose.z)} `
    + `v=${fmt3(pose.vx)} ${fmt3(pose.vy)} ${fmt3(pose.vz)} `
    + `ground=${pose.onGround} sneak=${pose.sneaking} sprint=${pose.sprinting} `
    + `fly=${fly}${jump === undefined ? '' : ` jumpHeld=${jump}`}`
  );
}

function classify(diag: Omit<CorrectionDiag, 'hypotheses' | 'ownerCategory'>): string[] {
  const out: string[] = [];
  if (diag.seqGap > 1 && diag.lastAckedSeq >= 0) out.push('B skipped/intermediate inputs (seq gap)');
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

/**
 * Owner categories from the 20/20 positional-correction pass.
 * A = physicsTicks / compare-point, B = input, C = sim parity, D = velocity-only,
 * E = world/collision, F = visibility, G = stationary vertical.
 */
export function classifyOwnerCategory(diag: Omit<CorrectionDiag, 'hypotheses' | 'ownerCategory'>): string {
  const hist = diag.history ?? diag.predicted;
  const xyzMatch = hist
    ? Math.hypot(diag.snapshot.x - hist.x, diag.snapshot.y - hist.y, diag.snapshot.z - hist.z) <= 0.03
    : false;
  if (xyzMatch && diag.error.speed > 0.2) return 'D xyz match, velocity differs (should be soft, not pose corr)';
  if (diag.world.visibility === 'hidden' || (diag.world.visibility !== undefined && diag.world.visibility !== 'visible')) {
    return 'F hidden/visible transition';
  }
  if (diag.world.chunkLoaded === false) return 'E client collision chunk not loaded (getBlock false → Air)';
  if (diag.world.msSinceBlockMutation >= 0 && diag.world.msSinceBlockMutation < 250) return 'E recent block mutation';
  if ((diag.physicsTicks ?? 1) > 1 && diag.extraTicks !== (diag.physicsTicks ?? 1) - Math.max(1, diag.seqGap)) {
    return 'A physicsTicks extra-tick formula vs seqGap';
  }
  if ((diag.physicsTicks ?? 1) > 1) return 'A physicsTicks>1 catch-up snapshot';
  if (diag.lastAckedSeq >= 0 && diag.seqGap > (diag.physicsTicks ?? 1)) {
    return 'B inputSeq is not a physics tick: seqGap>physicsTicks (client predicted more seqs than server simulated)';
  }
  if (diag.input && hist && Math.abs(diag.error.xz - WALK_STEP) < 0.08) {
    return 'A/B one walk-step: history[N] is one physics step from snapshot';
  }
  const stationary = !diag.input || (diag.input.forward === 0 && diag.input.right === 0 && !diag.input.jump);
  if (stationary && diag.firstDiff === 'y') return 'G stationary vertical (y/vy/onGround/flying/gravity/collision)';
  if (diag.input && hist) return 'C same-seq pose diverge (lockstep PlayerController or world collision)';
  return 'unknown — read the dump';
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
  readonly physicsTicksThisLoop?: number;
  readonly firstDiff?: string;
  readonly rawFirstDiff?: string;
  readonly extraTicks?: number;
  readonly comparePath?: SnapshotComparePath | 'none';
  readonly simTicks?: number;
  readonly seqGap?: number;
  readonly history?: PlayerMovementState;
  readonly comparable?: PlayerMovementState;
  readonly extraAssignSite?: string;
  readonly pendingOverwrites?: number;
  readonly timing?: CorrectionTiming;
  readonly world: CorrectionWorldHint;
  readonly flight?: PredictionFlightTrace;
}): CorrectionDiag {
  const lastAckedSeq = input.buffer.lastAckedSeq;
  const inputSeq = input.snapshot.inputSeq ?? Number.NaN;
  const seqGap = input.seqGap ?? (Number.isFinite(inputSeq) ? inputSeq - lastAckedSeq : 0);
  const tickGap = input.serverTick !== undefined ? input.serverTick - input.lastStateTick : 0;
  const latestClientSeq = input.buffer.entries.length > 0
    ? input.buffer.entries[input.buffer.entries.length - 1]!.seq
    : lastAckedSeq;
  const physicsTicks = Math.max(1, Math.floor(input.physicsTicks ?? 1));
  const extraOldFormula = Math.max(0, physicsTicks - seqGap);
  const extraTicks = input.extraTicks ?? extraOldFormula;
  const lastAckedServerTick = input.buffer.lastAckedServerTick;
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
    history: input.history ?? input.predicted,
    comparable: input.comparable ?? input.predicted,
    extraTicks,
    comparePath: input.comparePath ?? (extraTicks > 0 ? 'history[N]+extra' as const : 'history[N]' as const),
    simTicks: input.simTicks ?? extraTicks,
    lastAckedServerTick,
    extraAssignSite: input.extraAssignSite,
    extraOldFormula,
    pendingOverwrites: input.pendingOverwrites,
    appliedTicks: input.snapshot.appliedTicks,
    clientPredTicks: input.buffer.entries.map((entry) => ({
      predTick: entry.predTick ?? entry.seq,
      seq: entry.seq,
    })),
    lastAckedPose: input.buffer.lastAckedState ?? undefined,
    pendingSeqs: input.buffer.entries.map((entry) => entry.seq),
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
      creativeFlightAllowed: input.player.creativeFlightAllowed,
    },
    pending: input.buffer.entries.length,
    latestClientSeq,
    world: input.world,
    physicsTicks,
    physicsTicksThisLoop: input.physicsTicksThisLoop ?? physicsTicks,
    firstDiff: input.firstDiff,
    rawFirstDiff: input.rawFirstDiff,
    timing: input.timing,
    flight: input.flight,
  };
  return {
    ...base,
    hypotheses: classify(base),
    ownerCategory: classifyOwnerCategory(base),
  };
}

export function formatCorrectionDiag(diag: CorrectionDiag): string {
  const history = diag.history ?? diag.predicted;
  const comparable = diag.comparable ?? diag.predicted;
  const input = diag.input;
  const dx = comparable ? diag.snapshot.x - comparable.x : Number.NaN;
  const dy = comparable ? diag.snapshot.y - comparable.y : Number.NaN;
  const dz = comparable ? diag.snapshot.z - comparable.z : Number.NaN;
  const dvx = comparable ? diag.snapshot.vx - comparable.vx : Number.NaN;
  const dvy = comparable ? diag.snapshot.vy - comparable.vy : Number.NaN;
  const dvz = comparable ? diag.snapshot.vz - comparable.vz : Number.NaN;
  const dist = Number.isFinite(dx) ? Math.hypot(dx, dy, dz) : Number.NaN;
  const rawDx = history ? diag.snapshot.x - history.x : Number.NaN;
  const rawDz = history ? diag.snapshot.z - history.z : Number.NaN;
  const timing = diag.timing;
  const lines = [
    `[corrDiag] seq=${diag.inputSeq} lastAck=${diag.lastAckedSeq} gap=${diag.seqGap} `
    + `tick=${diag.serverTick ?? '—'} tickGap=${diag.tickGap} physicsTicks=${diag.physicsTicks ?? 1} `
    + `extra=${diag.extraTicks} path=${diag.comparePath} `
    + `firstDiff=${diag.firstDiff ?? '—'} rawDiff=${diag.rawFirstDiff ?? '—'} reject=${diag.reject} `
    + `xz=${diag.error.xz.toFixed(4)} y=${diag.error.y.toFixed(4)} speed=${diag.error.speed.toFixed(4)} `
    + `walkStep=${WALK_STEP.toFixed(4)}`,
    `SEQ:`,
    `  snapshot.inputSeq=${diag.inputSeq} currentClientSeq=${diag.latestClientSeq} lastAckedSeq=${diag.lastAckedSeq}`,
    `  pendingSeqs=[${diag.pendingSeqs.join(',')}] pending=${diag.pending}`,
    `  lastInputSeq semantics: latest movement state, NOT a unique physics tick id`,
    `TIMING:`,
    `  clientSent=${fmtMs(timing?.clientSentAt)} serverRecv=${fmtMs(timing?.serverRecvAt)} `
    + `serverSim=${fmtMs(timing?.serverSimAt)} serverSend=${fmtMs(timing?.serverSendAt)} `
    + `clientRecv=${fmtMs(timing?.clientRecvAt)} apply=${fmtMs(timing?.applyAt)}`,
    `PHYSICS:`,
    `  snapshot.physicsTicks=${diag.physicsTicks ?? 1} tickClock.physicsTicksThisLoop=${diag.physicsTicksThisLoop ?? '—'} `
    + `serverTickNumber=${diag.serverTick ?? '—'} lastStateTick=${diag.lastStateTick}`,
    `  lastAckedServerTick=${diag.lastAckedServerTick ?? '—'} `
    + `simTicks=${diag.simTicks ?? diag.extraTicks} extraTicks=${diag.extraTicks} seqGap=${diag.seqGap}`,
    `  extraAssignSite=${diag.extraAssignSite ?? '—'}`,
    `  extra is NOT max(0, physicsTicks-seqGap); that old formula=`
    + `max(0, ${diag.physicsTicks ?? 1}-${diag.seqGap})=${diag.extraOldFormula ?? '—'} `
    + `(live extra=${diag.extraTicks} ${diag.extraTicks === diag.extraOldFormula ? 'EQUALS' : 'DIFFERS FROM'} old formula)`,
    `  tickGap=serverTick-lastStateTick uses last *received* player_state, not last reconciled checkpoint`,
    `  pendingSlotOverwrites=${diag.pendingOverwrites ?? '—'} (latest-only queue between tickOnline flushes)`,
    `  comparePath=${diag.comparePath}  `
    + (diag.comparePath === 'applied-timeline'
      ? `authoritative applied server-tick timeline (${diag.simTicks ?? diag.extraTicks} tick(s))`
      : diag.comparePath === 'checkpoint'
      ? `checkpoint: lastAcked pose + ${diag.simTicks ?? diag.extraTicks} latest-input tick(s); inputSeq is state, not the checkpoint`
      : diag.extraTicks === 0
        ? 'compare exactly history[N]'
        : `compare history[N] plus ${diag.extraTicks} extra tick(s) of the SAME latest input`),
    `INPUT:`,
    `  ${input
      ? `forward=${input.forward} right=${input.right} jump=${input.jump} sneak=${input.sneak} `
        + `sprint=${input.sprint} descend=${input.descend} flySprint=${input.flySprint} `
        + `yaw=${input.yaw.toFixed(4)} pitch=${input.pitch.toFixed(4)} seq=${input.seq}`
      : 'MISSING (no history for this inputSeq)'}`,
    `APPLIED INPUT TIMELINE (server physics ticks, not latest inputSeq only):`,
    ...(diag.appliedTicks && diag.appliedTicks.length > 0
      ? diag.appliedTicks.map((tick) => (
        `  tick=${tick.tick} seq=${tick.seq} f=${tick.forward} r=${tick.right} `
        + `jump=${tick.jump} sneak=${tick.sneak} descend=${tick.descend} flySprint=${tick.flySprint} `
        + `y=${fmt3(tick.y)} vy=${fmt3(tick.vy)} fly=${tick.flying} ground=${tick.onGround}`
      ))
      : ['  MISSING (older server or no appliedTicks on snapshot)']),
    `CLIENT PRED TIMELINE (unacked):`,
    diag.clientPredTicks && diag.clientPredTicks.length > 0
      ? `  ${diag.clientPredTicks.map((tick) => `pred=${tick.predTick}:seq=${tick.seq}`).join(' ')}`
      : '  (none)',
    `CLIENT POSE:`,
    poseLine('checkpoint', diag.lastAckedPose),
    poseLine('history[N]', history),
    poseLine('comparable', comparable),
    poseLine('live     ', diag.liveBefore, diag.liveBefore.isFlying),
    `  livePrev ${fmt3(diag.liveBefore.px)} ${fmt3(diag.liveBefore.py)} ${fmt3(diag.liveBefore.pz)}`,
    `  checkpoint y/vy=${fmt3(diag.lastAckedPose?.y ?? Number.NaN)}/${fmt3(diag.lastAckedPose?.vy ?? Number.NaN)} `
    + `comparable y/vy=${fmt3(comparable?.y ?? Number.NaN)}/${fmt3(comparable?.vy ?? Number.NaN)} `
    + `server y/vy=${fmt3(diag.snapshot.y)}/${fmt3(diag.snapshot.vy)}`,
    `SERVER POSE:`,
    poseLine('snapshot ', diag.snapshot, diag.snapshot.flying),
    `DIFF (comparable vs snapshot):`,
    `  dx=${fmt3(dx)} dy=${fmt3(dy)} dz=${fmt3(dz)} distance=${fmt3(dist)}`,
    `  dvx=${fmt3(dvx)} dvy=${fmt3(dvy)} dvz=${fmt3(dvz)}`,
    `  firstDiff=${diag.firstDiff ?? '—'} rawHistoryFirstDiff=${diag.rawFirstDiff ?? '—'} `
    + `rawXz=${fmt3(Number.isFinite(rawDx) ? Math.hypot(rawDx, rawDz) : Number.NaN)}`,
    `FLIGHT:`,
    `  localAllowed=${diag.flight?.localAllowed ?? diag.liveBefore.creativeFlightAllowed ?? '—'} `
    + `scratchAllowed=${diag.flight?.scratchAllowed ?? '—'} `
    + `snapshotGamemode=${diag.flight?.snapshotGamemode ?? '—'}`,
    `  checkpointFlying=${diag.flight?.checkpointFlying ?? diag.lastAckedPose?.isFlying ?? '—'} `
    + `predictedFlying=${diag.flight?.predictedFlying ?? comparable?.isFlying ?? '—'} `
    + `snapshotFlying=${diag.flight?.snapshotFlying ?? diag.snapshot.flying ?? '—'}`,
    `STATE:`,
    `  hist ground/fly/sneak/sprint/jumpHeld=${history?.onGround}/${history?.isFlying}/${history?.sneaking}/${history?.sprinting}/${history?.jumpHeld}`,
    `  snap ground/fly/sneak/sprint=${diag.snapshot.onGround}/${diag.snapshot.flying}/${diag.snapshot.sneaking}/${diag.snapshot.sprinting}`,
    `  live ground/fly/sneak/sprint/jumpHeld=${diag.liveBefore.onGround}/${diag.liveBefore.isFlying}/${diag.liveBefore.sneaking}/${diag.liveBefore.sprinting}/${diag.liveBefore.jumpHeld}`,
    `WORLD:`,
    `  feet=${diag.world.feetBlock} below=${diag.world.belowBlock} ahead=${diag.world.aheadBlock}`,
    `  aabb=${diag.world.aabbBlocks ?? '—'} chunk=${diag.world.chunkKey ?? '—'} loaded=${diag.world.chunkLoaded ?? '—'}`,
    `  worldRevision=mutationMarks=${diag.world.mutationMarks ?? '—'} (client VoxelWorld; server revision is not on the snapshot)`,
    `  blockMs=${diag.world.msSinceBlockMutation} chunkMs=${diag.world.msSinceChunkUpdate}`,
    `  visibility=${diag.world.visibility ?? '—'} ticksThisFrame=${diag.world.ticksThisFrame}`,
    `CATEGORY: ${diag.ownerCategory}`,
    `  why ${diag.hypotheses.join('; ')}`,
  ];
  return lines.filter((line) => line !== undefined).join('\n');
}

let firstCorrectionLogged = false;

export function resetFirstCorrectionDump(): void {
  firstCorrectionLogged = false;
}

export function logCorrectionDiag(diag: CorrectionDiag): void {
  if (typeof console === 'undefined') return;
  const body = formatCorrectionDiag(diag);
  if (!firstCorrectionLogged) {
    firstCorrectionLogged = true;
    console.info(
      `[corrDiag:first] KEEP THIS DUMP — first positional correction this session\n${body}`,
    );
    return;
  }
  if (isCorrDiagQueryEnabled()) console.info(body);
  else console.info(body.split('\n')[0]);
}

export function sampleAabbBlocks(
  getBlock: (x: number, y: number, z: number, generate?: boolean) => { readonly name: string },
  x: number,
  y: number,
  z: number,
  width = 0.6,
  height = 1.8,
): string {
  const half = width * 0.5;
  const cells: string[] = [];
  const minX = Math.floor(x - half);
  const maxX = Math.floor(x + half - 1e-7);
  const minY = Math.floor(y) - 1;
  const maxY = Math.floor(y + height - 1e-7);
  const minZ = Math.floor(z - half);
  const maxZ = Math.floor(z + half - 1e-7);
  for (let by = minY; by <= maxY; by += 1) {
    for (let bz = minZ; bz <= maxZ; bz += 1) {
      for (let bx = minX; bx <= maxX; bx += 1) {
        const name = getBlock(bx, by, bz, false).name;
        if (name === 'air') continue;
        cells.push(`${bx},${by},${bz}:${name}`);
      }
    }
  }
  return cells.length === 0 ? 'air' : cells.join('|');
}

export function chunkKeyOf(x: number, z: number): string {
  const cx = floorDiv(Math.floor(x), CHUNK_SIZE);
  const cz = floorDiv(Math.floor(z), CHUNK_SIZE);
  return `${cx},${cz}`;
}

/** Collision neighborhood at a pose. Uses generate=false semantics (missing chunk = air). */
export function sampleCollisionHint(
  getBlock: (x: number, y: number, z: number, generate?: boolean) => { readonly name: string },
  pose: { readonly x: number; readonly y: number; readonly z: number },
  options: {
    readonly yaw?: number;
    readonly width?: number;
    readonly height?: number;
    readonly chunkLoaded?: boolean;
    readonly mutationMarks?: number;
  } = {},
): Pick<CorrectionWorldHint, 'feetBlock' | 'belowBlock' | 'aheadBlock' | 'aabbBlocks' | 'chunkKey' | 'chunkLoaded' | 'mutationMarks'> {
  const px = Math.floor(pose.x);
  const py = Math.floor(pose.y);
  const pz = Math.floor(pose.z);
  const yaw = options.yaw ?? 0;
  return {
    feetBlock: getBlock(px, py, pz, false).name,
    belowBlock: getBlock(px, py - 1, pz, false).name,
    aheadBlock: getBlock(
      px - Math.round(Math.sin(yaw)),
      py,
      pz - Math.round(Math.cos(yaw)),
      false,
    ).name,
    aabbBlocks: sampleAabbBlocks(
      getBlock,
      pose.x,
      pose.y,
      pose.z,
      options.width ?? 0.6,
      options.height ?? 1.8,
    ),
    chunkKey: chunkKeyOf(pose.x, pose.z),
    chunkLoaded: options.chunkLoaded,
    mutationMarks: options.mutationMarks,
  };
}
