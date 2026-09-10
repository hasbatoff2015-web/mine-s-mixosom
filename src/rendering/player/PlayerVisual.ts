import * as THREE from 'three';
import { bowPullingTexturePath, itemRenderProfile, thirdPersonItemPose } from '../../items';
import type { VoxelWorld } from '../../world/World';
import {
  createPlayerAppearance,
  type PlayerAppearance,
  type PlayerSkinLayers,
} from '../../player/appearance/PlayerAppearance';
import {
  MinecraftSkinRegistry,
  type SkinTextureHandle,
} from './MinecraftSkin';
import { ItemVisualFactory } from '../ItemVisualFactory';
import {
  applySampledEntityLight,
  bindEntityLightReceiver,
  createEntityMaterial,
  setEntityLight,
} from '../worldLighting';
import { applyMobHurtTint } from '../../entities/MobManager';
import { playerHurtFlashIntensity } from '../hurtFeedback';
import {
  PLAYER_MODEL_PIXEL,
  PlayerSkinGeometryCache,
  type PlayerSkinLayer,
  type PlayerSkinPart,
} from './PlayerSkinGeometry';
import {
  PlayerVisualAnimator,
  type PlayerAnimationState,
  type PlayerVisualPose,
} from './PlayerVisualAnimator';
import {
  PlayerArmorGeometryCache,
  PlayerArmorMaterialCache,
  PlayerArmorVisual,
  type PlayerArmorResources,
} from './PlayerArmorVisual';
import type { PlayerEquipmentState } from '../../../shared/protocol';
import {
  humanoidDeathRotationZ,
  humanoidDeathScale,
} from '../../entities/humanoidDeath';

export interface PlayerVisualFrameState extends PlayerAnimationState {
  readonly invisible: boolean;
  readonly hurtFlash: number;
  /** 0 = living pose. 1 = completed humanoid death tilt. */
  readonly deathProgress?: number;
}

export const UPPER_BODY_PIVOT_Y = 12 * PLAYER_MODEL_PIXEL;

export interface PlayerVisualRig {
  readonly upperBody: THREE.Group;
  readonly head: THREE.Group;
  readonly body: THREE.Group;
  readonly rightArm: THREE.Group;
  readonly leftArm: THREE.Group;
  readonly rightLeg: THREE.Group;
  readonly leftLeg: THREE.Group;
  readonly heldItem: THREE.Group;
}

interface SkinPartMeshes {
  base: THREE.Mesh;
  outer: THREE.Mesh;
}

const PARTS: readonly PlayerSkinPart[] = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];
export const SKIN_BASE_RENDER_ORDER = 0;
export const SKIN_OUTER_RENDER_ORDER = 10;
export const SKIN_PART_RENDER_RANK: Readonly<Record<PlayerSkinPart, number>> = Object.freeze({
  body: 0,
  head: 1,
  rightLeg: 2,
  leftLeg: 3,
  rightArm: 4,
  leftArm: 5,
});
export const SKIN_PART_DEPTH_BIAS: Readonly<Record<PlayerSkinPart, number>> = Object.freeze({
  head: 0,
  body: 0,
  rightArm: 1,
  leftArm: 2,
  rightLeg: 1,
  leftLeg: 2,
});
const LAYER_KEY: Readonly<Record<PlayerSkinPart, keyof PlayerSkinLayers>> = Object.freeze({
  head: 'hat',
  body: 'jacket',
  rightArm: 'rightSleeve',
  leftArm: 'leftSleeve',
  rightLeg: 'rightPants',
  leftLeg: 'leftPants',
});

/** Canonical 64x64 player rig shared by local third person and future remote players. */
export class PlayerVisual {
  readonly root = new THREE.Group();
  readonly rig: PlayerVisualRig;
  readonly animator = new PlayerVisualAnimator();
  readonly armor: PlayerArmorVisual;
  private readonly bodyYawRoot = new THREE.Group();
  private readonly baseMaterial: THREE.MeshBasicMaterial;
  private readonly outerMaterial: THREE.MeshBasicMaterial;
  private readonly outerMaterials = new Map<number, THREE.MeshBasicMaterial>();
  private readonly partMeshes = new Map<PlayerSkinPart, SkinPartMeshes>();
  private appearanceValue: PlayerAppearance;
  private skinHandle: SkinTextureHandle;
  private heldModel?: THREE.Group;
  private heldItemId?: string;
  private bowTexturePath = 'item/bow';
  private invisible = false;
  private hurtFlash = 0;
  private hurtFlashStartedAt = -1;
  private disposed = false;
  private readonly ownedArmorResources?: PlayerArmorResources;

