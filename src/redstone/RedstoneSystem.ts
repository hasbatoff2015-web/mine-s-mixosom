import * as THREE from 'three';
import {
  BlockId,
  getBlockDefinition,
  isPressurePlateBlock,
  type BlockAttachment,
  type BlockRenderState,
  type HorizontalFacing,
} from '../blocks';
import { blockKey } from '../core/constants';
import { bindEntityLightReceiver, createEntityMaterial, applySampledEntityLight, worldDaylightUniform } from '../rendering/worldLighting';
import type { VoxelWorld } from '../world/World';
import { moveVoxelBody } from '../entities/voxelPhysics';
import type {
  RedstoneExplosionEvent,
  RedstoneSourceKind,
  RedstoneSourceSnapshot,
  RedstoneUpdateStats,
  SerializedPrimedTnt,
  SerializedRedstoneState,
} from './types';

const NEIGHBOURS = Object.freeze([
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
] as const);

interface MutableSourceState {
  readonly kind: RedstoneSourceKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  active: boolean;
  remainingSeconds: number;
  attachment: BlockAttachment;
  facing: HorizontalFacing;
}

export interface RedstoneSystemOptions {
  /** Optional scene/group that receives simple primed-TNT meshes. */
  readonly root?: THREE.Object3D;
  readonly maxSources?: number;
  readonly maxPrimedTnt?: number;
  readonly maxPropagationStepsPerUpdate?: number;
  readonly maxQueuedUpdates?: number;
  readonly buttonPulseSeconds?: number;
  readonly tntFuseSeconds?: number;
  readonly onTntPrimed?: (entity: Readonly<PrimedTnt>) => void;
  readonly onExplosion?: (event: RedstoneExplosionEvent) => void;
  readonly onSourceChanged?: (x: number, y: number, z: number) => void;
}

export class PrimedTnt {
  readonly position: THREE.Vector3;
  readonly previousPosition: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  fuseSeconds: number;
  readonly totalFuseSeconds: number;
  readonly visual?: THREE.Mesh;

  constructor(
    readonly id: string,
    position: Readonly<THREE.Vector3>,
    fuseSeconds: number,
    visual?: THREE.Mesh,
    velocity?: Readonly<THREE.Vector3>,
  ) {
    this.position = new THREE.Vector3(position.x, position.y, position.z);
    this.previousPosition = this.position.clone();
    this.velocity = velocity
      ? new THREE.Vector3(velocity.x, velocity.y, velocity.z)
      : new THREE.Vector3(0, 4, 0);
    this.fuseSeconds = fuseSeconds;
    this.totalFuseSeconds = fuseSeconds;
    this.visual = visual;
  }
}

/**
 * Small, bounded redstone simulation. Call `notifyBlockChanged` after placing or
 * removing redstone content; propagation then discovers connected dust lazily.
 */
export class RedstoneSystem {
  private readonly sources = new Map<string, MutableSourceState>();
  private readonly wirePower = new Map<string, number>();
  private readonly primedById = new Map<string, PrimedTnt>();
  private readonly dirtyQueue: string[] = [];
  private readonly dirtySet = new Set<string>();
  private readonly explosionEvents: RedstoneExplosionEvent[] = [];
  private readonly maxSources: number;
  private readonly maxPrimedTnt: number;
  private readonly maxPropagationStepsPerUpdate: number;
  private readonly maxQueuedUpdates: number;
  private readonly defaultButtonPulseSeconds: number;
  private readonly defaultTntFuseSeconds: number;
  private dirtyHead = 0;
  private tntIdCounter = 0;
  private tntGeometry?: THREE.BoxGeometry;
  private tntMaterial?: THREE.MeshBasicMaterial;
  private disposed = false;

