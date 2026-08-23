/**
 * DEV-only snapshot of live streaming queues. Read-only: does not mutate jobs.
 */

import { CHUNK_SIZE, chunkKey as worldChunkKey } from '../core/constants';
import { lightingFloodOwner } from '../world/LightEngine';
import type { VoxelWorld } from '../world/World';
import { chebyshevChunkDistance, lightContextReady } from '../world/worldJobs';
import {
  CARDINAL_HALO,
  categorizeChunk,
  categoryLabel,
  chebyshev,
  chunkKey,
  chunksAlongLook,
  compass8,
  computeDurations,
  countHorizon,
  describeChunkBlocker,
  distancePriority,
  distanceSq,
  formatDurationMs,
  formatHalo,
  formatQueueRank,
  formatTraceEvents,
  haloBlockedDir,
  lightingIsActive,
  queueRank,
  selectFrontMissingChunk,
  shouldCaptureSlowChunk,
  summarizeQueueLane,
  yesNo,
  type ChunkDebugFacts,
  type FrontCandidate,
  type HaloNeighborFact,
  type InspectFreeze,
  type JobFrameCounters,
  type SlowChunkSnapshot,
} from './chunkStreamingInspector';
import type { ChunkStreamingTrace } from './chunkStreamingTrace';

export interface StreamingWorldView {
  readonly world: VoxelWorld;
  readonly hasMesh: (key: string) => boolean;
  readonly originX: number;
  readonly originZ: number;
  readonly meshRadius: number;
  readonly generateRadius: number;
  readonly playerCx: number;
  readonly playerCz: number;
  readonly lookX: number;
  readonly lookZ: number;
  readonly velocityX: number;
  readonly velocityZ: number;
  readonly flying: boolean;
  readonly jobFrame: JobFrameCounters;
  readonly freeze: InspectFreeze | null;
  readonly now: number;
}

export interface ChunkInspectView {
  readonly cx: number;
  readonly cz: number;
  readonly distance: number;
  readonly state: string;
  readonly category: ReturnType<typeof categorizeChunk>;
  readonly ageMs: number | null;
  readonly facts: ChunkDebugFacts;
  readonly blocker: string;
  readonly halo: HaloNeighborFact[];
  readonly haloLines: string[];
  readonly haloBlock: ReturnType<typeof haloBlockedDir>;
  readonly genRank: number | null;
  readonly lightRank: number | null;
  readonly meshRank: number | null;
  readonly lightVersion: number | null;
  readonly meshedLightVersion: number | null;
  readonly priority: ReturnType<typeof distancePriority>;
  readonly durations: ReturnType<typeof computeDurations>;
  readonly events: string[];
  readonly source?: string;
}

export interface StreamingInspectorSnapshot {
  readonly player: ChunkInspectView;
  readonly front: ChunkInspectView | null;
  readonly gen: ReturnType<typeof summarizeQueueLane>;
  readonly light: ReturnType<typeof summarizeQueueLane>;
  readonly mesh: ReturnType<typeof summarizeQueueLane>;
  readonly horizon: ReturnType<typeof countHorizon>;
  readonly furthestRequested: number;
  readonly furthestMissing: number | null;
  readonly meshRadius: number;
  readonly generateRadius: number;
  readonly speedBlocksPerSec: number;
  readonly heading: string;
  readonly flying: boolean;
  readonly jobFrame: JobFrameCounters;
  readonly lightStopsOnBlockedHead: boolean;
  readonly meshSkipsBlockedHead: boolean;
  readonly frozen: boolean;
  readonly overlay: Map<string, ReturnType<typeof categorizeChunk>>;
}

function wantedKeys(originCx: number, originCz: number, radius: number): string[] {
  const keys: string[] = [];
  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      keys.push(chunkKey(originCx + dx, originCz + dz));
    }
  }
  return keys;
}

function neighborStateLabel(world: VoxelWorld, hasMesh: (key: string) => boolean, cx: number, cz: number): string {
  const chunk = world.chunks.get(worldChunkKey(cx, cz));
  if (!chunk) return 'MISSING';
  if (!chunk.lightingReady) return 'GENERATED / WAIT_LIGHT';
  if (!hasMesh(worldChunkKey(cx, cz))) return 'LIT / WAIT_MESH';
  return 'READY';
}

