import * as THREE from 'three';
import {
  BlockId,
  getBlockDefinition,
  isKnownBlockId,
  isPressurePlateBlock,
  isRailBlock,
  isSlabBlock,
  isStairBlock,
  miningProgressPerTick,
  miningToolFromItemId,
  canHarvestBlock,
  buttonPlacementFromHit,
  chestFacingFromYaw,
  doorFacingFromYaw,
  furnaceFacingFromYaw,
  ladderPlacementFromHit,
  lanternPlacementFromHit,
  slabTypeFromHit,
  stairPlacementFromHit,
  torchPlacementFromHit,
} from '../src/blocks';
import {
  completeMeleeAttack,
  CombatSystem,
  PlayerArrowManager,
  flamingArrowBlockHit,
  resolvePlayerAttackTarget,
  applyExtraKnockback,
} from '../src/combat';
import {
  DAY_TICKS,
  FIXED_DT,
  PLAYER_NET_REACH,
  PLAYER_REACH,
  WORLD_HEIGHT,
  blockKey,
  clamp,
  isValidWorldY,
} from '../src/core/constants';
import {
  DroppedItemManager,
  FallingBlockManager,
  MinecartManager,
  MobManager,
  dropsForBrokenMinecart,
  minecartDismountFromSprint,
  resolveFlintAndSteelUse,
} from '../src/entities';
import { Inventory, createItemStack, damageItem, type ItemStack } from '../src/inventory';
import { applyInventoryUiAction, type InventoryWindow } from '../src/inventory/inventoryUiAction';
import { ItemId, tryGetItemDefinition } from '../src/items';
import { pickupFluidSource, placeBucketFluid } from '../src/items/bucketInteraction';
import { PlayerController } from '../src/player';
import { RedstoneSystem } from '../src/redstone';
import {
  defaultSlabType,
  isolatedRailShapeFromYaw,
  resolveRailShape,
} from '../src/rendering/specialBlockGeometry';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { SurvivalSystem } from '../src/survival';
import { ExplosionQueue } from '../src/world/ExplosionQueue';
import { isFluidBlock } from '../src/world/fluids';
import type { VoxelHit, VoxelWorld } from '../src/world/World';
import { rayAabbDistance } from '../src/world/collision';
import type { ClientInventoryActionMessage, EntitySnapshot, GameMode } from '../shared/protocol';
import type { EventBus } from './events';
import type { WorldDiskState } from './persistence';

export const ENTITY_INTEREST_RADIUS = 48;
const INTEREST_SQ = ENTITY_INTEREST_RADIUS * ENTITY_INTEREST_RADIUS;

export function daylightFactor(timeOfDay: number): number {
  const phase = (timeOfDay / DAY_TICKS) * Math.PI * 2;
  return clamp((Math.sin(phase) + 0.22) / 0.75, 0.08, 1);
}

export function rollBlockDropCount(
  drop: { readonly count?: number; readonly min?: number; readonly max?: number },
  random = Math.random,
): number {
  if (drop.count !== undefined) return drop.count;
  if (drop.min !== undefined) {
    const max = drop.max ?? drop.min;
    return drop.min + Math.floor(random() * (max - drop.min + 1));
  }
  return 1;
}

export interface GameplayPlayer {
  readonly id: string;
  connected: boolean;
  readonly controller: PlayerController;
  readonly inventory: Inventory;
  readonly survival: SurvivalSystem;
  readonly combat: CombatSystem;
  gamemode: GameMode;
  selectedSlot: number;
  cursor: ItemStack | null;
  craftSlots: Array<ItemStack | null>;
  window: InventoryWindow;
  ridingCartId?: string;
  miningTarget?: { x: number; y: number; z: number };
  miningProgress: number;
  bowUseTicks: number;
  foodUseTicks: number;
  lastUse: boolean;
  lastSprint: boolean;
  vehicleForward: number;
  inventoryDirty: boolean;
}

export interface GameplayMetrics {
  tickMs: number;
  maxTickMs: number;
  entities: number;
  blockChanges: number;
}

export class ServerGameplay {
  readonly scene = new THREE.Group();
  readonly drops: DroppedItemManager;
  readonly falling: FallingBlockManager;
  readonly mobs: MobManager;
  readonly minecarts: MinecartManager;
  readonly arrows: PlayerArrowManager;
  readonly redstone: RedstoneSystem;
  readonly explosions = new ExplosionQueue();
  lastTickMs = 0;
  maxTickMs = 0;
  private readonly blockDelta = new Map<string, { x: number; y: number; z: number; blockId: number }>();
  private activePressurePlates = new Set<string>();
  private readonly tmpEye = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();

  constructor(
    readonly world: VoxelWorld,
    readonly events: EventBus,
  ) {
    world.deferredLighting = false;
    world.onCommittedBlocks = (changes) => {
      for (const change of changes) {
        this.blockDelta.set(`${change.x},${change.y},${change.z}`, {
          x: change.x, y: change.y, z: change.z, blockId: change.block,
        });
        this.redstone.notifyBlockChanged(change.x, change.y, change.z);
        if (isFluidBlock(change.block) || isFluidBlock(change.previous)) {
          this.events.emit('fluidUpdate', {
            x: change.x, y: change.y, z: change.z, blockId: change.block,
          });
        }
      }
    };
    const visuals = new ItemVisualFactory();
    this.drops = new DroppedItemManager(this.scene, world, { visualFactory: visuals });
    this.falling = new FallingBlockManager(this.scene, world, visuals);
    this.mobs = new MobManager(this.scene, world);
    this.minecarts = new MinecartManager(this.scene, world, visuals);
    this.arrows = new PlayerArrowManager(this.scene, world, this.mobs, {
      minecarts: this.minecarts,
      onBlockHit: (x, y, z, flaming) => {
        if (flaming && flamingArrowBlockHit(this.world.getBlock(x, y, z, false)) === 'prime_tnt') {
          this.redstone.primeTnt(x, y, z);
        }
      },
      onMinecartHit: (cart, flaming) => {
        if (flaming && cart.variant === 'tnt') this.minecarts.explodeNow(cart);
      },
    });
    this.redstone = new RedstoneSystem(world, { root: this.scene });
  }

  consumeBlockChanges(): Array<{ x: number; y: number; z: number; blockId: number }> {
    const list = [...this.blockDelta.values()];
    this.blockDelta.clear();
    return list;
  }