  constructor(
    private readonly world: VoxelWorld,
    private readonly options: RedstoneSystemOptions = {},
  ) {
    this.maxSources = Math.max(1, Math.floor(options.maxSources ?? 2_048));
    this.maxPrimedTnt = Math.max(1, Math.floor(options.maxPrimedTnt ?? 64));
    this.maxPropagationStepsPerUpdate = Math.max(
      1,
      Math.floor(options.maxPropagationStepsPerUpdate ?? 512),
    );
    this.maxQueuedUpdates = Math.max(
      this.maxPropagationStepsPerUpdate,
      Math.floor(options.maxQueuedUpdates ?? 8_192),
    );
    this.defaultButtonPulseSeconds = Math.max(0.05, options.buttonPulseSeconds ?? 1);
    this.defaultTntFuseSeconds = Math.max(0.05, options.tntFuseSeconds ?? 4);
  }

  get sourceCount(): number {
    return this.sources.size;
  }

  get primedTntCount(): number {
    return this.primedById.size;
  }

  get pendingPropagation(): number {
    return this.dirtySet.size;
  }

  get primedTnt(): readonly PrimedTnt[] {
    return [...this.primedById.values()];
  }

  /** Registers/reconciles a changed coordinate and its six neighbours. */
  notifyBlockChanged(x: number, y: number, z: number): void {
    this.notifyBlocksChanged([{ x, y, z }]);
  }

  /** Dedupes coordinates and neighbours so one explosion does not enqueue the same cell hundreds of times. */
  notifyBlocksChanged(changes: ReadonlyArray<Readonly<{ x: number; y: number; z: number }>>): void {
    this.assertActive();
    for (const change of changes) {
      this.reconcileSource(change.x, change.y, change.z);
      this.enqueue(change.x, change.y, change.z);
      this.enqueueNeighbours(change.x, change.y, change.z);
    }
  }

  registerBlock(x: number, y: number, z: number): void {
    this.notifyBlockChanged(x, y, z);
  }

  /** Scans at most `maxBlocks` coordinates in a box, useful once after loading a chunk. */
  registerRegion(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    maxBlocks = this.maxQueuedUpdates,
  ): number {
    this.assertActive();
    let registered = 0;
    let scanned = 0;
    const fromX = Math.min(Math.floor(minX), Math.floor(maxX));
    const toX = Math.max(Math.floor(minX), Math.floor(maxX));
    const fromY = Math.min(Math.floor(minY), Math.floor(maxY));
    const toY = Math.max(Math.floor(minY), Math.floor(maxY));
    const fromZ = Math.min(Math.floor(minZ), Math.floor(maxZ));
    const toZ = Math.max(Math.floor(minZ), Math.floor(maxZ));
    const limit = Math.max(0, Math.floor(maxBlocks));
    for (let y = fromY; y <= toY && scanned < limit; y += 1) {
      for (let z = fromZ; z <= toZ && scanned < limit; z += 1) {
        for (let x = fromX; x <= toX && scanned < limit; x += 1) {
          scanned += 1;
          const block = this.world.getBlock(x, y, z);
          if (!this.isRelevantBlock(block)) continue;
          this.notifyBlockChanged(x, y, z);
          registered += 1;
        }
      }
    }
    return registered;
  }

  getPower(x: number, y: number, z: number): number {
    const block = this.world.getBlock(x, y, z);
    if (block === BlockId.RedstoneWire) return this.wirePower.get(blockKey(x, y, z)) ?? 0;
    return this.sourcePowerAt(x, y, z, block);
  }

  /** Highest signal entering this coordinate from its six direct neighbours. */
  getReceivedPower(x: number, y: number, z: number): number {
    let power = 0;
    for (const [dx, dy, dz] of NEIGHBOURS) {
      power = Math.max(power, this.getPower(x + dx, y + dy, z + dz));
      if (power >= 15) break;
    }
    return power;
  }

  isPowered(x: number, y: number, z: number): boolean {
    return Math.max(this.getPower(x, y, z), this.getReceivedPower(x, y, z)) > 0;
  }

  getSource(x: number, y: number, z: number): RedstoneSourceSnapshot | undefined {
    const source = this.sources.get(blockKey(x, y, z));
    if (!source) return undefined;
    return this.snapshotSource(source);
  }

