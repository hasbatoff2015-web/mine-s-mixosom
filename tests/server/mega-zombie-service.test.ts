import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMegaZombiePlugin } from '../../server/builtin-plugins/megaZombie';
import {
  MegaZombieService,
  sanitizeMegaZombiePersisted,
  type MegaZombieBossView,
  type MegaZombieHost,
  type MegaZombiePersisted,
} from '../../server/services/megaZombie';
import {
  MEGA_ZOMBIE_CYCLE_SECONDS,
  MEGA_ZOMBIE_SPAWN_TEXT,
  MEGA_ZOMBIE_TIMEOUT_TEXT,
  MEGA_ZOMBIE_WARNING_TEXT,
} from '../../src/entities/megaZombie';
import type { BuiltinPluginContext } from '../../server/builtin-plugins/context';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function harness(initial?: Partial<MegaZombiePersisted>) {
  const saved: MegaZombiePersisted[] = [];
  const broadcasts: string[] = [];
  const loot: Array<{ x: number; y: number; z: number }> = [];
  const fireworks: Array<{ x: number; y: number; z: number }> = [];
  let boss: MegaZombieBossView | undefined;
  let spawns = 0;
  const host: MegaZombieHost = {
    broadcast: (text) => { broadcasts.push(text); },
    log: () => {},
    load: () => sanitizeMegaZombiePersisted({
      spawn: { x: 4, y: 72, z: 4 },
      pos1: { x: 0, y: 70, z: 0 },
      pos2: { x: 12, y: 80, z: 12 },
      cycleSeconds: 0,
      warned: false,
      ...initial,
    }),
    save: (state) => { saved.push(state); },
    findBoss: () => boss,
    spawnBoss: () => {
      if (boss) return { ok: false, message: 'exists' };
      spawns += 1;
      boss = {
        id: `mega-${spawns}`,
        alive: true,
        dying: false,
        ageSeconds: 0,
        health: 1500,
        maxHealth: 1500,
        x: 4,
        y: 72,
        z: 4,
        lastAttackerName: null,
      };
      return { ok: true };
    },
    killBoss: (attacker) => {
      if (!boss || !boss.alive || boss.dying) return false;
      boss = {
        ...boss,
        alive: false,
        dying: true,
        health: 0,
        lastAttackerName: attacker?.name ?? null,
      };
      return true;
    },
    despawnBoss: () => { boss = undefined; },
    dropLoot: (x, y, z) => { loot.push({ x, y, z }); },
    launchFireworks: (x, y, z) => { fireworks.push({ x, y, z }); },
    random: () => 0,
  };
  const service = new MegaZombieService(host);
  return {
    service,
    broadcasts,
    saved,
    loot,
    fireworks,
    spawns: () => spawns,
    boss: () => boss,
    setBoss: (next: MegaZombieBossView | undefined) => { boss = next; },
    age: (seconds: number) => { if (boss) boss = { ...boss, ageSeconds: seconds }; },
  };
}