  tick(players: readonly GameplayPlayer[], dt: number): GameplayMetrics {
    const started = performance.now();
    const connected = players.filter((player) => player.connected);
    const focus = connected[0]?.controller.position;
    if (focus) this.world.setViewCenter(focus.x, focus.z, 8);

    this.world.tick();
    for (const spawn of this.world.consumeFallingBlocks()) {
      this.falling.spawn(spawn.block, spawn.x, spawn.y, spawn.z);
    }
    this.falling.update(dt);
    this.processDetachedBlocks();
    this.arrows.tick(dt, {
      players: connected
        .filter((player) => player.gamemode === 'survival' && !player.survival.dead)
        .map((player) => ({ id: player.id, aabb: player.controller.aabb })),
      onPlayerHit: (playerId, damage, flaming, position) => {
        const victim = connected.find((player) => player.id === playerId);
        if (!victim) return;
        this.hurtPlayer(victim, damage, 'projectile', position, {
          knockback: flaming ? 4.2 : 2.4,
          ignite: flaming,
        });
      },
    });

    for (const player of connected) {
      if (player.gamemode === 'survival') {
        this.arrows.tryCollect(player.controller.aabb, {
          mode: player.gamemode,
          addItem: (itemId, count) => {
            const leftover = player.inventory.addItem(itemId, count);
            if (leftover < count) player.inventoryDirty = true;
            return leftover;
          },
        });
      }
      this.minecarts.tryPushFromPlayer(player.controller, player.ridingCartId);
    }

    const rider = connected.find((player) => player.ridingCartId);
    const ridingCart = rider?.ridingCartId ? this.minecarts.get(rider.ridingCartId) : undefined;
    const steer = Boolean(ridingCart && rider && this.minecarts.isOnRail(ridingCart));
    this.minecarts.update(dt, {
      riderId: rider?.ridingCartId,
      forward: steer ? rider!.vehicleForward : 0,
      riderYaw: rider?.controller.yaw,
    });
    for (const boom of this.minecarts.consumeExplosions()) {
      this.enqueueExplosion(boom.position.x, boom.position.y, boom.position.z, boom.radius, boom.power);
      for (const player of players) {
        if (player.ridingCartId === boom.id) player.ridingCartId = undefined;
      }
    }

    this.mobs.update(dt, {
      players: connected.map((player) => ({
        position: player.controller.position,
        eyePosition: player.controller.eyePosition(),
        alive: !player.survival.dead,
        targetable: player.gamemode === 'survival' && !player.survival.invisible,
      })),
      daylight: daylightFactor(this.world.timeOfDay),
    });
    for (const drop of this.mobs.consumeDrops()) {
      this.drops.spawn(drop.stack, drop.position, { velocity: drop.velocity });
    }
    for (const event of this.mobs.consumePlayerDamage()) {
      const victim = this.nearestSurvivalPlayer(connected, event.position);
      if (!victim) continue;
      const damageEvent = this.events.createPlayerDamage(victim.id, event.amount, event.source);
      this.events.emit('playerDamage', damageEvent);
      if (damageEvent.cancelled) continue;
      const result = victim.survival.damage(event.amount, event.source === 'arrow' ? 'projectile' : 'melee', {
        armor: victim.inventory,
      });
      if (result.fullHurt && event.source === 'melee') {
        victim.controller.receiveMeleeKnockback({
          x: victim.controller.position.x - event.position.x,
          z: victim.controller.position.z - event.position.z,
        });
      } else if (result.fullHurt && event.knockback) {
        victim.controller.velocity.add(event.knockback);
      }
      this.respawnIfDead(victim);
    }
    for (const boom of this.mobs.consumeExplosions()) {
      this.enqueueExplosion(boom.position.x, boom.position.y, boom.position.z, boom.radius, boom.power);
    }

    this.drops.update(dt);
    for (const player of connected) this.collectFor(player);
    this.updateRedstone(connected);
    this.processExplosions(connected);

    const elapsed = performance.now() - started;
    this.lastTickMs = elapsed;
    this.maxTickMs = Math.max(this.maxTickMs, elapsed);
    return {
      tickMs: elapsed,
      maxTickMs: this.maxTickMs,
      entities: this.drops.count + this.mobs.count + this.minecarts.count
        + this.arrows.count + this.falling.count + this.redstone.primedTntCount,
      blockChanges: this.blockDelta.size,
    };
  }

  collectFor(player: GameplayPlayer): void {
    if (player.survival.dead) return;
    this.drops.collectNearby(player.controller.position, (stack, entity) => {
      const event = this.events.createItemPickup(player.id, entity.id, stack.itemId, stack.count);
      this.events.emit('itemPickup', event);
      if (event.cancelled) return 0;
      const remainder = player.inventory.add(stack);
      const accepted = stack.count - (remainder?.count ?? 0);
      if (accepted > 0) player.inventoryDirty = true;
      return accepted;
    });
  }

  dropFromPlayer(player: GameplayPlayer, stack: ItemStack): void {
    const origin = player.controller.eyePosition();
    const event = this.events.createItemDrop(stack.itemId, stack.count, origin.x, origin.y, origin.z, player.id);
    this.events.emit('itemDrop', event);
    if (event.cancelled) return;
    this.drops.drop(stack, origin, player.controller.viewDirection());
  }

  spawnDroppedStack(stack: ItemStack, position: THREE.Vector3, playerId?: string): void {
    const event = this.events.createItemDrop(stack.itemId, stack.count, position.x, position.y, position.z, playerId);
    this.events.emit('itemDrop', event);
    if (event.cancelled) return;
    this.drops.spawn(stack, position, {
      velocity: new THREE.Vector3((Math.random() - 0.5) * 1.4, 2.2, (Math.random() - 0.5) * 1.4),
    });
  }