  constructor(
    private readonly skins: MinecraftSkinRegistry,
    private readonly geometries: PlayerSkinGeometryCache,
    private readonly itemVisuals: ItemVisualFactory,
    appearance: PlayerAppearance,
    options: { readonly armorResources?: PlayerArmorResources } = {},
  ) {
    this.appearanceValue = createPlayerAppearance(appearance);
    this.skinHandle = skins.acquire(this.appearanceValue.skinId);
    this.baseMaterial = createEntityMaterial({
      map: this.skinHandle.texture,
      alphaTest: 0.01,
      transparent: false,
      depthWrite: true,
    });
    this.baseMaterial.name = 'player-skin-material:base';
    const translucentOuter = this.skinHandle.outerLayerAlpha === 'translucent';
    this.outerMaterial = this.createOuterMaterial(0, translucentOuter);
    this.outerMaterials.set(0, this.outerMaterial);
    this.outerMaterials.set(1, this.createOuterMaterial(1, translucentOuter));
    this.outerMaterials.set(2, this.createOuterMaterial(2, translucentOuter));
    this.root.name = 'player-visual';
    this.bodyYawRoot.name = 'player-visual:yaw';
    const upperBody = new THREE.Group();
    const head = new THREE.Group();
    const body = new THREE.Group();
    const rightArm = new THREE.Group();
    const leftArm = new THREE.Group();
    const rightLeg = new THREE.Group();
    const leftLeg = new THREE.Group();
    const heldItem = new THREE.Group();
    upperBody.name = 'player:upper-body';
    head.name = 'player:head-pivot';
    body.name = 'player:body-pivot';
    rightArm.name = 'player:right-arm-pivot';
    leftArm.name = 'player:left-arm-pivot';
    rightLeg.name = 'player:right-leg-pivot';
    leftLeg.name = 'player:left-leg-pivot';
    heldItem.name = 'player:right-hand-item';
    this.rig = { upperBody, head, body, rightArm, leftArm, rightLeg, leftLeg, heldItem };
    this.root.add(this.bodyYawRoot);
    this.bodyYawRoot.add(upperBody, rightLeg, leftLeg);
    upperBody.add(head, body, rightArm, leftArm);
    rightArm.add(heldItem);
    this.configurePivots();
    const armorResources = options.armorResources ?? {
      materials: new PlayerArmorMaterialCache(),
      geometries: new PlayerArmorGeometryCache(),
    };
    if (!options.armorResources) this.ownedArmorResources = armorResources;
    this.armor = new PlayerArmorVisual(this.rig, armorResources, this.appearanceValue.model);
    this.rebuildMeshes();
    bindEntityLightReceiver(this.root);
    setEntityLight(this.root, [1, 1, 1]);
  }

  get appearance(): PlayerAppearance {
    return this.appearanceValue;
  }

  get heldItem(): string | undefined {
    return this.heldItemId;
  }

  setAppearance(appearance: PlayerAppearance): void {
    this.assertActive();
    const next = createPlayerAppearance(appearance);
    const nextHandle = this.skins.acquire(next.skinId);
    const modelChanged = next.model !== this.appearanceValue.model;
    const previous = this.skinHandle;
    this.skinHandle = nextHandle;
    this.appearanceValue = next;
    this.syncSkinMaterials(nextHandle);
    if (modelChanged) {
      this.configurePivots();
      this.rebuildMeshes();
      this.armor.setModel(next.model);
      bindEntityLightReceiver(this.root);
    } else this.syncLayerVisibility();
    previous.release();
  }

  setHeldItem(itemId?: string): void {
    this.assertActive();
    if (itemId === this.heldItemId) return;
    this.heldModel?.removeFromParent();
    this.heldItemId = itemId;
    this.heldModel = itemId ? this.itemVisuals.createItemModel(itemId) : undefined;
    this.bowTexturePath = 'item/bow';
    if (!this.heldModel || !itemId) return;
    this.rig.heldItem.add(this.heldModel);
    this.applyHeldItemTransform(this.heldModel, itemId);
  }

