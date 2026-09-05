import { Vec3, type Vec3Like } from '../src/math/vec3';
import {
  BlockId,
  getBlockDefinition,
  isPressurePlateBlock,
  isSlabBlock,
  miningProgressPerTick,
  miningToolFromItemId,
  canHarvestBlock,
  type BlockRenderState,
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
  FIXED_DT,
  PLAYER_NET_REACH,
  PLAYER_REACH,
  blockKey,
  clamp,
  isValidWorldY,
} from '../src/core/constants';
import {
  clearDoorBlocks,
  daylightFactor,
  dropScatterVelocity,
  performUseHeld,
  placeBlockAt,
  rollBlockDropCount,
  systemRandomFn,
  tickGameplayKernel,
  type UseSimulationContext,
} from '../src/gameplay';
import {
  DroppedItemManager,
  FallingBlockManager,
  HeadlessEntityHost,
  MinecartManager,
  MobManager,
  dropsForBrokenMinecart,
  minecartDismountFromSprint,
} from '../src/entities';
import { Inventory, createItemStack, damageItem, type ItemStack } from '../src/inventory';
import { applyInventoryUiAction, type InventoryWindow } from '../src/inventory/inventoryUiAction';
import { ItemId, tryGetItemDefinition } from '../src/items';
import { FarmingSystem, farmingDropsForBlock } from '../src/farming';
import { PlayerController } from '../src/player';
import { RedstoneSystem } from '../src/redstone';
import {
  defaultSlabType,
} from '../src/world/blockGeometry';
import { SurvivalSystem } from '../src/survival';
import { ExplosionQueue } from '../src/world/ExplosionQueue';
import { isFluidBlock } from '../src/world/fluids';
import type { VoxelHit, VoxelWorld } from '../src/world/World';
import { rayAabbDistance } from '../src/world/collision';
import type { ClientInputMessage, ClientInventoryActionMessage, EntitySnapshot, GameMode, NetworkEntityEvent } from '../shared/protocol';
import type { BlockTargetIntent } from '../shared/playerActions';
import type { ActionPoseSample } from '../shared/actionPoseHistory';
import { resolveActionEye } from '../shared/actionPoseHistory';
import { viewDirectionFromLook } from '../src/player/localAim';
import {
  validateBlockTargetIntent,
  type ActionEye,
} from '../src/gameplay/actionValidation';
import type { EventBus } from './events';
import { bowDebug } from './log';
import type { WorldSnapshot } from '../src/save/types';

export const ENTITY_INTEREST_RADIUS = 48;
const INTEREST_SQ = ENTITY_INTEREST_RADIUS * ENTITY_INTEREST_RADIUS;
export const ENTITY_SNAPSHOT_CAP = 96;

export function packEntitySnapshots(
  groups: {
    readonly arrows?: readonly EntitySnapshot[];
    readonly tnt?: readonly EntitySnapshot[];
    readonly falling?: readonly EntitySnapshot[];
    readonly minecarts?: readonly EntitySnapshot[];
    readonly mobs?: readonly EntitySnapshot[];
    readonly items?: readonly EntitySnapshot[];
  },
  cap = ENTITY_SNAPSHOT_CAP,
): EntitySnapshot[] {
  return [
    ...(groups.arrows ?? []),
    ...(groups.tnt ?? []),
    ...(groups.falling ?? []),
    ...(groups.minecarts ?? []),
    ...(groups.mobs ?? []),
    ...(groups.items ?? []),
  ].slice(0, cap);
}

export { daylightFactor, rollBlockDropCount } from '../src/gameplay';

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
  lastInput?: ClientInputMessage;
  appliedCommandSeq?: number;
  actionPoseHistory?: ActionPoseSample[];
}

export interface GameplayMetrics {
  tickMs: number;
  maxTickMs: number;
  entities: number;
  blockChanges: number;
}