  snapshotsNear(origin: THREE.Vector3, passengers?: ReadonlyMap<string, string>): EntitySnapshot[] {
    const list: EntitySnapshot[] = [];
    const inRange = (x: number, y: number, z: number): boolean => {
      const dx = x - origin.x;
      const dy = y - origin.y;
      const dz = z - origin.z;
      return dx * dx + dy * dy + dz * dz <= INTEREST_SQ;
    };
    for (const item of this.drops.entities) {
      if (!inRange(item.position.x, item.position.y, item.position.z)) continue;
      list.push({
        id: item.id, kind: 'item',
        x: item.position.x, y: item.position.y, z: item.position.z,
        vx: item.velocity.x, vy: item.velocity.y, vz: item.velocity.z,
        itemId: item.stack.itemId, count: item.stack.count,
      });
    }
    for (const mob of this.mobs.entities) {
      if (!inRange(mob.position.x, mob.position.y, mob.position.z)) continue;
      list.push({
        id: mob.id, kind: 'mob',
        x: mob.position.x, y: mob.position.y, z: mob.position.z, yaw: mob.facingYaw,
        vx: mob.velocity.x, vy: mob.velocity.y, vz: mob.velocity.z,
        mobKind: mob.kind, health: mob.health, maxHealth: mob.definition.maxHealth,
        onFire: mob.isOnFire, hurt: mob.hurtFlashSeconds > 0, state: mob.state,
      });
    }
    for (const cart of this.minecarts.entities) {
      if (!inRange(cart.position.x, cart.position.y, cart.position.z)) continue;
      list.push({
        id: cart.id, kind: 'minecart',
        x: cart.position.x, y: cart.position.y, z: cart.position.z,
        yaw: cart.yaw, pitch: cart.pitch,
        vx: cart.velocity.x, vy: cart.velocity.y, vz: cart.velocity.z,
        variant: cart.variant, primed: cart.fuseTicks > 0, fuse: cart.fuseTicks,
        passengerId: passengers?.get(cart.id),
      });
    }
    for (const tnt of this.redstone.primedTnt) {
      if (!inRange(tnt.position.x, tnt.position.y, tnt.position.z)) continue;
      list.push({
        id: tnt.id, kind: 'tnt',
        x: tnt.position.x, y: tnt.position.y, z: tnt.position.z,
        vx: tnt.velocity.x, vy: tnt.velocity.y, vz: tnt.velocity.z,
        primed: true, fuse: tnt.fuseSeconds,
      });
    }
    for (const arrow of this.arrows.entities) {
      if (!inRange(arrow.position.x, arrow.position.y, arrow.position.z)) continue;
      list.push({
        id: arrow.id, kind: 'arrow',
        x: arrow.position.x, y: arrow.position.y, z: arrow.position.z,
        vx: arrow.velocity.x, vy: arrow.velocity.y, vz: arrow.velocity.z,
        onFire: arrow.flaming,
      });
    }
    for (const entity of this.falling.list) {
      if (!inRange(entity.position.x, entity.position.y, entity.position.z)) continue;
      list.push({
        id: entity.id, kind: 'falling',
        x: entity.position.x, y: entity.position.y, z: entity.position.z,
        vx: entity.velocity.x, vy: entity.velocity.y, vz: entity.velocity.z,
        blockId: entity.block,
      });
    }
    return list.slice(0, 96);
  }

  persistEntities(): Pick<WorldDiskState, 'droppedItems' | 'mobs' | 'minecarts' | 'fallingBlocks' | 'redstone' | 'chests' | 'furnaces'> {
    return {
      droppedItems: this.drops.serialize(),
      mobs: this.mobs.serialize(),
      minecarts: this.minecarts.serialize(),
      fallingBlocks: this.falling.serialize(),
      redstone: this.redstone.serialize(),
      chests: Object.fromEntries(this.world.chests),
      furnaces: Object.fromEntries(this.world.furnaces),
    };
  }

  restoreEntities(state: WorldDiskState): void {
    if (state.droppedItems?.length) this.drops.restore(state.droppedItems as never);
    if (state.mobs?.length) this.mobs.restore(state.mobs as never);
    if (state.minecarts?.length) this.minecarts.restore(state.minecarts as never);
    if (state.fallingBlocks?.length) this.falling.restore(state.fallingBlocks as never);
    if (state.redstone) this.redstone.restore(state.redstone as never);
  }

  applyInventory(player: GameplayPlayer, action: ClientInventoryActionMessage) {
    const chest = player.window.kind === 'chest' && player.window.x !== undefined
      ? this.world.getChest(player.window.x, player.window.y ?? 0, player.window.z ?? 0)
      : undefined;
    const furnace = player.window.kind === 'furnace' && player.window.x !== undefined
      ? this.world.getFurnace(player.window.x, player.window.y ?? 0, player.window.z ?? 0)
      : undefined;
    const state = {
      inventory: player.inventory,
      cursor: player.cursor,
      craftSlots: player.craftSlots,
      window: player.window,
      gamemode: player.gamemode,
      chest,
      furnace,
    };
    const result = applyInventoryUiAction(state, action);
    player.cursor = state.cursor;
    player.craftSlots = state.craftSlots;
    player.window = state.window;
    player.inventoryDirty = true;
    if (action.action === 'select' && action.slot !== undefined) player.selectedSlot = action.slot;
    for (const dropped of result.dropped) this.dropFromPlayer(player, dropped);
    if (result.crafted) {
      this.events.emit('craft', this.events.createCraft(
        player.id, result.crafted.itemId, result.crafted.count, result.crafted.recipeId,
      ));
    }
    return result;
  }

  breakBlock(player: GameplayPlayer, x: number, y: number, z: number): { ok: true } | { ok: false; reason: string } {
    if (!isValidWorldY(y) || !Number.isInteger(x) || !Number.isInteger(z)) return { ok: false, reason: 'bounds' };
    if (!this.inReach(player, x, y, z)) return { ok: false, reason: 'reach' };
    const block = this.world.getBlock(x, y, z);
    if (block === BlockId.Air) return { ok: false, reason: 'empty' };
    const definition = getBlockDefinition(block);
    if (definition.breakable === false) return { ok: false, reason: 'unbreakable' };
    if (player.gamemode === 'survival' && definition.hardness > 0) {
      const mining = player.miningTarget;
      if (!mining || mining.x !== x || mining.y !== y || mining.z !== z || player.miningProgress < 0.95) {
        return { ok: false, reason: 'mining' };
      }
    }
    const event = this.events.createBlockBreak(player.id, x, y, z, block);
    this.events.emit('blockBreak', event);
    if (event.cancelled) return { ok: false, reason: 'cancelled' };
    const harvestable = player.gamemode !== 'survival'
      || canHarvestBlock(definition, miningToolFromItemId(player.inventory.getSlot(player.selectedSlot)?.itemId));
    this.releaseContents(player, x, y, z, block);
    if (block === BlockId.OakDoor) this.removeDoor(x, y, z);
    else if (!this.world.setBlock(x, y, z, BlockId.Air)) return { ok: false, reason: 'rejected' };
    if (player.gamemode === 'survival' && harvestable && definition.drop) {
      const count = rollBlockDropCount(definition.drop);
      const extra = isSlabBlock(block) && defaultSlabType(this.world.getBlockState(x, y, z)) === 'double' ? count : 0;
      if (count + extra > 0) {
        this.spawnDroppedStack(createItemStack(definition.drop.item, count + extra), new THREE.Vector3(x + 0.5, y + 0.3, z + 0.5), player.id);
      }
    }
    if (player.gamemode === 'survival') {
      const tool = player.inventory.getSlot(player.selectedSlot);
      const item = tool ? tryGetItemDefinition(tool.itemId) : undefined;
      if (tool && (item?.kind === 'tool' || item?.kind === 'weapon')) {
        player.inventory.setSlot(player.selectedSlot, damageItem(tool, 1));
        player.inventoryDirty = true;
      }
      player.survival.addExhaustion(0.005);
    }
    player.miningProgress = 0;
    player.miningTarget = undefined;
    return { ok: true };
  }

