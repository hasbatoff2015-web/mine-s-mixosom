import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockId } from '../src/blocks';
import { CombatSystem, applyKnockback, completeMeleeAttack, MELEE_EXTRA_VERTICAL, MELEE_KB_VERTICAL } from '../src/combat';
import { Game } from '../src/core/Game';
import { MobManager, MOB_HURT_FLASH_SECONDS } from '../src/entities/MobManager';
import { InputManager, type MoveInput } from '../src/input/InputManager';
import { Inventory, createItemStack } from '../src/inventory';
import { PlayerController } from '../src/player';
import { FirstPersonRenderer, type FirstPersonFrameState } from '../src/rendering/FirstPersonRenderer';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { SurvivalSystem } from '../src/survival';
import { VoxelWorld } from '../src/world/World';
import combatSource from '../src/combat/CombatSystem.ts?raw';
import gameSource from '../src/core/Game.ts?raw';
import uiSource from '../src/ui/GameUI.ts?raw';

const disposals: Array<() => void> = [];
afterEach(() => { disposals.splice(0).forEach((dispose) => dispose()); vi.restoreAllMocks(); });

function flatWorld(wallX = Infinity): VoxelWorld {
  const world = new VoxelWorld('classic-combat-flat');
  // Deterministic collision field; no world generation or lighting jobs in a combat test.
  vi.spyOn(world, 'getBlock').mockImplementation((x, y) => y <= 0 || (x >= wallX && y < 8) ? BlockId.Stone : BlockId.Air);
  return world;
}

function arena(wallX = Infinity) {
  const world = flatWorld(wallX);
  const mobs = new MobManager(new THREE.Scene(), world, { automaticSpawning: false, random: () => 0.1 });
  disposals.push(() => mobs.dispose());
  const mob = mobs.spawn('zombie', new THREE.Vector3(0, 1, 0), { force: true })!;
  mob.onGround = true;
  return { world, mobs, mob };
}

function input(): InputManager {
  const result = Object.create(InputManager.prototype) as InputManager;
  result.attackPressed = false;
  result.usePressed = false;
  result.using = false;
  result.mining = false;
  result.yaw = 0; result.pitch = 0;
  return result;
}

function gameFixture(itemId = 'diamond_sword') {
  const { world, mobs, mob } = arena();
  const inventory = new Inventory();
  inventory.setSlot(0, createItemStack(itemId));
  const player = new PlayerController({ position: [0, 1, 2] });
  player.onGround = true;
  const combat = new CombatSystem({ heldItemId: itemId });
  const survival = new SurvivalSystem({ hunger: 15, isSwordBlocking: () => combat.swordBlocking });
  const controls = input();
  const swing = vi.fn();
  const game = Object.create(Game.prototype) as any;
  const session = { world, mobs, inventory, player, combat, survival, selectedSlot: 0,
    summary: { mode: 'survival' }, miningProgress: 0,
    minecarts: { raycast: () => undefined }, worldRenderer: { setTarget: vi.fn() } };
  Object.assign(game, { session, input: controls, audio: { playTone: vi.fn(), play: vi.fn(), playAt: vi.fn(), playBlock: vi.fn() }, firstPerson: { swing, setHeldItems: vi.fn() } });
  return { game, session, controls, swing, mob };
}

