/**
 * Client EntityHost: Three.js meshes, materials, and lighting.
 * Simulation managers must not construct these themselves.
 */

import * as THREE from 'three';
import { ArrowVisualFactory, ARROW_FORWARD } from '../rendering/ArrowVisualFactory';
import { SharedFireTexture } from '../rendering/fireTexture';
import { ItemVisualFactory } from '../rendering/ItemVisualFactory';
import { MinecartVisualFactory } from '../rendering/minecartGeometry';
import {
  applySampledEntityLight,
  bindEntityLightReceiver,
  createEntityMaterial,
  disposeOwnedEntityMaterials,
  worldDaylightUniform,
} from '../rendering/worldLighting';
import { TextureAtlas } from '../rendering/TextureAtlas';
import type { VoxelWorld } from '../world/World';
import type { EntityHost, EntityVisual, MobModel, MobVisualState } from './EntityHost';
import type { MobKind } from './mobDefinitions';
import { createMobModel } from './mobModels';
import { VoxelVisualFactory } from './voxelVisuals';

const PRIMED_TNT_TEXTURE_KEY = 'block/tnt';

export interface ThreeEntityHostOptions {
  readonly itemVisuals?: ItemVisualFactory;
  readonly arrowVisuals?: ArrowVisualFactory;
  readonly ownsItemVisuals?: boolean;
  readonly ownsArrowVisuals?: boolean;
}

function asObject3D(visual: EntityVisual): THREE.Object3D {
  return visual as THREE.Object3D;
}

export class ThreeEntityHost implements EntityHost {
  readonly hasVisuals = true;
  private itemVisuals?: ItemVisualFactory;
  private readonly providedItemVisuals?: ItemVisualFactory;
  private readonly ownsItemVisuals: boolean;
  private arrowVisuals?: ArrowVisualFactory;
  private readonly providedArrowVisuals?: ArrowVisualFactory;
  private readonly ownsArrowVisuals: boolean;
  private voxelVisuals?: VoxelVisualFactory;
  private minecartVisuals?: MinecartVisualFactory;
  private tntGeometry?: THREE.BoxGeometry;
  private tntMap?: THREE.Texture;
  private readonly tntMaterials: THREE.Material[] = [];
  private disposed = false;

  constructor(
    private readonly scene: THREE.Object3D,
    options: ThreeEntityHostOptions = {},
  ) {
    this.providedItemVisuals = options.itemVisuals;
    this.ownsItemVisuals = options.ownsItemVisuals ?? options.itemVisuals === undefined;
    this.providedArrowVisuals = options.arrowVisuals;
    this.ownsArrowVisuals = options.ownsArrowVisuals ?? options.arrowVisuals === undefined;
  }

  private items(): ItemVisualFactory {
    return this.itemVisuals ??= this.providedItemVisuals ?? new ItemVisualFactory();
  }

  private arrows(): ArrowVisualFactory {
    return this.arrowVisuals ??= this.providedArrowVisuals ?? new ArrowVisualFactory();
  }

  get itemVisualFactory(): ItemVisualFactory {
    return this.items();
  }

  get arrowVisualFactory(): ArrowVisualFactory {
    return this.arrows();
  }

  createDroppedItem(itemId: string, count: number): EntityVisual {
    return this.items().createDroppedItemVisual(itemId, count);
  }

  updateDroppedItem(visual: EntityVisual, itemId: string, count: number): void {
    this.items().updateDroppedItemVisual(asObject3D(visual) as THREE.Group, itemId, count);
  }

  createFallingBlock(itemKey: string): EntityVisual {
    const visual = this.items().createItemModel(itemKey);
    visual.scale.setScalar(0.98);
    return visual;
  }

  createMinecart(variant: 'normal' | 'tnt'): EntityVisual {
    const visual = (this.minecartVisuals ??= new MinecartVisualFactory()).create();
    this.minecartVisuals.setVariant(visual, variant);
    return visual;
  }

  setMinecartVariant(visual: EntityVisual, variant: 'normal' | 'tnt'): void {
    (this.minecartVisuals ??= new MinecartVisualFactory()).setVariant(asObject3D(visual), variant);
  }

  pulseMinecartTnt(visual: EntityVisual, fuseRatio: number): void {
    (this.minecartVisuals ??= new MinecartVisualFactory()).pulsePrimed(asObject3D(visual), fuseRatio);
  }

  createMob(kind: MobKind): { visual: EntityVisual; model: MobModel } {
    const model = createMobModel(this.voxelVisuals ??= new VoxelVisualFactory(), kind);
    return { visual: model.root, model };
  }

  createArrow(flaming = false): EntityVisual {
    return this.arrows().create(flaming);
  }

