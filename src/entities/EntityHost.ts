/**
 * Rendering seam for entity managers. Simulation (spawn, physics, AI, damage)
 * talks to this host instead of constructing Three.js Mesh / Geometry / Material.
 *
 * Server uses HeadlessEntityHost. Client / tests wrapping a scene use ThreeEntityHost.
 */

import type { VoxelWorld } from '../world/World';
import type { MobKind } from './mobDefinitions';

/** Opaque client visual. Runtime is a Three.js Object3D; simulation only stores the handle. */
export type EntityVisual = {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  userData: Record<string, unknown>;
  visible?: boolean;
  children: unknown[];
  name?: string;
  material?: unknown;
  traverse(cb: (object: unknown) => void): void;
  getObjectByName(name: string): unknown;
  updateMatrixWorld?(force?: boolean): void;
};

/** Visual rig handle. Client fills this with Three.js groups; sim only stores it. */
export interface MobModel {
  readonly root: EntityVisual;
  readonly parts: ReadonlyMap<string, EntityVisual>;
  readonly head?: EntityVisual;
  readonly legs: readonly EntityVisual[];
  readonly legSwingSigns: readonly number[];
  readonly arms: readonly EntityVisual[];
  readonly wings: readonly EntityVisual[];
}

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
  /** Fuse pulse / flash for primed TNT. Headless no-op. */
  pulsePrimedTnt?(visual: EntityVisual, elapsed: number, urgency: number): void;
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

  pulsePrimedTnt(): void {}

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