  getBlockRenderState(x: number, y: number, z: number): BlockRenderState | undefined {
    const block = this.world.getBlock(x, y, z, false);
    if (block === BlockId.RedstoneWire) {
      return { power: this.wirePower.get(blockKey(x, y, z)) ?? 0 };
    }
    const source = this.sources.get(blockKey(x, y, z));
    if (!source) return undefined;
    return {
      powered: source.active,
      ...(source.kind === 'lever' || source.kind === 'button'
        ? { attachment: source.attachment, facing: source.facing }
        : {}),
    };
  }

  setLeverOrientation(
    x: number,
    y: number,
    z: number,
    attachment: BlockAttachment,
    facing: HorizontalFacing,
  ): boolean {
    this.assertActive();
    if (this.world.getBlock(x, y, z) !== BlockId.Lever) return false;
    const source = this.ensureSource(x, y, z, 'lever');
    if (!source) return false;
    if (source.attachment !== attachment || source.facing !== facing) {
      source.attachment = attachment;
      source.facing = facing;
      this.options.onSourceChanged?.(x, y, z);
    }
    return true;
  }

  setButtonOrientation(
    x: number,
    y: number,
    z: number,
    attachment: BlockAttachment,
    facing: HorizontalFacing,
  ): boolean {
    this.assertActive();
    if (this.world.getBlock(x, y, z) !== BlockId.StoneButton) return false;
    const source = this.ensureSource(x, y, z, 'button');
    if (!source) return false;
    if (source.attachment !== attachment || source.facing !== facing) {
      source.attachment = attachment;
      source.facing = facing;
      this.options.onSourceChanged?.(x, y, z);
    }
    return true;
  }

  toggleLever(x: number, y: number, z: number): boolean | undefined {
    this.assertActive();
    if (this.world.getBlock(x, y, z) !== BlockId.Lever) return undefined;
    const source = this.ensureSource(x, y, z, 'lever');
    if (!source) return undefined;
    source.active = !source.active;
    this.sourceOutputChanged(source);
    return source.active;
  }

  setLever(x: number, y: number, z: number, active: boolean): boolean {
    this.assertActive();
    if (this.world.getBlock(x, y, z) !== BlockId.Lever) return false;
    const source = this.ensureSource(x, y, z, 'lever');
    if (!source) return false;
    if (source.active !== active) {
      source.active = active;
      this.sourceOutputChanged(source);
    }
    return true;
  }

  pressButton(
    x: number,
    y: number,
    z: number,
    durationSeconds = this.defaultButtonPulseSeconds,
  ): boolean {
    this.assertActive();
    if (this.world.getBlock(x, y, z) !== BlockId.StoneButton) return false;
    const source = this.ensureSource(x, y, z, 'button');
    if (!source) return false;
    const wasActive = source.active;
    source.active = true;
    source.remainingSeconds = Math.max(0.05, durationSeconds);
    if (!wasActive) this.sourceOutputChanged(source);
    return true;
  }

  setPressurePlate(x: number, y: number, z: number, active: boolean): boolean {
    this.assertActive();
    if (!isPressurePlateBlock(this.world.getBlock(x, y, z))) return false;
    const source = this.ensureSource(x, y, z, 'pressure_plate');
    if (!source) return false;
    if (source.active !== active) {
      source.active = active;
      this.sourceOutputChanged(source);
    }
    return true;
  }

  setPressurePlateOccupied(x: number, y: number, z: number, occupied: boolean): boolean {
    return this.setPressurePlate(x, y, z, occupied);
  }

  /** Convenience occupancy test for player/mob/item feet positions. */
  updatePressurePlateOccupancy(
    x: number,
    y: number,
    z: number,
    entityPositions: readonly Readonly<THREE.Vector3>[],
  ): boolean {
    const occupied = entityPositions.some((position) =>
      position.x >= x - 0.05 && position.x <= x + 1.05
      && position.z >= z - 0.05 && position.z <= z + 1.05
      && position.y >= y - 0.1 && position.y <= y + 1.25);
    return this.setPressurePlate(x, y, z, occupied);
  }

  get primedCapacityRemaining(): number {
    return Math.max(0, this.maxPrimedTnt - this.primedById.size);
  }