export function gatherHalo(
  world: VoxelWorld,
  hasMesh: (key: string) => boolean,
  cx: number,
  cz: number,
  originCx: number,
  originCz: number,
  generateRadius: number,
): HaloNeighborFact[] {
  return CARDINAL_HALO.map((dir) => {
    const nx = cx + dir.dx;
    const nz = cz + dir.dz;
    const required = chebyshevChunkDistance(nx, nz, originCx, originCz) <= generateRadius;
    const neighbor = world.chunks.get(worldChunkKey(nx, nz));
    return {
      dir: dir.dir,
      cx: nx,
      cz: nz,
      required,
      present: Boolean(neighbor),
      lightingReady: neighbor?.lightingReady === true,
      stateLabel: neighborStateLabel(world, hasMesh, nx, nz),
    };
  });
}

export function gatherChunkFacts(
  view: StreamingWorldView,
  cx: number,
  cz: number,
  extras: {
    readonly genKeys: readonly string[];
    readonly lightKeys: readonly string[];
    readonly meshKeys: readonly string[];
    readonly meshReadyKeys: ReadonlySet<string>;
    readonly floodOwner: string;
    readonly meshActiveKey: string | null;
  },
): ChunkDebugFacts {
  const key = worldChunkKey(cx, cz);
  const chunk = view.world.chunks.get(key);
  const generated = Boolean(chunk);
  const inMeshRadius = chebyshev(cx, cz, view.playerCx, view.playerCz) <= view.meshRadius;
  const inGenerateRadius = chebyshev(cx, cz, view.playerCx, view.playerCz) <= view.generateRadius;
  const requested = inGenerateRadius || generated || extras.genKeys.includes(chunkKey(cx, cz));
  const lightingReady = chunk?.lightingReady === true;
  const lightingActive = chunk
    ? lightingIsActive(
      lightingReady,
      chunk.skyFillCursor,
      chunk.blockScanCursor,
      extras.floodOwner,
      key,
    )
    : false;
  const visible = view.hasMesh(key);
  const pendingMesh = view.world.pendingMesh.has(key);
  const meshQueued = extras.meshKeys.includes(chunkKey(cx, cz)) || pendingMesh;
  const lightContext = chunk
    ? lightContextReady(view.world, chunk, view.playerCx, view.playerCz, view.generateRadius)
    : false;
  return {
    cx,
    cz,
    requested,
    generated,
    lightingQueued: generated && !lightingReady && !lightingActive,
    lightingActive,
    lightingReady,
    lightContextReady: lightContext,
    meshQueued,
    meshActive: extras.meshActiveKey === key,
    meshed: visible,
    meshLightCurrent: chunk ? chunk.meshedLightVersion === chunk.lightVersion : false,
    visible,
    dirty: chunk?.dirty === true,
    pendingMesh,
    pendingLight: generated && !lightingReady,
    inMeshRadius,
    inGenerateRadius,
    floodOwnerIsOther: extras.floodOwner !== '' && extras.floodOwner !== 'region' && extras.floodOwner !== key,
    meshSkippedDueToGenSeparation: view.jobFrame.meshSkippedDueToGenSeparation,
    lightingOnlyDueToBudget: view.jobFrame.lightingOnlyDueToBudget,
    meshReadyButOverBudget: extras.meshReadyKeys.has(chunkKey(cx, cz))
      && view.jobFrame.meshCompleted === 0
      && !view.jobFrame.meshSkippedDueToGenSeparation
      && view.jobFrame.meshAttempted > 0,
  };
}