  placeBlock(
    player: GameplayPlayer,
    x: number,
    y: number,
    z: number,
    requestedBlock?: number,
  ): { ok: true } | { ok: false; reason: string } {
    if (!isValidWorldY(y) || !Number.isInteger(x) || !Number.isInteger(z)) return { ok: false, reason: 'bounds' };
    if (!this.inReach(player, x, y, z)) return { ok: false, reason: 'reach' };
    const hit = this.lookHit(player);
    if (hit) {
      const replaceHit = getBlockDefinition(hit.block).replaceable === true;
      const px = replaceHit ? hit.x : Math.round(hit.x + hit.normal.x);
      const py = replaceHit ? hit.y : Math.round(hit.y + hit.normal.y);
      const pz = replaceHit ? hit.z : Math.round(hit.z + hit.normal.z);
      if (x !== px || y !== py || z !== pz) {
        if (Math.abs(x - hit.x) + Math.abs(y - hit.y) + Math.abs(z - hit.z) > 1) {
          return { ok: false, reason: 'look' };
        }
      }
    }
    return this.placeAt(player, x, y, z, requestedBlock, hit);
  }

  useHeld(player: GameplayPlayer): void {
    const origin = player.controller.eyePosition(this.tmpEye);
    const direction = player.controller.viewDirection(this.tmpDir);
    const hit = this.world.raycast(origin, direction, PLAYER_REACH);
    const cartRay = this.minecarts.raycast(origin, direction, PLAYER_REACH, player.ridingCartId);
    const stack = player.inventory.getSlot(player.selectedSlot);
    const item = stack ? tryGetItemDefinition(stack.itemId) : undefined;

    if (stack?.itemId === ItemId.Bucket) {
      pickupFluidSource({
        world: this.world, inventory: player.inventory, selectedSlot: player.selectedSlot,
        mode: player.gamemode, onDrop: (dropped) => this.dropFromPlayer(player, dropped),
      }, origin, direction, PLAYER_REACH);
      player.inventoryDirty = true;
      return;
    }
    if (hit) {
      const interact = this.events.createPlayerInteract(player.id, hit.x, hit.y, hit.z, hit.block);
      this.events.emit('playerInteract', interact);
      if (interact.cancelled) return;
      if (hit.block === BlockId.CraftingTable) {
        player.window = { kind: 'crafting-table', x: hit.x, y: hit.y, z: hit.z };
        player.craftSlots = Array.from({ length: 9 }, () => null);
        player.inventoryDirty = true;
        return;
      }
      if (hit.block === BlockId.Chest) {
        player.window = { kind: 'chest', x: hit.x, y: hit.y, z: hit.z };
        player.inventoryDirty = true;
        return;
      }
      if (hit.block === BlockId.Furnace) {
        player.window = { kind: 'furnace', x: hit.x, y: hit.y, z: hit.z };
        player.inventoryDirty = true;
        return;
      }
      if (hit.block === BlockId.Lever) { this.redstone.toggleLever(hit.x, hit.y, hit.z); return; }
      if (hit.block === BlockId.StoneButton) { this.redstone.pressButton(hit.x, hit.y, hit.z); return; }
      if (hit.block === BlockId.OakDoor) { this.toggleDoor(hit.x, hit.y, hit.z); return; }
      if (hit.block === BlockId.WhiteBed) {
        player.survival.setSpawnPoint([hit.x + 0.5, hit.y + 1.01, hit.z + 0.5]);
        if (this.world.timeOfDay > 12_500 && this.world.timeOfDay < 23_500) this.world.timeOfDay = 1_000;
        return;
      }
    }
    if (item?.kind === 'food') { player.foodUseTicks = 1; return; }
    if (stack?.itemId === ItemId.Bow) { player.bowUseTicks = 1; return; }

    const cartCloser = Boolean(cartRay && (!hit || cartRay.distance <= hit.distance));
    if (cartCloser && cartRay) {
      if (stack?.itemId === ItemId.FlintAndSteel) { this.useFlint(player, undefined); return; }
      if (stack?.itemId === 'tnt' && this.insertTntCart(player, undefined)) return;
      if (this.minecarts.isRideable(cartRay.cart)) this.enterVehicle(player, cartRay.cart.id);
      return;
    }
    if (stack?.itemId === ItemId.FlintAndSteel) { this.useFlint(player, hit); return; }
    if (stack?.itemId === 'tnt' && this.insertTntCart(player, hit)) return;
    if (stack?.itemId === ItemId.Minecart) { this.placeMinecart(player, hit); return; }
    if (stack?.itemId === ItemId.WaterBucket || stack?.itemId === ItemId.LavaBucket) {
      placeBucketFluid({
        world: this.world, inventory: player.inventory, selectedSlot: player.selectedSlot,
        mode: player.gamemode, onDrop: (dropped) => this.dropFromPlayer(player, dropped),
      }, hit);
      player.inventoryDirty = true;
      return;
    }
    if (hit && stack && item?.placesBlockId !== undefined) {
      const replaceHit = getBlockDefinition(hit.block).replaceable === true;
      this.placeAt(
        player,
        replaceHit ? hit.x : hit.x + hit.normal.x,
        replaceHit ? hit.y : hit.y + hit.normal.y,
        replaceHit ? hit.z : hit.z + hit.normal.z,
        item.placesBlockId,
        hit,
      );
    }
  }

  attack(player: GameplayPlayer, others: readonly GameplayPlayer[] = []): void {
    const origin = player.controller.eyePosition(this.tmpEye);
    const direction = player.controller.viewDirection(this.tmpDir);
    const blockHit = this.world.raycast(origin, direction, PLAYER_REACH);
    const cartHit = this.minecarts.raycast(origin, direction, PLAYER_REACH, player.ridingCartId);
    const mobHit = this.mobs.raycast(origin, direction, Math.min(3, PLAYER_REACH));
    const playerHit = this.raycastPlayers(player, others, origin, direction, Math.min(3, PLAYER_REACH));
    const playerCloser = playerHit
      && (!mobHit || playerHit.distance <= mobHit.distance)
      && (!cartHit || playerHit.distance <= cartHit.distance)
      && (!blockHit || playerHit.distance < blockHit.distance);
    if (playerCloser && playerHit) {
      this.meleePlayer(player, playerHit.player);
      return;
    }
    const attack = resolvePlayerAttackTarget(blockHit, cartHit, mobHit, player.ridingCartId);
    if (attack?.kind === 'mob' && mobHit) {
      const stack = player.inventory.getSlot(player.selectedSlot);
      const result = player.combat.performMeleeAttack(stack?.itemId ?? null, {
        critical: {
          fallDistance: player.controller.fallDistance,
          onGround: player.controller.onGround,
          sprinting: player.controller.sprinting,
          inWater: player.controller.inWater,
          onLadder: player.controller.onLadder,
          riding: Boolean(player.ridingCartId),
        },
        attackerSprinting: player.controller.sprinting,
        attackerYaw: player.controller.yaw,
      });
      const damageEvent = this.events.createEntityDamage(mobHit.mob.id, result.damage, 'melee');
      this.events.emit('entityDamage', damageEvent);
      if (damageEvent.cancelled) return;
      const accepted = this.mobs.damage(mobHit.mob, result.damage, {
        source: 'player',
        attackerPosition: player.controller.position,
        attackerYaw: result.attackerYaw,
        extraKnockbackLevel: result.extraKnockbackLevel,
      });
      completeMeleeAttack(result, accepted, player.controller);
      if (accepted && player.gamemode === 'survival') {
        if (stack && result.profile.durabilityCost > 0) {
          player.inventory.setSlot(player.selectedSlot, damageItem(stack, result.profile.durabilityCost));
          player.inventoryDirty = true;
        }
        player.survival.recordAttack();
      }
      if (!mobHit.mob.alive) {
        this.events.emit('entityDeath', { entityId: mobHit.mob.id, cause: 'melee', playerId: player.id });
      }
      return;
    }
    if (attack?.kind === 'minecart') {
      const broken = this.minecarts.breakCart(attack.cart, player.ridingCartId);
      if (!broken) return;
      for (const itemId of dropsForBrokenMinecart(player.gamemode, broken.items)) {
        this.spawnDroppedStack(createItemStack(itemId), broken.position.clone().add(new THREE.Vector3(0, 0.2, 0)), player.id);
      }
    }
  }

