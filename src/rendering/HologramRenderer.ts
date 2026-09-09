import * as THREE from 'three';
import type { NetworkHologram } from '../../shared/protocol';
import {
  HOLOGRAM_TEXT_FONT_PX,
  HOLOGRAM_TEXT_LOGICAL_HEIGHT,
  HOLOGRAM_TEXT_LOGICAL_WIDTH,
  hologramCanvasFont,
  hologramDisplayLines,
  hologramSpriteHeight,
  hologramSpriteWidth,
  hologramTextCanvasSize,
  type HologramFont,
  type HologramTextStyle,
} from '../../shared/hologramStyle';
import { pickHologramRayHit, type HologramRayHit } from '../gameplay/hologramHit';

interface HologramVisual {
  readonly name: string;
  range: number;
  billboard: boolean;
  yaw: number;
  group: THREE.Group;
  background: THREE.Mesh;
  text: THREE.Mesh;
  texture: THREE.CanvasTexture;
  textMaterial: THREE.MeshBasicMaterial;
  backgroundMaterial: THREE.MeshBasicMaterial;
  paintedKey: string;
}

/**
 * Client holograms. Server remains source of truth; this only renders.
 * Billboard copies the camera quaternion. Fixed uses stored world yaw only — no lookAt.
 * Text sharpness comes from a supersampled canvas; world-space plane scale is unchanged.
 */
