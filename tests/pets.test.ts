import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockId } from '../src/blocks';
import { shouldSnapPose } from '../src/core/entityInterpolation';
import { ItemId } from '../src/items';
import { Vec3 } from '../src/math/vec3';
import {
  CAT_FEAR_DISTANCE,
  LOCAL_PLAYER_FOCUS_ID,
  MAX_MOB_REWIND_TICKS,
  MAX_SEPARATION_PAIR_CHECKS,
  MobManager,
  PET_FOLLOW_STOP_DISTANCE,
  PET_INTERACT_REACH,
  PET_TELEPORT_COOLDOWN_SECONDS,
  PET_TELEPORT_DISTANCE,
  PET_TELEPORT_OFFSETS,
  findSafePetTeleport,
  lastPetTeleportSearchStats,
  petTeleportCandidateCount,
  pickCatVariant,
  pickPassiveSpawnKind,
  resetPetTeleportSearchStats,
  resolvePetInteract,
} from '../src/entities';
import {
  DEFAULT_MAX_TAMED_PETS,
  DEFAULT_PET_LIMIT,
  MAX_PET_LIMIT,
  MAX_TAMED_PET_SAFETY_CAP,
  parsePetLimitNode,
  petCapacityReachedMessage,
  petLimitReachedMessage,
  resolveMaxTamedPets,
  resolvePetLimitFromPermissions,
  tameSuccessMessage,
} from '../src/gameplay/petLimit';
import { VoxelWorld } from '../src/world/World';
import { PermissionService } from '../server/services/permissions';
import { JsonFileStore } from '../server/services/jsonStore';
import { resolvePetLimit } from '../server/services/playerLimits';
import { captureEntityUse } from '../src/net/actionIntent';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach((dispose) => dispose()); vi.restoreAllMocks(); });

function arena(options: {
  random?: () => number;
  maxMobs?: number;
  passiveCap?: number;
  maxTamedPets?: number;
} = {}) {
  const world = new VoxelWorld('pets');
  vi.spyOn(world, 'getBlock').mockImplementation((_x, y, _z, generate) => {
    expect(generate === false || generate === undefined || generate === true).toBe(true);
    return y <= 70 ? BlockId.Stone : BlockId.Air;
  });
  const manager = new MobManager(new THREE.Scene(), world, {
    automaticSpawning: false,
    random: options.random ?? (() => 0),
    maxMobs: options.maxMobs ?? 48,
    passiveCap: options.passiveCap ?? 20,
    ...(options.maxTamedPets !== undefined ? { maxTamedPets: options.maxTamedPets } : {}),
  });
  cleanup.push(() => manager.dispose());
  return { world, manager };
}

function ownerFocus(x: number, z: number, extras: Partial<{ id: string; alive: boolean; heldItemId: string }> = {}) {
  return {
    id: extras.id ?? 'owner-a',
    position: new Vec3(x, 71, z),
    eyePosition: new Vec3(x, 72.62, z),
    alive: extras.alive ?? true,
    targetable: true,
    ...(extras.heldItemId ? { heldItemId: extras.heldItemId } : {}),
  };
}