  advanceMining(player: GameplayPlayer): void {
    const hit = this.lookHit(player);
    if (!hit) {
      player.miningProgress = 0;
      player.miningTarget = undefined;
      return;
    }
    if (!player.miningTarget || player.miningTarget.x !== hit.x || player.miningTarget.y !== hit.y || player.miningTarget.z !== hit.z) {
      player.miningTarget = { x: hit.x, y: hit.y, z: hit.z };
      player.miningProgress = 0;
    }
    const definition = getBlockDefinition(hit.block);
    if (definition.breakable === false || definition.hardness < 0) return;
    player.miningProgress += player.gamemode === 'creative'
      ? 1
      : miningProgressPerTick(definition, miningToolFromItemId(player.inventory.getSlot(player.selectedSlot)?.itemId));
    if (player.miningProgress >= 1) this.breakBlock(player, hit.x, hit.y, hit.z);
  }

  advanceUseHold(player: GameplayPlayer, using: boolean): void {
    const stack = player.inventory.getSlot(player.selectedSlot);
    const item = stack ? tryGetItemDefinition(stack.itemId) : undefined;
    if (player.bowUseTicks > 0) {
      if (using && stack?.itemId === ItemId.Bow) player.bowUseTicks += 1;
      else {
        if (stack?.itemId === ItemId.Bow) this.releaseBow(player);
        player.bowUseTicks = 0;
      }
    }
    if (player.foodUseTicks <= 0) return;
    if (!using || item?.kind !== 'food' || !player.survival.canConsumeFood(item.id)) {
      player.foodUseTicks = 0;
      return;
    }
    player.foodUseTicks += 1;
    if (player.foodUseTicks >= 32) {
      if (player.survival.consumeFood(item, player.inventory)) player.inventoryDirty = true;
      player.foodUseTicks = 0;
    }
  }

  updateRiding(player: GameplayPlayer, sprint: boolean): void {
    const id = player.ridingCartId;
    if (!id) {
      player.lastSprint = sprint;
      return;
    }
    const cart = this.minecarts.get(id);
    if (!cart || !this.minecarts.isRideable(cart)) {
      player.ridingCartId = undefined;
      return;
    }
    const edge = minecartDismountFromSprint(sprint, player.lastSprint);
    player.lastSprint = edge.held;
    if (edge.dismount) {
      this.exitVehicle(player);
      return;
    }
    player.controller.position.set(cart.position.x, cart.position.y + 0.2, cart.position.z);
    player.controller.previousPosition.set(cart.previousPosition.x, cart.previousPosition.y + 0.2, cart.previousPosition.z);
    player.controller.velocity.copy(cart.velocity);
    player.controller.fallDistance = 0;
  }

  enterVehicle(player: GameplayPlayer, entityId: string): boolean {
    const cart = this.minecarts.get(entityId);
    if (!cart || !this.minecarts.isRideable(cart)) return false;
    const event = this.events.createVehicleEnter(player.id, entityId);
    this.events.emit('vehicleEnter', event);
    if (event.cancelled) return false;
    player.ridingCartId = entityId;
    cart.rider = true;
    player.controller.position.set(cart.position.x, cart.position.y + 0.2, cart.position.z);
    player.controller.velocity.set(0, 0, 0);
    return true;
  }

  exitVehicle(player: GameplayPlayer): void {
    const id = player.ridingCartId;
    if (!id) return;
    const event = this.events.createVehicleExit(player.id, id);
    this.events.emit('vehicleExit', event);
    if (event.cancelled) return;
    const cart = this.minecarts.get(id);
    player.ridingCartId = undefined;
    if (!cart) return;
    cart.rider = false;
    const exit = this.minecarts.findDismountPosition(cart);
    player.controller.position.copy(exit);
    player.controller.previousPosition.copy(exit);
    player.controller.velocity.set(0, 0, 0);
  }

  respawnIfDead(player: GameplayPlayer): void {
    if (!player.survival.dead) return;
    if (player.gamemode === 'survival') {
      for (const stack of player.inventory.slots) if (stack) this.dropFromPlayer(player, stack);
      for (const stack of Object.values(player.inventory.armor)) if (stack) this.dropFromPlayer(player, stack);
      if (player.inventory.offhand) this.dropFromPlayer(player, player.inventory.offhand);
      if (player.cursor) this.dropFromPlayer(player, player.cursor);
      for (const stack of player.craftSlots) if (stack) this.dropFromPlayer(player, stack);
      player.inventory.clear();
      player.cursor = null;
      player.craftSlots = player.craftSlots.map(() => null);
      player.inventoryDirty = true;
    }
    player.survival.respawn(player.controller, player.survival.spawnPoint);
  }

  private releaseBow(player: GameplayPlayer): void {
    const charge = player.combat.bowCharge(player.bowUseTicks);
    if (!charge.canFire) return;
    let flaming = false;
    if (player.gamemode === 'survival') {
      if (player.inventory.remove(ItemId.FireArrow, 1) === 1) flaming = true;
      else if (player.inventory.remove(ItemId.Arrow, 1) !== 1) return;
      player.inventoryDirty = true;
    } else flaming = player.inventory.has(ItemId.FireArrow, 1);
    const direction = player.controller.viewDirection();
    const origin = player.controller.eyePosition().addScaledVector(direction, 0.35);
    this.arrows.spawn(origin, direction, charge.launchSpeed, charge.baseDamage, charge.critical, flaming, undefined, player.id);
  }