describe('mega zombie service', () => {
  it('persists spawn and both arena corners and reports the normalized box', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-boss-'));
    dirs.push(dir);
    const file = join(dir, 'config.json');
    let disk: MegaZombiePersisted = sanitizeMegaZombiePersisted({});
    const host: MegaZombieHost = {
      broadcast: () => {},
      log: () => {},
      load: () => disk,
      save: (state) => {
        disk = state;
        return undefined;
      },
      findBoss: () => undefined,
      spawnBoss: () => ({ ok: false }),
      killBoss: () => false,
      despawnBoss: () => {},
      dropLoot: () => {},
      launchFireworks: () => {},
      random: () => 0,
    };
    void file;
    const service = new MegaZombieService(host);
    expect(service.setSpawn({ x: 3, y: 70, z: 5 }).ok).toBe(true);
    expect(service.setPos('pos1', { x: 9, y: 80, z: 1 }).ok).toBe(true);
    expect(service.setPos('pos2', { x: 1, y: 64, z: 8 }).ok).toBe(true);
    const reloaded = new MegaZombieService({ ...host, load: () => disk });
    expect(reloaded.persisted.spawn).toEqual({ x: 3, y: 70, z: 5 });
    expect(reloaded.arena()).toEqual({
      minX: 1, maxX: 9, minY: 64, maxY: 80, minZ: 1, maxZ: 8,
    });
    expect(reloaded.infoLines().some((line) => line.startsWith('AABB:'))).toBe(true);
  });

  it('warns five minutes before the only scheduled spawn and does not stack bosses', () => {
    const world = harness();
    world.service.enable();
    world.service.enable();
    world.service.tick(MEGA_ZOMBIE_CYCLE_SECONDS - 5 * 60);
    expect(world.broadcasts).toEqual([MEGA_ZOMBIE_WARNING_TEXT]);
    expect(world.spawns()).toBe(0);
    world.service.tick(5 * 60);
    expect(world.broadcasts).toEqual([MEGA_ZOMBIE_WARNING_TEXT, MEGA_ZOMBIE_SPAWN_TEXT]);
    expect(world.spawns()).toBe(1);
    expect(world.service.manualSpawn().ok).toBe(false);
    expect(world.spawns()).toBe(1);
  });

  it('replaces an expired boss without loot and starts the next cycle', () => {
    const world = harness();
    world.service.enable();
    world.service.tick(MEGA_ZOMBIE_CYCLE_SECONDS);
    expect(world.spawns()).toBe(1);
    world.age(MEGA_ZOMBIE_CYCLE_SECONDS);
    world.service.tick(MEGA_ZOMBIE_CYCLE_SECONDS);
    expect(world.broadcasts).toContain(MEGA_ZOMBIE_TIMEOUT_TEXT);
    expect(world.loot).toHaveLength(0);
    expect(world.fireworks).toHaveLength(0);
    expect(world.spawns()).toBe(2);
    expect(world.boss()?.id).toBe('mega-2');
  });

  it('drops loot and fireworks only for a player kill', () => {
    const world = harness();
    world.service.onBossKilled('Ada');
    world.service.onBossRemoved('death', { x: 4, y: 72, z: 4 });
    expect(world.broadcasts).toEqual(['Мега-зомби был убит игроком Ada!']);
    expect(world.loot).toEqual([{ x: 4, y: 72, z: 4 }]);
    expect(world.fireworks).toEqual([{ x: 4, y: 72, z: 4 }]);
    world.service.onBossKilled(null);
    world.service.onBossRemoved('death', { x: 1, y: 2, z: 3 });
    expect(world.broadcasts).toHaveLength(1);
    expect(world.loot).toHaveLength(2);
  });

  it('kills the active boss once and does not drop loot twice', () => {
    const world = harness();
    world.service.enable();
    world.service.tick(MEGA_ZOMBIE_CYCLE_SECONDS);
    expect(world.service.killActive({ id: 'op', name: 'Op' }).ok).toBe(true);
    world.service.onBossKilled('Op');
    world.service.onBossRemoved('death', { x: 4, y: 72, z: 4 });
    expect(world.loot).toHaveLength(1);
    expect(world.service.killActive({ id: 'op', name: 'Op' }).ok).toBe(false);
    world.service.onBossRemoved('death', { x: 4, y: 72, z: 4 });
    expect(world.loot).toHaveLength(1);
    expect(world.service.killActive().ok).toBe(false);
  });

  it('does not run a second schedule while disabled', () => {
    const world = harness();
    world.service.tick(MEGA_ZOMBIE_CYCLE_SECONDS);
    expect(world.spawns()).toBe(0);
    world.service.disable();
    world.service.tick(MEGA_ZOMBIE_CYCLE_SECONDS);
    expect(world.broadcasts).toHaveLength(0);
  });

  it('limits commands to operators and stores the admin position', () => {
    const world = harness({ spawn: null, pos1: null, pos2: null });
    let handler: ((args: readonly string[], sender: {
      playerId: string;
      name: string;
      operator?: boolean;
    }) => { ok: boolean; lines: readonly string[] }) | undefined;
    const plugin = createMegaZombiePlugin({ megaZombie: world.service } as BuiltinPluginContext);
    plugin.onEnable?.({
      registerCommand: (command: { execute: typeof handler }) => {
        handler = command.execute;
        return () => {};
      },
      registerEvent: () => () => {},
      hasPermission: () => false,
      isOperator: (name: string) => name === 'Op',
      getPlayer: () => ({ position: () => ({ x: 6, y: 71, z: 8, yaw: 0, pitch: 0 }) }),
      broadcast: () => {},
      log: () => {},
    } as never);
    expect(handler?.([], { playerId: 'p', name: 'Ada', operator: false }).ok).toBe(false);
    expect(handler?.(['setspawn'], { playerId: 'p', name: 'Op', operator: true }).ok).toBe(true);
    expect(handler?.(['setpos1'], { playerId: 'p', name: 'Op', operator: true }).ok).toBe(true);
    expect(handler?.(['setpos2'], { playerId: 'p', name: 'Op', operator: true }).ok).toBe(true);
    expect(world.service.arena()).toEqual({
      minX: 6, maxX: 6, minY: 71, maxY: 71, minZ: 8, maxZ: 8,
    });
    const info = handler?.(['info'], { playerId: 'p', name: 'Op', operator: true });
    expect(info?.ok).toBe(true);
    expect(info?.lines.some((line) => line.startsWith('spawn:'))).toBe(true);
    plugin.onDisable?.();
    world.service.tick(MEGA_ZOMBIE_CYCLE_SECONDS);
    expect(world.spawns()).toBe(0);
  });
});

describe('mega zombie loot source', () => {
  it('does not import the event chest generator from the server service', () => {
    const source = readFileSync(new URL('../../server/services/megaZombie.ts', import.meta.url), 'utf8');
    expect(source.includes('generateEventChestLoot')).toBe(false);
  });
});
