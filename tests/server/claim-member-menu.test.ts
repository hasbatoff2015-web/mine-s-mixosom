import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { menuClaimsHtml } from '../../src/ui/gameMenuGui';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';
import { parseClientMessage, type ServerMenuMessage } from '../../shared/protocol';

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function testConfig(dataDir: string) {
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
    operators: [] as string[],
  };
}

function lines(sink: MemorySink): string[] {
  const out: string[] = [];
  for (const payload of sink.payloads) {
    const message = payload as { lines?: string[]; text?: string };
    if (message.lines) out.push(...message.lines);
    if (message.text) out.push(message.text);
  }
  return out;
}

describe('claim member menu identity', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function boot(): Promise<WorldInstance> {
    const dir = await mkdtemp(pathJoin(tmpdir(), 'fc-claim-menu-'));
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function enter(world: WorldInstance, name: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name });
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
    expect(chat(world, player, '/claim create den').join(' ')).toMatch(/created|Claim/i);
  }

  function claimOf(world: WorldInstance, ownerId: string) {
    return world.pluginStore.load<{ claims: Array<{ id: string; owner: string; name: string; members: string[] }> }>(
      'claims/claims',
      { claims: [] },
    ).claims.find((entry) => entry.owner === ownerId);
  }

  function saveClaim(world: WorldInstance, claim: { id: string; owner: string; members: string[] }): void {
    const store = world.pluginStore.load<{ claims: Array<{ id: string; owner: string; members: string[] }> }>(
      'claims/claims',
      { claims: [] },
    );
    const live = store.claims.find((entry) => entry.id === claim.id);
    if (!live) throw new Error('missing claim');
    live.owner = claim.owner;
    live.members = claim.members;
    world.pluginStore.save('claims/claims', store);
  }

  function openSettings(world: WorldInstance, owner: { player: ServerPlayer; sink: MemorySink }) {
    const claim = claimOf(world, owner.player.id);
    if (!claim) throw new Error('missing claim');
    owner.sink.payloads.length = 0;
    world.handleMenuAction(owner.player, { type: 'menu_action', action: 'open', screen: 'claims' });
    world.handleMenuAction(owner.player, { type: 'menu_action', action: 'claim_open', claimId: claim.id });
    return lastMenu(owner.sink);
  }

  function addMember(world: WorldInstance, owner: { player: ServerPlayer; sink: MemorySink }, name: string): void {
    openSettings(world, owner);
    world.handleMenuAction(owner.player, { type: 'menu_action', action: 'set_claim_member', name });
    world.handleMenuAction(owner.player, { type: 'menu_action', action: 'claim_add_member', name });
  }

  it('keeps a 36-character member id through the menu, the protocol, and removal', async () => {
    const world = await boot();
    const owner = enter(world, 'Owner');
    const steve = enter(world, 'Steve');
    createClaim(world, owner);
    addMember(world, owner, 'Steve');
    expect(claimOf(world, owner.player.id)?.members).toEqual([steve.player.id]);
    expect(steve.player.id).toHaveLength(36);

    const menu = openSettings(world, owner);
    const shown = menu.claimMembers ?? [];
    expect(shown).toEqual([{ playerId: steve.player.id, name: 'Steve' }]);
    const html = menuClaimsHtml(menu, (value) => value);
    expect(html).toContain('>Steve<');
    expect(html).not.toContain(`>${steve.player.id}<`);
    const kick = html.match(/data-menu-claim-kick="([^"]+)"/)?.[1];
    expect(kick).toBe(steve.player.id);

    const wire = { type: 'menu_action', action: 'claim_remove_member', playerId: kick };
    const parsed = parseClientMessage(wire);
    expect(parsed).toMatchObject({ type: 'menu_action', action: 'claim_remove_member', playerId: steve.player.id });
    expect(parsed).not.toHaveProperty('name');
    const truncated = parseClientMessage({
      type: 'menu_action',
      action: 'claim_remove_member',
      name: steve.player.id,
    });
    expect(truncated).toMatchObject({ name: steve.player.id.slice(0, 32) });
    expect(truncated).not.toHaveProperty('playerId');

    world.handleMenuAction(owner.player, {
      type: 'menu_action',
      action: 'claim_remove_member',
      name: steve.player.id.slice(0, 32),
    });
    expect(claimOf(world, owner.player.id)?.members).toEqual([steve.player.id]);

    if (!parsed || !('type' in parsed) || parsed.type !== 'menu_action') throw new Error('parse failed');
    world.handleMenuAction(owner.player, parsed);
    expect(claimOf(world, owner.player.id)?.members).toEqual([]);
  });

  it('removes an offline member and keeps the other player who shares a nickname', async () => {
    const world = await boot();
    const owner = enter(world, 'Owner');
    const bob = enter(world, 'Bob');
    const cara = enter(world, 'Cara');
    createClaim(world, owner);
    addMember(world, owner, 'Bob');
    addMember(world, owner, 'Cara');
    world.disconnect(bob.player.id);
    expect(bob.player.connected).toBe(false);
    bob.player.name = 'Steve';
    cara.player.name = 'Steve';

    const menu = openSettings(world, owner);
    expect(menu.claimMembers).toEqual([
      { playerId: bob.player.id, name: 'Steve' },
      { playerId: cara.player.id, name: 'Steve' },
    ]);
    world.handleMenuAction(owner.player, {
      type: 'menu_action',
      action: 'claim_remove_member',
      playerId: bob.player.id,
    });
    expect(claimOf(world, owner.player.id)?.members).toEqual([cara.player.id]);
  });

  it('shows a renamed nickname and still removes the original player id', async () => {
    const world = await boot();
    const owner = enter(world, 'Owner');
    const bob = enter(world, 'Bob');
    createClaim(world, owner);
    addMember(world, owner, 'Bob');
    bob.player.name = 'Alex';
    const menu = openSettings(world, owner);
    expect(menu.claimMembers).toEqual([{ playerId: bob.player.id, name: 'Alex' }]);
    world.handleMenuAction(owner.player, {
      type: 'menu_action',
      action: 'claim_remove_member',
      playerId: bob.player.id,
    });
    expect(claimOf(world, owner.player.id)?.members).toEqual([]);
  });

  it('shows a fallback for an unknown id and still removes that exact member', async () => {
    const world = await boot();
    const owner = enter(world, 'Owner');
    createClaim(world, owner);
    const claim = claimOf(world, owner.player.id);
    if (!claim) throw new Error('missing claim');
    const missing = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    saveClaim(world, { ...claim, members: [missing] });
    const menu = openSettings(world, owner);
    expect(menu.claimMembers).toEqual([{ playerId: missing, name: 'Игрок bbbbbbbb' }]);
    world.handleMenuAction(owner.player, {
      type: 'menu_action',
      action: 'claim_remove_member',
      playerId: missing,
    });
    expect(claimOf(world, owner.player.id)?.members).toEqual([]);
  });

  it('rejects a missing, malformed, truncated, or non-member id without changing the claim', async () => {
    const world = await boot();
    const owner = enter(world, 'Owner');
    const steve = enter(world, 'Steve');
    const other = enter(world, 'Other');
    createClaim(world, owner);
    addMember(world, owner, 'Steve');
    openSettings(world, owner);
    const before = claimOf(world, owner.player.id)?.members;
    for (const playerId of [undefined, 'not-a-uuid', steve.player.id.slice(0, 32), other.player.id]) {
      world.handleMenuAction(owner.player, {
        type: 'menu_action',
        action: 'claim_remove_member',
        ...(playerId ? { playerId } : {}),
      });
      expect(claimOf(world, owner.player.id)?.members).toEqual(before);
    }
  });

  it('rejects removal from another claim and from a claim the opener no longer owns', async () => {
    const world = await boot();
    const owner = enter(world, 'Owner');
    const steve = enter(world, 'Steve');
    const cara = enter(world, 'Cara');
    createClaim(world, owner);
    addMember(world, owner, 'Steve');
    const claim = claimOf(world, owner.player.id);
    if (!claim) throw new Error('missing claim');
    world.handleMenuAction(cara.player, { type: 'menu_action', action: 'open', screen: 'claims' });
    world.handleMenuAction(cara.player, {
      type: 'menu_action',
      action: 'claim_remove_member',
      playerId: steve.player.id,
      claimId: claim.id,
    });
    expect(claimOf(world, owner.player.id)?.members).toEqual([steve.player.id]);

    openSettings(world, owner);
    saveClaim(world, { ...claim, owner: cara.player.id, members: [steve.player.id] });
    world.handleMenuAction(owner.player, {
      type: 'menu_action',
      action: 'claim_remove_member',
      playerId: steve.player.id,
    });
    const stolen = world.pluginStore.load<{ claims: Array<{ id: string; members: string[] }> }>(
      'claims/claims',
      { claims: [] },
    ).claims.find((entry) => entry.id === claim.id);
    expect(stolen?.members).toEqual([steve.player.id]);
  });

  it('leaves a legacy nickname member unresolved and does not grant the matching player', async () => {
    const world = await boot();
    const owner = enter(world, 'Owner');
    createClaim(world, owner);
    const claim = claimOf(world, owner.player.id);
    if (!claim) throw new Error('missing claim');
    saveClaim(world, { ...claim, members: ['OldNick'] });
    const legacy = enter(world, 'OldNick');
    const menu = openSettings(world, owner);
    expect(menu.claimMembers).toEqual([{ name: 'oldnick' }]);
    const html = menuClaimsHtml(menu, (value) => value);
    expect(html).toContain('Старая запись, нужна миграция');
    expect(html).not.toContain('data-menu-claim-kick');
    world.handleMenuAction(owner.player, {
      type: 'menu_action',
      action: 'claim_remove_member',
      playerId: legacy.player.id,
    });
    expect(claimOf(world, owner.player.id)?.members).toEqual(['OldNick']);
  });
});

function lastMenu(sink: MemorySink): ServerMenuMessage {
  const menu = [...sink.payloads].reverse().find((payload) => (
    typeof payload === 'object' && payload !== null && (payload as { type?: string }).type === 'menu'
  ));
  if (!menu) throw new Error('menu was not sent');
  return menu as ServerMenuMessage;
}
