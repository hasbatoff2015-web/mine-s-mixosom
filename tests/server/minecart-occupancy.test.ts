import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { collectMinecartPassengers } from '../../src/entities';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';
import type { ClientInputMessage } from '../../shared/protocol';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-minecart-occupancy-'));
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

let inputSeq = 1;

function rideInput(yaw: number, vehicleForward: number): ClientInputMessage {
  inputSeq += 1;
  return {
    type: 'input',
    seq: inputSeq,
    forward: vehicleForward,
    right: 0,
    jump: false,
    sneak: false,
    sprint: false,
    descend: false,
    flySprint: false,
    yaw,
    pitch: 0,
    selectedSlot: 0,
    vehicleForward,
  };
}

describe('Anarchy minecart occupancy and per-cart control', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(): Promise<WorldInstance> {
    const dataDir = await tempDir();
    dirs.push(dataDir);
    const world = new WorldInstance(testConfig(dataDir));
    worlds.push(world);
    await world.initialize();
    return world;
  }

  function join(world: WorldInstance, name: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  function passengerSnap(world: WorldInstance, player: ServerPlayer, cartId: string) {
    return world.gameplay.snapshotsNear(
      player.controller.position,
      collectMinecartPassengers(world.connectedPlayers()),
    ).find((entry) => entry.kind === 'minecart' && entry.id === cartId);
  }

  function placeRideableCart(
    world: WorldInstance,
    player: ServerPlayer,
    offsetX = 0,
    length = 24,
  ) {
    const x = 32 + offsetX;
    const y = 96;
    const z0 = 32;
    for (let z = z0; z <= z0 + length; z += 1) {
      world.world.getChunk(Math.floor(x / 16), Math.floor(z / 16));
      world.world.setBlock(x, y - 1, z, BlockId.Stone);
      world.world.setBlock(x, y, z, BlockId.Air);
      world.world.setBlock(x, y + 1, z, BlockId.Air);
      world.world.setBlock(x, y, z, BlockId.Rail);
      world.world.setBlockState(x, y, z, { railShape: 'north_south' });
    }
    player.controller.teleport([x + 0.5, y, z0 - 1.5]);
    const cart = world.gameplay.minecarts.spawn(x, y, z0)!;
    return cart;
  }

  it('rejects a second passenger in the same cart and frees the seat on exit', async () => {
    const world = await boot();
    const a = join(world, 'Ada');
    const b = join(world, 'Bob');
    const cart = placeRideableCart(world, a.player);
    b.player.controller.teleport([
      a.player.controller.position.x,
      a.player.controller.position.y,
      a.player.controller.position.z,
    ]);
    expect(world.gameplay.enterVehicle(a.player, cart.id)).toBe(true);
    expect(world.gameplay.enterVehicle(b.player, cart.id)).toBe(false);
    expect(a.player.ridingCartId).toBe(cart.id);
    expect(b.player.ridingCartId).toBeUndefined();
    expect(world.gameplay.findMinecartPassenger(cart.id)?.id).toBe(a.player.id);
    expect(cart.rider).toBe(true);
    expect(passengerSnap(world, a.player, cart.id)?.passengerId).toBe(a.player.id);

    world.applyInput(a.player, rideInput(Math.PI, 1));
    world.tick();
    expect(cart.alongSpeed).toBeGreaterThan(0);

    const speedWhileARides = cart.alongSpeed;
    world.applyInput(b.player, rideInput(Math.PI, -1));
    world.tick();
    expect(cart.alongSpeed).toBeGreaterThan(speedWhileARides - 1e-6);

    world.gameplay.exitVehicle(a.player);
    expect(a.player.ridingCartId).toBeUndefined();
    expect(cart.rider).toBe(false);
    expect(world.gameplay.enterVehicle(b.player, cart.id)).toBe(true);
    expect(b.player.ridingCartId).toBe(cart.id);
    expect(passengerSnap(world, b.player, cart.id)?.passengerId).toBe(b.player.id);
  });

  it('gives each occupied cart its own rider input in one physics tick', async () => {
    const world = await boot();
    const a = join(world, 'Ada');
    const b = join(world, 'Bob');
    const cartA = placeRideableCart(world, a.player, 0);
    const cartB = placeRideableCart(world, b.player, 2);
    expect(world.gameplay.enterVehicle(a.player, cartA.id)).toBe(true);
    expect(world.gameplay.enterVehicle(b.player, cartB.id)).toBe(true);
    for (let tick = 0; tick < 8; tick += 1) {
      world.applyInput(a.player, rideInput(Math.PI, 1));
      world.applyInput(b.player, rideInput(Math.PI, 1));
      world.tick();
    }
    expect(cartA.alongSpeed).toBeGreaterThan(1);
    expect(cartB.alongSpeed).toBeGreaterThan(1);
    const aBefore = cartA.alongSpeed;
    const bBefore = cartB.alongSpeed;
    for (let tick = 0; tick < 6; tick += 1) {
      world.applyInput(a.player, rideInput(Math.PI, -1));
      world.applyInput(b.player, rideInput(Math.PI, 1));
      world.tick();
    }
    expect(cartA.alongSpeed).toBeLessThan(aBefore);
    expect(cartB.alongSpeed).toBeGreaterThanOrEqual(bBefore - 1e-6);
  });

  it('releases occupancy on disconnect so another player can board immediately', async () => {
    const world = await boot();
    const a = join(world, 'Ada');
    const b = join(world, 'Bob');
    const cart = placeRideableCart(world, a.player);
    expect(world.gameplay.enterVehicle(a.player, cart.id)).toBe(true);
    world.disconnect(a.player.id);
    expect(a.player.connected).toBe(false);
    expect(a.player.ridingCartId).toBeUndefined();
    expect(cart.rider).toBe(false);
    expect(world.gameplay.findMinecartPassenger(cart.id)).toBeUndefined();
    expect(passengerSnap(world, b.player, cart.id)?.passengerId).toBeUndefined();
    expect(world.gameplay.enterVehicle(b.player, cart.id)).toBe(true);
    expect(b.player.ridingCartId).toBe(cart.id);
    expect(cart.rider).toBe(true);
  });

  it('rejects switching carts without exiting and repairs duplicate occupancy', async () => {
    const world = await boot();
    const a = join(world, 'Ada');
    const b = join(world, 'Bob');
    const cartA = placeRideableCart(world, a.player, 0);
    const cartB = placeRideableCart(world, a.player, 2);
    expect(world.gameplay.enterVehicle(a.player, cartA.id)).toBe(true);
    expect(world.gameplay.enterVehicle(a.player, cartB.id)).toBe(false);
    expect(a.player.ridingCartId).toBe(cartA.id);
    expect(cartA.rider).toBe(true);
    expect(cartB.rider).toBe(false);

    b.player.ridingCartId = cartA.id;
    cartA.rider = true;
    world.tick();
    const occupant = world.gameplay.findMinecartPassenger(cartA.id);
    expect(occupant?.id).toBe(a.player.id);
    expect(b.player.ridingCartId).toBeUndefined();
    expect(a.player.ridingCartId).toBe(cartA.id);
  });

  it('force-releases on death even if vehicleExit is cancelled', async () => {
    const world = await boot();
    const a = join(world, 'Ada');
    const cart = placeRideableCart(world, a.player);
    expect(world.gameplay.enterVehicle(a.player, cart.id)).toBe(true);
    world.setGameMode(a.player, 'survival');
    world.events.on('vehicleExit', (event) => {
      event.cancelled = true;
    });
    a.player.survival.damage(1000, 'generic', { ignoreInvulnerability: true, bypassArmor: true });
    world.gameplay.respawnIfDead(a.player);
    expect(a.player.ridingCartId).toBeUndefined();
    expect(cart.rider).toBe(false);
  });
});
