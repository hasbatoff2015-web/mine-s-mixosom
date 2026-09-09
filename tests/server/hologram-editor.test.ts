import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import { parseClientMessage } from '../../shared/protocol';

async function tempDir(): Promise<string> {
  return mkdtemp(pathJoin(tmpdir(), 'fc-hologram-editor-'));
}

function testConfig(dataDir: string, extra: { operators?: string[] } = {}) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'anarchy',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8',
      CHUNK_VIEW_RADIUS: '1',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '60000',
    }, process.cwd()),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    persistIntervalMs: 60_000,
    pluginDir: pathJoin(dataDir, 'no-plugins'),
    loadExamplePlugin: false,
    loadBuiltinPlugins: true,
    operators: extra.operators ?? ['Op'],
  };
}

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function resultLines(sink: MemorySink): string[] {
  const lines: string[] = [];
  for (const payload of sink.payloads) {
    const record = payload as { type?: string; lines?: string[]; text?: string };
    if (record.type === 'command_result' && record.lines) lines.push(...record.lines);
    if (record.type === 'chat' && record.text) lines.push(record.text);
  }
  return lines;
}

describe('hologram in-game editor', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(dataDir?: string): Promise<WorldInstance> {
    const dir = dataDir ?? await tempDir();
    if (!dataDir) dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function join(world: WorldInstance, name: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  function chat(world: WorldInstance, player: ReturnType<typeof join>, text: string): string[] {
    player.sink.payloads.length = 0;
    world.handleChat(player.player, text);
    return resultLines(player.sink);
  }

  function hologramPackets(sink: MemorySink) {
    return sink.payloads.filter((payload) => {
      const record = payload as { type?: string };
      return record.type === 'holograms' || record.type === 'hologram_editor';
    }) as Array<{ type: string; hologram?: { name: string; lines: string[]; font?: string; size?: number; style?: string }; holograms?: Array<{ name: string; lines: string[]; font?: string; size?: number; style?: string }> }>;
  }

  it('opens the editor, saves appearance, broadcasts, and persists', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const observer = join(world, 'Ada');
    expect(chat(world, op, '/holograms create spawn').some((line) => line.includes('Created hologram'))).toBe(true);
    op.sink.payloads.length = 0;
    observer.sink.payloads.length = 0;
    world.interactHologram(op.player, 'spawn');
    const opened = hologramPackets(op.sink).find((payload) => payload.type === 'hologram_editor');
    expect(opened?.hologram).toMatchObject({
      name: 'spawn',
      lines: ['spawn'],
      font: 'sans',
      size: 1,
      style: 'bold',
    });
    observer.sink.payloads.length = 0;
    world.updateHologramAppearance(op.player, {
      type: 'hologram_update',
      name: 'spawn',
      lines: ['Welcome', 'to spawn'],
      font: 'ui',
      size: 1.5,
      style: 'italic',
    });
    const listed = world.holograms.list().find((entry) => entry.name === 'spawn');
    expect(listed).toMatchObject({
      lines: ['Welcome', 'to spawn'],
      font: 'ui',
      size: 1.5,
      style: 'italic',
      x: listed?.x,
      y: listed?.y,
      z: listed?.z,
    });
    expect(hologramPackets(observer.sink).some((payload) => (
      payload.type === 'holograms'
      && payload.holograms?.some((entry) => entry.font === 'ui' && entry.lines[1] === 'to spawn')
    ))).toBe(true);
    const dir = world.config.dataDir;
    await world.save();
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const again = await boot(dir);
    const op2 = join(again, 'Op');
    const info = chat(again, op2, '/holograms info spawn');
    expect(info.some((line) => line.includes('Font: ui'))).toBe(true);
    expect(info.some((line) => line.includes('Size: 1.5'))).toBe(true);
    expect(info.some((line) => line.includes('Welcome'))).toBe(true);
    expect(again.holograms.list()[0]).toMatchObject({ font: 'ui', size: 1.5, style: 'italic' });
  });

  it('does not modify the hologram when the editor is cancelled', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    chat(world, op, '/holograms create spawn');
    const before = structuredClone(world.holograms.list());
    world.interactHologram(op.player, 'spawn');
    expect(world.holograms.list()).toEqual(before);
  });

  it('denies players without holograms.create and allows a granted editor', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    chat(world, op, '/holograms create spawn');
    ada.sink.payloads.length = 0;
    world.interactHologram(ada.player, 'spawn');
    expect(resultLines(ada.sink).some((line) => line.includes('You do not have permission.'))).toBe(true);
    expect(hologramPackets(ada.sink).some((payload) => payload.type === 'hologram_editor')).toBe(false);
    ada.sink.payloads.length = 0;
    world.updateHologramAppearance(ada.player, {
      type: 'hologram_update',
      name: 'spawn',
      lines: ['stolen'],
      font: 'ui',
      size: 2,
      style: 'bold',
    });
    expect(resultLines(ada.sink).some((line) => line.includes('You do not have permission.'))).toBe(true);
    expect(world.holograms.list()[0]?.lines).toEqual(['spawn']);
    world.permissions.grant('ada', 'holograms.create');
    ada.sink.payloads.length = 0;
    world.interactHologram(ada.player, 'spawn');
    expect(hologramPackets(ada.sink).some((payload) => payload.type === 'hologram_editor')).toBe(true);
  });

  it('loads a style-less persisted hologram with safe defaults', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const worldId = loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'anarchy',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8',
    }, process.cwd()).worldId;
    const pluginDir = pathJoin(dir, worldId, 'plugin-data', 'holograms');
    await mkdir(pluginDir, { recursive: true });
    await writeFile(pathJoin(pluginDir, 'holograms.json'), `${JSON.stringify({
      holograms: [{
        name: 'legacy',
        worldId,
        x: 4,
        y: 70,
        z: 4,
        lines: ['Old text'],
        range: 40,
        enabled: true,
      }],
    }, null, 2)}\n`);
    const world = await boot(dir);
    const listed = world.holograms.list().find((entry) => entry.name === 'legacy');
    expect(listed).toMatchObject({
      lines: ['Old text'],
      font: 'sans',
      size: 1,
      style: 'bold',
      range: 40,
      kind: 'normal',
      backgroundEnabled: true,
      billboard: true,
    });
  });

  it('rejects malformed client edit packets before they reach the store', () => {
    expect(parseClientMessage({ type: 'hologram_update', name: 'spawn', lines: ['Hi'], font: 'ui', size: 'big', style: 'bold' }))
      .toEqual({ error: 'hologram size invalid' });
    expect(parseClientMessage({ type: 'hologram_interact', name: '' }))
      .toEqual({ error: 'hologram_interact.name invalid' });
    expect(parseClientMessage({ type: 'hologram_update', name: 'spawn', lines: 3, font: 'ui', size: 1, style: 'bold' }))
      .toEqual({ error: 'hologram lines invalid' });
  });

  it('saves background, fixed yaw, and timer state and broadcasts once', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const observer = join(world, 'Ada');
    chat(world, op, '/holograms create spawn');
    op.player.controller.yaw = 1.25;
    observer.sink.payloads.length = 0;
    const before = Date.now();
    world.updateHologramAppearance(op.player, {
      type: 'hologram_update',
      name: 'spawn',
      lines: ['spawn'],
      font: 'sans',
      size: 1,
      style: 'bold',
      kind: 'timer',
      timerDuration: 60,
      backgroundEnabled: false,
      backgroundWidth: 4,
      backgroundHeight: 1.25,
      billboard: false,
    });
    const listed = world.holograms.list().find((entry) => entry.name === 'spawn');
    expect(listed).toMatchObject({
      kind: 'timer',
      timerDuration: 60,
      backgroundEnabled: false,
      backgroundWidth: 4,
      backgroundHeight: 1.25,
      billboard: false,
    });
    expect(listed?.yaw).toBeCloseTo(1.25, 5);
    expect(listed?.timerStartedAt).toBeGreaterThanOrEqual(before);
    const broadcasts = hologramPackets(observer.sink).filter((payload) => payload.type === 'holograms');
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.holograms?.[0]).toMatchObject({
      kind: 'timer',
      timerDuration: 60,
      billboard: false,
      backgroundEnabled: false,
    });
    observer.sink.payloads.length = 0;
    for (let tick = 0; tick < 40; tick += 1) world.tick();
    expect(hologramPackets(observer.sink)).toHaveLength(0);
  });

  it('resets a timer for every player and rejects reset on a normal hologram', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const observer = join(world, 'Ada');
    chat(world, op, '/holograms create eventtimer');
    world.updateHologramAppearance(op.player, {
      type: 'hologram_update',
      name: 'eventtimer',
      lines: ['eventtimer'],
      font: 'sans',
      size: 1,
      style: 'bold',
      kind: 'timer',
      timerDuration: 600,
    });
    const started = world.holograms.list().find((entry) => entry.name === 'eventtimer')?.timerStartedAt ?? 0;
    observer.sink.payloads.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const resetLines = chat(world, op, '/hologram reset eventtimer');
    expect(resetLines.some((line) => line.includes("Reset timer 'eventtimer'"))).toBe(true);
    const after = world.holograms.list().find((entry) => entry.name === 'eventtimer');
    expect(after?.timerStartedAt).toBeGreaterThan(started);
    expect(hologramPackets(observer.sink).some((payload) => (
      payload.type === 'holograms'
      && payload.holograms?.some((entry) => entry.name === 'eventtimer' && (entry as { timerStartedAt?: number }).timerStartedAt === after?.timerStartedAt)
    ))).toBe(true);
    chat(world, op, '/holograms create sign');
    expect(chat(world, op, '/hologram reset sign').some((line) => line.includes('Эта голограмма не является таймером.'))).toBe(true);
    expect(chat(world, op, '/hologram reset missing').some((line) => line.includes("Hologram 'missing' not found."))).toBe(true);
    expect(chat(world, observer, '/hologram reset eventtimer').some((line) => line.includes('You do not have permission.'))).toBe(true);
  });

  it('starts a fresh timer cycle when switching normal → timer → normal → timer', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    chat(world, op, '/holograms create spawn');
    world.updateHologramAppearance(op.player, {
      type: 'hologram_update',
      name: 'spawn',
      lines: ['Keep me'],
      font: 'ui',
      size: 1,
      style: 'bold',
      kind: 'timer',
      timerDuration: 10,
    });
    const first = world.holograms.list()[0]?.timerStartedAt ?? 0;
    world.updateHologramAppearance(op.player, {
      type: 'hologram_update',
      name: 'spawn',
      lines: ['Keep me'],
      font: 'ui',
      size: 1,
      style: 'bold',
      kind: 'normal',
      timerDuration: 10,
    });
    expect(world.holograms.list()[0]).toMatchObject({ kind: 'normal', lines: ['Keep me'] });
    world.updateHologramAppearance(op.player, {
      type: 'hologram_update',
      name: 'spawn',
      lines: ['Keep me'],
      font: 'ui',
      size: 1,
      style: 'bold',
      kind: 'timer',
      timerDuration: 10,
    });
    const second = world.holograms.list()[0]?.timerStartedAt ?? 0;
    expect(world.holograms.list()[0]?.kind).toBe('timer');
    expect(second).toBeGreaterThanOrEqual(first);
  });

  it('persists timer and fixed orientation across reconnect', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    chat(world, op, '/holograms create spawn');
    op.player.controller.yaw = 0.5;
    world.updateHologramAppearance(op.player, {
      type: 'hologram_update',
      name: 'spawn',
      lines: ['spawn'],
      font: 'sans',
      size: 1,
      style: 'bold',
      kind: 'timer',
      timerDuration: 120,
      backgroundEnabled: true,
      backgroundWidth: 3,
      backgroundHeight: 1,
      billboard: false,
    });
    const original = world.holograms.list()[0]!;
    const dir = world.config.dataDir;
    await world.save();
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const again = await boot(dir);
    const restored = again.holograms.list()[0];
    expect(restored).toMatchObject({
      kind: 'timer',
      timerDuration: 120,
      timerStartedAt: original.timerStartedAt,
      backgroundWidth: 3,
      backgroundHeight: 1,
      billboard: false,
    });
    expect(restored?.yaw).toBeCloseTo(0.5, 5);
    expect(again.holograms.list()[0]?.timerStartedAt).toBe(original.timerStartedAt);
  });
});