export function collectStreamingQueues(view: StreamingWorldView): {
  genKeys: string[];
  lightKeys: string[];
  meshKeys: string[];
  meshAllKeys: string[];
  lightReady: Set<string>;
  lightBlocked: Set<string>;
  meshReady: Set<string>;
  meshBlocked: Set<string>;
  floodOwner: string;
} {
  const originCx = view.playerCx;
  const originCz = view.playerCz;
  const genKeys: Array<{ key: string; dist: number }> = [];
  for (let dz = -view.generateRadius; dz <= view.generateRadius; dz += 1) {
    for (let dx = -view.generateRadius; dx <= view.generateRadius; dx += 1) {
      const cx = originCx + dx;
      const cz = originCz + dz;
      if (view.world.chunks.has(worldChunkKey(cx, cz))) continue;
      genKeys.push({ key: chunkKey(cx, cz), dist: distanceSq(cx, cz, originCx, originCz) });
    }
  }
  genKeys.sort((a, b) => a.dist - b.dist);

  const floodOwner = lightingFloodOwner();
  const lightJobs: Array<{ key: string; dist: number; ready: boolean }> = [];
  const meshJobs: Array<{ key: string; dist: number; ready: boolean }> = [];
  for (const chunk of view.world.chunks.values()) {
    const dist = distanceSq(chunk.x, chunk.z, originCx, originCz);
    const key = chunkKey(chunk.x, chunk.z);
    if (!chunk.lightingReady) {
      const blocked = floodOwner !== '' && floodOwner !== 'region' && floodOwner !== worldChunkKey(chunk.x, chunk.z);
      lightJobs.push({ key, dist, ready: !blocked });
    }
    const inMesh = chebyshev(chunk.x, chunk.z, originCx, originCz) <= view.meshRadius;
    if (inMesh && (chunk.dirty || chunk.lightMeshStale || view.world.pendingMesh.has(worldChunkKey(chunk.x, chunk.z)))) {
      const context = lightContextReady(view.world, chunk, originCx, originCz, view.generateRadius);
      meshJobs.push({ key, dist, ready: chunk.lightingReady && context });
    }
  }
  lightJobs.sort((a, b) => a.dist - b.dist);
  meshJobs.sort((a, b) => a.dist - b.dist);

  const meshAllKeys: string[] = [];
  const seenMesh = new Set<string>();
  const pushMeshAll = (key: string): void => {
    if (seenMesh.has(key)) return;
    seenMesh.add(key);
    meshAllKeys.push(key);
  };
  for (const key of view.world.pendingMesh) pushMeshAll(key);
  for (const chunk of view.world.chunks.values()) {
    if (chunk.dirty || chunk.lightMeshStale) pushMeshAll(chunkKey(chunk.x, chunk.z));
  }

  const lightReady = new Set(lightJobs.filter((job) => job.ready).map((job) => job.key));
  const lightBlocked = new Set(lightJobs.filter((job) => !job.ready).map((job) => job.key));
  const meshReady = new Set(meshJobs.filter((job) => job.ready).map((job) => job.key));
  const meshBlocked = new Set(meshJobs.filter((job) => !job.ready).map((job) => job.key));
  return {
    genKeys: genKeys.map((job) => job.key),
    lightKeys: lightJobs.map((job) => job.key),
    meshKeys: meshJobs.map((job) => job.key),
    meshAllKeys,
    lightReady,
    lightBlocked,
    meshReady,
    meshBlocked,
    floodOwner,
  };
}

export function inspectStreamingChunk(
  view: StreamingWorldView,
  cx: number,
  cz: number,
  queues: ReturnType<typeof collectStreamingQueues>,
  trace: ChunkStreamingTrace,
  meshActiveKey: string | null,
  source?: string,
): ChunkInspectView {
  const facts = gatherChunkFacts(view, cx, cz, {
    genKeys: queues.genKeys,
    lightKeys: queues.lightKeys,
    meshKeys: queues.meshKeys,
    meshReadyKeys: queues.meshReady,
    floodOwner: queues.floodOwner,
    meshActiveKey,
  });
  const halo = gatherHalo(view.world, view.hasMesh, cx, cz, view.playerCx, view.playerCz, view.generateRadius);
  const category = categorizeChunk(facts);
  const timestamps = trace.timestamps(cx, cz);
  const durations = computeDurations(timestamps, view.now);
  const chunk = view.world.chunks.get(worldChunkKey(cx, cz));
  const events = trace.get(cx, cz)?.events ?? [];
  const origin = timestamps.requestedAt ?? events[0]?.t ?? view.now;
  return {
    cx,
    cz,
    distance: chebyshev(cx, cz, view.playerCx, view.playerCz),
    state: categoryLabel(category),
    category,
    ageMs: durations.ageMs,
    facts,
    blocker: describeChunkBlocker(facts, halo),
    halo,
    haloLines: formatHalo(halo),
    haloBlock: haloBlockedDir(halo),
    genRank: queueRank(chunkKey(cx, cz), queues.genKeys),
    lightRank: queueRank(chunkKey(cx, cz), queues.lightKeys),
    meshRank: queueRank(chunkKey(cx, cz), queues.meshKeys),
    lightVersion: chunk?.lightVersion ?? null,
    meshedLightVersion: chunk?.meshedLightVersion ?? null,
    priority: distancePriority(cx, cz, view.playerCx, view.playerCz),
    durations,
    events: formatTraceEvents(events, origin),
    source,
  };
}

