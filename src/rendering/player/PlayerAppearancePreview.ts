import * as THREE from 'three';
import {
  createPlayerAppearance,
  type PlayerAppearance,
} from '../../player/appearance/PlayerAppearance';
import { ItemVisualFactory } from '../ItemVisualFactory';
import { MinecraftSkinRegistry } from './MinecraftSkin';
import { PlayerSkinGeometryCache } from './PlayerSkinGeometry';
import { PlayerVisual } from './PlayerVisual';
import type { PlayerArmorResources } from './PlayerArmorVisual';
import { setEntityLight } from '../worldLighting';

export const PREVIEW_AUTO_YAW_PER_SECOND = 0.35;
export const PREVIEW_DRAG_RADIANS_PER_PIXEL = 0.012;
const PREVIEW_INITIAL_YAW = 0.45;

export function normalizePreviewYaw(yaw: number): number {
  if (!Number.isFinite(yaw)) return PREVIEW_INITIAL_YAW;
  return Math.atan2(Math.sin(yaw), Math.cos(yaw));
}

/** Yaw state shared by the menu preview. Auto spin pauses only while a drag holds it. */
export class PreviewRotation {
  private yaw = PREVIEW_INITIAL_YAW;

  rotate(deltaRadians: number): void {
    if (!Number.isFinite(deltaRadians) || deltaRadians === 0) return;
    this.yaw = normalizePreviewYaw(this.yaw + deltaRadians);
  }

  advance(deltaSeconds: number, paused: boolean): void {
    if (paused || !Number.isFinite(deltaSeconds) || deltaSeconds === 0) return;
    this.yaw = normalizePreviewYaw(this.yaw + deltaSeconds * PREVIEW_AUTO_YAW_PER_SECOND);
  }

  read(): number {
    return this.yaw;
  }
}

export interface PlayerAppearancePreviewOptions {
  readonly canvas: HTMLCanvasElement;
  readonly skins: MinecraftSkinRegistry;
  readonly geometries: PlayerSkinGeometryCache;
  readonly items: ItemVisualFactory;
  readonly appearance: PlayerAppearance;
  readonly armorResources?: PlayerArmorResources;
}

/** Offscreen PlayerVisual used by the main-menu character panel and skin selector. */
export class PlayerAppearancePreview {
  readonly visual: PlayerVisual;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
  private readonly canvas: HTMLCanvasElement;
  private disposed = false;
  private readonly rotation = new PreviewRotation();
  private autoRotatePaused = false;

  constructor(options: PlayerAppearancePreviewOptions) {
    this.canvas = options.canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'low-power',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.scene.background = null;
    this.scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x3a2e24, 1.35));
    const key = new THREE.DirectionalLight(0xffe4c4, 1.85);
    key.position.set(-2.4, 4.2, 3.4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9ec5ff, 0.55);
    fill.position.set(3.2, 1.4, -2.2);
    this.scene.add(fill);

    this.visual = new PlayerVisual(
      options.skins,
      options.geometries,
      options.items,
      options.appearance,
      { armorResources: options.armorResources },
    );
    this.visual.root.position.set(0, 0, 0);
    this.scene.add(this.visual.root);
    setEntityLight(this.visual.root, [1.05, 1.02, 0.98]);
    this.camera.position.set(1.35, 1.15, 3.05);
    this.camera.lookAt(0, 0.95, 0);
    this.resize();
  }

  setAppearance(appearance: PlayerAppearance): void {
    if (this.disposed) return;
    this.visual.setAppearance(createPlayerAppearance(appearance));
  }

  setAutoRotatePaused(paused: boolean): void {
    if (this.disposed) return;
    this.autoRotatePaused = paused;
  }

  rotateYaw(deltaRadians: number): void {
    if (this.disposed) return;
    this.rotation.rotate(deltaRadians);
  }

  render(deltaSeconds: number): void {
    if (this.disposed || this.canvas.width === 0) return;
    this.resize();
    this.rotation.advance(deltaSeconds, this.autoRotatePaused);
    this.visual.update(deltaSeconds, {
      viewYaw: this.rotation.read(),
      viewPitch: -0.08,
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
    });
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.visual.dispose();
    this.renderer.dispose();
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const ratio = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
    if (this.canvas.width !== Math.floor(width * ratio) || this.canvas.height !== Math.floor(height * ratio)) {
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(width, height, false);
    }
    const aspect = width / height;
    if (Math.abs(this.camera.aspect - aspect) > 0.001) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
  }
}