  createPrimedTnt(id: string): EntityVisual {
    this.tntGeometry ??= new THREE.BoxGeometry(0.92, 0.92, 0.92);
    this.tntMap ??= this.createTntTexture();
    const material = createEntityMaterial({
      map: this.tntMap,
      color: 0xffffff,
      transparent: false,
      depthWrite: true,
    });
    this.tntMaterials.push(material);
    const visual = new THREE.Mesh(this.tntGeometry, material);
    visual.name = `primed-tnt:${id}`;
    bindEntityLightReceiver(visual);
    return visual;
  }

  pulsePrimedTnt(visual: EntityVisual, elapsed: number, urgency: number): void {
    const mesh = asObject3D(visual);
    const pulse = Math.sin(elapsed * (10 + urgency * 26)) > 0 ? 1.06 + urgency * 0.08 : 1;
    mesh.scale.setScalar(pulse);
    mesh.rotation.y = elapsed * 0.75;
    const material = (mesh as THREE.Mesh).material;
    if (material instanceof THREE.MeshBasicMaterial) {
      const flash = Math.sin(elapsed * (12 + urgency * 28)) > 0;
      material.color.setHex(flash ? 0xffffff : 0xffe7b0);
    }
  }

  attach(visual: EntityVisual): void {
    this.scene.add(asObject3D(visual));
  }

  detach(visual: EntityVisual): void {
    asObject3D(visual).removeFromParent();
  }

  setPosition(visual: EntityVisual, x: number, y: number, z: number): void {
    asObject3D(visual).position.set(x, y, z);
  }

  setRotation(visual: EntityVisual, x: number, y: number, z: number): void {
    asObject3D(visual).rotation.set(x, y, z);
  }

  setScale(visual: EntityVisual, x: number, y: number, z: number): void {
    asObject3D(visual).scale.set(x, y, z);
  }

  setScalarScale(visual: EntityVisual, scale: number): void {
    asObject3D(visual).scale.setScalar(scale);
  }

  orientArrow(visual: EntityVisual, vx: number, vy: number, vz: number): void {
    const lengthSq = vx * vx + vy * vy + vz * vz;
    if (lengthSq <= 1e-8) return;
    const length = Math.sqrt(lengthSq);
    asObject3D(visual).quaternion.setFromUnitVectors(
      ARROW_FORWARD,
      new THREE.Vector3(vx / length, vy / length, vz / length),
    );
  }

  applyLight(
    visual: EntityVisual,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
    height: number,
  ): void {
    applySampledEntityLight(
      asObject3D(visual),
      world,
      x,
      y,
      z,
      height,
      worldDaylightUniform.value,
    );
  }

  applyMobHurtLight(
    visual: EntityVisual,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
    height: number,
    flash: number,
  ): void {
    const sample = applySampledEntityLight(
      asObject3D(visual),
      world,
      x,
      y,
      z,
      height,
      worldDaylightUniform.value,
    );
    if (flash <= 0) return;
    const tinted = [
      Math.min(1.2, sample.rgb[0] * (1 - flash * 0.12) + flash * 0.95),
      sample.rgb[1] * (1 - flash * 0.82),
      sample.rgb[2] * (1 - flash * 0.82),
    ] as const;
    const light = asObject3D(visual).userData.entityLight as THREE.Vector3 | undefined;
    if (light instanceof THREE.Vector3) light.set(tinted[0], tinted[1], tinted[2]);
  }