  setArmor(equipment: PlayerEquipmentState): void {
    this.assertActive();
    this.armor.setEquipment(equipment);
  }

  swing(): void {
    this.animator.triggerSwing();
  }

  triggerHurtFlash(nowMs = typeof performance !== 'undefined' ? performance.now() : 0): void {
    this.hurtFlashStartedAt = nowMs;
  }

  update(deltaSeconds: number, state: Readonly<PlayerVisualFrameState>): PlayerVisualPose {
    this.assertActive();
    this.invisible = state.invisible;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : 0;
    const timedFlash = this.hurtFlashStartedAt >= 0 ? playerHurtFlashIntensity(nowMs - this.hurtFlashStartedAt) : 0;
    this.hurtFlash = Math.max(THREE.MathUtils.clamp(state.hurtFlash, 0, 1), timedFlash);
    const dying = (state.deathProgress ?? 0) > 0;
    const pose = this.animator.advance(deltaSeconds, dying
      ? {
        ...state,
        movementSpeed: 0,
        sprinting: false,
        verticalVelocity: 0,
        mining: false,
        bowCharge: 0,
        swordBlocking: false,
        foodUseProgress: 0,
      }
      : state);
    this.applyPose(pose);
    if (dying) {
      const progress = Math.min(1, Math.max(0, state.deathProgress ?? 0));
      this.root.rotation.z = humanoidDeathRotationZ(progress);
      this.root.scale.setScalar(humanoidDeathScale(progress));
    } else {
      this.root.rotation.z = 0;
      this.root.scale.setScalar(1);
    }
    this.syncLayerVisibility();
    if (this.heldModel && this.heldItemId && itemRenderProfile(this.heldItemId).category === 'bow') {
      const texturePath = bowPullingTexturePath(state.bowCharge);
      if (texturePath !== this.bowTexturePath) {
        this.itemVisuals.setGeneratedTextureVariant(this.heldModel, texturePath);
        this.bowTexturePath = texturePath;
      }
    }
    return pose;
  }

