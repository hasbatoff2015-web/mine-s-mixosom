import * as THREE from 'three';
import { BlockId, getBlockDefinition } from '../blocks';
import type { VoxelWorld } from '../world/World';
import { ItemVisualFactory } from '../rendering/ItemVisualFactory';
import { moveVoxelBody } from './voxelPhysics';

const BODY = Object.freeze({ width: 0.98, height: 0.98 });
const GRAVITY = -32;

export interface SerializedFallingBlock {
  readonly id: string;
  readonly block: BlockId;
  readonly position: readonly [number, number, number];
  readonly velocity: readonly [number, number, number];
}

export interface FallingBlockEntity {
  readonly id: string;
  readonly block: BlockId;
  readonly position: THREE.Vector3;
  readonly previousPosition: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly visual: THREE.Object3D;
  ageSeconds: number;
}

export class FallingBlockManager {
  private readonly entities = new Map<string, FallingBlockEntity>();
  private idCounter = 0;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly world: VoxelWorld,
    private readonly visuals: ItemVisualFactory,
    private readonly maxEntities = 64,
  ) {}

  get count(): number {
    return this.entities.size;
  }

  spawn(block: BlockId, x: number, y: number, z: number, id?: string): FallingBlockEntity | undefined {
    if (this.disposed || this.entities.size >= this.maxEntities) return undefined;
    const definition = getBlockDefinition(block);
    if (!definition.gravity) return undefined;
    const entityId = id ?? `fall-${this.idCounter += 1}`;
    const position = new THREE.Vector3(x + 0.5, y, z + 0.5);
    const visual = this.visuals.createItemModel(definition.key);
    visual.scale.setScalar(0.98);
    visual.position.copy(position);
    visual.position.y += 0.5;
    this.scene.add(visual);
    const entity: FallingBlockEntity = {
      id: entityId,
      block,
      position,
      previousPosition: position.clone(),
      velocity: new THREE.Vector3(0, 0, 0),
      visual,
      ageSeconds: 0,
    };
    this.entities.set(entityId, entity);
    return entity;
  }

  update(deltaSeconds: number): void {
    if (this.disposed) return;
    for (const entity of [...this.entities.values()]) {
      entity.previousPosition.copy(entity.position);
      entity.ageSeconds += deltaSeconds;
      entity.velocity.y += GRAVITY * deltaSeconds;
      entity.velocity.x *= Math.exp(-0.6 * deltaSeconds);
      entity.velocity.z *= Math.exp(-0.6 * deltaSeconds);
      const result = moveVoxelBody(this.world, entity.position, entity.velocity, deltaSeconds, BODY);
      if (result.hitX) entity.velocity.x = 0;
      if (result.hitZ) entity.velocity.z = 0;
      if (result.hitY && entity.velocity.y <= 0) {
        entity.velocity.y = 0;
        this.land(entity);
        continue;
      }
      if (entity.position.y < -8 || entity.ageSeconds > 12) this.land(entity);
    }
  }

  interpolate(alpha: number): void {
    const t = Math.max(0, Math.min(1, alpha));
    for (const entity of this.entities.values()) {
      entity.visual.position.set(
        THREE.MathUtils.lerp(entity.previousPosition.x, entity.position.x, t),
        THREE.MathUtils.lerp(entity.previousPosition.y, entity.position.y, t) + 0.5,
        THREE.MathUtils.lerp(entity.previousPosition.z, entity.position.z, t),
      );
    }
  }

  serialize(): SerializedFallingBlock[] {
    return [...this.entities.values()].map((entity) => ({
      id: entity.id,
      block: entity.block,
      position: [entity.position.x, entity.position.y, entity.position.z],
      velocity: [entity.velocity.x, entity.velocity.y, entity.velocity.z],
    }));
  }

  restore(serialized: readonly SerializedFallingBlock[]): number {
    this.clear();
    let restored = 0;
    for (const entry of serialized.slice(-this.maxEntities)) {
      const x = Math.floor(entry.position[0]);
      const y = Math.floor(entry.position[1]);
      const z = Math.floor(entry.position[2]);
      const entity = this.spawn(entry.block, x, y, z, entry.id);
      if (!entity) continue;
      entity.position.set(entry.position[0], entry.position[1], entry.position[2]);
      entity.previousPosition.copy(entity.position);
      entity.velocity.set(entry.velocity[0], entry.velocity[1], entry.velocity[2]);
      restored += 1;
    }
    return restored;
  }

  clear(): void {
    for (const entity of this.entities.values()) entity.visual.removeFromParent();
    this.entities.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
  }

  private land(entity: FallingBlockEntity): void {
    this.entities.delete(entity.id);
    entity.visual.removeFromParent();
    const x = Math.floor(entity.position.x);
    const y = Math.max(0, Math.round(entity.position.y));
    const z = Math.floor(entity.position.z);
    const target = this.world.getBlock(x, y, z, false);
    const targetDefinition = getBlockDefinition(target);
    if (target === BlockId.Air || targetDefinition.replaceable || targetDefinition.liquid) {
      this.world.setBlock(x, y, z, entity.block);
      return;
    }
    const above = this.world.getBlock(x, y + 1, z, false);
    const aboveDefinition = getBlockDefinition(above);
    if (above === BlockId.Air || aboveDefinition.replaceable) {
      this.world.setBlock(x, y + 1, z, entity.block);
    }
  }
}
