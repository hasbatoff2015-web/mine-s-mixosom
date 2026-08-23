/**
 * DEV-only chunk streaming diagnostics.
 * Pure functions over snapshots of real world/renderer/queue state.
 * Does not schedule, cancel, or reprioritize jobs.
 */

export const SLOW_CHUNK_THRESHOLD_MS = 2000;
export const READY_MESH_WAIT_WARN_MS = 500;
export const SLOW_CHUNK_RING = 8;
export const TRACE_EVENT_LIMIT = 12;

export const CARDINAL_HALO = [
  { dir: 'N' as const, dx: 0, dz: -1 },
  { dir: 'S' as const, dx: 0, dz: 1 },
  { dir: 'E' as const, dx: 1, dz: 0 },
  { dir: 'W' as const, dx: -1, dz: 0 },
];

export type ChunkDebugCategory =
  | 'absent'
  | 'waiting_generation'
  | 'waiting_light'
  | 'lighting'
  | 'waiting_mesh'
  | 'meshing'
  | 'visible'
  | 'blocked';

export type HaloDir = 'N' | 'S' | 'E' | 'W';

export const CATEGORY_COLORS: Record<ChunkDebugCategory, number> = {
  absent: 0x8a8a8a,
  waiting_generation: 0x3b82f6,
  waiting_light: 0x22d3ee,
  lighting: 0xeab308,
  waiting_mesh: 0xf97316,
  meshing: 0xc084fc,
  visible: 0x22c55e,
  blocked: 0xef4444,
};

export const CATEGORY_LABELS: Record<ChunkDebugCategory, string> = {
  absent: 'ABSENT',
  waiting_generation: 'WAIT_GEN',
  waiting_light: 'WAIT_LIGHT',
  lighting: 'LIGHTING',
  waiting_mesh: 'WAITING_MESH',
  meshing: 'MESHING',
  visible: 'VISIBLE',
  blocked: 'BLOCKED',
};

export const OVERLAY_LEGEND = [
  'GRAY absent/not requested',
  'BLUE wait generation',
  'CYAN generated, wait light',
  'YELLOW lighting in progress',
  'ORANGE lit, wait mesh',
  'PURPLE mesh in progress',
  'GREEN ready + visible',
  'RED blocked/stale/halo',
];

export interface ChunkDebugFacts {
  readonly cx: number;
  readonly cz: number;
  readonly requested: boolean;
  readonly generated: boolean;
  readonly lightingQueued: boolean;
  readonly lightingActive: boolean;
  readonly lightingReady: boolean;
  readonly lightContextReady: boolean;
  readonly meshQueued: boolean;
  readonly meshActive: boolean;
  readonly meshed: boolean;
  readonly meshLightCurrent: boolean;
  readonly visible: boolean;
  readonly dirty: boolean;
  readonly pendingMesh: boolean;
  readonly pendingLight: boolean;
  readonly inMeshRadius: boolean;
  readonly inGenerateRadius: boolean;
  readonly floodOwnerIsOther: boolean;
  readonly meshSkippedDueToGenSeparation: boolean;
  readonly lightingOnlyDueToBudget: boolean;
  readonly meshReadyButOverBudget: boolean;
}

export interface HaloNeighborFact {
  readonly dir: HaloDir;
  readonly cx: number;
  readonly cz: number;
  readonly required: boolean;
  readonly present: boolean;
  readonly lightingReady: boolean;
  readonly stateLabel: string;
}

export interface ChunkTimestamps {
  requestedAt?: number;
  generationStartedAt?: number;
  generatedAt?: number;
  lightingStartedAt?: number;
  litAt?: number;
  meshQueuedAt?: number;
  meshStartedAt?: number;
  meshedAt?: number;
  visibleAt?: number;
}

export interface ChunkDurations {
  readonly requestToGenerateMs: number | null;
  readonly generateDurationMs: number | null;
  readonly generatedToLitMs: number | null;
  readonly litToMeshStartMs: number | null;
  readonly meshDurationMs: number | null;
  readonly meshToVisibleMs: number | null;
  readonly ageMs: number | null;
}

