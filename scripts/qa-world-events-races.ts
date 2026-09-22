/**
 * Headless QA for world-event persistence, catch-up, and search generation.
 * Not a CI gate — prints measurements for the follow-up report.
 */
import { performance } from 'node:perf_hooks';
import { BlockId } from '../src/blocks';
import { VoxelWorld } from '../src/world/World';
import { WorldEventsManager, DEFAULT_WORLD_EVENTS_CONFIG, EVENT_SEARCH_MAX_CHUNK_COMMITS_PER_TICK } from '../server/services/worldEvents';
import type { WorldEventsHost } from '../server/services/worldEvents';

function memoryHost(world: VoxelWorld): WorldEventsHost & { nowMs: number; messages: string[] } {
  const host: WorldEventsHost & { nowMs: number; messages: string[] } = {
    world,
    nowMs: Date.UTC(2026, 8, 19, 12, 0, 0),
    messages: [],
    worldId: () => 'anarchy',
    now: () => host.nowMs,
    random: () => 0,
    spawn: () => [0, 64, 0],
    loadStore: () => ({}),
    saveStore: () => undefined,
    createValidationContext: () => ({
      storeReads: 1,
      claimVolumes: [],
      autoMineVolumes: [],
      specialVolumes: [],
      homes: [],
      players: [],
    }),
    homes: () => [],
    players: () => [],
    flush: () => undefined,
    markDirty: () => undefined,
    persistWorld: () => undefined,
    closeChestWindow: () => undefined,
    broadcast: (text) => { host.messages.push(text); },
    send: () => undefined,
    log: () => undefined,
  };
  return host;
}

function banner(title: string) {
  console.log(`\n== ${title} ==`);
}

const world = new VoxelWorld('qa-event-races');
const host = memoryHost(world);
const manager = new WorldEventsManager(host);
manager.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC' });
manager.load();
manager.enabled = true;

const x = 24;
const z = 24;
const y = world.surfaceY(x, z) + 1;
const before = world.serializeModifications();
banner('force spawn / protection / modifications');
const spawned = manager.forceSpawn({ at: { x, y, z }, yaw: 0 });
if (!spawned.ok || !('event' in spawned)) throw new Error('force spawn failed');
console.log('placed', world.getBlock(x, y, z) === BlockId.EventChest);
console.log('protected column', manager.isProtected(x, y, z), manager.isProtected(x, 1, z), manager.isProtected(x, 250, z));
console.log('mods equal after spawn', JSON.stringify(world.serializeModifications()) === JSON.stringify(before));
manager.forceCleanup();
manager.acknowledgeWorldSaved();
console.log('mods equal after cleanup', JSON.stringify(world.serializeModifications()) === JSON.stringify(before));
console.log('chest gone', world.getBlock(x, y, z) !== BlockId.EventChest);

banner('scheduler catch-up 20:02 locked ~3 min');
{
  const w = new VoxelWorld('qa-event-catchup-lock');
  const h = memoryHost(w);
  h.nowMs = Date.UTC(2026, 8, 19, 20, 2, 0);
  const m = new WorldEventsManager(h);
  m.setConfig({
    ...DEFAULT_WORLD_EVENTS_CONFIG,
    timeZone: 'UTC',
    spawnMinDistance: 24,
    spawnMaxDistance: 24,
    worldBorder: 10_000,
    announceCoordinates: false,
  });
  m.load();
  m.enabled = true;
  m.searchGenerationBudgetMs = 1_000;
  let guard = 0;
  while (!m.active?.chest && guard < 40) {
    m.tick();
    guard += 1;
  }
  console.log('phase', m.active?.phase, 'locked', m.active?.chestLocked, 'ticks', guard);
  console.log('messages', h.messages);
}

banner('scheduler catch-up 20:10 already open');
{
  const w = new VoxelWorld('qa-event-catchup-open');
  const h = memoryHost(w);
  h.nowMs = Date.UTC(2026, 8, 19, 20, 10, 0);
  const m = new WorldEventsManager(h);
  m.setConfig({
    ...DEFAULT_WORLD_EVENTS_CONFIG,
    timeZone: 'UTC',
    spawnMinDistance: 24,
    spawnMaxDistance: 24,
    worldBorder: 10_000,
    announceCoordinates: false,
  });
  m.load();
  m.enabled = true;
  m.searchGenerationBudgetMs = 1_000;
  let guard = 0;
  while (!m.active?.chest && guard < 40) {
    m.tick();
    guard += 1;
  }
  console.log('phase', m.active?.phase, 'locked', m.active?.chestLocked, 'ticks', guard);
  console.log('messages', h.messages);
}

banner('expired window >22:00 never spawns');
{
  const w = new VoxelWorld('qa-event-expired');
  const h = memoryHost(w);
  h.nowMs = Date.UTC(2026, 8, 19, 22, 0, 1);
  const m = new WorldEventsManager(h);
  m.setConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG, timeZone: 'UTC', dailyTime: '20:00', durationMinutes: 120 });
  m.load();
  m.enabled = true;
  m.tick();
  console.log('phase', m.active?.phase, 'spawnDay', m.active ? new Date(m.active.spawnAt).toISOString() : 'none');
  console.log('placed', m.active?.chest ? 'yes' : 'no');
}

banner('far search generation per tick');
{
  const w = new VoxelWorld('qa-event-far-search');
  const h = memoryHost(w);
  const m = new WorldEventsManager(h);
  m.setConfig({
    ...DEFAULT_WORLD_EVENTS_CONFIG,
    timeZone: 'UTC',
    spawnMinDistance: 80,
    spawnMaxDistance: 80,
    worldBorder: 10_000,
    maxSearchAttempts: 16,
    attemptsPerTick: 4,
  });
  m.load();
  m.enabled = true;
  m.searchGenerationBudgetMs = 4;
  m.searchMaxChunkCommitsPerTick = EVENT_SEARCH_MAX_CHUNK_COMMITS_PER_TICK;
  m.forceSpawn({ yaw: 0 });
  const perTick: number[] = [];
  const ms: number[] = [];
  let guard = 0;
  while (!m.active?.chest && guard < 80) {
    const t0 = performance.now();
    const beforeCommits = w.generationCommitCount;
    m.tick();
    ms.push(performance.now() - t0);
    perTick.push(w.generationCommitCount - beforeCommits);
    guard += 1;
  }
  console.log('ticks', guard, 'placed', Boolean(m.active?.chest));
  console.log('commitsPerTick', perTick.slice(0, 12), '... max', Math.max(0, ...perTick));
  console.log('tickMs max', Number(Math.max(0, ...ms).toFixed(3)), 'avg', Number((ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length)).toFixed(3)));
  console.log('lastSearchGenerationMs', Number(m.lastSearchGenerationMs.toFixed(3)));
}