export function captureStreamingSnapshot(
  view: StreamingWorldView,
  trace: ChunkStreamingTrace,
  meshActiveKey: string | null,
): StreamingInspectorSnapshot {
  const queues = collectStreamingQueues(view);
  const ages = new Map<string, number>();
  const noteAge = (keys: readonly string[]): void => {
    for (const key of keys) {
      const comma = key.indexOf(',');
      const cx = Number(key.slice(0, comma));
      const cz = Number(key.slice(comma + 1));
      const requested = trace.timestamps(cx, cz).requestedAt;
      if (requested !== undefined) ages.set(key, view.now - requested);
    }
  };
  noteAge(queues.genKeys);
  noteAge(queues.lightKeys);
  noteAge(queues.meshKeys);

  const wantedVisible = wantedKeys(view.playerCx, view.playerCz, view.meshRadius);
  const present = new Set([...view.world.chunks.keys()]);
  const horizon = countHorizon({
    wantedKeys: wantedVisible,
    presentKeys: present,
    genQueueKeys: queues.genKeys,
    lightQueueKeys: queues.lightKeys,
    meshQueueKeys: queues.meshAllKeys,
  });

  const overlayCategories = new Map<string, ReturnType<typeof categorizeChunk>>();
  const candidates: FrontCandidate[] = [];
  let furthestMissing: number | null = null;
  for (let dz = -view.generateRadius; dz <= view.generateRadius; dz += 1) {
    for (let dx = -view.generateRadius; dx <= view.generateRadius; dx += 1) {
      const cx = view.playerCx + dx;
      const cz = view.playerCz + dz;
      const facts = gatherChunkFacts(view, cx, cz, {
        genKeys: queues.genKeys,
        lightKeys: queues.lightKeys,
        meshKeys: queues.meshKeys,
        meshReadyKeys: queues.meshReady,
        floodOwner: queues.floodOwner,
        meshActiveKey,
      });
      overlayCategories.set(chunkKey(cx, cz), categorizeChunk(facts));
      candidates.push({
        cx,
        cz,
        visible: facts.visible,
        generated: facts.generated,
        inMeshRadius: facts.inMeshRadius,
        inGenerateRadius: facts.inGenerateRadius,
      });
      if (!facts.generated) {
        const dist = chebyshev(cx, cz, view.playerCx, view.playerCz);
        furthestMissing = furthestMissing === null ? dist : Math.max(furthestMissing, dist);
      }
    }
  }

  const speed = Math.hypot(view.velocityX, view.velocityZ);
  const dirX = speed > 0.4 ? view.velocityX : view.lookX;
  const dirZ = speed > 0.4 ? view.velocityZ : view.lookZ;
  const lookChunks = chunksAlongLook(
    view.originX,
    view.originZ,
    view.lookX,
    view.lookZ,
    view.generateRadius,
    CHUNK_SIZE,
  );
  const frontSel = selectFrontMissingChunk({
    freeze: view.freeze,
    playerCx: view.playerCx,
    playerCz: view.playerCz,
    dirX,
    dirZ,
    lookChunks,
    candidates,
  });

  const player = inspectStreamingChunk(view, view.playerCx, view.playerCz, queues, trace, meshActiveKey);
  const front = frontSel
    ? inspectStreamingChunk(view, frontSel.cx, frontSel.cz, queues, trace, meshActiveKey, frontSel.source)
    : null;

  const genHead = queues.genKeys[0];
  const lightHead = queues.lightKeys[0];
  const meshHead = queues.meshKeys[0];

  return {
    player,
    front,
    gen: summarizeQueueLane({
      keys: queues.genKeys,
      ready: queues.genKeys,
      blocked: [],
      agesMs: ages,
      headState: genHead ? 'WAIT_GEN' : null,
    }),
    light: summarizeQueueLane({
      keys: queues.lightKeys,
      ready: queues.lightReady,
      blocked: queues.lightBlocked,
      agesMs: ages,
      headState: lightHead
        ? (queues.lightBlocked.has(lightHead) ? 'BLOCKED' : 'READY')
        : null,
    }),
    mesh: summarizeQueueLane({
      keys: queues.meshKeys,
      ready: queues.meshReady,
      blocked: queues.meshBlocked,
      agesMs: ages,
      headState: meshHead
        ? (queues.meshBlocked.has(meshHead) ? 'BLOCKED' : 'READY')
        : null,
    }),
    horizon,
    furthestRequested: view.generateRadius,
    furthestMissing,
    meshRadius: view.meshRadius,
    generateRadius: view.generateRadius,
    speedBlocksPerSec: speed,
    heading: compass8(dirX, dirZ),
    flying: view.flying,
    jobFrame: view.jobFrame,
    lightStopsOnBlockedHead: true,
    meshSkipsBlockedHead: true,
    frozen: view.freeze?.frozen === true,
    overlay: overlayCategories,
  };
}

