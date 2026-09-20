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

export const NAMEPLATE_HEIGHT_OFFSET = 2.05;
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
/**
 * Baseline logical atlas for short nicks. Long nicks grow past this so 44px
 * Press Start 2P glyphs are not clipped; world width scales with it.
 */
export const NAMEPLATE_TEXT_LOGICAL_WIDTH = 512;
export const NAMEPLATE_TEXT_LOGICAL_HEIGHT = 205;
export const NAMEPLATE_TEXT_PAD_X = 32;
export const NAMEPLATE_STROKE_WIDTH = 6;

export function nameplateLines(name: string, health: number): readonly [string, string] {
  const hp = Math.max(0, Math.round(health));
  return [name, `❤ ${hp}`];
}

export function nameplateOpacity(distance: number): number {
  if (distance >= NAMEPLATE_MAX_DISTANCE) return 0;
  if (distance <= NAMEPLATE_FADE_START) return 1;
  return 1 - (distance - NAMEPLATE_FADE_START) / (NAMEPLATE_MAX_DISTANCE - NAMEPLATE_FADE_START);
}

/** Press Start 2P is a square-cell face: advance ≈ font size. */
export function nameplateGlyphWidth(text: string, fontPx: number): number {
  return text.length * fontPx;
}

export function nameplateLogicalCanvasWidth(nameWidth: number, healthWidth: number): number {
  const content = Math.max(nameWidth, healthWidth, 0);
  const needed = Math.ceil(content + NAMEPLATE_STROKE_WIDTH + 2 * NAMEPLATE_TEXT_PAD_X);
  return Math.max(NAMEPLATE_TEXT_LOGICAL_WIDTH, needed);
}

/** Keep 44px glyphs the same world size when the atlas grows. */
export function nameplateWorldWidth(logicalWidth: number): number {
  return NAMEPLATE_WIDTH * (logicalWidth / NAMEPLATE_TEXT_LOGICAL_WIDTH);
}

export interface NameplateTextLayout {
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly nameWidth: number;
  readonly healthWidth: number;
  readonly nameLeft: number;
  readonly nameRight: number;
  readonly paddingLeft: number;
  readonly paddingRight: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
}

export function nameplateTextLayout(
  name: string,
  health: number,
  measured?: { readonly nameWidth?: number; readonly healthWidth?: number },
): NameplateTextLayout {
  const [nick, hp] = nameplateLines(name, health);
  const nameWidth = measured?.nameWidth ?? nameplateGlyphWidth(nick, NAMEPLATE_NAME_FONT_PX);
  const healthWidth = measured?.healthWidth ?? nameplateGlyphWidth(hp, NAMEPLATE_HEALTH_FONT_PX);
  const logicalWidth = nameplateLogicalCanvasWidth(nameWidth, healthWidth);
  const inset = NAMEPLATE_STROKE_WIDTH / 2;
  const nameLeft = logicalWidth / 2 - nameWidth / 2 - inset;
  const nameRight = logicalWidth / 2 + nameWidth / 2 + inset;
  return {
    logicalWidth,
    logicalHeight: NAMEPLATE_TEXT_LOGICAL_HEIGHT,
    nameWidth,
    healthWidth,
    nameLeft,
    nameRight,
    paddingLeft: nameLeft,
    paddingRight: logicalWidth - nameRight,
    worldWidth: nameplateWorldWidth(logicalWidth),
    worldHeight: NAMEPLATE_HEIGHT,
  };
}

function measuredLineWidth(
  context: CanvasRenderingContext2D,
  text: string,
  fontPx: number,
): number {
  const measured = context.measureText(text).width;
  const estimate = nameplateGlyphWidth(text, fontPx);
  return Number.isFinite(measured) ? Math.max(measured, estimate) : estimate;
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
  private layoutWidth = NAMEPLATE_TEXT_LOGICAL_WIDTH;
  private worldWidth = NAMEPLATE_WIDTH;
  private readonly tmp = new THREE.Vector3();

  constructor(name: string, health = 20) {
    this.nameValue = name;
    this.healthValue = health;
    const layout = nameplateTextLayout(name, health);
    this.layoutWidth = layout.logicalWidth;
    this.worldWidth = layout.worldWidth;
    const canPaint = typeof document !== 'undefined';
    this.canvas = canPaint
      ? createHologramTextCanvas(
        hologramDevicePixelRatio(),
        layout.logicalWidth,
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
    this.sprite.scale.set(this.worldWidth, NAMEPLATE_HEIGHT, 1);
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

  get logicalCanvasWidth(): number {
    return this.layoutWidth;
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
    this.sprite.scale.set(this.worldWidth * scale, NAMEPLATE_HEIGHT * scale, 1);
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.texture.dispose();
    this.material.dispose();
  }

  private paint(): void {
    const scale = hologramTextCanvasScale(hologramDevicePixelRatio());
    const canvas = this.canvas;
    const context = canvas?.getContext?.('2d') ?? null;
    const [name, health] = this.lines;
    const nameFont = hologramCanvasFont(NAMEPLATE_FONT, 'bold', NAMEPLATE_NAME_FONT_PX);
    const healthFont = hologramCanvasFont(NAMEPLATE_FONT, 'bold', NAMEPLATE_HEALTH_FONT_PX);
    let nameWidth = nameplateGlyphWidth(name, NAMEPLATE_NAME_FONT_PX);
    let healthWidth = nameplateGlyphWidth(health, NAMEPLATE_HEALTH_FONT_PX);
    if (context) {
      context.font = nameFont;
      nameWidth = measuredLineWidth(context, name, NAMEPLATE_NAME_FONT_PX);
      context.font = healthFont;
      healthWidth = measuredLineWidth(context, health, NAMEPLATE_HEALTH_FONT_PX);
    }
    const layout = nameplateTextLayout(this.nameValue, this.healthValue, { nameWidth, healthWidth });
    const key = `${name}|${health}|${scale}|${layout.logicalWidth}`;
    if (this.paintedKey === key) return;
    this.paintedKey = key;
    this.layoutWidth = layout.logicalWidth;
    this.worldWidth = layout.worldWidth;
    this.sprite.scale.set(this.worldWidth, NAMEPLATE_HEIGHT, 1);
    if (!canvas || !context) return;
    ensureHologramTextCanvasResolution(
      canvas,
      scale,
      layout.logicalWidth,
      NAMEPLATE_TEXT_LOGICAL_HEIGHT,
    );
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, layout.logicalWidth, NAMEPLATE_TEXT_LOGICAL_HEIGHT);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    const step = NAMEPLATE_TEXT_LOGICAL_HEIGHT / 3;
    this.strokeFill(
      context,
      name,
      layout.logicalWidth / 2,
      step,
      nameFont,
      NAMEPLATE_NAME_COLOR,
    );
    this.strokeFill(
      context,
      health,
      layout.logicalWidth / 2,
      step * 2,
      healthFont,
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
    context.lineWidth = NAMEPLATE_STROKE_WIDTH;
    context.strokeStyle = '#000';
    context.strokeText(text, x, y);
    context.fillStyle = fill;
    context.fillText(text, x, y);
  }
}
