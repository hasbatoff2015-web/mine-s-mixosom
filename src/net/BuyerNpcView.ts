import * as THREE from 'three';
import { PLAYER_HEIGHT, PLAYER_WIDTH } from '../core/constants';
import { rayAabbDistance } from '../world/collision';
import type { VoxelWorld } from '../world/World';
import type { PlayerVisual } from '../rendering/player/PlayerVisual';
import { BUYER_NPC_SKIN_ID } from '../../shared/buyers';
import type { NetworkBuyerNpc } from '../../shared/protocol';
import { createPlayerAppearance } from '../player/appearance/PlayerAppearance';

export interface BuyerNpcViewOptions {
  readonly visual: PlayerVisual;
  readonly world: VoxelWorld;
}

export class BuyerNpcView {
  readonly group = new THREE.Group();
  readonly visual: PlayerVisual;
  private record: NetworkBuyerNpc;

  constructor(info: NetworkBuyerNpc, private readonly options: BuyerNpcViewOptions) {
    this.record = info;
    this.visual = options.visual;
    this.group.name = `buyer-npc:${info.id}`;
    this.group.add(this.visual.root);
    this.visual.root.position.set(0, 0, 0);
    this.visual.setAppearance(createPlayerAppearance({
      skinId: BUYER_NPC_SKIN_ID,
      model: 'classic',
    }));
    this.apply(info, 0, 1);
  }

  get hologramName(): string {
    return this.record.hologramName;
  }

  get id(): string {
    return this.record.id;
  }

  apply(info: NetworkBuyerNpc, deltaSeconds = 0, daylight = 1): void {
    this.record = info;
    this.group.position.set(info.x, info.y, info.z);
    this.visual.animator.reset(info.yaw);
    this.visual.setHeldItem(info.itemId);
    this.visual.update(deltaSeconds, {
      viewYaw: info.yaw,
      viewPitch: info.pitch,
      movementSpeed: 0,
      onGround: true,
      sneaking: false,
      sprinting: false,
      verticalVelocity: 0,
      mining: false,
      bowCharge: 0,
      swordBlocking: false,
      foodUseProgress: 0,
      invisible: false,
      hurtFlash: 0,
      deathProgress: 0,
    });
    this.visual.applyWorldLight(this.options.world, info.x, info.y, info.z, daylight);
  }

  update(deltaSeconds: number, daylight = 1): void {
    this.visual.update(deltaSeconds, {
      viewYaw: this.record.yaw,
      viewPitch: this.record.pitch,
      movementSpeed: 0,
      onGround: true,
      sneaking: false,
      sprinting: false,
      verticalVelocity: 0,
      mining: false,
      bowCharge: 0,
      swordBlocking: false,
      foodUseProgress: 0,
      invisible: false,
      hurtFlash: 0,
      deathProgress: 0,
    });
    this.visual.applyWorldLight(this.options.world, this.record.x, this.record.y, this.record.z, daylight);
  }

  raycast(
    origin: { x: number; y: number; z: number },
    direction: { x: number; y: number; z: number },
    maxDistance: number,
  ): number | undefined {
    const half = PLAYER_WIDTH * 0.5;
    const hit = rayAabbDistance(origin, direction, {
      minX: this.record.x - half,
      maxX: this.record.x + half,
      minY: this.record.y,
      maxY: this.record.y + PLAYER_HEIGHT,
      minZ: this.record.z - half,
      maxZ: this.record.z + half,
    });
    if (!hit || hit.distance < 0 || hit.distance > maxDistance) return undefined;
    return hit.distance;
  }

  dispose(): void {
    this.visual.dispose();
  }
}
