import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { PlayerArrowManager } from '../src/combat/PlayerArrowManager';
import { MobManager } from '../src/entities';
import {
  BEE_BODY_CENTER_LOCAL_Y,
  BEE_SHOULDER_CENTER_HEIGHT,
  CREEPER_MODEL_HEIGHT,
  PET_BEE_MODEL_SCALE,
  PET_CREEPER_HEIGHT,
  PET_CREEPER_MODEL_SCALE,
  beeRootYForShoulder,
  isCosmeticPetKind,
  parseCosmeticPetSelection,
} from '../src/entities/cosmeticPets';
import { passiveSpawnWeights } from '../src/entities/petSpawn';
import { Vec3 } from '../src/math/vec3';
import { parseWorldSnapshot } from '../src/save/snapshot';
import { VoxelWorld } from '../src/world/World';
import {
  BEE_BOB_AMPLITUDE,
  BEE_WING_AMPLITUDE,
  BEE_WING_HZ,
  beeBobOffset,
  beeWingRadians,
} from '../src/entities/beeVisual';

function arena(seed: string): VoxelWorld {
  const world = new VoxelWorld(seed);
  for (let x = 0; x <= 24; x += 1) {
    for (let z = 0; z <= 16; z += 1) {
      world.setBlock(x, 70, z, BlockId.Stone);
      world.setBlock(x, 71, z, BlockId.Air);
      world.setBlock(x, 72, z, BlockId.Air);
      world.setBlock(x, 73, z, BlockId.Air);
    }
  }
  return world;
}

function manager(seed: string): { world: VoxelWorld; mobs: MobManager } {
  const world = arena(seed);
  return {
    world,
    mobs: new MobManager(new THREE.Scene(), world, { automaticSpawning: false, maxMobs: 32 }),
  };
}

describe('cosmetic pet classification', () => {
  it('keeps bee and mini creeper out of tameable pets and natural spawn weights', () => {
    expect(isCosmeticPetKind('pet_bee')).toBe(true);
    expect(isCosmeticPetKind('pet_creeper')).toBe(true);
    expect(isCosmeticPetKind('creeper')).toBe(false);
    expect(isCosmeticPetKind('wolf')).toBe(false);
    expect(parseCosmeticPetSelection('bee')).toBe('bee');
    expect(parseCosmeticPetSelection('creeper')).toBe('creeper');
    expect(parseCosmeticPetSelection(undefined)).toBeNull();
    expect(parseCosmeticPetSelection('dragon')).toBeNull();
    expect(parseCosmeticPetSelection(1)).toBeNull();
    for (const biome of ['plains', 'forest', 'desert', 'snowy_plains'] as const) {
      expect(passiveSpawnWeights(biome).some((entry) => isCosmeticPetKind(entry.kind))).toBe(false);
    }
    expect(PET_CREEPER_HEIGHT).toBeCloseTo(CREEPER_MODEL_HEIGHT * PET_CREEPER_MODEL_SCALE, 5);
    expect(PET_CREEPER_HEIGHT).toBeGreaterThanOrEqual(0.75);
    expect(PET_CREEPER_HEIGHT).toBeLessThanOrEqual(0.85);
  });

  it('drops an invalid persisted cosmeticPet and keeps a valid one', () => {
    const base = {
      schemaVersion: 1,
      summary: { id: 'anarchy', name: 'Anarchy', seed: '1', mode: 'survival', createdAt: 1, updatedAt: 1, playTimeSeconds: 0 },
      player: { position: [0, 80, 0], velocity: [0, 0, 0], yaw: 0, pitch: 0, health: 20, hunger: 20, saturation: 5, selectedSlot: 0, inventory: {} },
      players: {
        good: { id: 'good', name: 'Good', x: 1, y: 80, z: 2, yaw: 0, pitch: 0, health: 20, gamemode: 'survival', selectedSlot: 0, inventory: {}, updatedAt: 1, cosmeticPet: 'bee' },
        bad: { id: 'bad', name: 'Bad', x: 1, y: 80, z: 2, yaw: 0, pitch: 0, health: 20, gamemode: 'survival', selectedSlot: 0, inventory: {}, updatedAt: 1, cosmeticPet: 'wolf' },
        old: { id: 'old', name: 'Old', x: 1, y: 80, z: 2, yaw: 0, pitch: 0, health: 20, gamemode: 'survival', selectedSlot: 0, inventory: {}, updatedAt: 1 },
      },
    };
    const parsed = parseWorldSnapshot(base);
    expect(parsed.players?.good?.cosmeticPet).toBe('bee');
    expect(parsed.players?.bad?.cosmeticPet).toBeUndefined();
    expect(parsed.players?.old?.cosmeticPet).toBeUndefined();
  });

  it('flaps both wings at a stable rate and keeps the bob small', () => {
    expect(beeWingRadians(0, 'left')).toBeCloseTo(0, 5);
    expect(beeWingRadians(0, 'right')).toBeCloseTo(0, 5);
    const quarter = 1 / (4 * BEE_WING_HZ);
    expect(beeWingRadians(quarter, 'left')).toBeCloseTo(BEE_WING_AMPLITUDE, 5);
    expect(beeWingRadians(quarter, 'right')).toBeCloseTo(-BEE_WING_AMPLITUDE, 5);
    expect(beeWingRadians(quarter + 1 / BEE_WING_HZ, 'left')).toBeCloseTo(BEE_WING_AMPLITUDE, 4);
    expect(Math.abs(beeBobOffset(0.2))).toBeLessThanOrEqual(BEE_BOB_AMPLITUDE + 1e-6);
    expect(BEE_BOB_AMPLITUDE).toBeGreaterThanOrEqual(0.025);
    expect(BEE_BOB_AMPLITUDE).toBeLessThanOrEqual(0.035);
    expect(BEE_WING_HZ).toBeGreaterThanOrEqual(5);
    expect(BEE_WING_HZ).toBeLessThanOrEqual(8);
  });
});

