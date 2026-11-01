import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { JsonFileStore } from '../../server/services/jsonStore';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';

class MemorySink implements ConnectedSink {
  readonly payloads: Array<{ type?: string; lines?: string[]; text?: string; screen?: string; homes?: Array<{ name: string }> }> = [];
  send(payload: unknown): void {
    this.payloads.push(payload as { type?: string; lines?: string[]; text?: string; screen?: string; homes?: Array<{ name: string }> });
  }
}

function lines(sink: MemorySink): string[] {
  const out: string[] = [];
  for (const payload of sink.payloads) {
    if (payload.lines) out.push(...payload.lines);
    if (payload.text) out.push(payload.text);
  }
  return out;
}

function testConfig(dataDir: string, operators: string[] = []) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'own',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8',
      CHUNK_VIEW_RADIUS: '1',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '60000',
    }),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    loadBuiltinPlugins: true,
    pluginDir: pathJoin(dataDir, 'plugins'),
    operators,
  };
}

describe('claim and home identity', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function boot(dataDir?: string, operators: string[] = []): Promise<WorldInstance> {
    const dir = dataDir ?? await mkdtemp(pathJoin(tmpdir(), 'fc-own-'));
    if (!dataDir) dirs.push(dir);
    const world = new WorldInstance(testConfig(dir, operators));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function enter(world: WorldInstance, name: string, sessionToken?: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name, sessionToken });
    if ('error' in result) throw new Error(result.error);
    return { player: result.player, sink };
  }

  function chat(world: WorldInstance, player: { player: ServerPlayer; sink: MemorySink }, text: string): string[] {
    player.sink.payloads.length = 0;
    world.handleChat(player.player, text);
    return lines(player.sink);
  }

  function createClaim(world: WorldInstance, player: { player: ServerPlayer; sink: MemorySink }) {
    const position = player.player.controller.position;
    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    const z = Math.floor(position.z);
    player.player.controller.teleport([x + 0.5, y, z + 0.5]);
    chat(world, player, '/claim pos1');
    player.player.controller.teleport([x + 2.5, y, z + 2.5]);
    chat(world, player, '/claim pos2');
    return chat(world, player, '/claim create den');
  }

  it('keeps claims and homes on the player id', async () => {
    const envOp = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4';
    const world = await boot(undefined, [envOp]);
    const owner = enter(world, 'AdminOwner');
    const impostor = enter(world, 'AdminOwner');
    const cased = enter(world, 'adminowner');
    expect(createClaim(world, owner).some((line) => line.includes('created') || line.includes('Claim'))).toBe(true);
    const claim = world.pluginStore.load<{ claims: Array<{ id: string; owner: string; members: string[] }> }>('claims/claims', { claims: [] }).claims
      .find((entry) => entry.owner === owner.player.id);
    expect(claim).toBeTruthy();
    expect(chat(world, impostor, '/claim delete den').join(' ')).toMatch(/permission|not found|owner/i);
    expect(chat(world, cased, '/claim rename den stolen').join(' ')).toMatch(/permission|not found|owner/i);
    expect(world.pluginStore.load<{ claims: Array<{ owner: string; name: string }> }>('claims/claims', { claims: [] }).claims
      .some((entry) => entry.owner === owner.player.id && entry.name === 'den')).toBe(true);

    const member = enter(world, 'Member');
    expect(chat(world, owner, '/claim addmember den Member').join(' ')).toMatch(/Added/);
    expect(chat(world, owner, '/claim addmember den AdminOwner').join(' ')).toMatch(/Ambiguous/);
    const stored = world.pluginStore.load<{ claims: Array<{ owner: string; members: string[] }> }>('claims/claims', { claims: [] }).claims
      .find((entry) => entry.owner === owner.player.id);
    expect(stored?.members).toEqual([member.player.id]);
    member.player.name = 'RenamedMember';
    expect(stored?.members).toEqual([member.player.id]);
    const tookMemberName = enter(world, 'Member');
    expect(stored?.members.includes(tookMemberName.player.id)).toBe(false);

    owner.player.name = 'Renamed';
    expect(world.pluginStore.load<{ claims: Array<{ owner: string }> }>('claims/claims', { claims: [] }).claims
      .some((entry) => entry.owner === owner.player.id)).toBe(true);
    expect(chat(world, owner, '/sethome base').some((line) => line.toLowerCase().includes('home'))).toBe(true);
    const away = enter(world, 'Renamed');
    expect(chat(world, away, '/homes').join(' ')).not.toMatch(/base/);
    expect(chat(world, away, '/home base').join(' ')).toMatch(/not found/i);
    expect(chat(world, away, '/delhome base').join(' ')).toMatch(/not found/i);
    const back = enter(world, 'Later', owner.player.sessionToken);
    expect(back.player.id).toBe(owner.player.id);
    expect(chat(world, back, '/homes').join(' ')).toMatch(/base/);

    world.openGameMenu(back.player.id, 'homes');
    world.handleMenuAction(back.player, { type: 'menu_action', action: 'home_create', name: 'cave' });
    world.openGameMenu(away.player.id, 'homes');
    const awayMenu = away.sink.payloads.filter((payload) => payload.type === 'menu').at(-1);
    expect(awayMenu?.homes?.some((home) => home.name === 'cave' || home.name === 'base')).toBeFalsy();
    world.handleMenuAction(away.player, { type: 'menu_action', action: 'home_teleport', name: 'base' });
    expect(lines(away.sink).join(' ')).toMatch(/не найден|not found/i);
    world.handleMenuAction(away.player, { type: 'menu_action', action: 'home_delete', name: 'base' });
    world.handleMenuAction(away.player, { type: 'menu_action', action: 'home_confirm_delete' });
    expect(world.homes.get(owner.player.id, 'base')).toBeTruthy();

    world.openGameMenu(back.player.id, 'claims');
    world.handleMenuAction(back.player, { type: 'menu_action', action: 'claim_open', claimId: claim!.id });
    world.handleMenuAction(back.player, { type: 'menu_action', action: 'claim_delete' });
    const stolen = world.pluginStore.load<{ claims: Array<{ id: string; owner: string }> }>('claims/claims', { claims: [] });
    const live = stolen.claims.find((entry) => entry.id === claim!.id)!;
    live.owner = member.player.id;
    world.pluginStore.save('claims/claims', stolen);
    world.handleMenuAction(back.player, { type: 'menu_action', action: 'claim_confirm_delete' });
    expect(world.pluginStore.load<{ claims: Array<{ id: string }> }>('claims/claims', { claims: [] }).claims
      .some((entry) => entry.id === claim!.id)).toBe(true);

    expect(world.permissions.isOperator(envOp)).toBe(true);
    expect(world.permissions.snapshot().ops).not.toContain(envOp);
  });

  it('keeps legacy claims and homes inert until the console migrates them', async () => {
    const dir = await mkdtemp(pathJoin(tmpdir(), 'fc-own-legacy-'));
    dirs.push(dir);
    const claims = new JsonFileStore(pathJoin(dir, 'own', 'plugin-data'));
    claims.save('claims/claims', {
      claims: [{
        id: 'old-den',
        name: 'den',
        owner: 'LegacyNick',
        worldId: 'own',
        volume: { minX: 0, minY: 60, minZ: 0, maxX: 4, maxY: 70, maxZ: 4 },
        members: ['OldFriend'],
        priority: 0,
        flags: { 'block-break': false, 'block-place': false },
      }, {
        id: 'clan:clan-1:base',
        name: 'base',
        owner: 'clan:clan-1',
        worldId: 'own',
        clanId: 'clan-1',
        volume: { minX: 20, minY: 60, minZ: 20, maxX: 24, maxY: 70, maxZ: 24 },
        members: [],
        priority: 0,
        flags: { 'block-break': false },
      }, {
        id: 'world-event:evt',
        name: 'Event location',
        owner: '__world_events__',
        worldId: 'own',
        volume: { minX: 40, minY: 0, minZ: 40, maxX: 44, maxY: 80, maxZ: 44 },
        members: [],
        priority: 1_000_000,
        flags: { 'block-break': false, 'block-place': false },
      }],
    });
    claims.save('home/homes', {
      players: {
        LegacyNick: [{ name: 'base', worldId: 'own', x: 3, y: 64, z: 3 }],
      },
    });
    const world = await boot(dir);
    const impostor = enter(world, 'LegacyNick');
    expect(chat(world, impostor, '/claim delete den').join(' ')).toMatch(/permission|not found|owner/i);
    expect(chat(world, impostor, '/homes').join(' ')).not.toMatch(/\bbase\b/);
    expect(world.homes.legacyList('LegacyNick').map((home) => home.name)).toEqual(['base']);
    const loaded = world.pluginStore.load<{ claims: Array<{ id: string; owner: string; members: string[] }> }>('claims/claims', { claims: [] });
    expect(loaded.claims.find((entry) => entry.id === 'old-den')?.owner.toLowerCase()).toBe('legacynick');
    expect(loaded.claims.find((entry) => entry.id === 'clan:clan-1:base')?.owner).toBe('clan:clan-1');
    expect(loaded.claims.find((entry) => entry.id === 'world-event:evt')?.owner).toBe('__world_events__');

    impostor.player.controller.teleport([1.5, 64, 1.5]);
    world.setGameMode(impostor.player, 'creative');
    world.world.setBlock(1, 64, 1, BlockId.Stone);
    expect(world.tryBreak(impostor.player, 1, 64, 1)).toEqual({ ok: false, reason: 'cancelled' });
    world.world.setBlock(2, 64, 2, BlockId.Air);
    expect(world.tryPlace(impostor.player, 2, 64, 2, BlockId.Dirt)).toEqual({ ok: false, reason: 'cancelled' });

    const byName = world.dispatchConsole(`claim migrate-owner old-den ${impostor.player.name}`);
    expect(byName.ok).toBe(false);
    const migrated = world.dispatchConsole(`claim migrate-owner old-den ${impostor.player.id}`);
    expect(migrated.ok).toBe(true);
    const again = world.dispatchConsole(`claim migrate-owner old-den ${impostor.player.id}`);
    expect(again.ok).toBe(true);
    const memberMove = world.dispatchConsole(`claim migrate-member old-den OldFriend ${impostor.player.id}`);
    expect(memberMove.ok).toBe(true);
    const memberAgain = world.dispatchConsole(`claim migrate-member old-den OldFriend ${impostor.player.id}`);
    expect(memberAgain.ok).toBe(true);
    const after = world.pluginStore.load<{ claims: Array<{ id: string; owner: string; members: string[]; flags: { pvp?: boolean } }> }>('claims/claims', { claims: [] });
    const den = after.claims.find((entry) => entry.id === 'old-den');
    expect(den?.owner).toBe(impostor.player.id);
    expect(den?.members).toEqual([impostor.player.id]);
    expect(den?.flags.pvp).toBeUndefined();

    expect(world.dispatchConsole(`home migrate LegacyNick ${impostor.player.name}`).ok).toBe(false);
    expect(world.dispatchConsole(`home migrate LegacyNick ${impostor.player.id}`).ok).toBe(true);
    expect(world.homes.get(impostor.player.id, 'base')?.x).toBe(3);
    expect(world.homes.legacyList('LegacyNick')).toEqual([]);
    expect(world.dispatchConsole(`home migrate LegacyNick ${impostor.player.id}`).ok).toBe(false);
    expect(world.homes.list(impostor.player.id)).toHaveLength(1);

    const playerCommand = chat(world, impostor, `/claim migrate-owner old-den ${impostor.player.id}`);
    expect(playerCommand.join(' ')).toMatch(/console/i);
  });
});