  private lookHit(player: GameplayPlayer): VoxelHit | undefined {
    return this.world.raycast(
      player.controller.eyePosition(this.tmpEye),
      player.controller.viewDirection(this.tmpDir),
      PLAYER_NET_REACH,
    );
  }

  private inReach(player: GameplayPlayer, x: number, y: number, z: number): boolean {
    const eye = player.controller.eyePosition(this.tmpEye);
    const dx = eye.x - (x + 0.5);
    const dy = eye.y - (y + 0.5);
    const dz = eye.z - (z + 0.5);
    return dx * dx + dy * dy + dz * dz <= PLAYER_NET_REACH * PLAYER_NET_REACH;
  }

  private placeAt(
    player: GameplayPlayer,
    x: number,
    y: number,
    z: number,
    requestedBlock: number | undefined,
    hit?: VoxelHit,
  ): { ok: true } | { ok: false; reason: string } {
    if (!isValidWorldY(y)) return { ok: false, reason: 'bounds' };
    const existing = this.world.getBlock(x, y, z);
    const existingDef = getBlockDefinition(existing);
    if (existing !== BlockId.Air && existingDef.replaceable !== true) return { ok: false, reason: 'occupied' };
    let blockId: number | undefined;
    if (player.gamemode === 'creative' && requestedBlock !== undefined && isKnownBlockId(requestedBlock) && requestedBlock !== BlockId.Air) {
      blockId = requestedBlock;
    } else {
      const stack = player.inventory.getSlot(player.selectedSlot);
      blockId = stack ? tryGetItemDefinition(stack.itemId)?.placesBlockId : undefined;
      if (blockId === undefined) return { ok: false, reason: 'inventory' };
    }
    if (!isKnownBlockId(blockId) || blockId === BlockId.Air) return { ok: false, reason: 'block' };
    const placed = getBlockDefinition(blockId);
    if (placed.solid !== false && player.controller.intersectsBlock(x, y, z)) return { ok: false, reason: 'collision' };
    const event = this.events.createBlockPlace(player.id, x, y, z, blockId);
    this.events.emit('blockPlace', event);
    if (event.cancelled) return { ok: false, reason: 'cancelled' };
    if (blockId === BlockId.OakDoor) this.placeDoor(player, x, y, z);
    else if (!this.world.setBlock(x, y, z, blockId)) return { ok: false, reason: 'rejected' };
    else this.applyPlacementState(player, x, y, z, blockId, hit);
    if (player.gamemode === 'survival') {
      const stack = player.inventory.getSlot(player.selectedSlot);
      if (!stack) {
        this.world.setBlock(x, y, z, existing);
        return { ok: false, reason: 'inventory' };
      }
      player.inventory.setSlot(player.selectedSlot, stack.count <= 1 ? null : { ...stack, count: stack.count - 1 });
      player.inventoryDirty = true;
    }
    return { ok: true };
  }

  private applyPlacementState(player: GameplayPlayer, x: number, y: number, z: number, blockId: number, hit?: VoxelHit): void {
    const normal = hit && getBlockDefinition(hit.block).replaceable === true
      ? new THREE.Vector3(0, 1, 0)
      : hit?.normal ?? new THREE.Vector3(0, 1, 0);
    if (blockId === BlockId.Lantern) {
      const orientation = lanternPlacementFromHit(normal.x, normal.y, normal.z);
      if (orientation) this.world.setBlockState(x, y, z, { attachment: orientation.attachment });
    } else if (blockId === BlockId.Chain) {
      this.world.setBlockState(x, y, z, { attachment: normal.y < -0.5 ? 'ceiling' : 'floor' });
    } else if (blockId === BlockId.Torch || blockId === BlockId.RedstoneTorch) {
      const view = player.controller.viewDirection();
      const orientation = torchPlacementFromHit(normal.x, normal.y, normal.z, view.x, view.z);
      if (orientation) this.world.setBlockState(x, y, z, orientation);
    } else if (blockId === BlockId.StoneButton) {
      const view = player.controller.viewDirection();
      const orientation = buttonPlacementFromHit(normal.x, normal.y, normal.z, view.x, view.z);
      this.redstone.setButtonOrientation(x, y, z, orientation.attachment, orientation.facing);
    } else if (blockId === BlockId.Ladder && hit) {
      const orientation = ladderPlacementFromHit(hit.normal.x, hit.normal.y, hit.normal.z);
      if (orientation) this.world.setBlockState(x, y, z, { facing: orientation.facing });
    } else if (isSlabBlock(blockId) && hit) {
      const localY = hit.point ? hit.point.y - hit.y : 0.25;
      this.world.setBlockState(x, y, z, { slabType: slabTypeFromHit(hit.normal.x, hit.normal.y, hit.normal.z, localY) });
    } else if (isStairBlock(blockId) && hit) {
      const view = player.controller.viewDirection();
      const localY = hit.point ? hit.point.y - hit.y : 0.25;
      const placement = stairPlacementFromHit(hit.normal.x, hit.normal.y, hit.normal.z, localY, view.x, view.z);
      this.world.setBlockState(x, y, z, { facing: placement.facing, stairHalf: placement.stairHalf });
    } else if (blockId === BlockId.Chest) {
      this.world.setBlockState(x, y, z, { facing: chestFacingFromYaw(player.controller.yaw) });
    } else if (blockId === BlockId.Furnace) {
      this.world.setBlockState(x, y, z, { facing: furnaceFacingFromYaw(player.controller.yaw) });
    } else if (isRailBlock(blockId)) {
      this.world.setBlockState(x, y, z, { railShape: isolatedRailShapeFromYaw(player.controller.yaw) });
      this.refreshRails(x, y, z);
    } else if (blockId === BlockId.Lever) {
      const view = player.controller.viewDirection();
      const orientation = buttonPlacementFromHit(normal.x, normal.y, normal.z, view.x, view.z);
      this.redstone.setLeverOrientation(x, y, z, orientation.attachment, orientation.facing);
    }
  }

  private placeDoor(player: GameplayPlayer, x: number, y: number, z: number): void {
    if (y + 1 >= WORLD_HEIGHT) return;
    if (!this.world.setBlock(x, y, z, BlockId.OakDoor)) return;
    if (!this.world.setBlock(x, y + 1, z, BlockId.OakDoor)) {
      this.world.setBlock(x, y, z, BlockId.Air);
      return;
    }
    const facing = doorFacingFromYaw(player.controller.yaw);
    this.world.setBlockState(x, y, z, { facing, hinge: 'left', open: false, half: 'lower' });
    this.world.setBlockState(x, y + 1, z, { facing, hinge: 'left', open: false, half: 'upper' });
  }