describe('pet taming', () => {
  it('tames a wolf with a bone, sits immediately, and consumes in survival', () => {
    const { manager } = arena({ random: () => 0 });
    const wolf = manager.spawn('wolf', new THREE.Vector3(0.5, 71, 0.5), { force: true })!;
    const result = manager.tryPetInteract(wolf, {
      playerId: 'owner-a',
      heldItemId: ItemId.Bone,
      gamemode: 'survival',
      petLimit: 2,
    });
    expect(result).toEqual({ ok: true, kind: 'tame', consume: true });
    expect(wolf.ownerId).toBe('owner-a');
    expect(wolf.sitting).toBe(true);
    expect(wolf.velocity.x).toBe(0);
    expect(wolf.velocity.z).toBe(0);
  });

  it('uses deterministic RNG: values >= 1/3 fail but still consume', () => {
    const failed = resolvePetInteract(
      { kind: 'wolf', alive: true, sitting: false },
      {
        playerId: 'p',
        heldItemId: ItemId.Bone,
        gamemode: 'survival',
        ownedCount: 0,
        petLimit: 2,
        random: () => 0.34,
      },
    );
    expect(failed).toMatchObject({ ok: false, reason: 'tame_failed', consume: true });
    const success = resolvePetInteract(
      { kind: 'wolf', alive: true, sitting: false },
      {
        playerId: 'p',
        heldItemId: ItemId.Bone,
        gamemode: 'survival',
        ownedCount: 0,
        petLimit: 2,
        random: () => 0,
      },
    );
    expect(success).toMatchObject({ ok: true, kind: 'tame', consume: true });
  });

  it.each([ItemId.CookedBeef, ItemId.CookedPorkchop, ItemId.CookedChicken])('tames a cat with %s', (item) => {
    const { manager } = arena({ random: () => 0 });
    const cat = manager.spawn('cat', new THREE.Vector3(1.5, 71, 1.5), { force: true, catVariant: 'red' })!;
    expect(manager.tryPetInteract(cat, {
      playerId: 'owner-a', heldItemId: item, gamemode: 'survival', petLimit: 2,
    })).toMatchObject({ ok: true, kind: 'tame', consume: true });
    expect(cat.catVariant).toBe('red');
    expect(cat.sitting).toBe(true);
  });

  it('rejects the wrong food and does not consume', () => {
    const { manager } = arena({ random: () => 0 });
    const cat = manager.spawn('cat', new THREE.Vector3(0.5, 71, 0.5), { force: true })!;
    expect(manager.tryPetInteract(cat, {
      playerId: 'owner-a', heldItemId: ItemId.Bone, gamemode: 'survival', petLimit: 2,
    })).toMatchObject({ ok: false, reason: 'item', consume: false });
    expect(cat.ownerId).toBeUndefined();
  });

  it('does not consume in creative', () => {
    const { manager } = arena({ random: () => 0 });
    const wolf = manager.spawn('wolf', new THREE.Vector3(0.5, 71, 0.5), { force: true })!;
    expect(manager.tryPetInteract(wolf, {
      playerId: 'owner-a', heldItemId: ItemId.Bone, gamemode: 'creative', petLimit: 2,
    })).toEqual({ ok: true, kind: 'tame', consume: false });
  });

  it('does not retame an owned pet and only the owner toggles sit', () => {
    const { manager } = arena({ random: () => 0 });
    const wolf = manager.spawn('wolf', new THREE.Vector3(0.5, 71, 0.5), { force: true })!;
    manager.tryPetInteract(wolf, { playerId: 'owner-a', heldItemId: ItemId.Bone, gamemode: 'survival', petLimit: 2 });
    expect(manager.tryPetInteract(wolf, {
      playerId: 'owner-b', heldItemId: ItemId.Bone, gamemode: 'survival', petLimit: 2,
    })).toMatchObject({ ok: false, reason: 'not_owner', consume: false });
    expect(wolf.sitting).toBe(true);
    expect(manager.tryPetInteract(wolf, {
      playerId: 'owner-a', heldItemId: ItemId.Bone, gamemode: 'survival', petLimit: 2,
    })).toMatchObject({ ok: true, kind: 'stand', consume: false });
    expect(wolf.sitting).toBe(false);
    expect(manager.tryPetInteract(wolf, {
      playerId: 'owner-a', gamemode: 'survival', petLimit: 2,
    })).toMatchObject({ ok: true, kind: 'sit', consume: false });
    expect(wolf.sitting).toBe(true);
  });
});

