import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { CLAIM_ANCHOR_RADIUS, claimAnchorVolume } from '../../server/services/claimAnchors';
import { migrateClaimStore } from '../../server/services/claims';
import { resolveClanBaseAnchor } from '../../server/services/clanBase';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import {
  CLAN_BASE_CHANGE_LABEL,
  CLAN_BASE_COOLDOWN_MS,
  CLAN_BASE_OVERLAP_ERROR,
  CLAN_BASE_SET_LABEL,
} from '../../shared/clans';
import { CLAN_ACTIONS, parseClientMessage, type ServerClanMessage } from '../../shared/protocol';
import { CLAN_OWNER_ONLY_ERROR } from '../../server/services/clan';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-clan-base-'));
}

function testConfig(dataDir: string) {
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
    pluginDir: join(dataDir, 'no-plugins'),
    loadExamplePlugin: false,
    loadBuiltinPlugins: true,
    operators: ['Op'],
  };
}

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function lastClan(sink: MemorySink): ServerClanMessage | undefined {
  for (let index = sink.payloads.length - 1; index >= 0; index -= 1) {
    const payload = sink.payloads[index] as { type?: string };
    if (payload.type === 'clan') return payload as ServerClanMessage;
  }
  return undefined;
}

describe('clan base anchor helper', () => {
  it('uses the standing block and never replaces bedrock', () => {
    const blocks = new Map<string, number>([
      ['8,64,8', BlockId.Stone],
      ['4,10,4', BlockId.Bedrock],
      ['4,11,4', BlockId.Air],
    ]);
    const get = (x: number, y: number, z: number) => blocks.get(`${x},${y},${z}`) ?? BlockId.Air;
    expect(resolveClanBaseAnchor({ x: 8.5, y: 65, z: 8.5 }, get)).toEqual({
      ok: true,
      anchor: { x: 8, y: 64, z: 8 },
    });
    expect(resolveClanBaseAnchor({ x: 4.2, y: 11, z: 4.8 }, get)).toEqual({
      ok: true,
      anchor: { x: 4, y: 11, z: 4 },
    });
    expect(resolveClanBaseAnchor({ x: 0.5, y: 80, z: 0.5 }, get).ok).toBe(false);
  });
});

