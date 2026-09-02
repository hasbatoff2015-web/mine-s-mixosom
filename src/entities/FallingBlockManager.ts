import { Vec3 } from '../math/vec3';
import { lerp } from '../core/constants';
import { BlockId, getBlockDefinition } from '../blocks';
import type { VoxelWorld } from '../world/World';
import { moveVoxelBody } from './voxelPhysics';
import type { EntityHost, EntityVisual } from './EntityHost';
import { isEntityHost } from './EntityHost';
import { resolveEntityHost } from './resolveEntityHost';

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
  readonly position: Vec3;
  readonly previousPosition: Vec3;
  readonly velocity: Vec3;
  readonly visual?: EntityVisual;
  ageSeconds: number;
}

export class FallingBlockManager {
  private readonly entities = new Map<string, FallingBlockEntity>();
  private readonly host: EntityHost;
  private readonly ownsHost: boolean;
  private idCounter = 0;
  private disposed = false;

  constructor(
    sceneOrHost: EntityHost | object,
    private readonly world: VoxelWorld,
    visuals?: unknown,
    private readonly maxEntities = 64,
  ) {
    this.ownsHost = !isEntityHost(sceneOrHost);
    this.host = resolveEntityHost(sceneOrHost, {
      itemVisuals: visuals,
      ownsItemVisuals: visuals ? false : undefined,
    });
  }

  get count(): number {
    return this.entities.size;
  }

  get list(): readonly FallingBlockEntity[] {
    return [...this.entities.values()];
  }

  spawn(block: BlockId, x: number, y: number, z: number, id?: string): FallingBlockEntity | undefined {
    if (this.disposed || this.entities.size >= this.maxEntities) return undefined;
    const definition = getBlockDefinition(block);
    if (!definition.gravity) return undefined;
    const entityId = id ?? `fall-${this.idCounter += 1}`;
    const position = new Vec3(x + 0.5, y, z + 0.5);
    const visual = this.host.createFallingBlock(definition.key) as EntityVisual | undefined;
    if (visual) {
      this.host.setPosition(visual, position.x, position.y + 0.5, position.z);
      this.host.attach(visual);
    }
    const entity: FallingBlockEntity = {
      id: entityId,
      block,
      position,
      previousPosition: position.clone(),
      velocity: new Vec3(0, 0, 0),
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
      else if (entity.visual) {
        this.host.applyLight(
          entity.visual,
          this.world,
          entity.position.x,
          entity.position.y,
          entity.position.z,
          1,
        );
      }
    }
  }

  interpolate(alpha: number): void {
    const t = Math.max(0, Math.min(1, alpha));
    for (const entity of this.entities.values()) {
      if (!entity.visual) continue;
      const x = lerp(entity.previousPosition.x, entity.position.x, t);
      const y = lerp(entity.previousPosition.y, entity.position.y, t);
      const z = lerp(entity.previousPosition.z, entity.position.z, t);
      this.host.setPosition(entity.visual, x, y + 0.5, z);
      this.host.applyLight(entity.visual, this.world, x, y, z, 1);
    }
  }

  get(id: string): FallingBlockEntity | undefined {
    return this.entities.get(id);
  }

  remove(id: string): boolean {
    const entity = this.entities.get(id);
    if (!entity) return false;
    if (entity.visual) this.host.detach(entity.visual);
    this.entities.delete(id);
    return true;
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
    for (const entity of this.entities.values()) {
      if (entity.visual) this.host.detach(entity.visual);
    }
    this.entities.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    if (this.ownsHost) this.host.dispose();
    this.disposed = true;
  }

  private land(entity: FallingBlockEntity): void {
    this.entities.delete(entity.id);
    if (entity.visual) this.host.detach(entity.visual);
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
