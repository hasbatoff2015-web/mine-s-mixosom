import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { GAMEPLAY_KERNEL_STEPS } from '../src/gameplay';
import { FarmingSystem } from '../src/farming';
import { shouldRunClientWorldSimulation } from '../src/core/onlineSimulation';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';
import { PROTOCOL_VERSION } from '../shared/config';
import { parseClientMessage, parseNetworkBlockState } from '../shared/protocol';
import { PlayerCommandQueue } from '../server/playerCommandQueue';
import type { PlayerCommand } from '../shared/playerCommand';
import { REMOTE_BUFFER_MAX_SAMPLES, RemoteInterpolationBuffer, remoteSampleFromSnapshot } from '../src/net/remotePlayerInterpolation';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function command(seq: number, extra: Partial<PlayerCommand> = {}): PlayerCommand {
  return {
    commandSeq: seq,
    clientTick: seq,
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

describe('Farming V1 + Networking V2 union', () => {
  it('speaks protocol 3 and rejects protocol 1 joins', () => {
    expect(PROTOCOL_VERSION).toBe(3);
    const rejected = parseClientMessage({ type: 'join', protocol: 1, name: 'old' });
    expect(rejected).toMatchObject({ error: expect.stringMatching(/protocol/i) });
    const ok = parseClientMessage({ type: 'join', protocol: 3, name: 'ok' });
    expect(ok).toMatchObject({ type: 'join', protocol: 3 });
  });

  it('keeps Networking V2 modules on disk', () => {
    for (const relative of [
      'src/net/localPlayerPrediction.ts',
      'src/net/remotePlayerInterpolation.ts',
      'shared/playerCommand.ts',
      'server/playerCommandQueue.ts',
      'server/tickScheduler.ts',
      'src/player/localAim.ts',
    ]) {
      expect(existsSync(join(root, relative)), relative).toBe(true);
    }
  });

  it('keeps Farming block IDs 150–157', () => {
    expect(BlockId.Farmland).toBe(150);
    expect(BlockId.WheatCrop).toBe(151);
    expect(BlockId.CarrotCrop).toBe(152);
    expect(BlockId.PotatoCrop).toBe(153);
    expect(BlockId.MelonStem).toBe(154);
    expect(BlockId.PumpkinStem).toBe(155);
    expect(BlockId.Melon).toBe(156);
    expect(BlockId.Pumpkin).toBe(157);
  });

  it('round-trips farming block state on the live protocol', () => {
    expect(parseNetworkBlockState({ hydrated: true, age: 7 })).toEqual({ hydrated: true, age: 7 });
    expect(parseNetworkBlockState({ age: 8 })?.age).toBe(7);
  });

  it('runs farming in the kernel before players', () => {
    expect(GAMEPLAY_KERNEL_STEPS).toEqual([
      'world',
      'farming',
      'falling',
      'players',
      'playerActions',
      'projectiles',
      'vehicles',
      'mobs',
      'mobEvents',
      'preDropSupport',
      'drops',
      'redstone',
      'explosions',
    ]);
  });

  it('does not tick farming on the online client', () => {
    expect(shouldRunClientWorldSimulation(true)).toBe(false);
    expect(shouldRunClientWorldSimulation(false)).toBe(true);
  });

  it('applies two queued commands on two physics ticks, not latest-input', () => {
    const queue = new PlayerCommandQueue();
    queue.enqueue(command(1, { forward: 1 }));
    queue.enqueue(command(2, { forward: -1 }));
    expect(queue.takeForTick()?.forward).toBe(1);
    expect(queue.takeForTick()?.forward).toBe(-1);
  });

  it('keys remote interpolation by serverTick, not packet arrival', () => {
    expect(REMOTE_BUFFER_MAX_SAMPLES).toBe(12);
    const buffer = new RemoteInterpolationBuffer();
    const snapshot = {
      id: 'p',
      name: 'p',
      x: 1,
      y: 2,
      z: 3,
      yaw: 0,
      pitch: 0,
    };
    expect(buffer.push(remoteSampleFromSnapshot(snapshot, 10, 1_000))).toBe('accepted');
    expect(buffer.push(remoteSampleFromSnapshot({ ...snapshot, x: 2 }, 11, 1_050))).toBe('accepted');
    const samples = buffer.snapshots();
    expect(samples.map((sample) => sample.serverTick)).toEqual([10, 11]);
    expect(samples[0]?.receivedAt).toBe(1_000);
    expect(samples[1]?.receivedAt).toBe(1_050);
  });

  it('still hydrates farmland on the shared 20 TPS pulse', () => {
    const world = new VoxelWorld('union-farm');
    world.chunks.set('0,0', new Chunk(0, 0));
    world.setViewCenter(0, 0, 40);
    world.applyBlockBatch([
      { x: 4, y: 40, z: 4, block: BlockId.Farmland },
      { x: 8, y: 41, z: 8, block: BlockId.Water },
    ], { updateLighting: false, scheduleNeighbors: false });
    const farming = new FarmingSystem(world, { random: () => 0 });
    world.tickNumber = 100;
    expect(farming.tick([{ x: 4, z: 4 }]).stateWrites).toBe(1);
    expect(world.getBlockState(4, 40, 4)?.hydrated).toBe(true);
    farming.dispose();
  });

  it('does not chase the local online player with stepTowardTarget', () => {
    const game = readFileSync(join(root, 'src/core/Game.ts'), 'utf8');
    expect(game).toMatch(/predictLocalMove\(/);
    expect(game).not.toMatch(/stepTowardTarget\(session\.player\.position/);
    expect(game).toMatch(/tickFarming: \(\) => \{/);
    const world = readFileSync(join(root, 'server/WorldInstance.ts'), 'utf8');
    expect(world).toMatch(/commandQueue\.takeForTick\(\)/);
    expect(world).toMatch(/tickCatchUp/);
    expect(world).not.toMatch(/setInterval\(\(\) => this\.tick\(\), tickMs\)/);
  });
});