  primeTnt(
    x: number,
    y: number,
    z: number,
    fuseSeconds = this.defaultTntFuseSeconds,
    options: { readonly blockAlreadyRemoved?: boolean } = {},
  ): PrimedTnt | undefined {
    this.assertActive();
    if (this.primedById.size >= this.maxPrimedTnt) return undefined;
    if (!options.blockAlreadyRemoved) {
      if (this.world.getBlock(x, y, z) !== BlockId.Tnt) return undefined;
      if (!this.world.setBlock(x, y, z, BlockId.Air)) return undefined;
      this.notifyBlockChanged(x, y, z);
    }
    return this.createPrimedTnt(
      undefined,
      new THREE.Vector3(x + 0.5, y, z + 0.5),
      Math.max(0.05, fuseSeconds),
    );
  }

  update(deltaSeconds: number): RedstoneUpdateStats {
    if (this.disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return this.stats(0);
    }
    this.updateSources(deltaSeconds);
    const propagationSteps = this.processPropagation(this.maxPropagationStepsPerUpdate);
    this.updatePrimedTnt(deltaSeconds);
    return this.stats(propagationSteps);
  }

  /** Processes queued dust changes immediately, still bounded by `maxSteps`. */
  flushPropagation(maxSteps = this.maxQueuedUpdates * 16): number {
    this.assertActive();
    return this.processPropagation(Math.max(0, Math.floor(maxSteps)));
  }

  consumeExplosionEvents(): RedstoneExplosionEvent[] {
    return this.explosionEvents.splice(0);
  }

  serialize(): SerializedRedstoneState {
    return {
      version: 2,
      sources: [...this.sources.values()].map((source) => this.snapshotSource(source)),
      primedTnt: [...this.primedById.values()].map((entity): SerializedPrimedTnt => ({
        id: entity.id,
        position: [entity.position.x, entity.position.y, entity.position.z],
        fuseSeconds: entity.fuseSeconds,
        velocity: [entity.velocity.x, entity.velocity.y, entity.velocity.z],
      })),
    };
  }

  restore(serialized: SerializedRedstoneState, clearExisting = true): number {
    this.assertActive();
    if (serialized.version !== 1 && serialized.version !== 2) {
      throw new RangeError(`Unsupported redstone state version: ${serialized.version}`);
    }
    if (clearExisting) this.clear();
    let restored = 0;
    for (const snapshot of serialized.sources.slice(-this.maxSources)) {
      if (!this.validTuple(snapshot.position)) continue;
      const [x, y, z] = snapshot.position;
      const expectedKind = this.sourceKindForBlock(this.world.getBlock(x, y, z));
      if (expectedKind !== snapshot.kind) continue;
      const source = this.ensureSource(x, y, z, snapshot.kind);
      if (!source) continue;
      source.active = snapshot.kind === 'torch' ? true : snapshot.active;
      source.remainingSeconds = snapshot.kind === 'button' && source.active
        ? Math.max(0, snapshot.remainingSeconds ?? this.defaultButtonPulseSeconds)
        : 0;
      if (snapshot.kind === 'lever' || snapshot.kind === 'button') {
        source.attachment = snapshot.attachment ?? 'floor';
        source.facing = snapshot.facing ?? 'north';
      }
      this.sourceOutputChanged(source);
      restored += 1;
    }
    for (const snapshot of serialized.primedTnt.slice(-this.maxPrimedTnt)) {
      if (!this.validTuple(snapshot.position) || !Number.isFinite(snapshot.fuseSeconds)
        || snapshot.fuseSeconds <= 0) continue;
      this.createPrimedTnt(
        snapshot.id,
        new THREE.Vector3(...snapshot.position),
        snapshot.fuseSeconds,
        snapshot.velocity,
      );
      restored += 1;
    }
    return restored;
  }

  clear(): void {
    this.sources.clear();
    this.wirePower.clear();
    this.dirtyQueue.length = 0;
    this.dirtySet.clear();
    this.dirtyHead = 0;
    for (const entity of this.primedById.values()) entity.visual?.removeFromParent();
    this.primedById.clear();
    this.explosionEvents.length = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.tntGeometry?.dispose();
    this.tntMaterial?.dispose();
    this.tntGeometry = undefined;
    this.tntMaterial = undefined;
    this.disposed = true;
  }