describe('pet limit', () => {
  it('defaults to 2 and blocks a third tame without consuming', () => {
    expect(resolvePetLimitFromPermissions([])).toBe(DEFAULT_PET_LIMIT);
    expect(parsePetLimitNode('pets.limit.foo')).toBeUndefined();
    expect(parsePetLimitNode('pets.limit.1')).toBeUndefined();
    expect(parsePetLimitNode('pets.limit.3')).toBe(3);
    expect(parsePetLimitNode('pets.limit.999999')).toBeUndefined();
    const { manager } = arena({ random: () => 0 });
    for (let index = 0; index < 2; index += 1) {
      const wolf = manager.spawn('wolf', new THREE.Vector3(index + 0.5, 71, 0.5), { force: true })!;
      expect(manager.tryPetInteract(wolf, {
        playerId: 'owner-a', heldItemId: ItemId.Bone, gamemode: 'survival', petLimit: 2,
      }).ok).toBe(true);
    }
    const third = manager.spawn('cat', new THREE.Vector3(8.5, 71, 0.5), { force: true })!;
    const denied = manager.tryPetInteract(third, {
      playerId: 'owner-a', heldItemId: ItemId.CookedBeef, gamemode: 'survival', petLimit: 2,
    });
    expect(denied).toMatchObject({ ok: false, reason: 'pet_limit', consume: false, ownedCount: 2, petLimit: 2 });
    expect(third.ownerId).toBeUndefined();
    expect(petLimitReachedMessage(2, 2)).toBe('Достигнут лимит питомцев: 2/2.');
    expect(tameSuccessMessage('wolf')).toBe('Волк приручён.');
  });

  it('takes the highest valid pets.limit.N and clamps the hard max', () => {
    expect(resolvePetLimitFromPermissions(['pets.limit.3', 'pets.limit.5'])).toBe(5);
    expect(resolvePetLimitFromPermissions(['pets.limit.11'])).toBe(DEFAULT_PET_LIMIT);
    expect(MAX_PET_LIMIT).toBe(10);
  });

  it('keeps extra pets when a role is removed and only blocks new tames', () => {
    const { manager } = arena({ random: () => 0 });
    for (let index = 0; index < 3; index += 1) {
      const wolf = manager.spawn('wolf', new THREE.Vector3(index + 0.5, 71, 0.5), { force: true })!;
      expect(manager.tryPetInteract(wolf, {
        playerId: 'owner-a', heldItemId: ItemId.Bone, gamemode: 'survival', petLimit: 3,
      }).ok).toBe(true);
    }
    expect(manager.countOwnedPets('owner-a')).toBe(3);
    const extra = manager.spawn('cat', new THREE.Vector3(9.5, 71, 0.5), { force: true })!;
    expect(manager.tryPetInteract(extra, {
      playerId: 'owner-a', heldItemId: ItemId.CookedChicken, gamemode: 'survival', petLimit: 2,
    })).toMatchObject({ ok: false, reason: 'pet_limit', consume: false });
    expect(manager.countOwnedPets('owner-a')).toBe(3);
  });
});