  private toggleDoor(x: number, y: number, z: number): void {
    const { lowerY, upperY } = this.doorHalves(x, y, z);
    const current = this.world.getBlockState(x, lowerY, z) ?? this.world.getBlockState(x, y, z);
    const next = { facing: current?.facing ?? 'north', hinge: current?.hinge ?? 'left' as const, open: current?.open !== true };
    this.world.setBlockState(x, lowerY, z, { ...next, half: 'lower' });
    if (this.world.getBlock(x, upperY, z, false) === BlockId.OakDoor) {
      this.world.setBlockState(x, upperY, z, { ...next, half: 'upper' });
    }
  }

  private removeDoor(x: number, y: number, z: number): void {
    const { lowerY, upperY } = this.doorHalves(x, y, z);
    this.world.setBlock(x, lowerY, z, BlockId.Air);
    if (this.world.getBlock(x, upperY, z, false) === BlockId.OakDoor) this.world.setBlock(x, upperY, z, BlockId.Air);
  }

  private doorHalves(x: number, y: number, z: number): { lowerY: number; upperY: number } {
    const half = this.world.getBlockState(x, y, z)?.half
      ?? (this.world.getBlock(x, y - 1, z, false) === BlockId.OakDoor ? 'upper' : 'lower');
    const lowerY = half === 'upper' ? y - 1 : y;
    return { lowerY, upperY: lowerY + 1 };
  }

  private useFlint(player: GameplayPlayer, hit: VoxelHit | undefined): void {
    const cart = this.minecarts.handleFlintUse(
      player.controller.eyePosition(), player.controller.viewDirection(), PLAYER_REACH, player.ridingCartId,
    );
    const action = resolveFlintAndSteelUse(cart, hit);
    if (action.type === 'prime-cart' || action.type === 'already-primed') {
      if (action.wear && player.gamemode === 'survival') this.wearHeld(player);
      return;
    }
    if (action.type === 'prime-tnt-block') {
      this.redstone.primeTnt(action.x, action.y, action.z);
      if (action.wear && player.gamemode === 'survival') this.wearHeld(player);
      return;
    }
    if (action.type === 'ignite-cell' && isValidWorldY(action.y)) {
      const dest = this.world.getBlock(action.x, action.y, action.z);
      if (dest !== BlockId.Air && !getBlockDefinition(dest).replaceable) return;
      this.world.setBlock(action.x, action.y, action.z, BlockId.Fire);
      if (player.gamemode === 'survival') this.wearHeld(player);
    }
  }

  private wearHeld(player: GameplayPlayer): void {
    const stack = player.inventory.getSlot(player.selectedSlot);
    if (!stack) return;
    player.inventory.setSlot(player.selectedSlot, damageItem(stack, 1));
    player.inventoryDirty = true;
  }

  private insertTntCart(player: GameplayPlayer, hit: VoxelHit | undefined): boolean {
    const origin = player.controller.eyePosition();
    const direction = player.controller.viewDirection();
    const cart = this.minecarts.raycast(origin, direction, PLAYER_REACH, player.ridingCartId)?.cart
      ?? (hit ? this.minecarts.cartAt(hit.x, hit.y, hit.z) : this.minecarts.nearest(player.controller.position, 1.6));
    if (!cart || !this.minecarts.insertTnt(cart)) return false;
    if (player.gamemode === 'survival') {
      const stack = player.inventory.getSlot(player.selectedSlot);
      if (stack) player.inventory.setSlot(player.selectedSlot, stack.count <= 1 ? null : { ...stack, count: stack.count - 1 });
      player.inventoryDirty = true;
    }
    if (player.ridingCartId === cart.id) player.ridingCartId = undefined;
    return true;
  }

  private placeMinecart(player: GameplayPlayer, hit: VoxelHit | undefined): void {
    if (!hit) return;
    const replace = getBlockDefinition(hit.block).replaceable === true;
    const spawned = this.minecarts.spawn(
      replace ? hit.x : hit.x + hit.normal.x,
      replace ? hit.y : hit.y + hit.normal.y,
      replace ? hit.z : hit.z + hit.normal.z,
    );
    if (!spawned) return;
    if (player.gamemode === 'survival') {
      const stack = player.inventory.getSlot(player.selectedSlot);
      if (stack) player.inventory.setSlot(player.selectedSlot, stack.count <= 1 ? null : { ...stack, count: stack.count - 1 });
      player.inventoryDirty = true;
    }
  }

  private refreshRails(x: number, y: number, z: number): void {
    for (const [cx, cy, cz] of [
      [x, y, z], [x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1],
    ] as const) {
      if (this.world.getBlock(cx, cy, cz, false) !== BlockId.Rail) continue;
      this.world.setBlockState(cx, cy, cz, { railShape: resolveRailShape(this.world, cx, cy, cz) });
    }
  }

  private releaseContents(player: GameplayPlayer, x: number, y: number, z: number, block: number): void {
    const key = blockKey(x, y, z);
    if (block === BlockId.Chest) {
      const chest = this.world.chests.get(key);
      if (chest) for (const stack of chest.slots) if (stack) this.spawnDroppedStack(stack, new THREE.Vector3(x + 0.5, y + 0.6, z + 0.5), player.id);
      this.world.chests.delete(key);
    } else if (block === BlockId.Furnace) {
      const furnace = this.world.furnaces.get(key);
      if (furnace) for (const stack of furnace.slots) if (stack) this.spawnDroppedStack(stack, new THREE.Vector3(x + 0.5, y + 0.6, z + 0.5), player.id);
      this.world.furnaces.delete(key);
    }
  }

  private processDetachedBlocks(): void {
    const events = this.world.consumeDetachedBlocks();
    if (events.length) this.redstone.notifyBlocksChanged(events);
    for (const event of events) {
      const drop = getBlockDefinition(event.block).drop;
      if (!drop || event.reason === 'lava') continue;
      const count = rollBlockDropCount(drop);
      if (count > 0) {
        this.spawnDroppedStack(createItemStack(drop.item, count), new THREE.Vector3(event.x + 0.5, event.y + 0.3, event.z + 0.5));
      }
    }
  }

  private updateRedstone(players: readonly GameplayPlayer[]): void {
    const occupied = new Set<string>();
    const occupy = (positions: readonly Readonly<THREE.Vector3>[]): void => {
      for (const position of positions) {
        const x = Math.floor(position.x);
        const z = Math.floor(position.z);
        const feetY = Math.floor(position.y + 0.05);
        for (const y of [feetY, feetY - 1]) {
          if (!isPressurePlateBlock(this.world.getBlock(x, y, z))) continue;
          const key = blockKey(x, y, z);
          if (occupied.has(key)) continue;
          occupied.add(key);
          this.redstone.setPressurePlateOccupied(x, y, z, true);
        }
      }
    };
    occupy(players.map((player) => player.controller.position));
    occupy(this.mobs.entities.map((mob) => mob.position));
    occupy(this.drops.entities.map((drop) => drop.position));
    for (const key of this.activePressurePlates) {
      if (occupied.has(key)) continue;
      const [x, y, z] = key.split(',').map(Number) as [number, number, number];
      this.redstone.setPressurePlateOccupied(x, y, z, false);
    }
    this.activePressurePlates = occupied;
    this.redstone.update(FIXED_DT);
    for (const event of this.redstone.consumeExplosionEvents()) {
      this.enqueueExplosion(event.position.x, event.position.y, event.position.z, event.radius, event.power);
    }
  }