  applyWorldLight(world: VoxelWorld, x: number, y: number, z: number, daylight = 1): void {
    const sample = applySampledEntityLight(this.root, world, x, y, z, 1.8, daylight);
    if (this.hurtFlash <= 0) return;
    setEntityLight(this.root, applyMobHurtTint(sample.rgb, this.hurtFlash));
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  dispose(): void {
    if (this.disposed) return;
    this.root.removeFromParent();
    this.heldModel?.removeFromParent();
    this.armor.dispose();
    this.baseMaterial.dispose();
    for (const material of this.outerMaterials.values()) material.dispose();
    this.outerMaterials.clear();
    this.skinHandle.release();
    this.partMeshes.clear();
    this.ownedArmorResources?.materials.dispose();
    this.ownedArmorResources?.geometries.dispose();
    this.disposed = true;
  }

  private configurePivots(): void {
    const pixel = PLAYER_MODEL_PIXEL;
    const slim = this.appearanceValue.model === 'slim';
    this.rig.upperBody.position.set(0, UPPER_BODY_PIVOT_Y, 0);
    this.rig.upperBody.rotation.set(0, 0, 0);
    this.rig.head.position.set(0, 12 * pixel, 0);
    this.rig.body.position.set(0, 0, 0);
    this.rig.body.rotation.set(0, 0, 0);
    this.rig.rightLeg.position.set(-1.9 * pixel, 12 * pixel, 0);
    this.rig.leftLeg.position.set(1.9 * pixel, 12 * pixel, 0);
    const shoulderY = (slim ? 21.5 : 22) * pixel - UPPER_BODY_PIVOT_Y;
    this.rig.rightArm.position.set(-5 * pixel, shoulderY, 0);
    this.rig.leftArm.position.set(5 * pixel, shoulderY, 0);
    const armCenterX = (slim ? 0.5 : 1) * pixel;
    this.rig.heldItem.position.set(-armCenterX, -10 * pixel, -1.5 * pixel);
  }

  private rebuildMeshes(): void {
    for (const meshes of this.partMeshes.values()) {
      meshes.base.removeFromParent();
      meshes.outer.removeFromParent();
    }
    this.partMeshes.clear();
    for (const part of PARTS) {
      const pivot = this.rig[part];
      const base = this.createPartMesh(part, 'base');
      const outer = this.createPartMesh(part, 'outer');
      this.positionPartMeshes(part, base, outer);
      pivot.add(base, outer);
      this.partMeshes.set(part, { base, outer });
    }
    this.syncLayerVisibility();
  }

  private createPartMesh(part: PlayerSkinPart, layer: PlayerSkinLayer): THREE.Mesh {
    const renderRank = SKIN_PART_RENDER_RANK[part];
    const depthBias = SKIN_PART_DEPTH_BIAS[part];
    const mesh = new THREE.Mesh(
      this.geometries.get(part, this.appearanceValue.model, layer),
      layer === 'base' ? this.baseMaterial : this.outerMaterials.get(depthBias)!,
    );
    mesh.name = `player:${part}:${layer}`;
    mesh.renderOrder = (layer === 'outer' ? SKIN_OUTER_RENDER_ORDER : SKIN_BASE_RENDER_ORDER) + renderRank;
    return mesh;
  }

  private createOuterMaterial(depthBias: number, transparent: boolean): THREE.MeshBasicMaterial {
    // The small seam bias is independent from the unique transparent painter rank.
    // Opaque armor writes depth first; later translucent outer pixels must pass depthTest.
    const material = createEntityMaterial({
      map: this.skinHandle.texture,
      alphaTest: 0.01,
      transparent,
      depthWrite: true,
    });
    material.name = `player-skin-material:outer:depth-bias-${depthBias}`;
    material.polygonOffset = depthBias > 0;
    material.polygonOffsetFactor = -depthBias;
    material.polygonOffsetUnits = -depthBias;
    return material;
  }

  private syncSkinMaterials(handle: SkinTextureHandle): void {
    this.baseMaterial.map = handle.texture;
    this.baseMaterial.needsUpdate = true;
    const translucentOuter = handle.outerLayerAlpha === 'translucent';
    for (const material of this.outerMaterials.values()) {
      material.map = handle.texture;
      material.transparent = translucentOuter;
      material.needsUpdate = true;
    }
  }

  private positionPartMeshes(part: PlayerSkinPart, ...meshes: THREE.Mesh[]): void {
    const pixel = PLAYER_MODEL_PIXEL;
    const slim = this.appearanceValue.model === 'slim';
    let x = 0;
    let y = 0;
    if (part === 'head') y = 4 * pixel;
    else if (part === 'body') y = 6 * pixel;
    else if (part === 'rightLeg' || part === 'leftLeg') y = -6 * pixel;
    else {
      x = (part === 'rightArm' ? -1 : 1) * (slim ? 0.5 : 1) * pixel;
      y = -4 * pixel;
    }
    for (const mesh of meshes) mesh.position.set(x, y, 0);
  }

  private syncLayerVisibility(): void {
    for (const [part, meshes] of this.partMeshes) {
      meshes.base.visible = !this.invisible;
      meshes.outer.visible = !this.invisible && this.appearanceValue.layers[LAYER_KEY[part]];
    }
    this.rig.heldItem.visible = this.heldModel !== undefined;
  }

  private applyPose(pose: PlayerVisualPose): void {
    this.bodyYawRoot.rotation.y = pose.bodyYaw;
    this.rig.upperBody.rotation.x = pose.bodyPitch;
    this.rig.upperBody.position.set(0, UPPER_BODY_PIVOT_Y + pose.bodyYOffset, pose.bodyZOffset);
    this.rig.head.rotation.set(pose.headPitch, pose.headYaw, 0, 'YXZ');
    this.rig.body.rotation.set(0, 0, 0);
    this.rig.rightArm.rotation.set(pose.rightArmX, pose.rightArmY, pose.rightArmZ, 'YXZ');
    this.rig.leftArm.rotation.set(pose.leftArmX, pose.leftArmY, pose.leftArmZ, 'YXZ');
    this.rig.rightLeg.rotation.x = pose.rightLegX;
    this.rig.leftLeg.rotation.x = pose.leftLegX;
  }

  private applyHeldItemTransform(model: THREE.Group, itemId: string): void {
    const pose = thirdPersonItemPose(itemId);
    model.position.set(...pose.position);
    model.rotation.set(...pose.rotation);
    model.scale.set(...pose.scale);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('PlayerVisual is disposed.');
  }
}