describe('follow, teleport, despawn and capacity', () => {
  it('follows at medium range, idles when close, and sits still', () => {
    const { manager } = arena();
    const pet = manager.spawn('cat', new THREE.Vector3(0.5, 71, 0.5), {
      force: true, ownerId: 'owner-a', sitting: false, catVariant: 'black',
    })!;
    manager.update(0.05, { players: [ownerFocus(PET_FOLLOW_STOP_DISTANCE - 1, 0)] });
    pet.position.set(0.5, 71, 0.5);
    pet.velocity.set(0, 0, 0);
    manager.update(0.05, { players: [ownerFocus(8, 0)] });
    expect(pet.velocity.x).toBeGreaterThan(0);
    pet.sitting = true;
    pet.velocity.set(0, 0, 0);
    manager.update(0.05, { players: [ownerFocus(8, 0)] });
    expect(pet.velocity.x).toBe(0);
    expect(pet.velocity.z).toBe(0);
  });

  it('does not chase another player while the owner is offline', () => {
    const { manager } = arena();
    const pet = manager.spawn('wolf', new THREE.Vector3(0.5, 71, 0.5), {
      force: true, ownerId: 'owner-a', sitting: false,
    })!;
    const startX = pet.position.x;
    manager.update(0.05, { players: [ownerFocus(12, 0, { id: 'stranger' })] });
    expect(pet.position.x).toBeCloseTo(startX, 5);
    expect(pet.ownerId).toBe('owner-a');
  });

  it('captures a new idle home at the latest owner-loss point', () => {
    const { manager } = arena();
    const pet = manager.spawn('wolf', new THREE.Vector3(0.5, 71, 0.5), {
      force: true, ownerId: 'owner-a', sitting: false,
    })!;
    manager.update(0.05, { players: [] });
    expect(pet.petHomeX).toBeCloseTo(0.5, 5);
    const homeA = pet.petHomeX!;
    manager.update(0.05, { players: [ownerFocus(0.5 + PET_TELEPORT_DISTANCE + 8, 0.5)] });
    expect(pet.petHomeX).toBeUndefined();
    expect(pet.position.x).toBeGreaterThan(homeA + 8);
    manager.update(0.05, { players: [] });
    expect(pet.petHomeX).toBeDefined();
    expect(Math.abs((pet.petHomeX ?? 0) - homeA)).toBeGreaterThan(8);
    expect(pet.petHomeX).toBeCloseTo(pet.position.x, 1);
  });

  it('attempts a bounded safe teleport when far from the owner', () => {
    const world = new VoxelWorld('pet-teleport');
    const getBlock = vi.spyOn(world, 'getBlock');
    getBlock.mockImplementation((_x, y, _z, generate) => {
      if (generate === false) {
        if (y <= 70) return BlockId.Stone;
        return BlockId.Air;
      }
      return y <= 70 ? BlockId.Stone : BlockId.Air;
    });
    resetPetTeleportSearchStats();
    const destination = findSafePetTeleport(world, { x: 8.5, y: 71, z: 8.5 });
    expect(destination).toBeDefined();
    expect(petTeleportCandidateCount()).toBe(PET_TELEPORT_OFFSETS.length);
    expect(PET_TELEPORT_OFFSETS.length).toBeLessThanOrEqual(32);
    expect(lastPetTeleportSearchStats().candidateChecks).toBeGreaterThan(0);
    expect(lastPetTeleportSearchStats().candidateChecks).toBeLessThanOrEqual(32);
    expect(getBlock.mock.calls.filter((call) => call[3] === false).length).toBeGreaterThan(0);
    expect(getBlock.mock.calls.some((call) => call[3] === true)).toBe(false);
    getBlock.mockClear();

    const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false, random: () => 0 });
    cleanup.push(() => manager.dispose());
    const pet = manager.spawn('wolf', new THREE.Vector3(0.5, 71, 0.5), {
      force: true, ownerId: 'owner-a', sitting: false,
    })!;
    manager.update(0.05, { players: [ownerFocus(0.5 + PET_TELEPORT_DISTANCE + 2, 0.5)] });
    expect(pet.position.distanceTo(new THREE.Vector3(0.5, 71, 0.5))).toBeGreaterThan(1);
    const searches = manager.teleportSearches;
    manager.update(0.05, { players: [ownerFocus(40, 0)] });
    expect(manager.teleportSearches).toBe(searches);
    expect(PET_TELEPORT_COOLDOWN_SECONDS).toBeGreaterThan(0.4);
  });

  it('rejects water, lava, fire and solid body space', () => {
    const owner = { x: 10.5, y: 71, z: 0.5 };
    const search = (floor: BlockId, body: BlockId) => {
      const world = new VoxelWorld(`unsafe-teleport-${floor}-${body}`);
      vi.spyOn(world, 'getBlock').mockImplementation((_x, y) => {
        if (y <= 70) return floor;
        return body;
      });
      return findSafePetTeleport(world, owner);
    };
    expect(search(BlockId.Water, BlockId.Air)).toBeUndefined();
    expect(search(BlockId.Lava, BlockId.Air)).toBeUndefined();
    expect(search(BlockId.Fire, BlockId.Air)).toBeUndefined();
    expect(search(BlockId.Stone, BlockId.Stone)).toBeUndefined();
  });

  it('snaps interpolation for a 16-block teleport jump', () => {
    expect(shouldSnapPose(
      { x: 0, y: 71, z: 0, yaw: 0, walkPhase: 0 },
      { x: PET_TELEPORT_DISTANCE, y: 71, z: 0, yaw: 0, walkPhase: 0 },
    )).toBe(true);
  });

  it('never distance-despawns tamed pets', () => {
    const { manager } = arena();
    const wild = manager.spawn('cow', new THREE.Vector3(0.5, 71, 0.5), { force: true })!;
    const pet = manager.spawn('wolf', new THREE.Vector3(1.5, 71, 0.5), {
      force: true, ownerId: 'owner-a', sitting: true,
    })!;
    for (let tick = 0; tick < 200; tick += 1) {
      manager.update(0.05, { playerPosition: new Vec3(400, 71, 400), playerAlive: true });
    }
    expect(manager.get(wild.id)).toBeUndefined();
    expect(manager.get(pet.id)).toBeDefined();
    expect(pet.sitting).toBe(true);
  });

  it('excludes tamed pets from wild caps and eviction', () => {
    const { manager } = arena({ maxMobs: 2, passiveCap: 2 });
    const pet = manager.spawn('cat', new THREE.Vector3(0.5, 71, 0.5), {
      force: true, ownerId: 'owner-a', sitting: true,
    })!;
    const cow = manager.spawn('cow', new THREE.Vector3(2.5, 71, 0.5), { force: true })!;
    expect(manager.countByDisposition('passive')).toBe(1);
    manager.spawn('pig', new THREE.Vector3(4.5, 71, 0.5), { force: true });
    expect(manager.spawn('sheep', new THREE.Vector3(6.5, 71, 0.5))).toBeUndefined();
    const restored = manager.serialize();
    manager.clear();
    const petEntry = restored.find((entry) => entry.id === pet.id)!;
    manager.restore([
      { id: 'cow-a', kind: 'cow', position: [20, 71, 20], velocity: [0, 0, 0], health: 8, state: 'idle', ageSeconds: 0, fuseSeconds: 0 },
      { id: 'cow-b', kind: 'cow', position: [21, 71, 20], velocity: [0, 0, 0], health: 8, state: 'idle', ageSeconds: 0, fuseSeconds: 0 },
      { id: 'cow-c', kind: 'cow', position: [22, 71, 20], velocity: [0, 0, 0], health: 8, state: 'idle', ageSeconds: 0, fuseSeconds: 0 },
      petEntry,
    ]);
    expect(manager.get(pet.id)?.ownerId).toBe('owner-a');
    expect(manager.countWildMobs()).toBeLessThanOrEqual(2);
    expect(manager.countTamedPets()).toBe(1);
    expect(manager.get(pet.id)).toBeDefined();
  });

  it('lets several owners keep pets without zeroing the wild budget', () => {
    const { manager } = arena({ maxMobs: 4, passiveCap: 4 });
    for (let index = 0; index < 3; index += 1) {
      manager.spawn('wolf', new THREE.Vector3(index * 2 + 0.5, 71, 0.5), {
        force: true, ownerId: `owner-${index}`, sitting: true,
      });
      manager.spawn('cat', new THREE.Vector3(index * 2 + 0.5, 71, 2.5), {
        force: true, ownerId: `owner-${index}`, sitting: true,
      });
    }
    expect(manager.countTamedPets()).toBe(6);
    expect(manager.spawn('cow', new THREE.Vector3(20.5, 71, 0.5))).toBeDefined();
    expect(manager.spawn('pig', new THREE.Vector3(22.5, 71, 0.5))).toBeDefined();
    expect(manager.countWildMobs()).toBeGreaterThan(0);
    expect(manager.countWildMobs()).toBeLessThanOrEqual(4);
  });

  it('restores every tamed pet even when the safety ceiling is lower', () => {
    const { manager } = arena({ maxMobs: 2, maxTamedPets: 2 });
    manager.restore([
      { id: 'pet-a', kind: 'wolf', position: [1, 71, 1], velocity: [0, 0, 0], health: 8, state: 'idle', ageSeconds: 0, fuseSeconds: 0, ownerId: 'a', sitting: true },
      { id: 'pet-b', kind: 'cat', position: [2, 71, 1], velocity: [0, 0, 0], health: 8, state: 'idle', ageSeconds: 0, fuseSeconds: 0, ownerId: 'b', sitting: true },
      { id: 'pet-c', kind: 'wolf', position: [3, 71, 1], velocity: [0, 0, 0], health: 8, state: 'idle', ageSeconds: 0, fuseSeconds: 0, ownerId: 'c', sitting: true },
      { id: 'cow-a', kind: 'cow', position: [20, 71, 20], velocity: [0, 0, 0], health: 8, state: 'idle', ageSeconds: 0, fuseSeconds: 0 },
      { id: 'cow-b', kind: 'cow', position: [21, 71, 20], velocity: [0, 0, 0], health: 8, state: 'idle', ageSeconds: 0, fuseSeconds: 0 },
      { id: 'cow-c', kind: 'cow', position: [22, 71, 20], velocity: [0, 0, 0], health: 8, state: 'idle', ageSeconds: 0, fuseSeconds: 0 },
    ]);
    expect(manager.get('pet-a')).toBeDefined();
    expect(manager.get('pet-b')).toBeDefined();
    expect(manager.get('pet-c')).toBeDefined();
    expect(manager.countTamedPets()).toBe(3);
    expect(manager.countWildMobs()).toBe(2);
  });

  it('rejects a new tame at the global safety ceiling without despawning pets', () => {
    const { manager } = arena({ random: () => 0, maxTamedPets: 2 });
    manager.spawn('wolf', new THREE.Vector3(0.5, 71, 0.5), {
      force: true, ownerId: 'owner-a', sitting: true,
    });
    manager.spawn('cat', new THREE.Vector3(2.5, 71, 0.5), {
      force: true, ownerId: 'owner-b', sitting: true,
    });
    const wild = manager.spawn('wolf', new THREE.Vector3(4.5, 71, 0.5), { force: true })!;
    const result = manager.tryPetInteract(wild, {
      playerId: 'owner-c',
      heldItemId: ItemId.Bone,
      gamemode: 'survival',
      petLimit: 2,
    });
    expect(result).toEqual({ ok: false, reason: 'pet_capacity', consume: false });
    expect(wild.ownerId).toBeUndefined();
    expect(manager.countTamedPets()).toBe(2);
  });
});