  private updateSources(deltaSeconds: number): void {
    for (const [key, source] of [...this.sources]) {
      if (this.sourceKindForBlock(this.world.getBlock(source.x, source.y, source.z)) !== source.kind) {
        const wasActive = source.active;
        this.sources.delete(key);
        if (wasActive) this.enqueueNeighbours(source.x, source.y, source.z);
        continue;
      }
      if (source.kind !== 'button' || !source.active) continue;
      source.remainingSeconds -= deltaSeconds;
      if (source.remainingSeconds <= 0) {
        source.remainingSeconds = 0;
        source.active = false;
        this.sourceOutputChanged(source);
      }
    }
  }

  private updatePrimedTnt(deltaSeconds: number): void {
    for (const entity of [...this.primedById.values()]) {
      entity.previousPosition.copy(entity.position);
      entity.fuseSeconds -= deltaSeconds;
      if (entity.fuseSeconds <= 1e-9) {
        this.detonate(entity);
        continue;
      }
      entity.velocity.y -= 32 * deltaSeconds;
      entity.velocity.x *= Math.exp(-0.5 * deltaSeconds);
      entity.velocity.z *= Math.exp(-0.5 * deltaSeconds);
      const result = moveVoxelBody(
        this.world,
        entity.position,
        entity.velocity,
        deltaSeconds,
        { width: 0.98, height: 0.98 },
      );
      if (result.hitX) entity.velocity.x = 0;
      if (result.hitZ) entity.velocity.z = 0;
      if (result.hitY) entity.velocity.y = 0;
      if (entity.visual) {
        const elapsed = entity.totalFuseSeconds - entity.fuseSeconds;
        const urgency = 1 - entity.fuseSeconds / entity.totalFuseSeconds;
        const pulse = Math.sin(elapsed * (10 + urgency * 26)) > 0 ? 1.06 + urgency * 0.08 : 1;
        entity.visual.scale.setScalar(pulse);
        entity.visual.rotation.y = elapsed * 0.75;
        entity.visual.position.set(entity.position.x, entity.position.y + 0.49, entity.position.z);
        applySampledEntityLight(
          entity.visual,
          this.world,
          entity.position.x,
          entity.position.y,
          entity.position.z,
          0.98,
          worldDaylightUniform.value,
        );
      }
    }
  }

  interpolatePrimedTnt(alpha: number): void {
    const t = Math.max(0, Math.min(1, alpha));
    for (const entity of this.primedById.values()) {
      if (!entity.visual) continue;
      entity.visual.position.set(
        THREE.MathUtils.lerp(entity.previousPosition.x, entity.position.x, t),
        THREE.MathUtils.lerp(entity.previousPosition.y, entity.position.y, t) + 0.49,
        THREE.MathUtils.lerp(entity.previousPosition.z, entity.position.z, t),
      );
    }
  }

  private processPropagation(maxSteps: number): number {
    let steps = 0;
    while (steps < maxSteps && this.dirtyHead < this.dirtyQueue.length) {
      const key = this.dirtyQueue[this.dirtyHead];
      this.dirtyHead += 1;
      if (key === undefined) break;
      this.dirtySet.delete(key);
      const position = this.parseKey(key);
      this.processCoordinate(position[0], position[1], position[2]);
      steps += 1;
    }
    if (this.dirtyHead >= this.dirtyQueue.length) {
      this.dirtyQueue.length = 0;
      this.dirtyHead = 0;
    } else if (this.dirtyHead > 2_048) {
      this.dirtyQueue.splice(0, this.dirtyHead);
      this.dirtyHead = 0;
    }
    return steps;
  }