export class ServerGameplay {
  readonly host = new HeadlessEntityHost();
  readonly drops: DroppedItemManager;
  readonly falling: FallingBlockManager;
  readonly mobs: MobManager;
  readonly minecarts: MinecartManager;
  readonly arrows: PlayerArrowManager;
  readonly redstone: RedstoneSystem;
  readonly farming: FarmingSystem;
  readonly explosions = new ExplosionQueue();
  readonly random = systemRandomFn;
  lastTickMs = 0;
  maxTickMs = 0;
  private readonly blockDelta = new Map<string, { x: number; y: number; z: number; blockId: number }>();
  private activePressurePlates = new Set<string>();
  private readonly tmpEye = new Vec3();
  private readonly tmpDir = new Vec3();
  private readonly pendingEntityEvents: NetworkEntityEvent[] = [];

  constructor(
    readonly world: VoxelWorld,
    readonly events: EventBus,
    private readonly flushPlayerLife?: (player: GameplayPlayer) => void,
  ) {
    world.deferredLighting = false;
    world.onCommittedBlocks = (changes) => {
      for (const change of changes) {
        this.noteBlockDelta(change.x, change.y, change.z, change.block);
        this.redstone.notifyBlockChanged(change.x, change.y, change.z);
        if (isFluidBlock(change.block) || isFluidBlock(change.previous)) {
          this.events.emit('fluidUpdate', {
            x: change.x, y: change.y, z: change.z, blockId: change.block,
          });
        }
      }
    };
    world.onCommittedBlockState = (change) => {
      this.noteBlockDelta(change.x, change.y, change.z, change.block);
    };
    const host = this.host;
    this.drops = new DroppedItemManager(host, world);
    this.falling = new FallingBlockManager(host, world);
    this.mobs = new MobManager(host, world, {
      random: this.random,
      onHurt: (mob) => this.pushEntityEvent(mob.id, 'hurt'),
      onDeath: (mob) => this.pushEntityEvent(mob.id, 'death'),
      onProjectileSpawn: (event) => this.pushEntityEvent(event.projectileId, 'projectile_spawn'),
      onProjectileRemove: (id) => this.pushEntityEvent(id, 'projectile_hit'),
    });
    this.minecarts = new MinecartManager(host, world);
    this.arrows = new PlayerArrowManager(host, world, this.mobs, {
      minecarts: this.minecarts,
      random: this.random,
      onBlockHit: (x, y, z, flaming) => {
        this.events.emit('projectileHit', { entityId: 'projectile', x, y, z });
        if (flaming && flamingArrowBlockHit(this.world.getBlock(x, y, z, false)) === 'prime_tnt') {
          this.redstone.primeTnt(x, y, z);
        }
      },
      onMinecartHit: (cart, flaming) => {
        if (flaming && cart.variant === 'tnt') this.minecarts.explodeNow(cart);
      },
      onSpawn: (id) => this.pushEntityEvent(id, 'projectile_spawn'),
      onRemove: (id) => this.pushEntityEvent(id, 'projectile_hit'),
    });
    this.redstone = new RedstoneSystem(world);
    this.farming = new FarmingSystem(world, { random: this.random });
  }

  consumeBlockChanges(): Array<{ x: number; y: number; z: number; blockId: number; state?: BlockRenderState }> {
    const list: Array<{ x: number; y: number; z: number; blockId: number; state?: BlockRenderState }> = [];
    for (const pending of this.blockDelta.values()) {
      const blockId = this.world.getBlock(pending.x, pending.y, pending.z, false);
      const state = this.world.getBlockState(pending.x, pending.y, pending.z);
      list.push(state
        ? { x: pending.x, y: pending.y, z: pending.z, blockId, state }
        : { x: pending.x, y: pending.y, z: pending.z, blockId });
    }
    this.blockDelta.clear();
    return list;
  }

  private noteBlockDelta(x: number, y: number, z: number, blockId: number): void {
    this.blockDelta.set(`${x},${y},${z}`, { x, y, z, blockId });
  }