describe('Game click → target damage integration', () => {
  it.each(['diamond_sword', 'diamond_axe'])('uses one durability per accepted %s hit, none in Creative', (item) => {
    const { game, session, controls, mob } = gameFixture(item);
    controls.attackPressed = true;
    game.updateTargetAndActions();
    expect(session.inventory.getSlot(0)!.durability).toBe(1560);
    mob.hurtResistance.reset();
    session.summary.mode = 'creative';
    controls.attackPressed = true;
    game.updateTargetAndActions();
    expect(session.inventory.getSlot(0)!.durability).toBe(1560);
    expect(session.survival.exhaustion).toBeCloseTo(0.3);
  });

  it('keeps all clicks between ticks: full attempts, one actual hit, no sweep', () => {
    const { game, session, controls, swing, mob } = gameFixture();
    const neighbour = session.mobs.spawn('zombie', new THREE.Vector3(0.9, 1, 0), { force: true })!;
    const attack = vi.spyOn(session.combat, 'performMeleeAttack');
    const durability = 1561;
    for (let click = 0; click < 4; click++) controls.attackPressed = true;
    game.updateTargetAndActions();
    expect(attack).toHaveBeenCalledTimes(4);
    expect(attack.mock.results.map((result) => result.value.damage)).toEqual([8, 8, 8, 8]);
    expect(swing).toHaveBeenCalledTimes(4);
    expect(mob.health).toBe(12);
    expect(neighbour.health).toBe(20);
    expect(session.survival.exhaustion).toBeCloseTo(0.3);
    expect(session.inventory.getSlot(0)!.durability).toBe(durability - 1);
    expect(controls.consumeAttackPresses()).toBe(0);
    const velocity = mob.velocity.clone();
    const flash = mob.hurtFlashSeconds;
    controls.attackPressed = true;
    game.updateTargetAndActions();
    expect(mob.velocity).toEqual(velocity);
    expect(mob.hurtFlashSeconds).toBe(flash);
    expect(swing).toHaveBeenCalledTimes(5);
    expect(session.survival.exhaustion).toBeCloseTo(0.3);
  });

  it('does not damage durability or add exhaustion on an air click', () => {
    const { game, session, controls, swing } = gameFixture();
    session.player.yaw = Math.PI;
    const before = session.inventory.getSlot(0);
    controls.attackPressed = true;
    game.updateTargetAndActions();
    expect(swing).toHaveBeenCalledOnce();
    expect(session.inventory.getSlot(0)).toEqual(before);
    expect(session.survival.exhaustion).toBe(0);
  });

  it('slows attacker XZ on accepted sprint hit and keeps sprinting without a key release', () => {
    const { game, session, controls, mob } = gameFixture('wooden_sword');
    session.player.sprinting = true;
    session.player.velocity.set(5, 2, -10);
    controls.attackPressed = true;
    game.updateTargetAndActions();
    expect(session.player.velocity.toArray()).toEqual([3, 2, -6]);
    expect(session.player.sprinting).toBe(true);
    expect(mob.velocity.toArray()).toEqual([0, MELEE_KB_VERTICAL + MELEE_EXTRA_VERTICAL, -18]);
    session.player.sprinting = true;
    controls.attackPressed = true;
    game.updateTargetAndActions();
    expect(session.player.sprinting).toBe(true);
    expect(session.player.velocity.toArray()).toEqual([3, 2, -6]);
  });

  it('supports a stronger differential sprint hit without another base knockback or flash', () => {
    const { game, session, controls, mob } = gameFixture('wooden_sword');
    controls.attackPressed = true; game.updateTargetAndActions();
    mob.hurtFlashSeconds = 0.1;
    session.inventory.setSlot(0, createItemStack('diamond_sword'));
    session.player.sprinting = true;
    controls.attackPressed = true; game.updateTargetAndActions();
    expect(mob.health).toBe(12); // 5 + (8 - 5), not 5 + 8.
    expect(mob.velocity.toArray()).toEqual([0, MELEE_KB_VERTICAL + MELEE_EXTRA_VERTICAL, -18]);
    expect(mob.hurtFlashSeconds).toBe(0.1);
    expect(session.player.sprinting).toBe(true);
    expect(session.survival.exhaustion).toBeCloseTo(0.6);
  });

  it('uses the same hurt gate for melee and projectile damage', () => {
    const { mobs, mob } = arena();
    expect(mobs.damage(mob, 5, { source: 'player' })).toBe(true);
    expect(mobs.damage(mob, 5, { source: 'projectile', igniteTicks: 100 })).toBe(false);
    expect(mob.fireTicks).toBe(0);
    expect(mobs.damage(mob, 8, { source: 'projectile', igniteTicks: 100 })).toBe(true);
    expect(mob.health).toBe(12);
    expect(mob.fireTicks).toBe(100);
    for (let t = 0; t < 10; t++) mobs.update(0.05, { daylight: 0.2 });
    expect(mobs.damage(mob, 5, { source: 'player' })).toBe(true);
    expect(mob.hurtFlashSeconds).toBe(MOB_HURT_FLASH_SECONDS);
    expect(mob.health).toBe(7);
  });

  it('applies classic player melee KB for full hits, not rejected/differential hits', () => {
    const { game, session } = gameFixture();
    session.combat.updateUse(true, true, true);
    session.player.velocity.set(4, -4, 2);
    const event = { amount: 5, source: 'melee', position: new THREE.Vector3(0, 1, 0) };
    game.damagePlayerFromMob(event);
    expect(session.survival.health).toBe(17); // sword (5+1)/2
    expect(session.player.velocity.toArray()).toEqual([2, Math.min(-2 + MELEE_KB_VERTICAL, MELEE_KB_VERTICAL), 9]);
    game.damagePlayerFromMob(event);
    game.damagePlayerFromMob({ ...event, amount: 8 });
    expect(session.survival.health).toBe(15); // differential (3+1)/2
    expect(session.player.velocity.toArray()).toEqual([2, Math.min(-2 + MELEE_KB_VERTICAL, MELEE_KB_VERTICAL), 9]);
    session.summary.mode = 'creative';
    game.damagePlayerFromMob({ ...event, amount: 100 });
    expect(session.survival.health).toBe(15);
  });

  it('retains exact 3-block AABB reach and solid-wall occlusion', () => {
    const { world, mobs, mob } = arena();
    const direction = new THREE.Vector3(0, 0, -1);
    expect(mobs.raycast(new THREE.Vector3(0, 2, 3.3), direction, 3)?.mob).toBe(mob);
    expect(mobs.raycast(new THREE.Vector3(0, 2, 3.301), direction, 3)).toBeUndefined();
    vi.spyOn(world, 'getBlock').mockImplementation((_x, y, z) => y <= 0 || z === 1 ? BlockId.Stone : BlockId.Air);
    expect(mobs.raycast(new THREE.Vector3(0, 2, 3), direction, 3)).toBeUndefined();
  });
});