describe('cat fear and wolf combat', () => {
  it('flees a nearby player unless cooked meat is held', () => {
    const { manager } = arena();
    const cat = manager.spawn('cat', new THREE.Vector3(0.5, 71, 0.5), { force: true })!;
    manager.update(0.05, {
      players: [ownerFocus(CAT_FEAR_DISTANCE - 1, 0, { id: LOCAL_PLAYER_FOCUS_ID })],
    });
    expect(cat.velocity.x).toBeLessThan(0);
    cat.velocity.set(0, 0, 0);
    cat.fleeSeconds = 0;
    manager.update(0.05, {
      players: [ownerFocus(CAT_FEAR_DISTANCE - 1, 0, {
        id: LOCAL_PLAYER_FOCUS_ID,
        heldItemId: ItemId.CookedBeef,
      })],
    });
    expect(cat.fleeSeconds).toBe(0);
  });

  it('makes a wild wolf angry at its attacker and sitting wolves do not assist', () => {
    const { manager } = arena();
    const wild = manager.spawn('wolf', new THREE.Vector3(0.5, 71, 0.5), { force: true })!;
    const standing = manager.spawn('wolf', new THREE.Vector3(2.5, 71, 0.5), {
      force: true, ownerId: 'owner-a', sitting: false,
    })!;
    const sitting = manager.spawn('wolf', new THREE.Vector3(3.5, 71, 0.5), {
      force: true, ownerId: 'owner-a', sitting: true,
    })!;
    const cat = manager.spawn('cat', new THREE.Vector3(4.5, 71, 0.5), {
      force: true, ownerId: 'owner-a', sitting: false,
    })!;
    const zombie = manager.spawn('zombie', new THREE.Vector3(6.5, 71, 0.5), { force: true })!;
    expect(manager.damage(wild, 1, {
      source: 'player', attackerId: 'owner-a', attackerPosition: new Vec3(-2, 71, 0),
    })).toBe(true);
    expect(wild.angry).toBe(true);
    expect(wild.combatTargetId).toBe('owner-a');
    manager.assignOwnedWolfTarget('owner-a', zombie.id, 'mob', 'assist');
    expect(standing.combatTargetId).toBe(zombie.id);
    expect(sitting.combatTargetId).toBeUndefined();
    expect(cat.combatTargetId).toBeUndefined();
  });

  it('does not make owned wolves attack the owner\'s other pets', () => {
    const { manager } = arena();
    const wolfA = manager.spawn('wolf', new THREE.Vector3(0.5, 71, 0.5), {
      force: true, ownerId: 'owner-a', sitting: false,
    })!;
    const wolfB = manager.spawn('wolf', new THREE.Vector3(2.5, 71, 0.5), {
      force: true, ownerId: 'owner-a', sitting: false,
    })!;
    const cat = manager.spawn('cat', new THREE.Vector3(4.5, 71, 0.5), {
      force: true, ownerId: 'owner-a', sitting: false,
    })!;
    expect(manager.damage(cat, 1, {
      source: 'player', attackerId: 'owner-a', attackerPosition: new Vec3(-2, 71, 0),
    })).toBe(true);
    expect(wolfA.combatTargetId).not.toBe(cat.id);
    expect(wolfB.combatTargetId).not.toBe(cat.id);
    expect(manager.damage(wolfB, 1, {
      source: 'player', attackerId: 'owner-a', attackerPosition: new Vec3(-2, 71, 0),
    })).toBe(true);
    expect(wolfA.combatTargetId).not.toBe(wolfB.id);
    wolfA.combatTargetId = cat.id;
    wolfA.combatTargetKind = 'mob';
    manager.update(0.05, { players: [ownerFocus(1, 0)] });
    expect(wolfA.combatTargetId).toBeUndefined();
  });

  it('still assists against hostiles and other owners\' pets', () => {
    const { manager } = arena();
    const wolf = manager.spawn('wolf', new THREE.Vector3(0.5, 71, 0.5), {
      force: true, ownerId: 'owner-a', sitting: false,
    })!;
    const zombie = manager.spawn('zombie', new THREE.Vector3(3.5, 71, 0.5), { force: true })!;
    const rival = manager.spawn('wolf', new THREE.Vector3(5.5, 71, 0.5), {
      force: true, ownerId: 'owner-b', sitting: false,
    })!;
    expect(manager.damage(zombie, 1, {
      source: 'player', attackerId: 'owner-a', attackerPosition: new Vec3(-2, 71, 0),
    })).toBe(true);
    expect(wolf.combatTargetId).toBe(zombie.id);
    wolf.combatTargetId = undefined;
    wolf.combatTargetKind = undefined;
    expect(manager.damage(rival, 1, {
      source: 'player', attackerId: 'owner-a', attackerPosition: new Vec3(-2, 71, 0),
    })).toBe(true);
    expect(wolf.combatTargetId).toBe(rival.id);
  });

  it('clears a dead combat target and returns when the owner is too far', () => {
    const { manager } = arena();
    const wolf = manager.spawn('wolf', new THREE.Vector3(0.5, 71, 0.5), {
      force: true, ownerId: 'owner-a', sitting: false,
    })!;
    const zombie = manager.spawn('zombie', new THREE.Vector3(2.5, 71, 0.5), { force: true })!;
    manager.assignOwnedWolfTarget('owner-a', zombie.id, 'mob', 'defend');
    zombie.health = 0;
    zombie.state = 'die';
    manager.update(0.05, { players: [ownerFocus(1, 0)] });
    expect(wolf.combatTargetId).toBeUndefined();
    const far = manager.spawn('zombie', new THREE.Vector3(3.5, 71, 0.5), { force: true })!;
    manager.assignOwnedWolfTarget('owner-a', far.id, 'mob', 'assist');
    manager.update(0.05, { players: [ownerFocus(40, 0)] });
    expect(wolf.combatTargetId).toBeUndefined();
  });
});

