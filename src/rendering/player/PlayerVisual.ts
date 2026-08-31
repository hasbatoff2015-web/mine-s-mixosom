import * as THREE from 'three';
import { bowPullingTexturePath, itemRenderProfile, type ItemRenderCategory } from '../../items';
import type { VoxelWorld } from '../../world/World';
import {
  createPlayerAppearance,
  type PlayerAppearance,
  type PlayerSkinLayers,
} from '../../player/appearance/PlayerAppearance';
import {
  MinecraftSkinRegistry,
  type SkinTextureHandle,
} from '../../player/appearance/MinecraftSkin';
import { ItemVisualFactory } from '../ItemVisualFactory';
import {
  applySampledEntityLight,
  bindEntityLightReceiver,
  createEntityMaterial,
  setEntityLight,
} from '../worldLighting';
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

export interface PlayerVisualFrameState extends PlayerAnimationState {
  readonly invisible: boolean;
  readonly hurtFlash: number;
}

export interface PlayerVisualRig {
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
  private readonly bodyYawRoot = new THREE.Group();
  private readonly material: THREE.MeshBasicMaterial;
  private readonly partMeshes = new Map<PlayerSkinPart, SkinPartMeshes>();
  private appearanceValue: PlayerAppearance;
  private skinHandle: SkinTextureHandle;
  private heldModel?: THREE.Group;
  private heldItemId?: string;
  private bowTexturePath = 'item/bow';
  private invisible = false;
  private hurtFlash = 0;
  private disposed = false;

  constructor(
    private readonly skins: MinecraftSkinRegistry,
    private readonly geometries: PlayerSkinGeometryCache,
    private readonly itemVisuals: ItemVisualFactory,
    appearance: PlayerAppearance,
  ) {
    this.appearanceValue = createPlayerAppearance(appearance);
    this.skinHandle = skins.acquire(this.appearanceValue.skinId);
    this.material = createEntityMaterial({
      map: this.skinHandle.texture,
      alphaTest: 0.01,
      transparent: true,
      depthWrite: true,
    });
    this.material.name = 'player-skin-material';
    this.root.name = 'player-visual';
    this.bodyYawRoot.name = 'player-visual:yaw';
    const head = new THREE.Group();
    const body = new THREE.Group();
    const rightArm = new THREE.Group();
    const leftArm = new THREE.Group();
    const rightLeg = new THREE.Group();
    const leftLeg = new THREE.Group();
    const heldItem = new THREE.Group();
    head.name = 'player:head-pivot';
    body.name = 'player:body-pivot';
    rightArm.name = 'player:right-arm-pivot';
    leftArm.name = 'player:left-arm-pivot';
    rightLeg.name = 'player:right-leg-pivot';
    leftLeg.name = 'player:left-leg-pivot';
    heldItem.name = 'player:right-hand-item';
    this.rig = { head, body, rightArm, leftArm, rightLeg, leftLeg, heldItem };
    this.root.add(this.bodyYawRoot);
    this.bodyYawRoot.add(head, body, rightArm, leftArm, rightLeg, leftLeg);
    rightArm.add(heldItem);
    this.configurePivots();
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
    this.material.map = nextHandle.texture;
    this.material.needsUpdate = true;
    if (modelChanged) {
      this.configurePivots();
      this.rebuildMeshes();
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
    this.applyHeldItemTransform(this.heldModel, itemRenderProfile(itemId).category);
  }

  swing(): void {
    this.animator.triggerSwing();
  }

  update(deltaSeconds: number, state: Readonly<PlayerVisualFrameState>): PlayerVisualPose {
    this.assertActive();
    this.invisible = state.invisible;
    this.hurtFlash = THREE.MathUtils.clamp(state.hurtFlash, 0, 1);
    const pose = this.animator.advance(deltaSeconds, state);
    this.applyPose(pose);
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
    const flash = this.hurtFlash;
    setEntityLight(this.root, [
      Math.min(1.2, sample.rgb[0] + flash * 0.55),
      sample.rgb[1] * (1 - flash * 0.58),
      sample.rgb[2] * (1 - flash * 0.58),
    ]);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  dispose(): void {
    if (this.disposed) return;
    this.root.removeFromParent();
    this.heldModel?.removeFromParent();
    this.material.dispose();
    this.skinHandle.release();
    this.partMeshes.clear();
    this.disposed = true;
  }

  private configurePivots(): void {
    const pixel = PLAYER_MODEL_PIXEL;
    const slim = this.appearanceValue.model === 'slim';
    this.rig.head.position.set(0, 24 * pixel, 0);
    this.rig.body.position.set(0, 12 * pixel, 0);
    this.rig.rightLeg.position.set(-1.9 * pixel, 12 * pixel, 0);
    this.rig.leftLeg.position.set(1.9 * pixel, 12 * pixel, 0);
    const shoulderY = (slim ? 21.5 : 22) * pixel;
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
    const mesh = new THREE.Mesh(
      this.geometries.get(part, this.appearanceValue.model, layer),
      this.material,
    );
    mesh.name = `player:${part}:${layer}`;
    mesh.renderOrder = layer === 'outer' ? 1 : 0;
    return mesh;
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
    this.rig.head.rotation.set(pose.headPitch, pose.headYaw, 0, 'YXZ');
    this.rig.head.position.y = 24 * PLAYER_MODEL_PIXEL + pose.bodyYOffset;
    this.rig.head.position.z = pose.bodyZOffset * 0.65;
    this.rig.body.rotation.x = pose.bodyPitch;
    this.rig.body.position.y = 12 * PLAYER_MODEL_PIXEL + pose.bodyYOffset;
    this.rig.body.position.z = pose.bodyZOffset;
    const shoulderY = (this.appearanceValue.model === 'slim' ? 21.5 : 22) * PLAYER_MODEL_PIXEL;
    this.rig.rightArm.position.y = shoulderY + pose.bodyYOffset;
    this.rig.leftArm.position.y = shoulderY + pose.bodyYOffset;
    this.rig.rightArm.position.z = pose.bodyZOffset * 0.8;
    this.rig.leftArm.position.z = pose.bodyZOffset * 0.8;
    this.rig.rightArm.rotation.set(pose.rightArmX, pose.rightArmY, pose.rightArmZ, 'YXZ');
    this.rig.leftArm.rotation.set(pose.leftArmX, pose.leftArmY, pose.leftArmZ, 'YXZ');
    this.rig.rightLeg.rotation.x = pose.rightLegX;
    this.rig.leftLeg.rotation.x = pose.leftLegX;
  }

  private applyHeldItemTransform(model: THREE.Group, category: ItemRenderCategory): void {
    if (category === 'block') {
      model.position.set(0, -0.02, -0.02);
      model.rotation.set(-0.55, 0.45, -0.28);
      model.scale.setScalar(0.24);
      return;
    }
    model.position.set(0, -0.04, -0.06);
    model.rotation.set(-0.16, 0, category === 'bow' ? 0.85 : -0.72);
    model.scale.setScalar(category === 'bow' ? 0.46 : category === 'handheld' ? 0.55 : 0.40);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('PlayerVisual is disposed.');
  }
}
