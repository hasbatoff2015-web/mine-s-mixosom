import * as THREE from 'three';
import {
  hologramCanvasFont,
  hologramTextCanvasScale,
} from '../../../shared/hologramStyle';
import {
  configureHologramTextTexture,
  createHologramTextCanvas,
  ensureHologramTextCanvasResolution,
  hologramDevicePixelRatio,
  loadHologramCanvasFonts,
} from '../hologramTextCanvas';

export const NAMEPLATE_HEIGHT_OFFSET = 2.15;
export const NAMEPLATE_MAX_DISTANCE = 48;
export const NAMEPLATE_FADE_START = 32;
/** World-space size is 2× the original 1.05×0.42 plate. */
export const NAMEPLATE_SIZE_SCALE = 2;
export const NAMEPLATE_WIDTH = 1.05 * NAMEPLATE_SIZE_SCALE;
export const NAMEPLATE_HEIGHT = 0.42 * NAMEPLATE_SIZE_SCALE;
/** Same pixel face holograms use for `font: display`. */
export const NAMEPLATE_FONT: 'display' = 'display';
export const NAMEPLATE_NAME_COLOR = '#fff7c2';
export const NAMEPLATE_HEALTH_COLOR = '#ff1f1f';
export const NAMEPLATE_NAME_FONT_PX = 44;
export const NAMEPLATE_HEALTH_FONT_PX = 36;
export const NAMEPLATE_TEXT_LOGICAL_WIDTH = 512;
export const NAMEPLATE_TEXT_LOGICAL_HEIGHT = 205;

export function nameplateLines(name: string, health: number): readonly [string, string] {
  const hp = Math.max(0, Math.round(health));
  return [name, `❤ ${hp}`];
}

export function nameplateOpacity(distance: number): number {
  if (distance >= NAMEPLATE_MAX_DISTANCE) return 0;
  if (distance <= NAMEPLATE_FADE_START) return 1;
  return 1 - (distance - NAMEPLATE_FADE_START) / (NAMEPLATE_MAX_DISTANCE - NAMEPLATE_FADE_START);
}

/**
 * Billboard nameplate owned by player presentation, not world holograms.
 * Sprite always faces the camera. Glyphs reuse hologram canvas supersampling
 * and the Press Start 2P face; there is no background panel.
 */
export class PlayerNameplate {
  readonly sprite: THREE.Sprite;
  private readonly texture: THREE.CanvasTexture | THREE.Texture;
  private readonly material: THREE.SpriteMaterial;
  private readonly canvas?: HTMLCanvasElement;
  private nameValue: string;
  private healthValue: number;
  private paintedKey = '';
  private invisible = false;
  private readonly tmp = new THREE.Vector3();

  constructor(name: string, health = 20) {
    this.nameValue = name;
    this.healthValue = health;
    const canPaint = typeof document !== 'undefined';
    this.canvas = canPaint
      ? createHologramTextCanvas(
        hologramDevicePixelRatio(),
        NAMEPLATE_TEXT_LOGICAL_WIDTH,
        NAMEPLATE_TEXT_LOGICAL_HEIGHT,
      )
      : undefined;
    this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : new THREE.Texture();
    if (this.texture instanceof THREE.CanvasTexture) configureHologramTextTexture(this.texture);
    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.name = 'player-nameplate';
    this.sprite.position.set(0, NAMEPLATE_HEIGHT_OFFSET, 0);
    this.sprite.scale.set(NAMEPLATE_WIDTH, NAMEPLATE_HEIGHT, 1);
    this.sprite.renderOrder = 9;
    this.paint();
    loadHologramCanvasFonts(() => {
      this.paintedKey = '';
      this.paint();
    });
  }

  get name(): string {
    return this.nameValue;
  }

  get health(): number {
    return this.healthValue;
  }

  get lines(): readonly [string, string] {
    return nameplateLines(this.nameValue, this.healthValue);
  }

  setIdentity(name: string, health: number): boolean {
    const nextHealth = Math.max(0, health);
    const changed = name !== this.nameValue || nextHealth !== this.healthValue;
    this.nameValue = name;
    this.healthValue = nextHealth;
    if (changed) this.paint();
    return changed;
  }

  setInvisible(invisible: boolean): void {
    this.invisible = invisible;
  }

  update(camera: THREE.Camera): void {
    this.sprite.getWorldPosition(this.tmp);
    const dx = this.tmp.x - camera.position.x;
    const dy = this.tmp.y - camera.position.y;
    const dz = this.tmp.z - camera.position.z;
    const distance = Math.hypot(dx, dy, dz);
    const opacity = this.invisible ? 0 : nameplateOpacity(distance);
    this.sprite.visible = opacity > 0.02;
    this.material.opacity = opacity;
    const scale = THREE.MathUtils.clamp(0.72 + distance * 0.008, 0.72, 1.15);
    this.sprite.scale.set(NAMEPLATE_WIDTH * scale, NAMEPLATE_HEIGHT * scale, 1);
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.texture.dispose();
    this.material.dispose();
  }

  private paint(): void {
    const scale = hologramTextCanvasScale(hologramDevicePixelRatio());
    const key = `${this.nameValue}|${this.healthValue}|${scale}`;
    if (this.paintedKey === key) return;
    this.paintedKey = key;
    const canvas = this.canvas;
    const context = canvas?.getContext?.('2d') ?? null;
    if (!canvas || !context) return;
    ensureHologramTextCanvasResolution(
      canvas,
      scale,
      NAMEPLATE_TEXT_LOGICAL_WIDTH,
      NAMEPLATE_TEXT_LOGICAL_HEIGHT,
    );
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, NAMEPLATE_TEXT_LOGICAL_WIDTH, NAMEPLATE_TEXT_LOGICAL_HEIGHT);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const [name, health] = this.lines;
    const step = NAMEPLATE_TEXT_LOGICAL_HEIGHT / 3;
    this.strokeFill(
      context,
      name.slice(0, 16),
      NAMEPLATE_TEXT_LOGICAL_WIDTH / 2,
      step,
      hologramCanvasFont(NAMEPLATE_FONT, 'bold', NAMEPLATE_NAME_FONT_PX),
      NAMEPLATE_NAME_COLOR,
    );
    this.strokeFill(
      context,
      health,
      NAMEPLATE_TEXT_LOGICAL_WIDTH / 2,
      step * 2,
      hologramCanvasFont(NAMEPLATE_FONT, 'bold', NAMEPLATE_HEALTH_FONT_PX),
      NAMEPLATE_HEALTH_COLOR,
    );
    this.texture.needsUpdate = true;
  }

  private strokeFill(
    context: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    font: string,
    fill: string,
  ): void {
    context.font = font;
    context.lineWidth = 6;
    context.strokeStyle = '#000';
    context.strokeText(text, x, y);
    context.fillStyle = fill;
    context.fillText(text, x, y);
  }
}