  consumeEntityEvents(): NetworkEntityEvent[] {
    const events = this.pendingEntityEvents.splice(0);
    return events;
  }

  private pushEntityEvent(entityId: string, kind: NetworkEntityEvent['kind']): void {
    this.pendingEntityEvents.push({ entityId, kind });
  }

  lookupEntity(id: string): { id: string; kind: 'mob' | 'minecart' | 'item' | 'falling' } | undefined {
    if (this.mobs.get(id)) return { id, kind: 'mob' };
    if (this.minecarts.get(id)) return { id, kind: 'minecart' };
    if (this.drops.get(id)) return { id, kind: 'item' };
    if (this.falling.get(id)) return { id, kind: 'falling' };
    return undefined;
  }

  tick(
    players: readonly GameplayPlayer[],
    dt: number,
    host: { readonly tickPlayers: () => void; readonly trace?: string[] },
  ): GameplayMetrics {
    const started = performance.now();
    const connected = players.filter((player) => player.connected);
    const focus = connected[0]?.controller.position;
    if (focus) this.world.setViewCenter(focus.x, focus.z, 8);

    tickGameplayKernel({
      tickWorld: () => {
        this.world.tick();
      },
      tickFarming: () => {
        this.farming.tick(connected.map((player) => ({
          x: player.controller.position.x,
          z: player.controller.position.z,
        })));
      },
      tickFalling: () => {
        for (const spawn of this.world.consumeFallingBlocks()) {
          this.falling.spawn(spawn.block, spawn.x, spawn.y, spawn.z);
        }
        this.falling.update(dt);
        this.processDetachedBlocks();
      },
      tickPlayers: () => {
        host.tickPlayers();
      },
      tickPlayerActions: () => {
        // Mining/use hold stay next to physics in WorldInstance.tickConnectedPlayers.
      },
      tickProjectiles: () => {
        this.arrows.tick(dt, {
          players: connected
            .filter((player) => player.gamemode === 'survival' && !player.survival.dead)
            .map((player) => ({ id: player.id, aabb: player.controller.aabb })),
          onPlayerHit: (playerId, damage, flaming, position) => {
            const victim = connected.find((player) => player.id === playerId);
            if (!victim) return;
            this.events.emit('projectileHit', {
              entityId: 'projectile',
              x: position.x,
              y: position.y,
              z: position.z,
              playerId,
            });
            this.hurtPlayer(victim, damage, 'projectile', position, {
              knockback: flaming ? 4.2 : 2.4,
              ignite: flaming,
            });
          },
        });
      },
      tickVehicles: () => {
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
      },
      tickMobs: () => {
        this.mobs.update(dt, {
          players: connected.map((player) => ({
            position: player.controller.position,
            eyePosition: player.controller.eyePosition(),
            alive: !player.survival.dead,
            targetable: player.gamemode === 'survival' && !player.survival.invisible,
          })),
          daylight: daylightFactor(this.world.timeOfDay),
        });
      },
      handleMobEvents: () => {
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
          this.events.emit('playerDamaged', { playerId: victim.id, amount: event.amount, cause: event.source });
          if (victim.survival.dead) {
            this.events.emit('entityDeath', { entityId: victim.id, cause: event.source, playerId: victim.id });
          }
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
      },
      tickPreDropSupport: () => {
        // Extra support after mid-tick explosions is a singleplayer-only pass.
      },
      tickDrops: () => {
        this.drops.update(dt);
        for (const player of connected) this.collectFor(player);
      },
      tickRedstone: () => {
        this.updateRedstone(connected);
      },
      processExplosions: () => {
        this.processExplosions(connected);
      },
    }, host.trace);

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

  spawnDroppedStack(stack: ItemStack, position: Vec3, playerId?: string): void {
    const event = this.events.createItemDrop(stack.itemId, stack.count, position.x, position.y, position.z, playerId);
    this.events.emit('itemDrop', event);
    if (event.cancelled) return;
    this.drops.spawn(stack, position, {
      velocity: new Vec3(...dropScatterVelocity(this.random)),
    });
  }

  snapshotsNear(origin: Vec3, passengers?: ReadonlyMap<string, string>): EntitySnapshot[] {
    const inRange = (x: number, y: number, z: number): boolean => {
      const dx = x - origin.x;
      const dy = y - origin.y;
      const dz = z - origin.z;
      return dx * dx + dy * dy + dz * dz <= INTEREST_SQ;
    };
    const arrows: EntitySnapshot[] = [];
    for (const arrow of this.arrows.entities) {
      if (!inRange(arrow.position.x, arrow.position.y, arrow.position.z)) continue;
      arrows.push({
        id: arrow.id, kind: 'arrow',
        x: arrow.position.x, y: arrow.position.y, z: arrow.position.z,
        vx: arrow.velocity.x, vy: arrow.velocity.y, vz: arrow.velocity.z,
        onFire: arrow.flaming,
      });
    }
    for (const projectile of this.mobs.networkProjectiles()) {
      if (!inRange(projectile.x, projectile.y, projectile.z)) continue;
      arrows.push({
        id: projectile.id, kind: 'arrow',
        x: projectile.x, y: projectile.y, z: projectile.z,
        vx: projectile.vx, vy: projectile.vy, vz: projectile.vz,
      });
    }
    const tnt: EntitySnapshot[] = [];
    for (const primed of this.redstone.primedTnt) {
      if (!inRange(primed.position.x, primed.position.y, primed.position.z)) continue;
      tnt.push({
        id: primed.id, kind: 'tnt',
        x: primed.position.x, y: primed.position.y, z: primed.position.z,
        vx: primed.velocity.x, vy: primed.velocity.y, vz: primed.velocity.z,
        primed: true, fuse: primed.fuseSeconds,
      });
    }
    const falling: EntitySnapshot[] = [];
    for (const entity of this.falling.list) {
      if (!inRange(entity.position.x, entity.position.y, entity.position.z)) continue;
      falling.push({
        id: entity.id, kind: 'falling',
        x: entity.position.x, y: entity.position.y, z: entity.position.z,
        vx: entity.velocity.x, vy: entity.velocity.y, vz: entity.velocity.z,
        blockId: entity.block,
      });
    }
    const minecarts: EntitySnapshot[] = [];
    for (const cart of this.minecarts.entities) {
      if (!inRange(cart.position.x, cart.position.y, cart.position.z)) continue;
      minecarts.push({
        id: cart.id, kind: 'minecart',
        x: cart.position.x, y: cart.position.y, z: cart.position.z,
        yaw: cart.yaw, pitch: cart.pitch,
        vx: cart.velocity.x, vy: cart.velocity.y, vz: cart.velocity.z,
        variant: cart.variant, primed: cart.fuseTicks > 0, fuse: cart.fuseTicks,
        passengerId: passengers?.get(cart.id),
      });
    }
    const mobs: EntitySnapshot[] = [];
    for (const mob of this.mobs.entities) {
      if (!inRange(mob.position.x, mob.position.y, mob.position.z)) continue;
      mobs.push({
        id: mob.id, kind: 'mob',
        x: mob.position.x, y: mob.position.y, z: mob.position.z, yaw: mob.facingYaw,
        vx: mob.velocity.x, vy: mob.velocity.y, vz: mob.velocity.z,
        mobKind: mob.kind, health: mob.health, maxHealth: mob.definition.maxHealth,
        onFire: mob.isOnFire, hurt: mob.hurtFlashSeconds > 0, state: mob.state,
      });
    }
    const items: EntitySnapshot[] = [];
    for (const item of this.drops.entities) {
      if (!inRange(item.position.x, item.position.y, item.position.z)) continue;
      items.push({
        id: item.id, kind: 'item',
        x: item.position.x, y: item.position.y, z: item.position.z,
        vx: item.velocity.x, vy: item.velocity.y, vz: item.velocity.z,
        itemId: item.stack.itemId, count: item.stack.count,
      });
    }
    return packEntitySnapshots({ arrows, tnt, falling, minecarts, mobs, items });
  }

  persistEntities(): Pick<
    WorldSnapshot,
    'droppedItems' | 'mobs' | 'minecarts' | 'fallingBlocks' | 'redstone' | 'chests' | 'furnaces'
  > {
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

  restoreEntities(state: Pick<
    WorldSnapshot,
    'droppedItems' | 'mobs' | 'minecarts' | 'fallingBlocks' | 'redstone'
  >): void {
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
    const blockState = this.world.getBlockState(x, y, z);
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
    this.events.emit('blockBroken', { playerId: player.id, x, y, z, blockId: block });
    if (player.gamemode === 'survival' && harvestable) {
      const farmingDrops = farmingDropsForBlock(block, blockState, this.random);
      if (farmingDrops !== undefined) {
        for (const drop of farmingDrops) if (drop.count > 0) {
          this.spawnDroppedStack(createItemStack(drop.item, drop.count), new Vec3(x + 0.5, y + 0.3, z + 0.5), player.id);
        }
      } else if (definition.drop) {
        const count = rollBlockDropCount(definition.drop, this.random);
        const extra = isSlabBlock(block) && defaultSlabType(blockState) === 'double' ? count : 0;
        if (count + extra > 0) {
          this.spawnDroppedStack(createItemStack(definition.drop.item, count + extra), new Vec3(x + 0.5, y + 0.3, z + 0.5), player.id);
        }
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
    intent?: BlockTargetIntent,
    commandSeq?: number,
  ): { ok: true } | { ok: false; reason: string } {
    if (player.survival.dead) return { ok: false, reason: 'dead' };
    if (!isValidWorldY(y) || !Number.isInteger(x) || !Number.isInteger(z)) return { ok: false, reason: 'bounds' };
    if (!intent && !this.inReach(player, x, y, z)) return { ok: false, reason: 'reach' };
    let hit: VoxelHit | undefined;
    if (intent) {
      const eye = this.intentEye(player, commandSeq);
      if (!eye.ok) return { ok: false, reason: eye.reason };
      const validated = validateBlockTargetIntent(this.world, eye.value, intent);
      if (!validated.ok) return { ok: false, reason: validated.reason };
      hit = validated.value.hit;
    } else {
      hit = this.lookHit(player);
    }
    return placeBlockAt(this.useContext(player, hit), x, y, z, requestedBlock, hit);
  }

  useHeld(
    player: GameplayPlayer,
    intent?: BlockTargetIntent,
    commandSeq?: number,
  ): { ok: true } | { ok: false; reason: string } {
    if (player.survival.dead) return { ok: false, reason: 'dead' };
    let hit: VoxelHit | undefined;
    if (intent) {
      const eye = this.intentEye(player, commandSeq);
      if (!eye.ok) return { ok: false, reason: eye.reason };
      const validated = validateBlockTargetIntent(this.world, eye.value, intent);
      if (!validated.ok) return { ok: false, reason: validated.reason };
      hit = validated.value.hit;
    } else {
      hit = this.lookHit(player);
    }
    const beforeBow = player.bowUseTicks;
    performUseHeld(this.useContext(player, hit));
    if (player.bowUseTicks > 0 && beforeBow === 0) {
      bowDebug(player.id, 'server_press', `charge=${player.bowUseTicks}`);
    }
    return { ok: true };
  }

  beginMining(
    player: GameplayPlayer,
    intent: BlockTargetIntent,
    commandSeq?: number,
  ): { ok: true } | { ok: false; reason: string } {
    if (player.survival.dead) return { ok: false, reason: 'dead' };
    const eye = this.intentEye(player, commandSeq);
    if (!eye.ok) return { ok: false, reason: eye.reason };
    const validated = validateBlockTargetIntent(this.world, eye.value, intent);
    if (!validated.ok) return { ok: false, reason: validated.reason };
    const hit = validated.value.hit;
    const definition = getBlockDefinition(hit.block);
    if (definition.breakable === false || definition.hardness < 0) {
      return { ok: false, reason: 'unbreakable' };
    }
    if (
      !player.miningTarget
      || player.miningTarget.x !== hit.x
      || player.miningTarget.y !== hit.y
      || player.miningTarget.z !== hit.z
    ) {
      player.miningTarget = { x: hit.x, y: hit.y, z: hit.z };
      player.miningProgress = 0;
    }
    return { ok: true };
  }

  validatePlayerIntent(
    player: GameplayPlayer,
    intent: BlockTargetIntent,
    commandSeq?: number,
  ): { ok: true } | { ok: false; reason: string } {
    const eye = this.intentEye(player, commandSeq);
    if (!eye.ok) return eye;
    const validated = validateBlockTargetIntent(this.world, eye.value, intent);
    if (!validated.ok) return { ok: false, reason: validated.reason };
    return { ok: true };
  }

  private useContext(player: GameplayPlayer, hit?: VoxelHit): UseSimulationContext {
    const gameplay = this;
    return {
      world: this.world,
      inventory: player.inventory,
      get selectedSlot() { return player.selectedSlot; },
      set selectedSlot(value) { player.selectedSlot = value; },
      gamemode: player.gamemode,
      reach: PLAYER_REACH,
      ...(hit ? { hit } : {}),
      eyePosition: () => player.controller.eyePosition(gameplay.tmpEye).clone(),
      viewDirection: () => player.controller.viewDirection(gameplay.tmpDir).clone(),
      get yaw() { return player.controller.yaw; },
      get position() { return player.controller.position; },
      intersectsBlock: (x, y, z) => player.controller.intersectsBlock(x, y, z),
      intersectsCollisionBoxes: (boxes) => player.controller.intersectsCollisionBoxes(boxes),
      get foodUseTicks() { return player.foodUseTicks; },
      set foodUseTicks(value) { player.foodUseTicks = value; },
      get bowUseTicks() { return player.bowUseTicks; },
      set bowUseTicks(value) { player.bowUseTicks = value; },
      get ridingCartId() { return player.ridingCartId; },
      set ridingCartId(value) { player.ridingCartId = value; },
      minecarts: this.minecarts,
      redstone: this.redstone,
      random: this.random,
      setSpawnPoint: (position) => player.survival.setSpawnPoint(position),
      allowInteract: (x, y, z, block) => {
        const event = gameplay.events.createPlayerInteract(player.id, x, y, z, block);
        gameplay.events.emit('playerInteract', event);
        return !event.cancelled;
      },
      allowPlace: (x, y, z, block) => {
        const event = gameplay.events.createBlockPlace(player.id, x, y, z, block);
        gameplay.events.emit('blockPlace', event);
        return !event.cancelled;
      },
      enterVehicle: (cartId) => gameplay.enterVehicle(player, cartId),
      effects: {
        openContainer: (kind, x, y, z) => {
          if (kind === 'crafting-table') {
            player.window = { kind: 'crafting-table', x, y, z };
            player.craftSlots = Array.from({ length: 9 }, () => null);
          } else if (kind === 'chest') {
            player.window = { kind: 'chest', x, y, z };
          } else {
            player.window = { kind: 'furnace', x, y, z };
          }
          player.inventoryDirty = true;
        },
        onInventoryChanged: () => { player.inventoryDirty = true; },
        dropOverflow: (stack) => gameplay.dropFromPlayer(player, stack),
        onPlaced: (x, y, z, blockId) => {
          gameplay.events.emit('blockPlaced', { playerId: player.id, x, y, z, blockId });
        },
      },
    };
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
      if (accepted) {
        this.events.emit('entityDamaged', { entityId: mobHit.mob.id, amount: result.damage, cause: 'melee' });
      }
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
        this.spawnDroppedStack(createItemStack(itemId), broken.position.clone().add(new Vec3(0, 0.2, 0)), player.id);
      }
    }
  }

  advanceMining(player: GameplayPlayer): void {
    const target = player.miningTarget;
    if (!target) return;
    const block = this.world.getBlock(target.x, target.y, target.z);
    if (block === BlockId.Air) {
      player.miningProgress = 0;
      player.miningTarget = undefined;
      return;
    }
    const definition = getBlockDefinition(block);
    if (definition.breakable === false || definition.hardness < 0) return;
    player.miningProgress += player.gamemode === 'creative'
      ? 1
      : miningProgressPerTick(definition, miningToolFromItemId(player.inventory.getSlot(player.selectedSlot)?.itemId));
    if (player.miningProgress >= 1) this.breakBlock(player, target.x, target.y, target.z);
  }

  advanceUseHold(player: GameplayPlayer, using: boolean): void {
    const stack = player.inventory.getSlot(player.selectedSlot);
    const item = stack ? tryGetItemDefinition(stack.itemId) : undefined;
    if (player.bowUseTicks > 0) {
      if (stack?.itemId !== ItemId.Bow) {
        bowDebug(player.id, 'draw_cancel', 'item');
        player.bowUseTicks = 0;
      } else {
        player.bowUseTicks += 1;
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
    this.flushPlayerLife?.(player);
    if (player.ridingCartId) this.exitVehicle(player);
    player.window = { kind: 'inventory' };
    player.miningTarget = undefined;
    player.miningProgress = 0;
    player.bowUseTicks = 0;
    player.foodUseTicks = 0;
    player.lastUse = false;
    player.lastSprint = false;
    if (player.lastInput) {
      player.lastInput = {
        ...player.lastInput,
        forward: 0,
        right: 0,
        jump: false,
        sneak: false,
        sprint: false,
        descend: false,
        flySprint: false,
        mining: false,
        use: false,
        vehicleForward: 0,
      };
    }
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
    this.flushPlayerLife?.(player);
  }

  releaseBowWithAim(
    player: GameplayPlayer,
    yaw: number,
    pitch: number,
  ): { ok: true; yaw: number; pitch: number } | { ok: false; reason: string } {
    if (player.survival.dead) return { ok: false, reason: 'dead' };
    const stack = player.inventory.getSlot(player.selectedSlot);
    if (stack?.itemId !== ItemId.Bow) return { ok: false, reason: 'item' };
    if (player.bowUseTicks <= 0) return { ok: false, reason: 'no-draw' };
    const charge = player.combat.bowCharge(player.bowUseTicks);
    bowDebug(player.id, 'server_fire', `charge=${player.bowUseTicks} canFire=${charge.canFire} yaw=${yaw.toFixed(4)} pitch=${pitch.toFixed(4)}`);
    player.bowUseTicks = 0;
    if (!charge.canFire) return { ok: false, reason: 'charge' };
    let flaming = false;
    if (player.gamemode === 'survival') {
      if (player.inventory.remove(ItemId.FireArrow, 1) === 1) flaming = true;
      else if (player.inventory.remove(ItemId.Arrow, 1) !== 1) return { ok: false, reason: 'ammo' };
      player.inventoryDirty = true;
    } else flaming = player.inventory.has(ItemId.FireArrow, 1);
    const direction = viewDirectionFromLook(yaw, pitch);
    const origin = player.controller.eyePosition().addScaledVector(direction, 0.35);
    this.arrows.spawn(origin, direction, charge.launchSpeed, charge.baseDamage, charge.critical, flaming, undefined, player.id, 0);
    bowDebug(player.id, 'arrow_spawn', `arrows=${this.arrows.count}`);
    return { ok: true, yaw, pitch };
  }

  private intentEye(
    player: GameplayPlayer,
    commandSeq?: number,
  ): { ok: true; value: ActionEye } | { ok: false; reason: string } {
    const current = this.actionEye(player);
    const resolved = resolveActionEye(
      player.actionPoseHistory ?? [],
      player.appliedCommandSeq ?? -1,
      current,
      commandSeq,
    );
    if (!resolved.ok) return resolved;
    return { ok: true, value: resolved.eye };
  }

  private actionEye(player: GameplayPlayer): ActionEye {
    const eye = player.controller.eyePosition(this.tmpEye);
    return { x: eye.x, y: eye.y, z: eye.z };
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

  private removeDoor(x: number, y: number, z: number): void {
    clearDoorBlocks(this.world, x, y, z);
  }

  private releaseContents(player: GameplayPlayer, x: number, y: number, z: number, block: number): void {
    const key = blockKey(x, y, z);
    if (block === BlockId.Chest) {
      const chest = this.world.chests.get(key);
      if (chest) for (const stack of chest.slots) if (stack) this.spawnDroppedStack(stack, new Vec3(x + 0.5, y + 0.6, z + 0.5), player.id);
      this.world.chests.delete(key);
    } else if (block === BlockId.Furnace) {
      const furnace = this.world.furnaces.get(key);
      if (furnace) for (const stack of furnace.slots) if (stack) this.spawnDroppedStack(stack, new Vec3(x + 0.5, y + 0.6, z + 0.5), player.id);
      this.world.furnaces.delete(key);
    }
  }

  private processDetachedBlocks(): void {
    const events = this.world.consumeDetachedBlocks();
    if (events.length) this.redstone.notifyBlocksChanged(events);
    for (const event of events) {
      if (event.reason === 'lava') continue;
      const farmingDrops = farmingDropsForBlock(event.block, event.state, this.random);
      if (farmingDrops !== undefined) {
        for (const drop of farmingDrops) if (drop.count > 0) {
          this.spawnDroppedStack(createItemStack(drop.item, drop.count), new Vec3(event.x + 0.5, event.y + 0.3, event.z + 0.5));
        }
        continue;
      }
      const drop = getBlockDefinition(event.block).drop;
      if (!drop) continue;
      const count = rollBlockDropCount(drop, this.random);
      if (count > 0) {
        this.spawnDroppedStack(createItemStack(drop.item, count), new Vec3(event.x + 0.5, event.y + 0.3, event.z + 0.5));
      }
    }
  }

  private updateRedstone(players: readonly GameplayPlayer[]): void {
    const occupied = new Set<string>();
    const occupy = (positions: readonly Readonly<Vec3>[]): void => {
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
      random: this.random,
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
    const origin = new Vec3(originX, originY, originZ);
    for (const mob of this.mobs.entities) {
      const exposure = clamp(1 - mob.position.distanceTo(origin) / (radius * 1.5), 0, 1);
      if (exposure > 0) {
        this.mobs.damage(mob, exposure * power * 5, {
          source: 'explosion', attackerPosition: origin, knockback: exposure * 8,
        });
      }
    }
  }

  private nearestSurvivalPlayer(players: readonly GameplayPlayer[], position: Vec3): GameplayPlayer | undefined {
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
    origin: Vec3,
    direction: Vec3,
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
      attackerId: attacker.id,
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
    from: Vec3,
    extras: {
      readonly knockback?: number;
      readonly extraKnockbackLevel?: number;
      readonly attackerYaw?: number;
      readonly ignite?: boolean;
      readonly attackerId?: string;
    } = {},
  ): boolean {
    if (victim.gamemode !== 'survival' || victim.survival.dead) return false;
    const event = this.events.createPlayerDamage(victim.id, amount, cause, extras.attackerId);
    this.events.emit('playerDamage', event);
    if (event.cancelled) return false;
    const result = victim.survival.damage(amount, cause, {
      armor: victim.inventory,
      swordBlocking: victim.combat.swordBlocking,
    });
    if (!result.accepted) return false;
    this.events.emit('playerDamaged', {
      playerId: victim.id,
      amount,
      cause,
      ...(extras.attackerId ? { attackerId: extras.attackerId } : {}),
    });
    if (victim.survival.dead) {
      this.events.emit('entityDeath', { entityId: victim.id, cause, playerId: victim.id });
    }
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