describe('cosmetic pet simulation', () => {
  it('flies the bee above the ground and after its owner', () => {
    const { mobs } = manager('bee-fly');
    const owner = { id: 'owner', position: new Vec3(8, 71, 8), alive: true };
    const bee = mobs.spawn('pet_bee', new Vec3(9.4, 72.2, 8.2), { ownerId: 'owner' })!;
    expect(bee.kind).toBe('pet_bee');
    for (let index = 0; index < 40; index += 1) mobs.update(0.05, { players: [owner] });
    expect(bee.position.y).toBeGreaterThan(71.4);
    expect(bee.fuseSeconds).toBe(0);
    const beforeX = bee.position.x;
    owner.position = new Vec3(18, 71, 8);
    for (let index = 0; index < 50; index += 1) mobs.update(0.05, { players: [owner] });
    expect(bee.position.x).toBeGreaterThan(beforeX + 3);
    expect(Math.hypot(bee.velocity.x, bee.velocity.z)).toBeLessThan(9.5);
    const settled = Math.hypot(owner.position.x - bee.position.x, owner.position.z - bee.position.z);
    expect(settled).toBeLessThan(4);
    mobs.dispose();
  });

  it('does not fly the bee through a solid wall and relocates it when the owner is far', () => {
    const { world, mobs } = manager('bee-wall');
    for (let y = 71; y <= 76; y += 1) {
      for (let z = 4; z <= 12; z += 1) world.setBlock(8, y, z, BlockId.Stone);
    }
    const owner = { id: 'owner', position: new Vec3(12, 72, 8), alive: true };
    const bee = mobs.spawn('pet_bee', new Vec3(5.5, 73, 8), { ownerId: 'owner' })!;
    for (let index = 0; index < 30; index += 1) mobs.update(0.05, { players: [owner] });
    expect(bee.position.x).toBeLessThan(8);
    owner.position = new Vec3(40, 74, 8);
    mobs.update(0.05, { players: [owner] });
    expect(Math.hypot(bee.position.x - 40, bee.position.z - 8)).toBeLessThan(4);
    expect(bee.position.y).toBeGreaterThan(71);
    mobs.dispose();
  });

  it('stops the mini creeper beside the owner and walks when the owner leaves', () => {
    const { mobs } = manager('mini-follow');
    const owner = { id: 'owner', position: new Vec3(10, 71, 10), alive: true };
    const pet = mobs.spawn('pet_creeper', new Vec3(12.2, 71, 10), { ownerId: 'owner' })!;
    for (let index = 0; index < 30; index += 1) mobs.update(0.05, { players: [owner] });
    expect(Math.hypot(pet.velocity.x, pet.velocity.z)).toBeLessThan(0.35);
    expect(pet.position.y).toBeGreaterThan(70.9);
    expect(pet.position.y).toBeLessThan(72);
    const startX = pet.position.x;
    owner.position = new Vec3(20, 71, 10);
    for (let index = 0; index < 40; index += 1) mobs.update(0.05, { players: [owner] });
    expect(pet.position.x).toBeGreaterThan(startX + 1);
    expect(pet.fuseSeconds).toBe(0);
    mobs.dispose();
  });

  it('never fuses a mini creeper while a hostile creeper still explodes', () => {
    const { mobs } = manager('fuse-isolation');
    const owner = { id: 'owner', position: new Vec3(4, 71, 4), alive: true };
    const pet = mobs.spawn('pet_creeper', new Vec3(5, 71, 4), { ownerId: 'owner' })!;
    const hostile = mobs.spawn('creeper', new Vec3(20, 71, 4), { force: true })!;
    for (let index = 0; index < 80; index += 1) mobs.update(0.05, { players: [owner] });
    expect(pet.alive).toBe(true);
    expect(pet.fuseSeconds).toBe(0);
    expect(mobs.consumeExplosions()).toHaveLength(0);
    expect(mobs.get(pet.id)?.health).toBe(pet.definition.maxHealth);
    hostile.position.set(4.8, 71, 4);
    for (let index = 0; index < 40; index += 1) mobs.update(0.05, { players: [owner] });
    expect(mobs.consumeExplosions().length).toBeGreaterThan(0);
    expect(mobs.get(pet.id)?.alive).toBe(true);
    mobs.dispose();
  });

  it('ignores damage, melee, arrows, and world-mob serialization', () => {
    const { world, mobs } = manager('non-combat');
    const pet = mobs.spawn('pet_bee', new Vec3(0.5, 71.2, 2), { ownerId: 'owner' })!;
    const cow = mobs.spawn('cow', new Vec3(0.5, 71, 5), { force: true })!;
    const health = pet.health;
    expect(mobs.damage(pet, 20, { source: 'player', attackerPosition: new Vec3(0.5, 73, 0), lethal: true })).toBe(false);
    expect(mobs.damage(pet, 8, { source: 'explosion', attackerPosition: new Vec3(0.5, 73, 0), knockback: 8 })).toBe(false);
    expect(mobs.damage(pet, 4, { source: 'fire' })).toBe(false);
    expect(pet.health).toBe(health);
    expect(pet.alive).toBe(true);
    const hit = mobs.attackTarget(new Vec3(0.5, 71.8, 0), new Vec3(0, 0, 1), 6, 8);
    expect(hit?.mob.id).toBe(cow.id);
    expect(pet.health).toBe(health);
    const arrows = new PlayerArrowManager(new THREE.Scene(), world, mobs, { random: () => 0.5 });
    arrows.spawn(new Vec3(0.5, 71.6, 0), new Vec3(0, 0, 1), 3, 4, false, false, 'arrow-1', 'shooter', 0);
    arrows.tick(0.05);
    expect(arrows.count).toBe(1);
    expect(arrows.entities[0]!.position.z).toBeGreaterThan(pet.position.z);
    expect(pet.health).toBe(health);
    expect(mobs.serialize().some((entry) => isCosmeticPetKind(entry.kind))).toBe(false);
    const before = mobs.count;
    expect(mobs.restore([{
      id: 'ghost',
      kind: 'pet_bee',
      position: [3, 71, 3],
      velocity: [0, 0, 0],
      health: 20,
      state: 'idle',
      ageSeconds: 0,
      fuseSeconds: 0,
      ownerId: 'owner',
    }], false)).toBe(0);
    expect(mobs.count).toBe(before);
    const wolf = mobs.spawn('wolf', new Vec3(8, 71, 8), { ownerId: 'owner', force: true })!;
    expect(mobs.countTamedPets()).toBe(1);
    expect(mobs.countOwnedPets('owner')).toBe(1);
    expect(mobs.isTamedPet(pet)).toBe(false);
    expect(mobs.isTamedPet(wolf)).toBe(true);
    expect(mobs.countCosmeticPets()).toBe(1);
    arrows.dispose();
    mobs.dispose();
  });

  it('keeps the visible body center at shoulder height while idle, following, and after a teleport', () => {
    const { mobs } = manager('bee-shoulder');
    const feet = 70;
    const owner = { id: 'owner', position: new Vec3(8, feet, 8), alive: true };
    const bee = mobs.spawn('pet_bee', new Vec3(9.3, beeRootYForShoulder(feet), 8.1), { ownerId: 'owner' })!;
    const bodyCenterY = () => {
      mobs.interpolateVisuals(1, 8_000);
      const root = bee.visual as THREE.Object3D;
      expect(root.scale.x).toBeCloseTo(PET_BEE_MODEL_SCALE, 5);
      expect(root.scale.y).toBeCloseTo(root.scale.x, 5);
      expect(root.scale.z).toBeCloseTo(root.scale.x, 5);
      root.updateMatrixWorld(true);
      const body = bee.model?.parts.get('body') as THREE.Object3D;
      const mesh = body.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
      return mesh.getWorldPosition(new THREE.Vector3()).y;
    };
    for (let index = 0; index < 30; index += 1) mobs.update(0.05, { players: [owner] });
    const idle = bodyCenterY();
    expect(idle).toBeGreaterThan(feet + 1.15);
    expect(idle).toBeLessThan(feet + 1.35);
    expect(idle).toBeLessThan(feet + 1.5);
    expect(Math.abs(idle - (feet + BEE_SHOULDER_CENTER_HEIGHT))).toBeLessThan(0.08);
    owner.position = new Vec3(12, feet, 8);
    for (let index = 0; index < 20; index += 1) mobs.update(0.05, { players: [owner] });
    expect(bodyCenterY()).toBeLessThan(feet + 1.4);
    owner.position = new Vec3(14, feet + 1.1, 8);
    for (let index = 0; index < 20; index += 1) mobs.update(0.05, { players: [owner] });
    const running = bodyCenterY();
    expect(running).toBeGreaterThan(feet + 1.1 + 0.9);
    expect(running).toBeLessThan(feet + 1.1 + 1.45);
    owner.position = new Vec3(40, feet + 3, 8);
    mobs.update(0.05, { players: [owner] });
    const relocated = bodyCenterY();
    expect(Math.abs(relocated - (feet + 3 + BEE_SHOULDER_CENTER_HEIGHT))).toBeLessThan(0.12);
    expect(bee.position.y).toBeCloseTo(
      beeRootYForShoulder(feet + 3),
      1,
    );
    expect(BEE_BODY_CENTER_LOCAL_Y * PET_BEE_MODEL_SCALE).toBeGreaterThan(0.1);
    mobs.dispose();
  });

  it('orbits a still owner without start-stop jolts or yaw snaps', () => {
    const { mobs } = manager('bee-idle-smooth');
    const owner = { id: 'owner', position: new Vec3(8, 71, 8), alive: true };
    const bee = mobs.spawn('pet_bee', new Vec3(9.4, 72.05, 8.2), { ownerId: 'owner' })!;
    const speeds: number[] = [];
    const yaws: number[] = [];
    let minX = bee.position.x;
    let maxX = bee.position.x;
    let jumps = 0;
    let previousX = bee.position.x;
    let previousZ = bee.position.z;
    for (let index = 0; index < 400; index += 1) {
      mobs.update(0.05, { players: [owner] });
      const step = Math.hypot(bee.position.x - previousX, bee.position.z - previousZ);
      if (step > 0.6) jumps += 1;
      previousX = bee.position.x;
      previousZ = bee.position.z;
      minX = Math.min(minX, bee.position.x);
      maxX = Math.max(maxX, bee.position.x);
      speeds.push(Math.hypot(bee.velocity.x, bee.velocity.z));
      yaws.push(bee.facingYaw);
    }
    expect(jumps).toBe(0);
    expect(maxX - minX).toBeGreaterThan(0.15);
    let cliffs = 0;
    let yawSnaps = 0;
    for (let index = 1; index < speeds.length; index += 1) {
      expect(Math.abs(speeds[index]! - speeds[index - 1]!)).toBeLessThan(0.5);
      if (speeds[index - 1]! > 0.4 && speeds[index]! < 0.05) cliffs += 1;
      let turn = yaws[index]! - yaws[index - 1]!;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      if (Math.abs(turn) > 0.25) yawSnaps += 1;
    }
    expect(cliffs).toBe(0);
    expect(yawSnaps).toBe(0);
    mobs.dispose();
  });

  it('does not let one owner pet follow the other player', () => {
    const { mobs } = manager('owners');
    const alpha = { id: 'alpha', position: new Vec3(6, 71, 4), alive: true };
    const beta = { id: 'beta', position: new Vec3(6, 71, 14), alive: true };
    const bee = mobs.spawn('pet_bee', new Vec3(7.2, 72.2, 4.2), { ownerId: 'alpha' })!;
    mobs.spawn('pet_creeper', new Vec3(8, 71, 14), { ownerId: 'beta' });
    for (let index = 0; index < 20; index += 1) mobs.update(0.05, { players: [alpha, beta] });
    expect(Math.hypot(bee.position.x - beta.position.x, bee.position.z - beta.position.z)).toBeGreaterThan(6);
    expect(mobs.entities.filter((mob) => isCosmeticPetKind(mob.kind))).toHaveLength(2);
    mobs.dispose();
  });
});