export function maybeSlowSnapshot(
  view: ChunkInspectView,
  horizon: ReturnType<typeof countHorizon>,
  genPending: number,
  lightPending: number,
  meshPending: number,
  now: number,
  alreadyCaptured: boolean,
): SlowChunkSnapshot | null {
  const wantedVisible = view.facts.inMeshRadius;
  if (!shouldCaptureSlowChunk(wantedVisible, view.facts.visible, view.ageMs ?? 0, alreadyCaptured)) {
    return null;
  }
  return {
    atMs: now,
    cx: view.cx,
    cz: view.cz,
    state: view.state,
    blocker: view.blocker,
    genRank: view.genRank,
    lightRank: view.lightRank,
    meshRank: view.meshRank,
    durations: view.durations,
    wantedNow: horizon.wantedNow,
    missingWanted: horizon.missingWanted,
    queuedObsolete: horizon.queuedObsolete,
    genPending,
    lightPending,
    meshPending,
  };
}

function formatInspectBlock(title: string, view: ChunkInspectView, frozen: boolean): string[] {
  const haloNote = view.haloBlock ? ` (${view.haloBlock} halo)` : '';
  return [
    `${title} ${view.cx},${view.cz}${frozen ? '  FROZEN' : ''}${view.source ? `  [${view.source}]` : ''}`,
    `distance ${view.distance}  state ${view.state}  age ${formatDurationMs(view.ageMs)}`,
    `requested ${yesNo(view.facts.requested)}  generated ${yesNo(view.facts.generated)}  lit ${yesNo(view.facts.lightingReady)}  lightContextReady ${yesNo(view.facts.lightContextReady)}`,
    `meshQueued ${yesNo(view.facts.meshQueued)}  meshActive ${yesNo(view.facts.meshActive)}  meshed ${yesNo(view.facts.meshed)}  visible ${yesNo(view.facts.visible)}`,
    `lightVersion ${view.lightVersion ?? '—'}  meshedLightVersion ${view.meshedLightVersion ?? '—'}`,
    `priority ${view.priority.score}  (${view.priority.note})`,
    `GEN rank ${formatQueueRank(view.genRank)}  LIGHT rank ${formatQueueRank(view.lightRank)}  MESH rank ${formatQueueRank(view.meshRank)}`,
    `blockedBy ${view.blocker}${haloNote}`,
    `request→gen ${formatDurationMs(view.durations.requestToGenerateMs)}  gen dur ${formatDurationMs(view.durations.generateDurationMs)}  gen→lit ${formatDurationMs(view.durations.generatedToLitMs)}`,
    `lit→meshStart ${formatDurationMs(view.durations.litToMeshStartMs)}  mesh dur ${formatDurationMs(view.durations.meshDurationMs)}  mesh→vis ${formatDurationMs(view.durations.meshToVisibleMs)}`,
    'HALO',
    ...view.haloLines.map((line) => `  ${line}`),
    ...(view.events.length > 0 ? ['EVENTS', ...view.events.map((line) => `  ${line}`)] : []),
  ];
}

