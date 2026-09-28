import * as THREE from 'three';
import { hologramCanvasFont, hologramTextCanvasScale } from '../../../shared/hologramStyle';
import {
  configureHologramTextTexture,
  createHologramTextCanvas,
  ensureHologramTextCanvasResolution,
  hologramDevicePixelRatio,
  loadHologramCanvasFonts,
} from '../hologramTextCanvas';
import { nameplateOpacity } from './PlayerNameplate';
import {
  PLAYER_CHAT_BUBBLE_COLOR,
  PLAYER_CHAT_BUBBLE_FONT_PX,
  PLAYER_CHAT_BUBBLE_LINE_LOGICAL_HEIGHT,
  PLAYER_CHAT_BUBBLE_PAD_Y,
  PLAYER_CHAT_BUBBLE_STROKE_WIDTH,
  PlayerChatBubbleState,
  playerChatBubbleLayout,
} from './playerChatBubbleLayout';

/**
 * Transient billboard above a remote player's nameplate.
 * One sprite per player. Not a persisted world hologram.
 */
export class PlayerChatBubble {
  readonly sprite: THREE.Sprite;
  readonly state = new PlayerChatBubbleState();
  private readonly texture: THREE.CanvasTexture | THREE.Texture;
  private readonly material: THREE.SpriteMaterial;
  private readonly canvas?: HTMLCanvasElement;
  private paintedKey = '';
  private paintCount = 0;
  private invisible = false;
  private worldWidth = 0.4;
  private worldHeight = 0.34;
  private readonly tmp = new THREE.Vector3();

  constructor() {
    const canPaint = typeof document !== 'undefined';
    this.canvas = canPaint ? createHologramTextCanvas(hologramDevicePixelRatio(), 64, 64) : undefined;
    this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : new THREE.Texture();
    if (this.texture instanceof THREE.CanvasTexture) configureHologramTextTexture(this.texture);
    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.name = 'player-chat-bubble';
    this.sprite.visible = false;
    this.sprite.renderOrder = 10;
    loadHologramCanvasFonts(() => {
      this.paintedKey = '';
      this.paint();
    });
  }

  get text(): string {
    return this.state.text;
  }

  get lines(): readonly string[] {
    return this.state.lines;
  }

  get paints(): number {
    return this.paintCount;
  }

  show(text: string, now: number): void {
    this.state.show(text, now);
    this.layout();
    this.paint();
  }

  clear(): void {
    this.state.clear();
    this.sprite.visible = false;
    this.material.opacity = 0;
  }

  setInvisible(invisible: boolean): void {
    this.invisible = invisible;
  }

  visibleAt(now: number): boolean {
    return this.state.visibleAt(now);
  }

  update(camera: THREE.Camera, now: number): void {
    const active = this.state.visibleAt(now) && !this.invisible;
    if (!active) {
      this.sprite.visible = false;
      this.material.opacity = 0;
      return;
    }
    this.sprite.getWorldPosition(this.tmp);
    const distance = Math.hypot(
      this.tmp.x - camera.position.x,
      this.tmp.y - camera.position.y,
      this.tmp.z - camera.position.z,
    );
    const opacity = nameplateOpacity(distance);
    this.sprite.visible = opacity > 0.02;
    this.material.opacity = opacity;
    const scale = THREE.MathUtils.clamp(0.72 + distance * 0.008, 0.72, 1.15);
    this.sprite.scale.set(this.worldWidth * scale, this.worldHeight * scale, 1);
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.texture.dispose();
    this.material.dispose();
  }

  private layout(): void {
    const layout = playerChatBubbleLayout(this.state.lines);
    this.worldWidth = layout.worldWidth;
    this.worldHeight = layout.worldHeight;
    this.sprite.position.set(0, layout.centerY, 0);
    this.sprite.scale.set(layout.worldWidth, layout.worldHeight, 1);
  }

  private paint(): void {
    if (this.state.lines.length === 0) return;
    const scale = hologramTextCanvasScale(hologramDevicePixelRatio());
    const layout = playerChatBubbleLayout(this.state.lines);
    const key = `${this.state.text}|${scale}|${layout.logicalWidth}|${layout.logicalHeight}`;
    if (this.paintedKey === key) return;
    this.paintedKey = key;
    this.paintCount += 1;
    this.layout();
    const canvas = this.canvas;
    const context = canvas?.getContext?.('2d') ?? null;
    if (!canvas || !context) return;
    ensureHologramTextCanvasResolution(canvas, scale, layout.logicalWidth, layout.logicalHeight);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, layout.logicalWidth, layout.logicalHeight);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    const font = hologramCanvasFont('display', 'bold', PLAYER_CHAT_BUBBLE_FONT_PX);
    context.font = font;
    context.lineWidth = PLAYER_CHAT_BUBBLE_STROKE_WIDTH;
    context.strokeStyle = '#000';
    context.fillStyle = PLAYER_CHAT_BUBBLE_COLOR;
    this.state.lines.forEach((line, index) => {
      const y = PLAYER_CHAT_BUBBLE_PAD_Y + (index + 0.5) * PLAYER_CHAT_BUBBLE_LINE_LOGICAL_HEIGHT;
      context.strokeText(line, layout.logicalWidth / 2, y);
      context.fillText(line, layout.logicalWidth / 2, y);
    });
    this.texture.needsUpdate = true;
  }
}
