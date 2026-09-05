import * as THREE from 'three';
import type { NetworkHologram } from '../../shared/protocol';

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

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {}

  sync(holograms: readonly NetworkHologram[]): void {
    const keep = new Set<string>();
    for (const hologram of holograms) {
      if (!hologram.enabled) continue;
      keep.add(hologram.name);
      const existing = this.visuals.get(hologram.name);
      if (existing) {
        existing.group.position.set(hologram.x, hologram.y, hologram.z);
        existing.range = hologram.range;
        this.paint(existing, hologram.lines);
        continue;
      }
      const texture = new THREE.CanvasTexture(this.makeCanvas(hologram.lines));
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
      this.paint(visual, hologram.lines);
      this.visuals.set(hologram.name, visual);
    }
    for (const [name, visual] of this.visuals) {
      if (keep.has(name)) continue;
      this.disposeVisual(visual);
      this.visuals.delete(name);
    }
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
  }

  private disposeVisual(visual: HologramVisual): void {
    this.scene.remove(visual.group);
    visual.texture.dispose();
    visual.material.dispose();
  }

  private makeCanvas(lines: readonly string[]): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    this.draw(canvas, lines);
    return canvas;
  }

  private paint(visual: HologramVisual, lines: readonly string[]): void {
    const canvas = visual.texture.image as HTMLCanvasElement;
    this.draw(canvas, lines);
    visual.texture.needsUpdate = true;
    const height = Math.max(1, lines.length);
    visual.group.scale.set(2.6, 0.42 * height + 0.35, 1);
  }

  private draw(canvas: HTMLCanvasElement, lines: readonly string[]): void {
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(0, 0, 0, 0.35)';
    context.fillRect(8, 8, canvas.width - 16, canvas.height - 16);
    context.font = 'bold 36px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const usable = lines.length > 0 ? lines : [' '];
    const step = canvas.height / (usable.length + 1);
    usable.forEach((line, index) => {
      const y = step * (index + 1);
      context.strokeStyle = '#000';
      context.lineWidth = 6;
      context.strokeText(line.slice(0, 40), canvas.width / 2, y);
      context.fillStyle = '#fff7c2';
      context.fillText(line.slice(0, 40), canvas.width / 2, y);
    });
  }
}