  private processCoordinate(x: number, y: number, z: number): void {
    const key = blockKey(x, y, z);
    const block = this.world.getBlock(x, y, z);
    this.reconcileSource(x, y, z, block);
    if (block === BlockId.RedstoneWire) {
      const previousPower = this.wirePower.get(key) ?? 0;
      const nextPower = this.calculateWirePower(x, y, z);
      if (nextPower !== previousPower) {
        if (nextPower > 0) this.wirePower.set(key, nextPower);
        else this.wirePower.delete(key);
        this.options.onSourceChanged?.(x, y, z);
        this.enqueueNeighbours(x, y, z);
      }
      if (nextPower > 0) this.primeAdjacentTnt(x, y, z);
      return;
    }
    if (this.wirePower.delete(key)) this.enqueueNeighbours(x, y, z);
    if (block === BlockId.Tnt && this.getReceivedPower(x, y, z) > 0) this.primeTnt(x, y, z);
  }

  private calculateWirePower(x: number, y: number, z: number): number {
    let result = 0;
    for (const [dx, dy, dz] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const neighbourBlock = this.world.getBlock(nx, ny, nz);
      if (neighbourBlock === BlockId.RedstoneWire) {
        result = Math.max(result, (this.wirePower.get(blockKey(nx, ny, nz)) ?? 0) - 1);
      } else {
        result = Math.max(result, this.sourcePowerAt(nx, ny, nz, neighbourBlock));
      }
      if (result >= 15) return 15;
    }
    return Math.max(0, Math.min(15, result));
  }

  private primeAdjacentTnt(x: number, y: number, z: number): void {
    for (const [dx, dy, dz] of NEIGHBOURS) {
      if (this.world.getBlock(x + dx, y + dy, z + dz) === BlockId.Tnt) {
        this.primeTnt(x + dx, y + dy, z + dz);
      }
    }
  }

  private sourceOutputChanged(source: MutableSourceState): void {
    this.options.onSourceChanged?.(source.x, source.y, source.z);
    this.enqueue(source.x, source.y, source.z);
    this.enqueueNeighbours(source.x, source.y, source.z);
    if (source.active) this.primeAdjacentTnt(source.x, source.y, source.z);
  }

  private reconcileSource(x: number, y: number, z: number, knownBlock?: BlockId): void {
    const key = blockKey(x, y, z);
    const block = knownBlock ?? this.world.getBlock(x, y, z);
    const kind = this.sourceKindForBlock(block);
    const existing = this.sources.get(key);
    if (!kind) {
      if (existing) {
        this.sources.delete(key);
        if (existing.active) this.enqueueNeighbours(x, y, z);
      }
      return;
    }
    if (existing?.kind === kind) {
      if (kind === 'torch' && !existing.active) {
        existing.active = true;
        this.sourceOutputChanged(existing);
      }
      return;
    }
    if (existing) this.sources.delete(key);
    const source = this.ensureSource(x, y, z, kind);
    if (source?.active) this.sourceOutputChanged(source);
  }

  private ensureSource(
    x: number,
    y: number,
    z: number,
    kind: RedstoneSourceKind,
  ): MutableSourceState | undefined {
    const key = blockKey(x, y, z);
    const existing = this.sources.get(key);
    if (existing?.kind === kind) return existing;
    if (existing) this.sources.delete(key);
    if (this.sources.size >= this.maxSources) return undefined;
    const source: MutableSourceState = {
      kind,
      x,
      y,
      z,
      active: kind === 'torch',
      remainingSeconds: 0,
      attachment: 'floor',
      facing: 'north',
    };
    this.sources.set(key, source);
    return source;
  }

  private sourcePowerAt(x: number, y: number, z: number, knownBlock?: BlockId): number {
    const block = knownBlock ?? this.world.getBlock(x, y, z);
    const kind = this.sourceKindForBlock(block);
    if (kind === 'torch') return getBlockDefinition(block).redstonePower ?? 15;
    if (!kind) return 0;
    const source = this.sources.get(blockKey(x, y, z));
    return source?.kind === kind && source.active
      ? getBlockDefinition(block).redstonePower ?? 15
      : 0;
  }

  private sourceKindForBlock(block: BlockId): RedstoneSourceKind | undefined {
    switch (block) {
      case BlockId.RedstoneTorch: return 'torch';
      case BlockId.Lever: return 'lever';
      case BlockId.StoneButton: return 'button';
      case BlockId.OakPressurePlate:
      case BlockId.StonePressurePlate: return 'pressure_plate';
      default: return undefined;
    }
  }