  syncMob(state: MobVisualState): EntityVisual | undefined {
    const visual = asObject3D(state.visual);
    const model = state.model;
    const legs = model.legs.map(asObject3D);
    const arms = model.arms.map(asObject3D);
    const wings = model.wings.map(asObject3D);
    const speed = state.locomotionSpeed;
    const walkPhase = state.walkPhase;
    const swing = Math.sin(walkPhase) * Math.min(0.65, speed * 0.22);
    visual.rotation.y = state.yaw;
    if (state.kind === 'spider') {
      legs.forEach((leg, index) => {
        const side = index % 2 === 0 ? -1 : 1;
        const pair = Math.floor(index / 2);
        const phase = Math.sin(walkPhase + pair * 0.85) * Math.min(1, speed);
        leg.rotation.x = Number(leg.userData.baseRotationX ?? 0);
        leg.rotation.y = Number(leg.userData.baseRotationY ?? 0) - phase * 0.18 * side;
        leg.rotation.z = Number(leg.userData.baseRotationZ ?? 0)
          - Math.abs(Math.cos(walkPhase + pair * 0.7)) * 0.08 * side * Math.min(1, speed);
      });
    } else {
      legs.forEach((leg, index) => {
        leg.rotation.x = Number(leg.userData.baseRotationX ?? 0)
          + swing * (model.legSwingSigns[index] ?? (index % 2 === 0 ? 1 : -1));
        leg.rotation.y = Number(leg.userData.baseRotationY ?? 0);
        leg.rotation.z = Number(leg.userData.baseRotationZ ?? 0);
      });
    }
    if (state.kind === 'chicken') {
      const flap = Math.sin(state.visualAge * (speed > 0.1 ? 14 : 4)) * (speed > 0.1 ? 0.35 : 0.08);
      wings.forEach((wing, index) => {
        wing.rotation.x = Number(wing.userData.baseRotationX ?? 0);
        wing.rotation.y = Number(wing.userData.baseRotationY ?? 0);
        wing.rotation.z = Number(wing.userData.baseRotationZ ?? 0) + (index === 0 ? flap : -flap);
      });
    }
    if (state.kind === 'zombie') {
      const poseArms = state.state === 'attack' ? 1.55 : 1.2;
      arms.forEach((arm, index) => {
        arm.rotation.x = Number(arm.userData.baseRotationX ?? 0)
          + poseArms + (index % 2 === 0 ? swing : -swing) * 0.25;
        arm.rotation.y = Number(arm.userData.baseRotationY ?? 0);
        arm.rotation.z = Number(arm.userData.baseRotationZ ?? 0);
      });
    } else if (state.kind === 'skeleton') {
      arms.forEach((arm, index) => {
        arm.rotation.x = Number(arm.userData.baseRotationX ?? 0) + (state.state === 'attack'
          ? -1.15
          : (index % 2 === 0 ? swing : -swing) * 0.5);
        arm.rotation.y = Number(arm.userData.baseRotationY ?? 0);
        arm.rotation.z = Number(arm.userData.baseRotationZ ?? 0);
      });
    }
    if (state.state === 'die') {
      const progress = THREE.MathUtils.clamp(state.deathSeconds / 0.7, 0, 1);
      visual.rotation.z = progress * Math.PI * 0.5;
      visual.scale.setScalar(1 - progress * 0.25);
    } else if (state.kind === 'creeper') {
      const fuseProgress = THREE.MathUtils.clamp(state.fuseSeconds / 1.5, 0, 1);
      const pulse = fuseProgress > 0
        ? Math.sin(state.fuseSeconds * (10 + fuseProgress * 18)) * 0.025 * fuseProgress
        : 0;
      visual.scale.set(1 + pulse, 1 + fuseProgress * 0.08, 1 + pulse);
      visual.rotation.z = 0;
    } else {
      visual.scale.setScalar(1);
      visual.rotation.z = 0;
    }
    const hurtJolt = state.state === 'hurt' ? Math.sin(state.stateSeconds * 45) * 0.035 : 0;
    visual.position.set(state.x + hurtJolt, state.y, state.z);
    return this.syncFireOverlay(state, visual);
  }

  disposeVisual(visual: EntityVisual, options?: { readonly materials?: boolean }): void {
    const object = asObject3D(visual);
    if (object instanceof THREE.Mesh && object.name === 'fire-overlay') {
      object.geometry.dispose();
    }
    if (options?.materials) disposeOwnedEntityMaterials(object);
    object.removeFromParent();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.ownsItemVisuals) this.itemVisuals?.dispose();
    if (this.ownsArrowVisuals) this.arrowVisuals?.dispose();
    this.voxelVisuals?.dispose();
    this.minecartVisuals?.dispose();
    this.tntGeometry?.dispose();
    this.tntMap?.dispose();
    for (const material of this.tntMaterials) material.dispose();
    this.tntMaterials.length = 0;
  }

  private syncFireOverlay(state: MobVisualState, visual: THREE.Object3D): EntityVisual | undefined {
    if (state.onFire) {
      if (!state.fireOverlay) {
        const overlay = SharedFireTexture.instance().createScaledOverlay(state.width, state.height);
        visual.add(overlay);
        state.fireOverlay = overlay;
      }
      const overlay = asObject3D(state.fireOverlay);
      overlay.visible = true;
      overlay.rotation.y = -visual.rotation.y;
      return state.fireOverlay;
    }
    if (state.fireOverlay) asObject3D(state.fireOverlay).visible = false;
    return state.fireOverlay;
  }

  private createTntTexture(): THREE.Texture {
    const map = typeof document === 'undefined'
      ? new THREE.Texture()
      : new THREE.TextureLoader().load(TextureAtlas.url(PRIMED_TNT_TEXTURE_KEY));
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    map.generateMipmaps = false;
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.name = PRIMED_TNT_TEXTURE_KEY;
    return map;
  }
}

export function createThreeEntityHost(
  scene: THREE.Object3D,
  options?: ThreeEntityHostOptions,
): ThreeEntityHost {
  return new ThreeEntityHost(scene, options);
}
