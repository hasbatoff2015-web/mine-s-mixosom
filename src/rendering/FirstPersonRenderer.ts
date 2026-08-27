import * as THREE from 'three';
import { bowPullingTexturePath, itemRenderProfile, tryGetItemDefinition, type ItemRenderCategory } from '../items';
import { applyItemViewTransform, ItemVisualFactory } from './ItemVisualFactory';
import { TextureAtlas } from './TextureAtlas';
import { createTexturedCuboidGeometry } from './TexturedCuboid';
import {
  formatHeldItemQaQuery,
  heldItemQaValuesFromTransform,
  readDevHeldItemQaOverride,
  resolveHeldItemTransform,
  type HeldItemQaOverride,
} from './heldItemQa';
import {
  composeVanilla1218IdleFirstPersonRightHand,
  composeVanillaIdleFirstPersonRightHand,
  formatHeldItemMatrixOverlay,
  frontFacingMetrics,
  projectGeneratedReferencePoints,
  transformUnitAxes,
  type HeldItemMatrixDebugSnapshot,
} from './heldItemVanillaTransform';
import {
  compareLandmarksToScreenshot,
  extractIronPickaxeLandmarks,
  projectSilhouetteLandmarks,
  REFERENCE_F2_IRON_PICKAXE,
} from './heldItemLandmarks';
import type { GeneratedItemMask } from './GeneratedItemGeometry';
import { SharedFireTexture } from './fireTexture';
import {
  SharedPotionParticles,
  type PotionParticleKind,
} from './potionParticles';

export interface FirstPersonFrameState {
  visible: boolean;
  movementSpeed: number;
  onGround: boolean;
  sprinting: boolean;
  mining: boolean;
  foodUseProgress: number;
  bowCharge: number;
  swordBlocking?: boolean;
  onFire?: boolean;
  invisible?: boolean;
  potionActive?: boolean;
  potionKind?: PotionParticleKind;
}

const ARM_BASE_POSITION = Object.freeze([0.53, -0.48, -0.84] as const);
const ARM_BASE_ROTATION = Object.freeze([-0.48, 0.18, -0.30] as const);

