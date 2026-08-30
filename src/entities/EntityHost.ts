/**
 * Rendering seam for entity managers. Simulation (spawn, physics, AI, damage)
 * talks to this host instead of constructing Three.js Mesh / Geometry / Material.
 *
 * Server uses HeadlessEntityHost. Client / tests wrapping a scene use ThreeEntityHost.
 */

import type { VoxelWorld } from '../world/World';
import type { MobKind } from './mobDefinitions';
import type { MobModel } from './mobModels';

/** Opaque client visual. Absent on the server host. */
export type EntityVisual = object;

export interface MobVisualState {
  readonly kind: MobKind;
  readonly model: MobModel;
  readonly visual: EntityVisual;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly walkPhase: number;
  readonly visualAge: number;
  readonly locomotionSpeed: number;
  readonly state: string;
  readonly stateSeconds: number;
  readonly deathSeconds: number;
  readonly fuseSeconds: number;
  readonly onFire: boolean;
  readonly width: number;
  readonly height: number;
  readonly hurtFlashSeconds: number;
  fireOverlay?: EntityVisual;
}

export interface EntityHost {
  readonly hasVisuals: boolean;
  createDroppedItem(itemId: string, count: number): EntityVisual | undefined;
  updateDroppedItem(visual: EntityVisual, itemId: string, count: number): void;
  createFallingBlock(itemKey: string): EntityVisual | undefined;
  createMinecart(variant: 'normal' | 'tnt'): EntityVisual | undefined;
  setMinecartVariant(visual: EntityVisual, variant: 'normal' | 'tnt'): void;
  pulseMinecartTnt(visual: EntityVisual, fuseRatio: number): void;
  createMob(kind: MobKind): { visual: EntityVisual; model: MobModel } | undefined;
  createArrow(flaming?: boolean): EntityVisual | undefined;
  createPrimedTnt?(id: string): EntityVisual | undefined;
  attach(visual: EntityVisual): void;
  detach(visual: EntityVisual): void;
  setPosition(visual: EntityVisual, x: number, y: number, z: number): void;
  setRotation(visual: EntityVisual, x: number, y: number, z: number): void;
  setScale(visual: EntityVisual, x: number, y: number, z: number): void;
  setScalarScale(visual: EntityVisual, scale: number): void;
  orientArrow(visual: EntityVisual, vx: number, vy: number, vz: number): void;
  applyLight(
    visual: EntityVisual,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
    height: number,
  ): void;
  applyMobHurtLight(
    visual: EntityVisual,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
    height: number,
    flash: number,
  ): void;
  syncMob(state: MobVisualState): EntityVisual | undefined;
  disposeVisual(visual: EntityVisual, options?: { readonly materials?: boolean }): void;
  dispose(): void;
}

export class HeadlessEntityHost implements EntityHost {
  readonly hasVisuals = false;

  createDroppedItem(): undefined {
    return undefined;
  }

  updateDroppedItem(): void {}

  createFallingBlock(_itemKey: string): undefined {
    return undefined;
  }

  createMinecart(_variant: 'normal' | 'tnt'): undefined {
    return undefined;
  }

  setMinecartVariant(): void {}

  pulseMinecartTnt(): void {}

  createMob(_kind: MobKind): undefined {
    return undefined;
  }

  createArrow(_flaming?: boolean): undefined {
    return undefined;
  }

  createPrimedTnt(_id: string): undefined {
    return undefined;
  }

  attach(): void {}

  detach(): void {}

  setPosition(): void {}

  setRotation(): void {}

  setScale(): void {}

  setScalarScale(): void {}

  orientArrow(): void {}

  applyLight(): void {}

  applyMobHurtLight(): void {}

  syncMob(): undefined {
    return undefined;
  }

  disposeVisual(): void {}

  dispose(): void {}
}

export function isEntityHost(value: unknown): value is EntityHost {
  return typeof value === 'object'
    && value !== null
    && 'hasVisuals' in value
    && 'createDroppedItem' in value
    && 'createMob' in value
    && typeof (value as EntityHost).createDroppedItem === 'function';
}
