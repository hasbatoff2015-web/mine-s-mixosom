import * as THREE from 'three';
import { bowPullingTexturePath, itemRenderProfile, type ItemRenderCategory } from '../items';
import { applyItemViewTransform, ItemVisualFactory } from './ItemVisualFactory';
import { TextureAtlas } from './TextureAtlas';
import { createTexturedCuboidGeometry } from './TexturedCuboid';

export interface FirstPersonFrameState {
  visible: boolean;
  movementSpeed: number;
  onGround: boolean;
  sprinting: boolean;
  mining: boolean;
  foodUseProgress: number;
  bowCharge: number;
  shieldRaised: boolean;
}

const ARM_BASE_POSITION = Object.freeze([0.53, -0.48, -0.84] as const);
const ARM_BASE_ROTATION = Object.freeze([-0.48, 0.18, -0.30] as const);
const OFFHAND_SHIELD_POSITION = Object.freeze([-0.52, -0.33, -0.82] as const);

/** Separate camera-space scene rendered after the world with a fresh depth buffer. */
export class FirstPersonRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 12);
  readonly root = new THREE.Group();
  private readonly armPivot = new THREE.Group();
  private readonly itemHolder = new THREE.Group();
  private readonly offhandHolder = new THREE.Group();
  private readonly armGeometry = createTexturedCuboidGeometry({
    size: [4, 12, 4],
    textureOffset: [40, 16],
    logicalTextureSize: [64, 64],
    physicalSize: [0.16, 0.48, 0.16],
  });
  private readonly armTexture: THREE.Texture;
  private readonly armMaterial: THREE.MeshLambertMaterial;
  private mainModel?: THREE.Group;
  private offhandModel?: THREE.Group;
  private mainItem?: string;
  private offhandItem?: string;
  private mainCategory?: ItemRenderCategory;
  private elapsedSeconds = 0;
  private walkPhase = 0;
  private walkStrength = 0;
  private swingSeconds = 1;
  private equipProgress = 1;
  private bowTexturePath = 'item/bow';
  private disposed = false;

  constructor(private readonly visuals: ItemVisualFactory) {
    this.scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x4a382d, 1.75));
    const key = new THREE.DirectionalLight(0xffe4c2, 1.9);
    key.position.set(-2, 4, 3);
    this.scene.add(key, this.root);
    this.root.add(this.armPivot, this.itemHolder, this.offhandHolder);
    this.armTexture = this.createDefaultArmTexture();
    this.armMaterial = new THREE.MeshLambertMaterial({ map: this.armTexture, flatShading: true });
    const arm = new THREE.Mesh(this.armGeometry, this.armMaterial);
    arm.name = 'first-person:right-arm';
    arm.position.y = -0.22;
    this.armPivot.add(arm);
    this.offhandHolder.visible = false;
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

  setHeldItems(mainItemId?: string, offhandItemId?: string): void {
    if (mainItemId !== this.mainItem) {
      this.mainModel?.removeFromParent();
      this.mainModel = mainItemId ? this.visuals.createItemModel(mainItemId) : undefined;
      if (this.mainModel) this.itemHolder.add(this.mainModel);
      this.mainItem = mainItemId;
      this.mainCategory = mainItemId ? itemRenderProfile(mainItemId).category : undefined;
      this.armPivot.visible = mainItemId === undefined;
      this.bowTexturePath = 'item/bow';
      this.equipProgress = 0;
    }
    if (offhandItemId !== this.offhandItem) {
      this.offhandModel?.removeFromParent();
      this.offhandModel = offhandItemId ? this.visuals.createItemModel(offhandItemId) : undefined;
      if (this.offhandModel) this.offhandHolder.add(this.offhandModel);
      this.offhandItem = offhandItemId;
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
    this.root.visible = state.visible;
    if (!state.visible) return;

    const targetWalk = state.onGround ? THREE.MathUtils.clamp(state.movementSpeed / 4.3, 0, 1) : 0;
    this.walkStrength += (targetWalk - this.walkStrength) * Math.min(1, delta * 10);
    this.walkPhase += delta * (5.5 + state.movementSpeed * 1.25);
    const sprintFactor = state.sprinting ? 1.22 : 1;
    const bobX = Math.sin(this.walkPhase) * 0.025 * this.walkStrength * sprintFactor;
    const bobY = -Math.abs(Math.cos(this.walkPhase)) * 0.018 * this.walkStrength * sprintFactor;
    const idle = Math.sin(this.elapsedSeconds * 1.35) * 0.004;

    const explicitProgress = THREE.MathUtils.clamp(this.swingSeconds / 0.34, 0, 1);
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
      applyItemViewTransform(this.mainModel, itemRenderProfile(this.mainItem).transforms.firstPersonRightHand);
      this.mainModel.position.y -= (1 - this.equipProgress) * 0.22;
      if (state.foodUseProgress > 0) this.applyEatPose(this.mainModel, state.foodUseProgress);
      if (this.mainCategory === 'bow') this.updateBowTexture(this.mainModel, state.bowCharge);
      if (this.mainCategory === 'shield' && state.shieldRaised) this.applyShieldPose(this.mainModel, false);
    }

    const offhandShieldRaised = this.offhandItem === 'shield' && state.shieldRaised && this.mainItem !== 'shield';
    this.offhandHolder.visible = offhandShieldRaised;
    if (offhandShieldRaised && this.offhandModel) {
      applyItemViewTransform(this.offhandModel, itemRenderProfile('shield').transforms.firstPersonRightHand);
      this.applyShieldPose(this.offhandModel, true);
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

  dispose(): void {
    if (this.disposed) return;
    this.mainModel?.removeFromParent();
    this.offhandModel?.removeFromParent();
    this.armGeometry.dispose();
    this.armMaterial.dispose();
    this.armTexture.dispose();
    this.disposed = true;
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

  private applyShieldPose(model: THREE.Object3D, leftHand: boolean): void {
    model.position.set(
      leftHand ? OFFHAND_SHIELD_POSITION[0] : 0.20,
      OFFHAND_SHIELD_POSITION[1] + 0.12,
      OFFHAND_SHIELD_POSITION[2] + 0.18,
    );
    model.rotation.set(-0.16, leftHand ? 0.58 : -0.58, leftHand ? 0.10 : -0.10);
    model.scale.setScalar(0.72);
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