export class HologramRenderer {
  private readonly visuals = new Map<string, HologramVisual>();
  private readonly tmp = new THREE.Vector3();
  private readonly fixedEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly plane = new THREE.PlaneGeometry(1, 1);
  private holograms: readonly NetworkHologram[] = [];
  private fontsReady = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly getServerNowMs: () => number = () => Date.now(),
  ) {
    this.prepareFonts();
  }

  sync(holograms: readonly NetworkHologram[]): void {
    this.holograms = holograms;
    const keep = new Set<string>();
    for (const hologram of holograms) {
      if (!hologram.enabled) continue;
      keep.add(hologram.name);
      const existing = this.visuals.get(hologram.name);
      if (existing) {
        existing.group.position.set(hologram.x, hologram.y, hologram.z);
        existing.range = hologram.range;
        existing.billboard = hologram.billboard;
        existing.yaw = hologram.yaw;
        this.paint(existing, hologram);
        continue;
      }
      const texture = new THREE.CanvasTexture(this.makeCanvas());
      this.configureTextTexture(texture);
      const textMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
      });
      const backgroundMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        opacity: 0.35,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
      });
      const background = new THREE.Mesh(this.plane, backgroundMaterial);
      background.position.z = -0.02;
      background.renderOrder = 7;
      const text = new THREE.Mesh(this.plane, textMaterial);
      text.renderOrder = 8;
      const group = new THREE.Group();
      group.position.set(hologram.x, hologram.y, hologram.z);
      group.add(background);
      group.add(text);
      this.scene.add(group);
      const visual: HologramVisual = {
        name: hologram.name,
        range: hologram.range,
        billboard: hologram.billboard,
        yaw: hologram.yaw,
        group,
        background,
        text,
        texture,
        textMaterial,
        backgroundMaterial,
        paintedKey: '',
      };
      this.paint(visual, hologram);
      this.visuals.set(hologram.name, visual);
    }
    for (const [name, visual] of this.visuals) {
      if (keep.has(name)) continue;
      this.disposeVisual(visual);
      this.visuals.delete(name);
    }
  }

  raycast(
    origin: { x: number; y: number; z: number },
    direction: { x: number; y: number; z: number },
    maxDistance: number,
  ): HologramRayHit | undefined {
    return pickHologramRayHit(this.holograms, origin, direction, maxDistance);
  }

  update(): void {
    const now = this.getServerNowMs();
    this.camera.getWorldPosition(this.tmp);
    for (const hologram of this.holograms) {
      if (!hologram.enabled) continue;
      const visual = this.visuals.get(hologram.name);
      if (!visual) continue;
      if (hologram.kind === 'timer') this.paint(visual, hologram, now);
      const dx = visual.group.position.x - this.tmp.x;
      const dy = visual.group.position.y - this.tmp.y;
      const dz = visual.group.position.z - this.tmp.z;
      visual.group.visible = dx * dx + dy * dy + dz * dz <= visual.range * visual.range;
      if (visual.billboard) {
        visual.group.quaternion.copy(this.camera.quaternion);
      } else {
        this.fixedEuler.set(0, visual.yaw, 0);
        visual.group.quaternion.setFromEuler(this.fixedEuler);
      }
    }
  }

  dispose(): void {
    for (const visual of this.visuals.values()) this.disposeVisual(visual);
    this.visuals.clear();
    this.holograms = [];
    this.plane.dispose();
  }

  private disposeVisual(visual: HologramVisual): void {
    this.scene.remove(visual.group);
    visual.texture.dispose();
    visual.textMaterial.dispose();
    visual.backgroundMaterial.dispose();
  }

  private configureTextTexture(texture: THREE.CanvasTexture): void {
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
  }

  private devicePixelRatio(): number {
    if (typeof window === 'undefined') return 1;
    const dpr = window.devicePixelRatio;
    return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  }

  private makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    const size = hologramTextCanvasSize(this.devicePixelRatio());
    canvas.width = size.width;
    canvas.height = size.height;
    return canvas;
  }

  private ensureCanvasResolution(canvas: HTMLCanvasElement, scale: number): void {
    const width = HOLOGRAM_TEXT_LOGICAL_WIDTH * scale;
    const height = HOLOGRAM_TEXT_LOGICAL_HEIGHT * scale;
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
  }

  private paint(visual: HologramVisual, hologram: NetworkHologram, nowMs = this.getServerNowMs()): void {
    const lines = hologramDisplayLines(hologram, nowMs);
    const scale = hologramTextCanvasSize(this.devicePixelRatio()).scale;
    const key = [
      hologram.kind,
      hologram.font,
      hologram.style,
      hologram.size,
      hologram.backgroundEnabled ? '1' : '0',
      hologram.backgroundWidth,
      hologram.backgroundHeight,
      scale,
      lines.join('\n'),
    ].join('|');
    if (visual.paintedKey !== key) {
      const canvas = visual.texture.image as HTMLCanvasElement;
      this.ensureCanvasResolution(canvas, scale);
      this.draw(canvas, lines, hologram.font, hologram.style, scale);
      visual.texture.needsUpdate = true;
      visual.paintedKey = key;
    }
    const textLines = Math.max(1, lines.length);
    visual.text.scale.set(
      hologramSpriteWidth(hologram.size),
      hologramSpriteHeight(textLines, hologram.size),
      1,
    );
    visual.background.visible = hologram.backgroundEnabled;
    visual.background.scale.set(hologram.backgroundWidth, hologram.backgroundHeight, 1);
  }

  private draw(
    canvas: HTMLCanvasElement,
    lines: readonly string[],
    font: HologramFont,
    style: HologramTextStyle,
    scale: number,
  ): void {
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, HOLOGRAM_TEXT_LOGICAL_WIDTH, HOLOGRAM_TEXT_LOGICAL_HEIGHT);
    context.font = hologramCanvasFont(font, style, HOLOGRAM_TEXT_FONT_PX);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const usable = lines.length > 0 ? lines : [' '];
    const step = HOLOGRAM_TEXT_LOGICAL_HEIGHT / (usable.length + 1);
    usable.forEach((line, index) => {
      const y = step * (index + 1);
      const text = line.slice(0, 80);
      context.strokeStyle = '#000';
      context.lineWidth = 6;
      context.strokeText(text, HOLOGRAM_TEXT_LOGICAL_WIDTH / 2, y);
      context.fillStyle = '#fff7c2';
      context.fillText(text, HOLOGRAM_TEXT_LOGICAL_WIDTH / 2, y);
    });
  }

  private prepareFonts(): void {
    if (typeof document === 'undefined' || !document.fonts) return;
    const sizes = [HOLOGRAM_TEXT_FONT_PX, HOLOGRAM_TEXT_FONT_PX * 2, HOLOGRAM_TEXT_FONT_PX * 4];
    void Promise.all([
      ...sizes.flatMap((px) => [
        document.fonts.load(`700 ${px}px "Inter"`),
        document.fonts.load(`400 ${px}px "Inter"`),
        document.fonts.load(`400 ${px}px "Press Start 2P"`),
      ]),
      document.fonts.ready,
    ]).then(() => {
      if (this.fontsReady) return;
      this.fontsReady = true;
      this.sync(this.holograms);
    });
  }
}
