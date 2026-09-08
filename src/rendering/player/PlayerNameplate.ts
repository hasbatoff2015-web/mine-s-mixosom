import * as THREE from 'three';

export const NAMEPLATE_HEIGHT_OFFSET = 2.15;
export const NAMEPLATE_MAX_DISTANCE = 48;
export const NAMEPLATE_FADE_START = 32;
export const NAMEPLATE_WIDTH = 1.05;
export const NAMEPLATE_HEIGHT = 0.42;

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
 * Sprite always faces the camera; text is only rebuilt when name or health changes.
 */
export class PlayerNameplate {
  readonly sprite: THREE.Sprite;
  private readonly texture: THREE.Texture;
  private readonly material: THREE.SpriteMaterial;
  private readonly canvas?: HTMLCanvasElement;
  private nameValue: string;
  private healthValue: number;
  private paintedName = '';
  private paintedHealth = Number.NaN;
  private invisible = false;
  private readonly tmp = new THREE.Vector3();

  constructor(name: string, health = 20) {
    this.nameValue = name;
    this.healthValue = health;
    const canPaint = typeof document !== 'undefined';
    this.canvas = canPaint ? document.createElement('canvas') : undefined;
    if (this.canvas) {
      this.canvas.width = 256;
      this.canvas.height = 96;
    }
    this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : new THREE.Texture();
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.LinearFilter;
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
    if (this.paintedName === this.nameValue && this.paintedHealth === this.healthValue) return;
    this.paintedName = this.nameValue;
    this.paintedHealth = this.healthValue;
    const canvas = this.canvas;
    const context = canvas?.getContext?.('2d') ?? null;
    if (!canvas || !context) return;
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgba(0, 0, 0, 0.28)';
    context.fillRect(16, 10, width - 32, height - 20);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const [name, health] = this.lines;
    this.strokeFill(context, name.slice(0, 16), width / 2, height * 0.36, 'bold 22px sans-serif', '#fff7c2');
    this.strokeFill(context, health, width / 2, height * 0.68, 'bold 18px sans-serif', '#ff6b6b');
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
    context.lineWidth = 4;
    context.strokeStyle = '#000';
    context.strokeText(text, x, y);
    context.fillStyle = fill;
    context.fillText(text, x, y);
  }
}
