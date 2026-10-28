import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import type { Plugin, ServerAPI } from '../../server/PluginManager';
import { JsonFileStore } from '../../server/services/jsonStore';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';

class MemorySink implements ConnectedSink {
  readonly payloads: Array<{ type?: string; lines?: string[]; text?: string; ok?: boolean }> = [];
  send(payload: unknown): void {
    this.payloads.push(payload as { type?: string; lines?: string[]; text?: string; ok?: boolean });
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
      WORLD: 'priv',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8',
      CHUNK_VIEW_RADIUS: '1',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '60000',
      FC_NO_BUILTIN_PLUGINS: '1',
    }),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    loadBuiltinPlugins: true,
    pluginDir: join(dataDir, 'plugins'),
    operators,
  };
}

describe('nickname privilege escalation', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function boot(operators: string[] = [], dataDir?: string): Promise<WorldInstance> {
    const dir = dataDir ?? await mkdtemp(join(tmpdir(), 'fc-priv-'));
    if (!dataDir) dirs.push(dir);
    const world = new WorldInstance(testConfig(dir, operators));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function enter(world: WorldInstance, name: string, sessionToken?: string): { player: ServerPlayer; sink: MemorySink } {
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

  it('does not give OP, roles, or admin nodes to a matching nickname', async () => {
    const world = await boot(['AdminOwner']);
    const owner = enter(world, 'AdminOwner');
    const impostor = enter(world, 'AdminOwner');
    const cased = enter(world, 'adminowner');
    expect(owner.player.id).not.toBe(impostor.player.id);
    expect(world.permissions.isOperator(owner.player.id)).toBe(false);
    expect(world.permissions.isOperator(impostor.player.id)).toBe(false);
    expect(world.permissions.isOperator('AdminOwner')).toBe(false);
    expect(world.permissions.ignoredOperators()).toEqual(['AdminOwner']);

    world.permissions.op(owner.player.id);
    world.permissions.assignRole(owner.player.id, 'admin');
    world.permissions.grant(owner.player.id, 'plugins.manage');
    world.permissions.assignRole(owner.player.id, 'vip');
    expect(world.permissions.isOperator(owner.player.id)).toBe(true);
    expect(world.permissions.has(owner.player.id, 'economy.admin')).toBe(true);
    expect(world.permissions.has(owner.player.id, 'server.admin')).toBe(true);
    expect(world.permissions.has(owner.player.id, 'plugins.manage')).toBe(true);
    expect(world.permissions.has(owner.player.id, 'home.multiple')).toBe(true);
    for (const other of [impostor, cased]) {
      expect(world.permissions.isOperator(other.player.id)).toBe(false);
      expect(world.permissions.has(other.player.id, 'economy.admin')).toBe(false);
      expect(world.permissions.has(other.player.id, 'server.admin')).toBe(false);
      expect(world.permissions.has(other.player.id, 'plugins.manage')).toBe(false);
      expect(world.permissions.has(other.player.id, 'home.multiple')).toBe(false);
      expect(world.permissions.has(other.player.name, 'economy.admin')).toBe(false);
    }

    const before = world.economy.getBalance(impostor.player.id);
    for (const command of [
      '/op Someone',
      '/deop AdminOwner',
      '/plugins list',
      '/permissions grant AdminOwner economy.admin',
      '/permissions role assign AdminOwner admin',
      '/eco give AdminOwner 50',
    ]) {
      expect(chat(world, impostor, command).some((line) => line.includes('permission') || line.includes('прав'))).toBe(true);
    }
    expect(world.economy.getBalance(impostor.player.id)).toBe(before);
    expect(world.economy.getBalance(owner.player.id)).toBe(before);
    expect(world.permissions.snapshot().ops).toEqual([owner.player.id]);

    expect(chat(world, owner, `/op ${cased.player.id}`).some((line) => line.includes('operator'))).toBe(true);
    expect(world.permissions.isOperator(cased.player.id)).toBe(true);
    expect(world.permissions.isOperator(impostor.player.id)).toBe(false);
    expect(chat(world, owner, `/deop ${cased.player.id}`).some((line) => line.includes('Removed operator'))).toBe(true);

    const ambiguous = world.dispatchConsole('op AdminOwner');
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.lines.join(' ')).toMatch(/Ambiguous/);
    expect(world.permissions.isOperator(impostor.player.id)).toBe(false);

    const unknown = world.dispatchConsole('op Nobody');
    expect(unknown.ok).toBe(false);
    expect(world.permissions.snapshot().ops).not.toContain('nobody');
    expect(world.permissions.legacyInfo('Nobody')).toBeNull();

    const byId = world.dispatchConsole(`op ${impostor.player.id}`);
    expect(byId.ok).toBe(true);
    expect(world.permissions.isOperator(impostor.player.id)).toBe(true);
    expect(world.permissions.isOperator(owner.player.name)).toBe(false);
    world.permissions.deop(impostor.player.id);

    owner.player.name = 'Renamed';
    expect(world.permissions.isOperator(owner.player.id)).toBe(true);
    expect(world.permissions.has(owner.player.id, 'server.admin')).toBe(true);
    const reused = enter(world, 'AdminOwner');
    const taken = enter(world, 'Renamed');
    expect(world.permissions.isOperator(reused.player.id)).toBe(false);
    expect(world.permissions.isOperator(taken.player.id)).toBe(false);
    expect(world.permissions.has(reused.player.id, 'server.admin')).toBe(false);

    world.disconnect(owner.player.id);
    const whileAway = enter(world, 'Renamed');
    expect(world.permissions.isOperator(whileAway.player.id)).toBe(false);
    const back = enter(world, 'Renamed', owner.player.sessionToken);
    expect(back.player.id).toBe(owner.player.id);
    expect(world.permissions.isOperator(back.player.id)).toBe(true);

    expect(world.permissions.has(whileAway.player.id, 'spawn.use')).toBe(true);
    expect(world.permissions.has(whileAway.player.id, 'home.use')).toBe(true);
    expect(chat(world, whileAway, '/spawn').some((line) => line.toLowerCase().includes('spawn'))).toBe(true);

    let api: ServerAPI | undefined;
    const probe: Plugin = {
      name: 'priv-probe',
      version: '1.0.0',
      apiVersion: 1,
      onEnable(next) { api = next; },
    };
    world.plugins.register(probe);
    await world.plugins.enable('priv-probe');
    expect(api?.isOperator(impostor.player.name)).toBe(false);
    expect(api?.isOperator(owner.player.id)).toBe(true);
    expect(api?.hasPermission(impostor.player.name, 'economy.admin')).toBe(false);
    expect(api?.hasPermission(owner.player.id, 'plugins.manage')).toBe(true);
  });

  it('keeps an id grant across restart and leaves a legacy nickname inert', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-priv-legacy-'));
    dirs.push(dir);
    const store = new JsonFileStore(join(dir, 'priv', 'plugin-data'));
    store.save('permissions', {
      ops: ['LegacyOp'],
      roles: { helper: ['economy.balance'] },
      playerRoles: { LegacyOp: ['admin'] },
      playerPermissions: { LegacyOp: ['plugins.manage'] },
    });
    const world = await boot([], dir);
    const impostor = enter(world, 'LegacyOp');
    expect(world.permissions.isOperator(impostor.player.id)).toBe(false);
    expect(world.permissions.has(impostor.player.id, 'server.admin')).toBe(false);
    expect(world.permissions.has(impostor.player.id, 'plugins.manage')).toBe(false);
    expect(world.permissions.legacyInfo('LegacyOp')).toMatchObject({ operator: true, roles: ['admin'] });
    expect(world.permissions.listRoles()).toContain('helper');

    const migrated = world.dispatchConsole(`/permissions migrate LegacyOp ${impostor.player.name}`);
    expect(migrated.ok).toBe(false);
    const ambiguous = enter(world, 'LegacyOp');
    const byName = world.dispatchConsole('op LegacyOp');
    expect(byName.ok).toBe(false);
    expect(byName.lines.join(' ')).toMatch(/Ambiguous/);
    expect(world.permissions.isOperator(ambiguous.player.id)).toBe(false);

    const confirmed = world.dispatchConsole(`/permissions migrate LegacyOp ${impostor.player.id}`);
    expect(confirmed.ok).toBe(true);
    expect(world.permissions.isOperator(impostor.player.id)).toBe(true);
    expect(world.permissions.has(impostor.player.id, 'economy.admin')).toBe(true);
    expect(world.permissions.has(impostor.player.id, 'plugins.manage')).toBe(true);
    expect(world.permissions.isOperator(ambiguous.player.id)).toBe(false);
    expect(world.permissions.legacyInfo('LegacyOp')).toBeNull();

    const token = impostor.player.sessionToken;
    const id = impostor.player.id;
    await world.save();
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const again = await boot(['LegacyOp'], dir);
    const resumed = enter(again, 'SomeoneElse', token);
    expect(resumed.player.id).toBe(id);
    expect(again.permissions.isOperator(id)).toBe(true);
    expect(again.permissions.has(id, 'server.admin')).toBe(true);
    const fresh = enter(again, 'LegacyOp');
    expect(again.permissions.isOperator(fresh.player.id)).toBe(false);
    expect(again.permissions.has(fresh.player.id, 'plugins.manage')).toBe(false);
    expect(again.permissions.legacyInfo('LegacyOp')).toBeNull();
    expect(again.permissions.listRoles()).toContain('helper');
  });
});