describe('Clan base point', () => {
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

  function join(world: WorldInstance, name: string, sessionToken?: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name, sessionToken });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  function createClan(world: WorldInstance, player: ReturnType<typeof join>, name: string): void {
    world.economy.deposit(player.player.id, 20_000, 'ADMIN_GIVE');
    world.handleClanAction(player.player, { type: 'clan_action', action: 'set_name', name });
    world.handleClanAction(player.player, { type: 'clan_action', action: 'select_icon', icon: 'swords' });
    world.handleClanAction(player.player, { type: 'clan_action', action: 'confirm_create' });
    expect(world.clan.playerClan(player.player.id)?.name).toBe(name);
  }

  function standOn(world: WorldInstance, player: ReturnType<typeof join>, x: number, y: number, z: number, block = BlockId.Dirt): void {
    world.world.setBlock(x, y, z, block);
    player.player.controller.teleport([x + 0.5, y + 1, z + 0.5]);
  }

  function loadClaims(world: WorldInstance) {
    return migrateClaimStore(world.pluginStore.load('claims/claims', { claims: [] }));
  }

  it('lets a leader set a diamond clan base and blocks members', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    createClan(world, ada, 'Foxes');
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'select_player', playerId: bob.player.id });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'confirm_invite' });
    const invite = world.clan.invitationsFor(bob.player.id)[0];
    expect(invite).toBeDefined();
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'confirm_accept', invitationId: invite!.invitationId });

    standOn(world, ada, 8, 64, 8);
    ada.sink.payloads.length = 0;
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'set_base' });
    const card = lastClan(ada.sink);
    expect(card?.card?.hasBase).toBe(true);
    expect(card?.card?.canSetBase).toBe(true);
    expect(card?.card?.setBaseLabel).toBe(CLAN_BASE_CHANGE_LABEL);
    expect(card?.card?.setBaseDisabled).toBe(true);
    expect(card?.card?.canTeleportToBase).toBe(true);
    expect(card?.message).toContain('установлена');
    expect(world.world.getBlock(8, 64, 8)).toBe(BlockId.DiamondBlock);
    const claims = loadClaims(world).claims.filter((claim) => claim.clanId);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.anchor).toEqual({ x: 8, y: 64, z: 8, block: 'diamond_block' });
    expect(claims[0]!.volume).toEqual(claimAnchorVolume(8, 64, 8, 'diamond_block'));
    expect(CLAIM_ANCHOR_RADIUS.diamond_block).toBe(30);

    standOn(world, bob, 40, 64, 40);
    bob.sink.payloads.length = 0;
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'set_base' });
    expect(lastClan(bob.sink)?.message).toBe(CLAN_OWNER_ONLY_ERROR);
    expect(world.world.getBlock(40, 64, 40)).toBe(BlockId.Dirt);
    expect(world.clan.playerClan(ada.player.id)?.base?.x).toBe(8);
  });

  it('refuses overlap with any existing claim and does not start cooldown', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    createClan(world, ada, 'Owls');
    const store = loadClaims(world);
    store.claims.push({
      id: 'ada:plot',
      name: 'plot',
      owner: 'ada',
      worldId: world.worldId,
      volume: { minX: 0, minY: 50, minZ: 0, maxX: 20, maxY: 80, maxZ: 20 },
      members: [],
      priority: 0,
      flags: {},
    });
    world.pluginStore.save('claims/claims', store);
    standOn(world, ada, 8, 64, 8);
    ada.sink.payloads.length = 0;
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'set_base' });
    expect(lastClan(ada.sink)?.message).toBe(CLAN_BASE_OVERLAP_ERROR);
    expect(world.world.getBlock(8, 64, 8)).toBe(BlockId.Dirt);
    expect(world.clan.playerClan(ada.player.id)?.base).toBeUndefined();
    expect(world.clan.playerClan(ada.player.id)?.baseCooldownUntil).toBeUndefined();
  });

  it('places the diamond one block above bedrock instead of replacing it', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    createClan(world, ada, 'Bears');
    standOn(world, ada, 12, 64, 12, BlockId.Bedrock);
    world.world.setBlock(12, 65, 12, BlockId.Air);
    ada.sink.payloads.length = 0;
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'set_base' });
    expect(lastClan(ada.sink)?.card?.hasBase).toBe(true);
    expect(world.world.getBlock(12, 64, 12)).toBe(BlockId.Bedrock);
    expect(world.world.getBlock(12, 65, 12)).toBe(BlockId.DiamondBlock);
    expect(world.clan.playerClan(ada.player.id)?.base).toMatchObject({ x: 12, y: 65, z: 12 });
  });

  it('teleports members onto the diamond and persists the 24h cooldown', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const world = await boot(dir);
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    createClan(world, ada, 'Wolves');
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'select_player', playerId: bob.player.id });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'confirm_invite' });
    world.handleClanAction(bob.player, {
      type: 'clan_action',
      action: 'confirm_accept',
      invitationId: world.clan.invitationsFor(bob.player.id)[0]!.invitationId,
    });
    standOn(world, ada, 16, 64, 16);
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'set_base' });
    const until = world.clan.playerClan(ada.player.id)?.baseCooldownUntil ?? 0;
    expect(until).toBeGreaterThan(Date.now());
    expect(until).toBeLessThanOrEqual(Date.now() + CLAN_BASE_COOLDOWN_MS);

    bob.sink.payloads.length = 0;
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'teleport_to_base' });
    expect(lastClan(bob.sink)?.message).toMatch(/Телепорт/);
    expect(bob.player.controller.position.x).toBeCloseTo(16.5, 5);
    expect(bob.player.controller.position.y).toBeCloseTo(65, 5);
    expect(bob.player.controller.position.z).toBeCloseTo(16.5, 5);

    ada.sink.payloads.length = 0;
    standOn(world, ada, 48, 64, 48);
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'set_base' });
    expect(lastClan(ada.sink)?.message).toMatch(/Изменение доступно через/);
    expect(world.world.getBlock(16, 64, 16)).toBe(BlockId.DiamondBlock);
    expect(world.world.getBlock(48, 64, 48)).toBe(BlockId.Dirt);

    world.clan.load();
    expect(world.clan.playerClan(ada.player.id)?.baseCooldownUntil).toBe(until);
    expect(world.clan.playerClan(ada.player.id)?.base).toMatchObject({ x: 16, y: 64, z: 16 });
  });

  it('registers protocol actions and shows the set button only for leaders', async () => {
    expect(CLAN_ACTIONS).toContain('set_base');
    expect(CLAN_ACTIONS).toContain('teleport_to_base');
    expect(parseClientMessage({ type: 'clan_action', action: 'set_base' })).toMatchObject({ action: 'set_base' });
    expect(parseClientMessage({ type: 'clan_action', action: 'teleport_to_base' })).toMatchObject({
      action: 'teleport_to_base',
    });
    const world = await boot();
    const ada = join(world, 'Ada');
    createClan(world, ada, 'Lynx');
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'refresh' });
    const card = lastClan(ada.sink)?.card;
    expect(card?.canSetBase).toBe(true);
    expect(card?.setBaseLabel).toBe(CLAN_BASE_SET_LABEL);
    expect(card?.hasBase).toBe(false);
    expect(card?.canTeleportToBase).toBe(false);
    expect(card?.baseLabel).toContain('не установлена');
  });
});