  private isRelevantBlock(block: BlockId): boolean {
    return block === BlockId.RedstoneWire
      || block === BlockId.Tnt
      || this.sourceKindForBlock(block) !== undefined;
  }

  private enqueue(x: number, y: number, z: number): void {
    const key = blockKey(x, y, z);
    if (this.dirtySet.has(key) || this.dirtySet.size >= this.maxQueuedUpdates) return;
    this.dirtySet.add(key);
    this.dirtyQueue.push(key);
  }

  private enqueueNeighbours(x: number, y: number, z: number): void {
    for (const [dx, dy, dz] of NEIGHBOURS) this.enqueue(x + dx, y + dy, z + dz);
  }

  private createPrimedTnt(
    requestedId: string | undefined,
    position: Readonly<THREE.Vector3>,
    fuseSeconds: number,
    velocity?: readonly [number, number, number],
  ): PrimedTnt {
    const id = this.allocateTntId(requestedId);
    const visual = this.createTntVisual(id, position);
    const entity = new PrimedTnt(
      id,
      position,
      fuseSeconds,
      visual,
      velocity ? new THREE.Vector3(...velocity) : undefined,
    );
    this.primedById.set(id, entity);
    this.options.onTntPrimed?.(entity);
    return entity;
  }

  private createTntVisual(
    id: string,
    position: Readonly<THREE.Vector3>,
  ): THREE.Mesh | undefined {
    if (!this.options.root) return undefined;
    this.tntGeometry ??= new THREE.BoxGeometry(0.92, 0.92, 0.92);
    this.tntMaterial ??= createEntityMaterial({ color: 0xc33b2e });
    const visual = new THREE.Mesh(this.tntGeometry, this.tntMaterial);
    visual.name = `primed-tnt:${id}`;
    visual.position.set(position.x, position.y + 0.49, position.z);
    bindEntityLightReceiver(visual);
    this.options.root.add(visual);
    return visual;
  }

  private detonate(entity: PrimedTnt): void {
    if (!this.primedById.delete(entity.id)) return;
    entity.visual?.removeFromParent();
    const event: RedstoneExplosionEvent = {
      id: entity.id,
      source: 'tnt',
      position: entity.position.clone().setY(entity.position.y + 0.49),
      power: 4,
      radius: 4,
    };
    this.explosionEvents.push(event);
    this.options.onExplosion?.(event);
  }

  private snapshotSource(source: MutableSourceState): RedstoneSourceSnapshot {
    return {
      kind: source.kind,
      position: [source.x, source.y, source.z],
      active: source.active,
      ...(source.kind === 'button' && source.active
        ? { remainingSeconds: source.remainingSeconds }
        : {}),
      ...(source.kind === 'lever' || source.kind === 'button'
        ? { attachment: source.attachment, facing: source.facing }
        : {}),
    };
  }

  private stats(propagationSteps: number): RedstoneUpdateStats {
    let activeSources = 0;
    for (const source of this.sources.values()) if (source.active) activeSources += 1;
    return {
      propagationSteps,
      pendingPropagation: this.pendingPropagation,
      activeSources,
      primedTnt: this.primedById.size,
    };
  }

  private allocateTntId(requested: string | undefined): string {
    if (requested && !this.primedById.has(requested)) {
      const suffix = Number(requested.split('-').at(-1));
      if (Number.isFinite(suffix)) this.tntIdCounter = Math.max(this.tntIdCounter, suffix);
      return requested;
    }
    let id: string;
    do {
      this.tntIdCounter += 1;
      id = `tnt-${this.tntIdCounter}`;
    } while (this.primedById.has(id));
    return id;
  }

  private parseKey(key: string): readonly [number, number, number] {
    const parts = key.split(',');
    return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
  }

  private validTuple(tuple: readonly number[]): tuple is readonly [number, number, number] {
    return tuple.length === 3 && tuple.every(Number.isFinite);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('RedstoneSystem has been disposed');
  }
}