/** Separate camera-space scene rendered after the world with a fresh depth buffer. */
export class FirstPersonRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 12);
  readonly root = new THREE.Group();
  private readonly armPivot = new THREE.Group();
  private readonly itemHolder = new THREE.Group();
  private readonly armGeometry = createTexturedCuboidGeometry({
    size: [4, 12, 4],
    textureOffset: [40, 16],
    logicalTextureSize: [64, 64],
    physicalSize: [0.16, 0.48, 0.16],
  });
  private readonly armTexture: THREE.Texture;
  private readonly armMaterial: THREE.MeshLambertMaterial;
  private mainModel?: THREE.Group;
  private mainItem?: string;
  private mainCategory?: ItemRenderCategory;
  private elapsedSeconds = 0;
  private walkPhase = 0;
  private walkStrength = 0;
  private swingSeconds = 1;
  private equipProgress = 1;
  private bowTexturePath = 'item/bow';
  private readonly fireOverlay: THREE.Object3D;
  private readonly potionOverlay: THREE.Group;
  private invisible = false;
  private disposed = false;
  private heldQaOverride?: HeldItemQaOverride;
  private loggedHeldQa = false;
  private readonly heldQaFromUrl: boolean;

  /** QA-only: drop residual idle bob / equip dip so matrices are comparable. */
  private readonly freezeIdleMotion: boolean;

  constructor(
    private readonly visuals: ItemVisualFactory,
    options: { readonly qaOverride?: HeldItemQaOverride; readonly freezeIdleMotion?: boolean } = {},
  ) {
    const fromUrl = options.qaOverride === undefined ? readDevHeldItemQaOverride() : undefined;
    this.heldQaOverride = options.qaOverride ?? fromUrl;
    this.heldQaFromUrl = fromUrl !== undefined;
    this.freezeIdleMotion = options.freezeIdleMotion === true;
    this.scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x4a382d, 1.75));
    const key = new THREE.DirectionalLight(0xffe4c2, 1.9);
    key.position.set(-2, 4, 3);
    this.scene.add(key, this.root);
    this.root.add(this.armPivot, this.itemHolder);
    this.armTexture = this.createDefaultArmTexture();
    this.armMaterial = new THREE.MeshLambertMaterial({ map: this.armTexture, flatShading: true });
    const arm = new THREE.Mesh(this.armGeometry, this.armMaterial);
    arm.name = 'first-person:right-arm';
    arm.position.y = -0.22;
    this.armPivot.add(arm);
    this.fireOverlay = SharedFireTexture.instance().createFirstPersonOverlay();
    this.fireOverlay.visible = false;
    this.scene.add(this.fireOverlay);
    this.potionOverlay = SharedPotionParticles.instance().createFirstPersonOverlay();
    this.potionOverlay.visible = false;
    this.scene.add(this.potionOverlay);
  }

  get heldItemId(): string | undefined {
    return this.mainItem;
  }

  get heldCategory(): ItemRenderCategory | undefined {
    return this.mainCategory;
  }

  get objectCount(): number {
    let count = 0;
    this.root.traverse(() => { count += 1; });
    return count;
  }

  /** QA-only live override. Does not write production `FIRST_PERSON_SPRITE_POSE`. */
  setHeldQaOverride(override?: HeldItemQaOverride): void {
    this.heldQaOverride = override;
  }

  setHeldItems(mainItemId?: string): void {
    if (mainItemId !== this.mainItem) {
      this.mainModel?.removeFromParent();
      this.mainModel = mainItemId ? this.visuals.createItemModel(mainItemId) : undefined;
      if (this.mainModel) this.itemHolder.add(this.mainModel);
      this.mainItem = mainItemId;
      this.mainCategory = mainItemId ? itemRenderProfile(mainItemId).category : undefined;
      this.syncArmVisibility();
      this.bowTexturePath = 'item/bow';
      this.equipProgress = 0;
    }
  }

  swing(): void {
    this.swingSeconds = 0;
  }

  update(deltaSeconds: number, state: Readonly<FirstPersonFrameState>): void {
    if (this.disposed) return;
    const delta = THREE.MathUtils.clamp(deltaSeconds, 0, 0.1);
    this.elapsedSeconds += delta;
    this.swingSeconds += delta;
    this.equipProgress = Math.min(1, this.equipProgress + delta * 7.5);
    if (this.freezeIdleMotion) {
      this.equipProgress = 1;
      this.swingSeconds = 1;
      this.walkStrength = 0;
      this.walkPhase = 0;
    }
    this.root.visible = state.visible;
    this.invisible = state.invisible === true;
    this.syncArmVisibility();
    this.fireOverlay.visible = state.visible && state.onFire === true;
    const potionActive = state.potionActive === true;
    this.potionOverlay.visible = state.visible && potionActive;
    if (potionActive) {
      SharedPotionParticles.instance().update(delta, state.potionKind ?? 'invisibility');
    }
    if (!state.visible) return;

    const targetWalk = state.onGround ? THREE.MathUtils.clamp(state.movementSpeed / 4.3, 0, 1) : 0;
    this.walkStrength += (targetWalk - this.walkStrength) * Math.min(1, delta * 10);
    this.walkPhase += delta * (5.5 + state.movementSpeed * 1.25);
    const sprintFactor = state.sprinting ? 1.22 : 1;
    const bobX = Math.sin(this.walkPhase) * 0.025 * this.walkStrength * sprintFactor;
    const bobY = -Math.abs(Math.cos(this.walkPhase)) * 0.018 * this.walkStrength * sprintFactor;
    const idle = this.freezeIdleMotion ? 0 : Math.sin(this.elapsedSeconds * 1.35) * 0.004;

    const explicitProgress = THREE.MathUtils.clamp(this.swingSeconds / 0.30, 0, 1);
    const miningProgress = (this.elapsedSeconds * 3.15) % 1;
    const swingProgress = explicitProgress < 1 ? explicitProgress : state.mining ? miningProgress : 1;
    const swingActive = explicitProgress < 1 || state.mining;
    const swingArc = swingActive ? Math.sin(Math.sqrt(swingProgress) * Math.PI) : 0;
    const swingDip = swingActive ? Math.sin(swingProgress * Math.PI * 2) : 0;

    this.root.position.set(bobX - swingArc * 0.19, bobY - swingDip * 0.07 + idle, 0);
    this.root.rotation.set(
      bobY * 0.8 + swingArc * 0.12,
      -bobX * 1.5 + swingArc * 0.38,
      bobX * 0.9 - swingArc * 0.34,
    );

    this.armPivot.position.set(
      ARM_BASE_POSITION[0] + swingArc * 0.05,
      ARM_BASE_POSITION[1] - (1 - this.equipProgress) * 0.20 - swingArc * 0.08,
      ARM_BASE_POSITION[2] + swingArc * 0.04,
    );
    this.armPivot.rotation.set(
      ARM_BASE_ROTATION[0] - swingArc * 0.52,
      ARM_BASE_ROTATION[1] + swingArc * 0.16,
      ARM_BASE_ROTATION[2] - swingArc * 0.34,
    );

    if (this.mainModel && this.mainItem) {
      const base = itemRenderProfile(this.mainItem).transforms.firstPersonRightHand;
      const resolved = resolveHeldItemTransform(base, this.heldQaOverride);
      applyItemViewTransform(this.mainModel, resolved);
      if (this.heldQaFromUrl && !this.loggedHeldQa) {
        this.loggedHeldQa = true;
        console.info(`[held-qa] ${formatHeldItemQaQuery(heldItemQaValuesFromTransform(resolved))}`);
      }
      this.mainModel.position.y -= (1 - this.equipProgress) * 0.22;
      const held = tryGetItemDefinition(this.mainItem);
      if (state.swordBlocking && held?.kind === 'weapon' && held.weapon === 'sword') {
        // Overlay on the accepted idle pose; no new mesh/material, no accumulated transforms.
        this.mainModel.position.x -= 0.25;
        this.mainModel.position.y += 0.13;
        this.mainModel.position.z += 0.10;
        this.mainModel.rotation.x -= 0.35;
        this.mainModel.rotation.y += 0.45;
        this.mainModel.rotation.z += 0.85;
      }
      if (state.foodUseProgress > 0) this.applyEatPose(this.mainModel, state.foodUseProgress);
      if (this.mainCategory === 'bow') this.updateBowTexture(this.mainModel, state.bowCharge);
    }

  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.root.visible || this.disposed) return;
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = previousAutoClear;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Idle alignment of the generated +Z front against the viewmodel camera.
   * 1 means the sprite faces the camera; walk/swing parent rotations reduce it.
   */
  measureHeldFrontCameraDot(): number | undefined {
    if (!this.mainModel) return undefined;
    this.mainModel.updateWorldMatrix(true, true);
    this.camera.updateMatrixWorld();
    const front = new THREE.Vector3(0, 0, 1).transformDirection(this.mainModel.matrixWorld).normalize();
    const view = new THREE.Vector3();
    this.camera.getWorldDirection(view);
    return -front.dot(view);
  }

  heldFrontWorldNormal(): THREE.Vector3 | undefined {
    if (!this.mainModel) return undefined;
    this.mainModel.updateWorldMatrix(true, true);
    return new THREE.Vector3(0, 0, 1).transformDirection(this.mainModel.matrixWorld).normalize();
  }

  /**
   * Snapshot of the live held-item matrices plus the proposed vanilla idle
   * right-hand matrix. The vanilla matrix is diagnostic only and is not
   * written onto the mesh.
   */
  captureHeldItemMatrixDebug(mask?: GeneratedItemMask): HeldItemMatrixDebugSnapshot | undefined {
    if (!this.mainModel) return undefined;
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
    this.root.updateWorldMatrix(true, true);
    const itemLocal = this.mainModel.matrix.clone();
    const itemWorld = this.mainModel.matrixWorld.clone();
    const modelView = new THREE.Matrix4().multiplyMatrices(this.camera.matrixWorldInverse, itemWorld);
    const vanillaModelView = composeVanillaIdleFirstPersonRightHand();
    const vanilla1218ModelView = composeVanilla1218IdleFirstPersonRightHand();
    const landmarks = mask ? extractIronPickaxeLandmarks(mask) : undefined;
    const silhouetteProduction = landmarks
      ? projectSilhouetteLandmarks(landmarks, modelView, this.camera)
      : undefined;
    const silhouetteVanilla = landmarks
      ? projectSilhouetteLandmarks(landmarks, vanillaModelView, this.camera)
      : undefined;
    const f2Camera = new THREE.PerspectiveCamera(
      REFERENCE_F2_IRON_PICKAXE.handFovDegrees,
      REFERENCE_F2_IRON_PICKAXE.aspect,
      this.camera.near,
      this.camera.far,
    );
    f2Camera.updateProjectionMatrix();
    const screenshotComparison = landmarks
      ? compareLandmarksToScreenshot(
        projectSilhouetteLandmarks(landmarks, modelView, f2Camera),
        projectSilhouetteLandmarks(landmarks, vanillaModelView, f2Camera),
      )
      : undefined;
    return {
      itemId: this.mainItem,
      freezeIdleMotion: this.freezeIdleMotion,
      camera: {
        type: this.camera.type,
        fov: this.camera.fov,
        aspect: this.camera.aspect,
        near: this.camera.near,
        far: this.camera.far,
      },
      itemLocal,
      itemWorld,
      modelView,
      productionPoints: projectGeneratedReferencePoints(modelView, this.camera),
      productionBasis: transformUnitAxes(modelView),
      productionFacing: frontFacingMetrics(modelView),
      vanillaModelView,
      vanilla1218ModelView,
      vanillaPoints: projectGeneratedReferencePoints(vanillaModelView, this.camera),
      vanillaBasis: transformUnitAxes(vanillaModelView),
      vanillaFacing: frontFacingMetrics(vanillaModelView),
      silhouetteProduction,
      silhouetteVanilla,
      screenshotComparison,
    };
  }

  formatHeldItemMatrixOverlay(mask?: GeneratedItemMask): string | undefined {
    const snapshot = this.captureHeldItemMatrixDebug(mask);
    return snapshot ? formatHeldItemMatrixOverlay(snapshot) : undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.mainModel?.removeFromParent();
    this.armGeometry.dispose();
    this.armMaterial.dispose();
    this.armTexture.dispose();
    this.fireOverlay.removeFromParent();
    this.fireOverlay.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.potionOverlay.removeFromParent();
    SharedPotionParticles.instance().release(this.potionOverlay);
    this.disposed = true;
  }

  private syncArmVisibility(): void {
    this.armPivot.visible = this.mainItem === undefined && !this.invisible;
  }

  private applyEatPose(model: THREE.Object3D, progress: number): void {
    const cadence = Math.abs(Math.cos(progress * Math.PI * 8));
    const settle = Math.sin(Math.min(1, progress * 1.5) * Math.PI * 0.5);
    model.position.x -= 0.08 * settle;
    model.position.y += 0.10 * settle + cadence * 0.018;
    model.position.z += 0.11 * settle;
    model.rotation.x += 0.38 * settle;
    model.rotation.y += 0.25 * settle;
    model.rotation.z += 0.18 * cadence;
  }

  private updateBowTexture(model: THREE.Group, charge: number): void {
    const texturePath = bowPullingTexturePath(charge);
    if (texturePath === this.bowTexturePath) return;
    this.visuals.setGeneratedTextureVariant(model, texturePath);
    this.bowTexturePath = texturePath;
  }

  private createDefaultArmTexture(): THREE.Texture {
    const texture = typeof document === 'undefined'
      ? new THREE.Texture()
      : new THREE.TextureLoader().load(TextureAtlas.url('entity/steve'));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    return texture;
  }
}