describe('rendered interaction raycast', () => {
  it('hits the visible pose instead of the latest simulation pose', () => {
    const { manager } = arena();
    const cat = manager.spawn('cat', new THREE.Vector3(4.5, 71, 0.5), { force: true })!;
    manager.setNetworkRenderPose(cat.id, 0.5, 71, 0.5, 0, 12);
    const origin = new Vec3(0.5, 71.4, -2);
    const direction = new Vec3(0, 0, 1);
    expect(manager.raycast(origin, direction, PET_INTERACT_REACH)).toBeUndefined();
    const rendered = manager.raycastRendered(origin, direction, PET_INTERACT_REACH);
    expect(rendered?.mob.id).toBe(cat.id);
    expect(rendered?.renderTick).toBe(12);
    const action = captureEntityUse(
      { actionSeq: 0, inputSeq: 4, selectedSlot: 0 },
      cat.id,
      { yaw: 0, pitch: 0 },
      rendered?.renderTick,
    );
    expect(action.targetRenderTick).toBe(12);
  });

  it('keeps a bounded rewind window and a separate pet safety ceiling', () => {
    expect(MAX_MOB_REWIND_TICKS).toBe(5);
    expect(MAX_SEPARATION_PAIR_CHECKS).toBe(1024);
    expect(resolveMaxTamedPets(8)).toBe(80);
    expect(resolveMaxTamedPets(300)).toBe(MAX_TAMED_PET_SAFETY_CAP);
    expect(DEFAULT_MAX_TAMED_PETS).toBe(80);
    expect(petCapacityReachedMessage()).toContain('сервера');
  });
});

