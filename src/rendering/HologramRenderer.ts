import * as THREE from 'three';
import type { NetworkHologram } from '../../shared/protocol';
import {
  hologramCanvasFont,
  hologramSpriteHeight,
  hologramSpriteWidth,
  type HologramFont,
  type HologramTextStyle,
} from '../../shared/hologramStyle';
import { pickHologramRayHit, type HologramRayHit } from '../gameplay/hologramHit';

interface HologramVisual {
  readonly name: string;
  range: number;
  group: THREE.Sprite;
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
}

/**
 * Client billboard holograms. Server remains source of truth; this only renders.
 */
export class HologramRenderer {
  private readonly visuals = new Map<string, HologramVisual>();
  private readonly tmp = new THREE.Vector3();
  private holograms: readonly NetworkHologram[] = [];
  private fontsReady = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
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
        this.paint(existing, hologram);
        continue;
      }
      const texture = new THREE.CanvasTexture(this.makeCanvas(hologram));
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.LinearFilter;
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(hologram.x, hologram.y, hologram.z);
      sprite.scale.set(2.4, 1.2, 1);
      sprite.renderOrder = 8;
      this.scene.add(sprite);
      const visual: HologramVisual = {
        name: hologram.name,
        range: hologram.range,
        group: sprite,
        texture,
        material,
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
    this.camera.getWorldPosition(this.tmp);
    for (const visual of this.visuals.values()) {
      const dx = visual.group.position.x - this.tmp.x;
      const dy = visual.group.position.y - this.tmp.y;
      const dz = visual.group.position.z - this.tmp.z;
      visual.group.visible = dx * dx + dy * dy + dz * dz <= visual.range * visual.range;
    }
  }

  dispose(): void {
    for (const visual of this.visuals.values()) this.disposeVisual(visual);
    this.visuals.clear();
    this.holograms = [];
  }

  private disposeVisual(visual: HologramVisual): void {
    this.scene.remove(visual.group);
    visual.texture.dispose();
    visual.material.dispose();
  }

  private makeCanvas(hologram: NetworkHologram): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    this.draw(canvas, hologram.lines, hologram.font, hologram.style);
    return canvas;
  }

  private paint(visual: HologramVisual, hologram: NetworkHologram): void {
    const canvas = visual.texture.image as HTMLCanvasElement;
    this.draw(canvas, hologram.lines, hologram.font, hologram.style);
    visual.texture.needsUpdate = true;
    visual.group.scale.set(
      hologramSpriteWidth(hologram.size),
      hologramSpriteHeight(Math.max(1, hologram.lines.length), hologram.size),
      1,
    );
  }

  private draw(
    canvas: HTMLCanvasElement,
    lines: readonly string[],
    font: HologramFont,
    style: HologramTextStyle,
  ): void {
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(0, 0, 0, 0.35)';
    context.fillRect(8, 8, canvas.width - 16, canvas.height - 16);
    context.font = hologramCanvasFont(font, style, 36);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const usable = lines.length > 0 ? lines : [' '];
    const step = canvas.height / (usable.length + 1);
    usable.forEach((line, index) => {
      const y = step * (index + 1);
      const text = line.slice(0, 80);
      context.strokeStyle = '#000';
      context.lineWidth = 6;
      context.strokeText(text, canvas.width / 2, y);
      context.fillStyle = '#fff7c2';
      context.fillText(text, canvas.width / 2, y);
    });
  }

  private prepareFonts(): void {
    if (typeof document === 'undefined' || !document.fonts) return;
    void Promise.all([
      document.fonts.load('700 36px "Inter"'),
      document.fonts.load('400 36px "Inter"'),
      document.fonts.load('400 36px "Press Start 2P"'),
      document.fonts.ready,
    ]).then(() => {
      if (this.fontsReady) return;
      this.fontsReady = true;
      this.sync(this.holograms);
    });
  }
}
