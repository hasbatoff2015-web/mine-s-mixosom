import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { createItemStack } from '../../src/inventory';
import type { ClientInputMessage } from '../../shared/protocol';
import { emoteDurationTicks } from '../../shared/emotes';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import { loadServerConfig } from '../../server/config';

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

describe('server emote presentation', () => {
  const worlds: WorldInstance[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function boot(): Promise<{ world: WorldInstance; player: ServerPlayer }> {
    const dir = await mkdtemp(join(tmpdir(), 'fc-emote-'));
    dirs.push(dir);
    const config = loadServerConfig({ HOST: '127.0.0.1', PORT: '0', CHUNK_VIEW_RADIUS: '1', MAX_PLAYERS: '4' }, process.cwd());
    const world = new WorldInstance({ ...config, dataDir: dir, port: 0, chunkViewRadius: 1 });
    worlds.push(world);
    await world.initialize();
    const joined = world.join({ name: 'Emoter', sink: { send: () => {} } });
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    world.setGameMode(player, 'survival');
    player.controller.teleport([8.5, 70, 8.5]);
    for (let x = 6; x <= 11; x += 1) {
      for (let z = 6; z <= 11; z += 1) {
        world.world.setBlock(x, 69, z, BlockId.Stone);
        for (let y = 70; y <= 74; y += 1) world.world.setBlock(x, y, z, BlockId.Air);
      }
    }
    world.applyInput(player, input(1));
    world.tick();
    return { world, player };
  }

  it('publishes a start, ignores look, and clears on movement, stop, death, and timeout', async () => {
    const { world, player } = await boot();
    const origin = player.controller.position.clone();
    player.inventory.setSlot(0, createItemStack('diamond_sword'));
    world.setPlayerEmote(player, { type: 'emote', action: 'start', id: 'wave' });
    const seq = player.presentation().emoteSeq;
    expect(player.presentation()).toMatchObject({ emote: 'wave', emoteSeq: seq });
    expect(player.presentation().heldItemId).toBe('diamond_sword');
    world.setPlayerEmote(player, { type: 'emote', action: 'start', id: 'bow' });
    expect(player.presentation().emote).toBe('wave');
    expect(player.presentation().emoteSeq).toBe(seq);

    world.applyInput(player, input(2, { yaw: 1.2, pitch: 0.2 }));
    world.tick();
    expect(player.presentation().emote).toBe('wave');
    expect(player.controller.position.x).toBeCloseTo(origin.x);
    expect(player.controller.position.y).toBeCloseTo(origin.y);
    expect(player.controller.position.z).toBeCloseTo(origin.z);

    world.applyInput(player, input(3, { forward: 1 }));
    world.tick();
    expect(player.presentation().emote).toBeNull();
    expect(player.inventory.getSlot(0)?.itemId).toBe('diamond_sword');

    world.setPlayerEmote(player, { type: 'emote', action: 'start', id: 'point' });
    world.setPlayerEmote(player, { type: 'emote', action: 'stop' });
    expect(player.presentation().emote).toBeNull();

    world.setPlayerEmote(player, { type: 'emote', action: 'start', id: 'celebrate' });
    player.survival.damage(1000, 'generic', { ignoreInvulnerability: true, bypassArmor: true });
    world.tick();
    expect(player.survival.dead).toBe(true);
    expect(player.presentation().emote).toBeNull();
  });

  it('clears a lost emote when its duration elapses without a stop', async () => {
    const { world, player } = await boot();
    world.setPlayerEmote(player, { type: 'emote', action: 'start', id: 'bow' });
    const ticks = emoteDurationTicks('bow');
    for (let i = 0; i < ticks; i += 1) world.tick();
    expect(player.presentation().emote).toBeNull();
    expect(player.controller.position.x).toBeCloseTo(8.5);
  });
});