describe('spawn weights and persistence', () => {
  it('keeps cats/wolves rare and biome-locked', () => {
    expect(pickPassiveSpawnKind('desert', () => 0.99)).not.toBe('wolf');
    expect(pickPassiveSpawnKind('desert', () => 0.99)).not.toBe('cat');
    expect(pickPassiveSpawnKind('snowy_plains', () => 0)).not.toBe('cat');
    expect(pickPassiveSpawnKind('snowy_plains', () => 0.99)).toBe('wolf');
    expect(pickPassiveSpawnKind('plains', () => 0.97)).toBe('cat');
    expect(pickPassiveSpawnKind('forest', () => 0.93)).toBe('wolf');
    expect(pickCatVariant(() => 0)).toBe('black');
    expect(pickCatVariant(() => 0.4)).toBe('red');
    expect(pickCatVariant(() => 0.8)).toBe('siamese');
  });

  it('round-trips owner, sit and variant and restores old cow saves', () => {
    const { manager } = arena();
    const cat = manager.spawn('cat', new THREE.Vector3(0.5, 71, 0.5), {
      force: true, ownerId: 'owner-a', sitting: true, catVariant: 'siamese',
    })!;
    const saved = manager.serialize();
    expect(saved[0]).toMatchObject({ ownerId: 'owner-a', sitting: true, variant: 'siamese' });
    manager.clear();
    expect(manager.restore([
      { id: 'cow-1', kind: 'cow', position: [4, 71, 4], velocity: [0, 0, 0], health: 10, state: 'idle', ageSeconds: 1, fuseSeconds: 0 },
      ...saved,
    ])).toBe(2);
    expect(manager.get(cat.id)?.catVariant).toBe('siamese');
    expect(manager.get(cat.id)?.sitting).toBe(true);
    expect(manager.get('cow-1')?.ownerId).toBeUndefined();
  });
});

describe('role pet limit resolver', () => {
  it('reads pets.limit.N from assigned roles without making operators unlimited', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-pet-limit-'));
    const permissions = new PermissionService(new JsonFileStore(dir));
    permissions.load();
    expect(resolvePetLimit(permissions, 'steve')).toBe(2);
    permissions.assignRole('steve', 'pet_plus');
    expect(resolvePetLimit(permissions, 'steve')).toBe(3);
    permissions.assignRole('steve', 'pet_master');
    expect(resolvePetLimit(permissions, 'steve')).toBe(5);
    permissions.unassignRole('steve', 'pet_plus');
    permissions.unassignRole('steve', 'pet_master');
    expect(resolvePetLimit(permissions, 'steve')).toBe(2);
    permissions.op('root');
    expect(resolvePetLimit(permissions, 'root')).toBe(2);
    await rm(dir, { recursive: true, force: true });
  });
});
