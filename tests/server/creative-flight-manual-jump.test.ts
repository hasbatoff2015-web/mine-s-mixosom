import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadServerConfig } from '../../server/config';
import { WorldInstance } from '../../server/WorldInstance';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import type { ClientInputMessage } from '../../shared/protocol';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-fly-manual-'));
}

function testConfig(dataDir: string) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1', PORT: '0', WORLD: 'anarchy', WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8', CHUNK_VIEW_RADIUS: '1', TICK_RATE: '20', PERSIST_INTERVAL_MS: '60000',
    }, process.cwd()),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    persistIntervalMs: 60_000,
  };
}

class MemorySink {
  send(): void { /* authority test does not read snapshots */ }
}

function input(seq: number, extra: Partial<ClientInputMessage> = {}): ClientInputMessage {
  return {
    type: 'input',
    seq,
    forward: 0,
    right: 0,
    jump: false,
    sneak: false,
    sprint: false,
    descend: false,
    flySprint: false,
    yaw: 0,
    pitch: 0,
    selectedSlot: 0,
    ...extra,
  };
}

describe('server creative flight uses the manual jump edge', { timeout: 20_000 }, () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(mode: 'survival' | 'creative') {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    const joined = world.join({ sink: new MemorySink(), name: 'Flyer' });
    if ('error' in joined) throw new Error(joined.error);
    world.setGameMode(joined.player, mode);
    joined.player.controller.isFlying = false;
    joined.player.controller.velocity.set(0, 0, 0);
    return { world, player: joined.player };
  }

  it('ignores an auto-jump bit and toggles only on two manual presses', async () => {
    const { world, player } = await boot('creative');
    expect(world.applyInput(player, input(1, { jump: true, manualJump: false }))).toBe(true);
    world.tick();
    expect(player.controller.isFlying).toBe(false);

    expect(world.applyInput(player, input(2, { jump: true, manualJump: true }))).toBe(true);
    world.tick();
    expect(player.controller.isFlying).toBe(false);

    expect(world.applyInput(player, input(3, { jump: false, manualJump: false }))).toBe(true);
    world.tick();
    expect(world.applyInput(player, input(4, { jump: true, manualJump: true }))).toBe(true);
    world.tick();
    expect(player.controller.isFlying).toBe(true);

    player.controller.position.y = 12;
    player.controller.velocity.set(0, 0, 0);
    expect(world.applyInput(player, input(5, { jump: false, manualJump: false }))).toBe(true);
    world.tick();
    expect(world.applyInput(player, input(6, { jump: true, manualJump: true }))).toBe(true);
    world.tick();
    expect(world.applyInput(player, input(7, { jump: false, manualJump: false }))).toBe(true);
    world.tick();
    expect(world.applyInput(player, input(8, { jump: true, manualJump: true }))).toBe(true);
    world.tick();
    expect(player.controller.isFlying).toBe(false);
  });

  it('does not turn a held manual jump into a second edge, and rejects a stale seq', async () => {
    const { world, player } = await boot('creative');
    expect(world.applyInput(player, input(1, { jump: true, manualJump: true }))).toBe(true);
    expect(world.applyInput(player, input(2, { jump: true, manualJump: true }))).toBe(true);
    expect(world.applyInput(player, input(3, { jump: true, manualJump: true }))).toBe(true);
    expect(world.applyInput(player, input(2, { jump: true, manualJump: true }))).toBe(false);
    world.tick();
    world.tick();
    world.tick();
    expect(player.controller.isFlying).toBe(false);
  });

  it('descends only while the descend command is held, then climbs back toward hover', async () => {
    const { world, player } = await boot('creative');
    player.controller.isFlying = true;
    player.controller.position.y = 200;
    player.controller.previousPosition.y = 200;
    player.controller.velocity.set(0, 0, 0);

    expect(world.applyInput(player, input(1, { descend: false }))).toBe(true);
    world.tick();
    const hover = player.controller.velocity.y;
    expect(player.controller.isFlying).toBe(true);

    expect(world.applyInput(player, input(2, { descend: true }))).toBe(true);
    world.tick();
    const falling = player.controller.velocity.y;
    expect(falling).toBeLessThan(0);
    expect(falling).toBeLessThan(hover);

    expect(world.applyInput(player, input(3, { descend: false }))).toBe(true);
    world.tick();
    const released = player.controller.velocity.y;
    expect(released).toBeGreaterThan(falling);
    expect(world.applyInput(player, input(3, { descend: true }))).toBe(false);
    world.tick();
    expect(player.controller.velocity.y).toBeGreaterThan(released);
    expect(player.controller.isFlying).toBe(true);
  });

  it('does not fly in survival when the same two manual presses arrive', async () => {
    const { world, player } = await boot('survival');
    for (let i = 0; i < 40; i += 1) world.tick();
    const grounded = player.controller.onGround;
    const before = player.controller.position.y;
    world.applyInput(player, input(1, { jump: true, manualJump: true }));
    world.tick();
    if (grounded) expect(player.controller.position.y).toBeGreaterThan(before);
    world.applyInput(player, input(2, { jump: false, manualJump: false }));
    world.tick();
    world.applyInput(player, input(3, { jump: true, manualJump: true }));
    world.tick();
    expect(player.controller.isFlying).toBe(false);
  });
});