export interface InspectFreeze {
  readonly frozen: boolean;
  readonly cx: number;
  readonly cz: number;
}

export interface SlowChunkSnapshot {
  readonly atMs: number;
  readonly cx: number;
  readonly cz: number;
  readonly state: string;
  readonly blocker: string;
  readonly genRank: number | null;
  readonly lightRank: number | null;
  readonly meshRank: number | null;
  readonly durations: ChunkDurations;
  readonly wantedNow: number;
  readonly missingWanted: number;
  readonly queuedObsolete: number;
  readonly genPending: number;
  readonly lightPending: number;
  readonly meshPending: number;
}

export interface HorizonCounts {
  readonly wantedNow: number;
  readonly missingWanted: number;
  readonly queuedObsolete: number;
  readonly queuedObsoleteGen: number;
  readonly queuedObsoleteLight: number;
  readonly queuedObsoleteMesh: number;
}

export interface QueueLaneSnapshot {
  readonly pending: number;
  readonly ready: number;
  readonly blocked: number;
  readonly oldestAgeMs: number | null;
  readonly headKey: string | null;
  readonly headState: string | null;
  readonly headBlocked: boolean;
}

export interface JobFrameCounters {
  genAttempted: number;
  genCompleted: number;
  genSkippedBlocked: number;
  lightAttempted: number;
  lightCompleted: number;
  lightYielded: number;
  lightBlocked: number;
  meshAttempted: number;
  meshCompleted: number;
  meshSkippedBlocked: number;
  meshSkippedDueToGenSeparation: boolean;
  lightingOnlyDueToBudget: boolean;
  meshReady: number;
  meshUrgent: number;
  meshOldestReadyAgeMs: number;
  meshStarvationAvoided: boolean;
  meshSkippedFrame: boolean;
}

export interface PrioritySnapshot {
  readonly score: number;
  readonly distanceComponent: number;
  readonly visibilityComponent: number | null;
  readonly movementAheadComponent: number | null;
  readonly note: string;
}

export interface ChunkTraceEvent {
  readonly t: number;
  readonly kind: string;
}

export function emptyJobFrameCounters(): JobFrameCounters {
  return {
    genAttempted: 0,
    genCompleted: 0,
    genSkippedBlocked: 0,
    lightAttempted: 0,
    lightCompleted: 0,
    lightYielded: 0,
    lightBlocked: 0,
    meshAttempted: 0,
    meshCompleted: 0,
    meshSkippedBlocked: 0,
    meshSkippedDueToGenSeparation: false,
    lightingOnlyDueToBudget: false,
    meshReady: 0,
    meshUrgent: 0,
    meshOldestReadyAgeMs: 0,
    meshStarvationAvoided: false,
    meshSkippedFrame: false,
  };
}

export function chebyshev(ax: number, az: number, bx: number, bz: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(az - bz));
}