  private enqueueExplosion(x: number, y: number, z: number, radius: number, power: number): void {
    const event = this.events.createExplosion(x, y, z, radius, power);
    this.events.emit('explosion', event);
    if (event.cancelled) return;
    this.explosions.enqueue({ x, y, z, radius, power });
  }

  private processExplosions(players: readonly GameplayPlayer[]): void {
    if (this.explosions.pendingCount === 0) return;
    this.explosions.process(this.world, {
      budgetMs: 3.5, maxJobs: 12, maxVoxels: 512,
      remainingPrimedCapacity: this.redstone.primedCapacityRemaining,
      onResolved: (job) => this.applyExplosionDamage(players, job.x, job.y, job.z, job.radius, job.power),
      onChainedTnt: (tnt) => {
        this.redstone.primeTnt(tnt.x, tnt.y, tnt.z, tnt.fuseSeconds, { blockAlreadyRemoved: true });
      },
    });
  }

  private applyExplosionDamage(
    players: readonly GameplayPlayer[],
    originX: number, originY: number, originZ: number, radius: number, power: number,
  ): void {
    for (const player of players) {
      if (player.gamemode !== 'survival') continue;
      const dx = player.controller.position.x - originX;
      const dy = player.controller.position.y + player.controller.height * 0.5 - originY;
      const dz = player.controller.position.z - originZ;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const exposure = clamp(1 - distance / (radius * 1.7), 0, 1);
      if (exposure <= 0) continue;
      player.survival.damage(Math.ceil(exposure * power * 5), 'explosion', { armor: player.inventory });
      const lengthSq = dx * dx + dy * dy + dz * dz;
      if (lengthSq > 1e-6) {
        const inverse = 1 / Math.sqrt(lengthSq);
        player.controller.velocity.x += dx * inverse * exposure * 8;
        player.controller.velocity.y += dy * inverse * exposure * 8 + exposure * 4;
        player.controller.velocity.z += dz * inverse * exposure * 8;
      }
      this.respawnIfDead(player);
    }
    const origin = new THREE.Vector3(originX, originY, originZ);
    for (const mob of this.mobs.entities) {
      const exposure = clamp(1 - mob.position.distanceTo(origin) / (radius * 1.5), 0, 1);
      if (exposure > 0) {
        this.mobs.damage(mob, exposure * power * 5, {
          source: 'explosion', attackerPosition: origin, knockback: exposure * 8,
        });
      }
    }
  }

  private nearestSurvivalPlayer(players: readonly GameplayPlayer[], position: THREE.Vector3): GameplayPlayer | undefined {
    let best: GameplayPlayer | undefined;
    let bestDistance = 4;
    for (const player of players) {
      if (player.gamemode !== 'survival' || player.survival.dead) continue;
      const distance = player.controller.position.distanceTo(position);
      if (distance < bestDistance) {
        best = player;
        bestDistance = distance;
      }
    }
    return best;
  }

  private raycastPlayers(
    attacker: GameplayPlayer,
    others: readonly GameplayPlayer[],
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ): { player: GameplayPlayer; distance: number } | undefined {
    let closest: { player: GameplayPlayer; distance: number } | undefined;
    for (const other of others) {
      if (other.id === attacker.id || !other.connected || other.survival.dead) continue;
      if (other.gamemode !== 'survival') continue;
      const hit = rayAabbDistance(origin, direction, other.controller.aabb);
      if (!hit || hit.distance < 0 || hit.distance > maxDistance) continue;
      if (closest && hit.distance >= closest.distance) continue;
      closest = { player: other, distance: hit.distance };
    }
    return closest;
  }

  private meleePlayer(attacker: GameplayPlayer, victim: GameplayPlayer): void {
    const stack = attacker.inventory.getSlot(attacker.selectedSlot);
    const result = attacker.combat.performMeleeAttack(stack?.itemId ?? null, {
      critical: {
        fallDistance: attacker.controller.fallDistance,
        onGround: attacker.controller.onGround,
        sprinting: attacker.controller.sprinting,
        inWater: attacker.controller.inWater,
        onLadder: attacker.controller.onLadder,
        riding: Boolean(attacker.ridingCartId),
      },
      attackerSprinting: attacker.controller.sprinting,
      attackerYaw: attacker.controller.yaw,
    });
    const accepted = this.hurtPlayer(victim, result.damage, 'melee', attacker.controller.position, {
      extraKnockbackLevel: result.extraKnockbackLevel,
      attackerYaw: result.attackerYaw,
    });
    completeMeleeAttack(result, accepted, attacker.controller);
    if (accepted && attacker.gamemode === 'survival') {
      if (stack && result.profile.durabilityCost > 0) {
        attacker.inventory.setSlot(attacker.selectedSlot, damageItem(stack, result.profile.durabilityCost));
        attacker.inventoryDirty = true;
      }
      attacker.survival.recordAttack();
    }
  }

  private hurtPlayer(
    victim: GameplayPlayer,
    amount: number,
    cause: 'melee' | 'projectile',
    from: THREE.Vector3,
    extras: {
      readonly knockback?: number;
      readonly extraKnockbackLevel?: number;
      readonly attackerYaw?: number;
      readonly ignite?: boolean;
    } = {},
  ): boolean {
    if (victim.gamemode !== 'survival' || victim.survival.dead) return false;
    const event = this.events.createPlayerDamage(victim.id, amount, cause);
    this.events.emit('playerDamage', event);
    if (event.cancelled) return false;
    const result = victim.survival.damage(amount, cause, {
      armor: victim.inventory,
      swordBlocking: victim.combat.swordBlocking,
    });
    if (!result.accepted) return false;
    if (extras.ignite) victim.survival.igniteFromArrow();
    if (result.fullHurt) {
      if (cause === 'melee') {
        victim.controller.receiveMeleeKnockback({
          x: victim.controller.position.x - from.x,
          z: victim.controller.position.z - from.z,
        });
      } else if (extras.knockback) {
        const dx = victim.controller.position.x - from.x;
        const dz = victim.controller.position.z - from.z;
        const length = Math.hypot(dx, dz) || 1;
        victim.controller.velocity.x += (dx / length) * extras.knockback;
        victim.controller.velocity.z += (dz / length) * extras.knockback;
      }
      if (extras.extraKnockbackLevel) {
        applyExtraKnockback(victim.controller.velocity, extras.attackerYaw ?? 0, extras.extraKnockbackLevel);
      }
    }
    this.respawnIfDead(victim);
    return true;
  }
}