describe('movement and presentation', () => {
  it('feeds 20% movement and no sprint through Game while blocking, clearing on release/death/overlay', () => {
    const { game, session, controls } = gameFixture();
    controls.movement = () => ({ forward: 1, right: 1, sprint: true, flySprint: true, jump: false, sneak: false });
    Object.assign(game, { profiler: { enabled: false }, lifecycle: { state: 'PLAYING' },
      ui: { isBlockingOverlay: () => false } });
    Object.assign(session, { playTicks: 0, falling: { update: () => {} } });
    vi.spyOn(session.world, 'tick').mockImplementation(() => {});
    const endCapture = new Error('movement captured');
    let movement: MoveInput;
    vi.spyOn(session.player, 'tick').mockImplementation((_world, source) => {
      movement = source.movement(); throw endCapture;
    });
    controls.using = true;
    expect(() => game.tick()).toThrow(endCapture);
    expect(session.combat.swordBlocking).toBe(true);
    expect(movement!).toMatchObject({ forward: 0.2, right: 0.2, sprint: false, flySprint: false });
    controls.using = false;
    expect(() => game.tick()).toThrow(endCapture);
    expect(session.combat.swordBlocking).toBe(false);
    expect(movement!).toMatchObject({ forward: 1, sprint: true });
    controls.using = true;
    session.survival.health = 0;
    session.survival.dead = true;
    expect(() => game.tick()).toThrow(endCapture);
    expect(session.combat.swordBlocking).toBe(false);
    session.survival.health = 20;
    session.survival.dead = false;
    game.ui.isBlockingOverlay = () => true;
    expect(() => game.tick()).toThrow(endCapture);
    expect(session.combat.swordBlocking).toBe(false);
    expect(movement!.forward).toBe(0);
  });

  it('retains skeleton arrow impulse while melee uses the shared velocity transform', () => {
    const { mobs, mob } = arena();
    const events: any[] = [];
    (mobs as any).emitPlayerDamage(mob, new THREE.Vector3(0, 1, 3), 4, 'arrow', {
      onPlayerDamage: (event: unknown) => events.push(event),
    });
    expect(events[0].knockback.toArray()).toEqual([0, 0.5, 2.4]);
  });

  it('moves player and mob with the same first-tick melee impulse and drag, including a wall', () => {
    for (const wall of [Infinity, 1]) {
      const { world, mobs, mob } = arena(wall);
      const player = new PlayerController({ position: [0, 1, 0] });
      player.onGround = true;
      player.receiveMeleeKnockback({ x: 1, z: 0 });
      mobs.damage(mob, 1, { source: 'player', attackerPosition: new THREE.Vector3(-1, 1, 0) });
      const noInput = { yaw: 0, pitch: 0, movement: () => ({ forward: 0, right: 0, sprint: false, jump: false, sneak: false }) };
      for (let tick = 0; tick < 9; tick++) {
        player.tick(world, noInput, 0.05);
        mobs.update(0.05, { daylight: 0.2 });
        if (tick === 0) {
          expect(player.position.x).toBeCloseTo(0.4);
          expect(player.velocity.x).toBeCloseTo(8 * 0.546);
        }
        if (!player.onGround && !mob.onGround) {
          expect(player.position.x).toBeCloseTo(mob.position.x, 4);
          expect(player.position.y).toBeCloseTo(mob.position.y, 4);
        }
      }
    }
  });

  it('keeps sprinting after a successful sprint hit while W and sprint stay held', () => {
    const world = flatWorld();
    const player = new PlayerController({ position: [0, 1, 0] });
    const move: MoveInput = { forward: 1, right: 0, sprint: true, jump: false, sneak: false };
    const source = { yaw: 0, pitch: 0, movement: () => move };
    player.tick(world, source, 0.05);
    expect(player.sprinting).toBe(true);
    completeMeleeAttack(new CombatSystem().attack('wooden_sword', { attackerSprinting: true }), true, player);
    player.tick(world, source, 0.05);
    expect(player.sprinting).toBe(true);
  });

  it('reuses the first-person object for repeated swing/block/release, restoring idle without drift', () => {
    const visuals = new ItemVisualFactory();
    const fp = new FirstPersonRenderer(visuals, { freezeIdleMotion: true });
    disposals.push(() => { fp.dispose(); visuals.dispose(); });
    fp.setHeldItems('diamond_sword');
    const state: FirstPersonFrameState = { visible: true, movementSpeed: 0, onGround: true,
      sprinting: false, mining: false, foodUseProgress: 0, bowCharge: 0 };
    fp.update(0.05, state);
    const idle = fp.captureHeldItemMatrixDebug()!.itemLocal.clone();
    const count = fp.objectCount;
    const objects: THREE.Object3D[] = [];
    fp.root.traverse((object) => objects.push(object));
    let blocked: THREE.Matrix4 | undefined;
    for (let cycle = 0; cycle < 100; cycle++) {
      fp.swing(); fp.update(0.01, { ...state, swordBlocking: true });
      const matrix = fp.captureHeldItemMatrixDebug()!.itemLocal;
      expect(matrix.equals(idle)).toBe(false);
      if (blocked) expect(matrix.equals(blocked)).toBe(true);
      blocked = matrix.clone();
      fp.update(0.01, state);
      expect(fp.captureHeldItemMatrixDebug()!.itemLocal.equals(idle)).toBe(true);
      expect(fp.objectCount).toBe(count);
    }
    const after: THREE.Object3D[] = [];
    fp.root.traverse((object) => after.push(object));
    expect(after).toEqual(objects);
  });

  it('removes active charge paths and the cooldown indicator', () => {
    for (const source of [combatSource, gameSource, uiSource]) {
      expect(/attackStrength|attackDamageFactor|attackCooldownTicks|attackSpeed|FULL_ATTACK_THRESHOLD|fullyCharged|ticksSinceAttack/.test(source)).toBe(false);
    }
    expect(uiSource.includes('attack-indicator')).toBe(false);
  });

  it('measures normal/sprint flat and wall displacement through actual mob physics', () => {
    const rows = [];
    for (const wall of [Infinity, 1]) for (const sprint of [false, true]) {
      const { mobs, mob } = arena(wall);
      mobs.damage(mob, 1, { source: 'player', attackerPosition: new THREE.Vector3(-1, 1, 0),
        attackerYaw: -Math.PI / 2, extraKnockbackLevel: Number(sprint) });
      const initial = mob.velocity.toArray();
      for (let t = 0; t < 20; t++) mobs.update(0.05, { daylight: 0.2 });
      rows.push({ wall: Number.isFinite(wall), sprint, initial, distance: mob.position.x, y: mob.position.y });
      // Initial XZ impulse stays 8/18. 20-tick travel is a bit shorter only because
      // the lower apex lands earlier and grounded drag then applies sooner.
      expect(initial[0]).toBe(sprint ? 18 : 8);
      expect(initial[1]).toBe(sprint ? MELEE_KB_VERTICAL + MELEE_EXTRA_VERTICAL : MELEE_KB_VERTICAL);
      if (Number.isFinite(wall)) expect(mob.position.x).toBeCloseTo(0.7, 4);
      else expect(mob.position.x).toBeCloseTo(sprint ? 4.44323 : 1.80024, 4);
    }
    console.info('Classic knockback: blocks/s initial, blocks displacement at 20 ticks', rows);
  });

  it('keeps mob resources bounded during a CPU combat soak (not a GPU/FPS benchmark)', () => {
    const { mobs, mob } = arena();
    const targets = [mob];
    for (let i = 1; i < 24; i++) {
      targets.push(mobs.spawn('zombie', new THREE.Vector3(0, 1, i * 3), { force: true })!);
    }
    const resources = (): unknown[] => {
      const result: unknown[] = [];
      for (const target of targets) target.visual.traverse((object) => {
        result.push(object);
        if (object instanceof THREE.Mesh) result.push(object.geometry, ...[object.material].flat());
      });
      return result;
    };
    const before = resources();
    const samples: number[] = [];
    const attacker = new THREE.Vector3();
    for (let tick = 0; tick < 300; tick++) {
      const start = performance.now();
      for (const target of targets) {
        target.health = 20;
        attacker.copy(target.position); attacker.x -= 1;
        // 20 CPS per target; immunity must filter attempts, without entity growth.
        mobs.damage(target, 1, { source: 'player', attackerPosition: attacker });
      }
      mobs.update(0.05, { daylight: 0.2 });
      samples.push(performance.now() - start);
    }
    expect(mobs.count).toBe(24);
    expect(targets.every((target) => target.alive && Number.isFinite(target.position.x))).toBe(true);
    const after = resources();
    expect(after.length).toBe(before.length);
    after.forEach((resource, index) => expect(resource).toBe(before[index]));
    samples.sort((a, b) => a - b);
    console.info('CPU combat soak: 24 mobs, 300 fixed ticks, 7200 attempts; tick ms', {
      p95: samples[Math.floor(samples.length * 0.95)], max: samples.at(-1),
    });
  });
});