export function distanceSq(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function parseChunkKey(key: string): { cx: number; cz: number } {
  const comma = key.indexOf(',');
  return { cx: Number(key.slice(0, comma)), cz: Number(key.slice(comma + 1)) };
}

export function categoryColor(category: ChunkDebugCategory): number {
  return CATEGORY_COLORS[category];
}

export function categoryLabel(category: ChunkDebugCategory): string {
  return CATEGORY_LABELS[category];
}

/**
 * Map real flags to overlay category. Red is only for stale mesh / halo-blocked
 * visible-radius chunks, not every "waiting" state.
 */
export function categorizeChunk(facts: ChunkDebugFacts): ChunkDebugCategory {
  if (!facts.generated) {
    return facts.requested ? 'waiting_generation' : 'absent';
  }
  if (facts.lightingActive) return 'lighting';
  if (!facts.lightingReady) return 'waiting_light';
  if (facts.meshActive) return 'meshing';
  if (facts.visible && !facts.meshLightCurrent) return 'blocked';
  if (facts.inMeshRadius && facts.lightingReady && !facts.lightContextReady) return 'blocked';
  if (facts.visible) return 'visible';
  if (facts.inMeshRadius) return 'waiting_mesh';
  return 'waiting_mesh';
}

export function lightingIsActive(
  lightingReady: boolean,
  skyFillCursor: number,
  blockScanCursor: number,
  floodOwnerKey: string,
  chunkKeyValue: string,
): boolean {
  if (lightingReady) return false;
  if (floodOwnerKey === chunkKeyValue) return true;
  if (skyFillCursor > 0 || blockScanCursor > 0) return true;
  return false;
}

/**
 * Explain why the chunk cannot take the next scheduler step.
 * Reasons come from actual Game/WorldRenderer/World conditions, not the category name.
 */
export function describeChunkBlocker(
  facts: ChunkDebugFacts,
  halo: readonly HaloNeighborFact[] = [],
): string {
  if (!facts.generated) return 'waiting generation';
  if (!facts.lightingReady) {
    if (facts.lightingActive) return 'lighting job active';
    return 'lighting job pending';
  }
  if (!facts.inMeshRadius && !facts.visible) return 'outside activation rule';
  if (facts.meshSkippedDueToGenSeparation && facts.inMeshRadius && !facts.visible) {
    return 'waiting generation-frame separation';
  }
  if (facts.lightingOnlyDueToBudget && facts.inMeshRadius && !facts.visible) {
    return 'waiting mesh budget';
  }
  if (facts.inMeshRadius && !facts.lightContextReady) {
    for (const neighbor of halo) {
      if (!neighbor.required) continue;
      if (!neighbor.present) return `neighbor (${neighbor.cx},${neighbor.cz}) missing`;
      if (!neighbor.lightingReady) return `neighbor (${neighbor.cx},${neighbor.cz}) not lit`;
    }
    return 'waiting neighbor light context';
  }
  if (facts.visible && !facts.meshLightCurrent) return 'mesh version stale';
  if (facts.meshActive) return 'mesh queued';
  if (!facts.visible && (facts.dirty || facts.pendingMesh || !facts.meshed)) {
    if (facts.meshReadyButOverBudget) return 'waiting mesh budget';
    if (facts.meshQueued || facts.pendingMesh || facts.dirty) return 'mesh queued';
    return 'mesh queued';
  }
  if (facts.visible && (facts.dirty || facts.pendingMesh)) return 'mesh queued';
  return 'none';
}

export function haloBlockedDir(halo: readonly HaloNeighborFact[]): HaloDir | null {
  for (const neighbor of halo) {
    if (!neighbor.required) continue;
    if (!neighbor.present || !neighbor.lightingReady) return neighbor.dir;
  }
  return null;
}

export function formatHalo(halo: readonly HaloNeighborFact[]): string[] {
  return halo.map((neighbor) => {
    if (!neighbor.required) return `${neighbor.dir} · n/a (outside request radius)`;
    if (neighbor.present && neighbor.lightingReady) return `${neighbor.dir} ✓`;
    const mark = neighbor.present ? 'GENERATED / WAIT_LIGHT' : 'MISSING';
    return `${neighbor.dir} ✗ chunk ${neighbor.cx},${neighbor.cz}: ${neighbor.stateLabel || mark}`;
  });
}

/** Read-only rank: index in an already-ordered snapshot. Does not mutate the queue. */
export function queueRank(key: string, orderedKeys: readonly string[]): number | null {
  const index = orderedKeys.indexOf(key);
  return index < 0 ? null : index;
}

export function formatQueueRank(rank: number | null): string {
  return rank === null ? 'not queued' : String(rank);
}

export function countHorizon(options: {
  readonly wantedKeys: readonly string[];
  readonly presentKeys: ReadonlySet<string>;
  readonly genQueueKeys: readonly string[];
  readonly lightQueueKeys: readonly string[];
  readonly meshQueueKeys: readonly string[];
  readonly genWantedKeys?: readonly string[];
  readonly lightWantedKeys?: readonly string[];
  readonly meshWantedKeys?: readonly string[];
}): HorizonCounts {
  const wanted = new Set(options.wantedKeys);
  const genWanted = new Set(options.genWantedKeys ?? options.wantedKeys);
  const lightWanted = new Set(options.lightWantedKeys ?? options.wantedKeys);
  const meshWanted = new Set(options.meshWantedKeys ?? options.wantedKeys);
  let missingWanted = 0;
  for (const key of wanted) {
    if (!options.presentKeys.has(key)) missingWanted += 1;
  }
  const obsoleteIn = (keys: readonly string[], wantedSet: ReadonlySet<string>): number => {
    let count = 0;
    for (const key of keys) {
      if (!wantedSet.has(key)) count += 1;
    }
    return count;
  };
  const queuedObsoleteGen = obsoleteIn(options.genQueueKeys, genWanted);
  const queuedObsoleteLight = obsoleteIn(options.lightQueueKeys, lightWanted);
  const queuedObsoleteMesh = obsoleteIn(options.meshQueueKeys, meshWanted);
  return {
    wantedNow: wanted.size,
    missingWanted,
    queuedObsolete: queuedObsoleteGen + queuedObsoleteLight + queuedObsoleteMesh,
    queuedObsoleteGen,
    queuedObsoleteLight,
    queuedObsoleteMesh,
  };
}

export function summarizeQueueLane(options: {
  readonly keys: readonly string[];
  readonly ready: ReadonlySet<string> | ReadonlyArray<string>;
  readonly blocked: ReadonlySet<string> | ReadonlyArray<string>;
  readonly agesMs: ReadonlyMap<string, number>;
  readonly headState?: string | null;
}): QueueLaneSnapshot {
  const readySet = options.ready instanceof Set ? options.ready : new Set(options.ready);
  const blockedSet = options.blocked instanceof Set ? options.blocked : new Set(options.blocked);
  let oldestAgeMs: number | null = null;
  for (const key of options.keys) {
    const age = options.agesMs.get(key);
    if (age === undefined) continue;
    oldestAgeMs = oldestAgeMs === null ? age : Math.max(oldestAgeMs, age);
  }
  const headKey = options.keys[0] ?? null;
  const headBlocked = headKey !== null && blockedSet.has(headKey);
  return {
    pending: options.keys.length,
    ready: [...readySet].filter((key) => options.keys.includes(key)).length,
    blocked: [...blockedSet].filter((key) => options.keys.includes(key)).length,
    oldestAgeMs,
    headKey,
    headState: options.headState ?? null,
    headBlocked,
  };
}

function delta(start?: number, end?: number): number | null {
  if (start === undefined || end === undefined) return null;
  return end - start;
}

function openDelta(start: number | undefined, end: number | undefined, now: number, stillOpen: boolean): number | null {
  if (start === undefined) return null;
  if (end !== undefined) return end - start;
  if (stillOpen) return now - start;
  return null;
}

export function computeDurations(timestamps: ChunkTimestamps, now: number): ChunkDurations {
  return {
    requestToGenerateMs: delta(timestamps.requestedAt, timestamps.generatedAt),
    generateDurationMs: delta(timestamps.generationStartedAt, timestamps.generatedAt),
    generatedToLitMs: openDelta(
      timestamps.generatedAt,
      timestamps.litAt,
      now,
      timestamps.generatedAt !== undefined && timestamps.litAt === undefined,
    ),
    litToMeshStartMs: openDelta(
      timestamps.litAt,
      timestamps.meshStartedAt,
      now,
      timestamps.litAt !== undefined && timestamps.meshStartedAt === undefined && timestamps.visibleAt === undefined,
    ),
    meshDurationMs: delta(timestamps.meshStartedAt, timestamps.meshedAt),
    meshToVisibleMs: openDelta(
      timestamps.meshedAt,
      timestamps.visibleAt,
      now,
      timestamps.meshedAt !== undefined && timestamps.visibleAt === undefined,
    ),
    ageMs: timestamps.requestedAt !== undefined
      ? now - timestamps.requestedAt
      : timestamps.generatedAt !== undefined
        ? now - timestamps.generatedAt
        : null,
  };
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (Math.abs(ms) >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)} ms`;
}

export function formatAgeMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatLastSpike(spikeMs: number, ageMs: number): string {
  return `LAST SPIKE ${spikeMs.toFixed(1)} ms (${formatAgeMs(ageMs)} ago)`;
}

export function formatHistogramMs(
  label: string,
  p50: number,
  p95: number,
  max: number,
  samples: number,
): string {
  if (samples <= 0) return `${label} —`;
  return `${label} p50 ${formatDurationMs(p50)}  p95 ${formatDurationMs(p95)}  max ${formatDurationMs(max)}  n${samples}`;
}

export function distancePriority(cx: number, cz: number, originCx: number, originCz: number): PrioritySnapshot {
  const score = distanceSq(cx, cz, originCx, originCz);
  return {
    score,
    distanceComponent: score,
    visibilityComponent: null,
    movementAheadComponent: null,
    note: 'inspect distanceSq; scheduler uses ring + age boost + ahead + distanceSq',
  };
}

export function toggleInspectFreeze(
  current: InspectFreeze | null,
  selected: { cx: number; cz: number } | null,
): InspectFreeze | null {
  if (current?.frozen) return null;
  if (!selected) return null;
  return { frozen: true, cx: selected.cx, cz: selected.cz };
}

export function resolveInspectedChunk(
  freeze: InspectFreeze | null,
  current: { cx: number; cz: number } | null,
): { cx: number; cz: number } | null {
  if (freeze?.frozen) return { cx: freeze.cx, cz: freeze.cz };
  return current;
}

export function shouldCaptureSlowChunk(
  wantedVisible: boolean,
  isVisible: boolean,
  ageMs: number,
  alreadyCaptured: boolean,
  thresholdMs = SLOW_CHUNK_THRESHOLD_MS,
): boolean {
  return wantedVisible && !isVisible && ageMs >= thresholdMs && !alreadyCaptured;
}

export function shouldWarnReadyMeshWait(
  waitMs: number,
  alreadyWarned: boolean,
  thresholdMs = READY_MESH_WAIT_WARN_MS,
): boolean {
  return waitMs >= thresholdMs && !alreadyWarned;
}

export function pushSlowSnapshot<T>(buffer: readonly T[], item: T, max = SLOW_CHUNK_RING): T[] {
  const next = [...buffer, item];
  if (next.length > max) return next.slice(next.length - max);
  return next;
}

export function compass8(x: number, z: number): string {
  if (x * x + z * z < 1e-8) return '—';
  const angle = Math.atan2(x, -z);
  const octant = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  return (['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const)[octant]!;
}

export interface FrontCandidate {
  readonly cx: number;
  readonly cz: number;
  readonly visible: boolean;
  readonly generated: boolean;
  readonly inMeshRadius: boolean;
  readonly inGenerateRadius: boolean;
}

export function selectFrontMissingChunk(options: {
  readonly freeze: InspectFreeze | null;
  readonly playerCx: number;
  readonly playerCz: number;
  readonly dirX: number;
  readonly dirZ: number;
  readonly lookChunks?: ReadonlyArray<{ cx: number; cz: number }>;
  readonly candidates: readonly FrontCandidate[];
}): { cx: number; cz: number; source: 'freeze' | 'look' | 'front-missing' | 'nearest-missing' } | null {
  if (options.freeze?.frozen) {
    return { cx: options.freeze.cx, cz: options.freeze.cz, source: 'freeze' };
  }
  const byKey = new Map(options.candidates.map((candidate) => [chunkKey(candidate.cx, candidate.cz), candidate]));
  for (const look of options.lookChunks ?? []) {
    const candidate = byKey.get(chunkKey(look.cx, look.cz));
    if (!candidate) continue;
    if (candidate.inMeshRadius && !candidate.visible) {
      return { cx: look.cx, cz: look.cz, source: 'look' };
    }
    if (!candidate.generated && candidate.inGenerateRadius) {
      return { cx: look.cx, cz: look.cz, source: 'look' };
    }
  }
  let dirX = options.dirX;
  let dirZ = options.dirZ;
  const length = Math.hypot(dirX, dirZ);
  if (length < 1e-6) {
    dirX = 0;
    dirZ = -1;
  } else {
    dirX /= length;
    dirZ /= length;
  }
  const forwardDot = (cx: number, cz: number): number => (
    (cx - options.playerCx) * dirX + (cz - options.playerCz) * dirZ
  );
  const pick = (
    list: FrontCandidate[],
    source: 'front-missing' | 'nearest-missing',
  ): { cx: number; cz: number; source: 'front-missing' | 'nearest-missing' } | null => {
    if (list.length === 0) return null;
    list.sort((a, b) => {
      const da = chebyshev(a.cx, a.cz, options.playerCx, options.playerCz);
      const db = chebyshev(b.cx, b.cz, options.playerCx, options.playerCz);
      if (da !== db) return da - db;
      return forwardDot(b.cx, b.cz) - forwardDot(a.cx, a.cz);
    });
    const best = list[0]!;
    return { cx: best.cx, cz: best.cz, source };
  };
  const missingVisible = options.candidates.filter((candidate) => candidate.inMeshRadius && !candidate.visible);
  const ahead = missingVisible.filter((candidate) => forwardDot(candidate.cx, candidate.cz) > 0.2);
  const fromAhead = pick(ahead, 'front-missing');
  if (fromAhead) return fromAhead;
  const nearestVisibleGap = pick(missingVisible, 'front-missing');
  if (nearestVisibleGap) return nearestVisibleGap;
  const ungenerated = options.candidates.filter((candidate) => !candidate.generated && candidate.inGenerateRadius);
  const aheadMissing = ungenerated.filter((candidate) => forwardDot(candidate.cx, candidate.cz) > 0.2);
  return pick(aheadMissing, 'nearest-missing') ?? pick(ungenerated, 'nearest-missing');
}

/** Chunk-grid DDA along a horizontal look ray, nearest first. */
export function chunksAlongLook(
  originX: number,
  originZ: number,
  dirX: number,
  dirZ: number,
  maxChebyshev: number,
  chunkSize = 16,
): Array<{ cx: number; cz: number }> {
  const length = Math.hypot(dirX, dirZ);
  if (length < 1e-6 || maxChebyshev < 0) return [];
  const nx = dirX / length;
  const nz = dirZ / length;
  const startCx = Math.floor(originX / chunkSize);
  const startCz = Math.floor(originZ / chunkSize);
  const result: Array<{ cx: number; cz: number }> = [{ cx: startCx, cz: startCz }];
  const stepX = nx > 0 ? 1 : nx < 0 ? -1 : 0;
  const stepZ = nz > 0 ? 1 : nz < 0 ? -1 : 0;
  const nextBoundary = (origin: number, step: number, size: number): number => {
    if (step > 0) return (Math.floor(origin / size) + 1) * size;
    if (step < 0) return Math.floor(origin / size) * size;
    return Number.POSITIVE_INFINITY;
  };
  let x = originX;
  let z = originZ;
  let cx = startCx;
  let cz = startCz;
  let guard = 0;
  const limit = (maxChebyshev * 2 + 3) * 4;
  while (guard < limit) {
    guard += 1;
    const tMaxX = stepX === 0 ? Number.POSITIVE_INFINITY : (nextBoundary(x, stepX, chunkSize) - x) / nx;
    const tMaxZ = stepZ === 0 ? Number.POSITIVE_INFINITY : (nextBoundary(z, stepZ, chunkSize) - z) / nz;
    const t = Math.min(tMaxX, tMaxZ) + 1e-4;
    x += nx * t;
    z += nz * t;
    cx = Math.floor(x / chunkSize);
    cz = Math.floor(z / chunkSize);
    if (chebyshev(cx, cz, startCx, startCz) > maxChebyshev) break;
    const last = result[result.length - 1]!;
    if (last.cx !== cx || last.cz !== cz) result.push({ cx, cz });
  }
  return result;
}

export function formatTraceEvents(events: readonly ChunkTraceEvent[], originMs: number): string[] {
  const slice = events.slice(-TRACE_EVENT_LIMIT);
  return slice.map((event) => {
    const rel = (event.t - originMs) / 1000;
    const label = event.kind.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
    return `${rel.toFixed(3)} ${label}`;
  });
}

export function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}