export function formatStreamingHud(
  snap: StreamingInspectorSnapshot,
  slow: SlowChunkSnapshot | null,
  now: number,
): string {
  const age = (ms: number | null): string => (ms === null ? '—' : formatDurationMs(ms));
  const lines = [
    `GEN ${snap.gen.pending} pending | oldest ${age(snap.gen.oldestAgeMs)} | head ${snap.gen.headKey ?? '—'} ${snap.gen.headState ?? ''}`,
    `LIGHT ${snap.light.pending} pending | ready ${snap.light.ready} | blocked ${snap.light.blocked} | oldest ${age(snap.light.oldestAgeMs)}`,
    `  head ${snap.light.headKey ?? '—'} ${snap.light.headState ?? ''} | stopsOnBlockedHead ${yesNo(snap.lightStopsOnBlockedHead)}`,
    `MESH ${snap.mesh.pending} pending | ready ${snap.mesh.ready} | blocked ${snap.mesh.blocked} | oldest ${age(snap.mesh.oldestAgeMs)}`,
    `  head ${snap.mesh.headKey ?? '—'} ${snap.mesh.headState ?? ''} | skipsBlockedHead ${yesNo(snap.meshSkipsBlockedHead)}`,
    `FRAME gen ${snap.jobFrame.genAttempted}/${snap.jobFrame.genCompleted}/${snap.jobFrame.genSkippedBlocked}  light ${snap.jobFrame.lightAttempted}/${snap.jobFrame.lightCompleted}/${snap.jobFrame.lightYielded}/${snap.jobFrame.lightBlocked}  mesh ${snap.jobFrame.meshAttempted}/${snap.jobFrame.meshCompleted}/${snap.jobFrame.meshSkippedBlocked}${snap.jobFrame.meshSkippedDueToGenSeparation ? '  skipMesh(gen-frame)' : ''}${snap.jobFrame.lightingOnlyDueToBudget ? '  lighting-only budget' : ''}`,
    `MOVE ${snap.speedBlocksPerSec.toFixed(1)} b/s ${snap.heading}  flying ${yesNo(snap.flying)}`,
    `HORIZON render ${snap.meshRadius}  requested ${snap.generateRadius}  furthestReq ${snap.furthestRequested}  furthestMissing ${snap.furthestMissing ?? '—'}`,
    `  wantedNow ${snap.horizon.wantedNow}  missingWanted ${snap.horizon.missingWanted}  queuedObsolete ${snap.horizon.queuedObsolete} (g${snap.horizon.queuedObsoleteGen}/l${snap.horizon.queuedObsoleteLight}/m${snap.horizon.queuedObsoleteMesh})`,
    ...formatInspectBlock('PLAYER CHUNK', snap.player, false),
    ...(snap.front ? formatInspectBlock('FRONT CHUNK', snap.front, snap.frozen) : ['FRONT CHUNK —']),
  ];
  if (slow) {
    lines.push(
      `LAST SLOW CHUNK ${slow.cx},${slow.cz}  ${slow.state}  ${(now - slow.atMs) >= 0 ? `${((now - slow.atMs) / 1000).toFixed(1)}s ago` : ''}`,
      `  blockedBy ${slow.blocker}  ranks G${formatQueueRank(slow.genRank)} L${formatQueueRank(slow.lightRank)} M${formatQueueRank(slow.meshRank)}`,
      `  wanted ${slow.wantedNow} missing ${slow.missingWanted} obsolete ${slow.queuedObsolete}  queues g${slow.genPending}/l${slow.lightPending}/m${slow.meshPending}`,
      `  lit→meshStart ${formatDurationMs(slow.durations.litToMeshStartMs)}  age ${formatDurationMs(slow.durations.ageMs)}`,
    );
  }
  lines.push('LEGEND  ' + [
    'GRAY absent',
    'BLUE waitGen',
    'CYAN waitLight',
    'YELLOW lighting',
    'ORANGE waitMesh',
    'PURPLE meshing',
    'GREEN visible',
    'RED blocked',
  ].join(' | '));
  lines.push('F7 light  F8 chunks  F9 freeze front');
  return lines.join('\n');
}

export function overlayColorAt(
  overlay: Map<string, ReturnType<typeof categorizeChunk>>,
  cx: number,
  cz: number,
): ReturnType<typeof categorizeChunk> {
  return overlay.get(chunkKey(cx, cz)) ?? 'absent';
}
