import * as THREE from 'three';
import {
  ITEMS,
  SPECIAL_ICON_POSES,
  itemIconDescriptor,
  specialIconCategory,
  generatedHeldTexturePath,
  orthographicFitExtent,
  OAK_DOOR_HELD_TEXTURE,
} from '../items';
import { TextureAtlas } from './TextureAtlas';
import { ItemVisualFactory } from './ItemVisualFactory';
import { disposeSpecialIconPreview, prepareSpecialIconPreview } from './itemIconPreview';

const ICON_SIZE = 64;

/**
 * Renders special_model items to cached 2D previews using the game WebGLRenderer.
 * Ordinary cube/generated items keep their atlas/sprite texture.
 */
export class ItemIconRenderer {
  private readonly cache = new Map<string, string>();
  private disposed = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly factory: ItemVisualFactory,
  ) {}

  bake(): void {
    for (const item of ITEMS) {
      if (itemIconDescriptor(item).kind === 'special_preview') this.url(item.id);
      if (item.id === 'oak_door') this.url(item.id);
    }
  }

  url(itemId: string): string {
    const cached = this.cache.get(itemId);
    if (cached) return cached;
    const resolved = this.resolve(itemId);
    this.cache.set(itemId, resolved);
    return resolved;
  }

  dispose(): void {
    this.disposed = true;
    this.cache.clear();
  }

  private resolve(itemId: string): string {
    if (itemId === 'oak_door') {
      const composite = this.factory.generatedTextureDataUrl(OAK_DOOR_HELD_TEXTURE);
      if (composite) return composite;
    }
    const descriptor = itemIconDescriptor(itemId);
    if (descriptor.kind !== 'special_preview') {
      return TextureAtlas.url(descriptor.texturePath ?? generatedHeldTexturePath(itemId));
    }
    try {
      return this.renderPreview(itemId) ?? TextureAtlas.url(generatedHeldTexturePath(itemId));
    } catch {
      return TextureAtlas.url(generatedHeldTexturePath(itemId));
    }
  }

  private renderPreview(itemId: string): string | undefined {
    if (this.disposed || typeof document === 'undefined') return undefined;
    const category = specialIconCategory(itemId);
    if (!category) return undefined;
    const pose = SPECIAL_ICON_POSES[category];
    const scene = new THREE.Scene();
    const model = this.factory.createItemModel(itemId);
    prepareSpecialIconPreview(model);
    model.rotation.set(
      THREE.MathUtils.degToRad(pose.rotationDeg[0]),
      THREE.MathUtils.degToRad(pose.rotationDeg[1]),
      THREE.MathUtils.degToRad(pose.rotationDeg[2]),
    );
    scene.add(model);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const extent = orthographicFitExtent(size.x, size.y);
    const camera = new THREE.OrthographicCamera(-extent, extent, extent, -extent, 0.05, 8);
    camera.position.set(center.x, center.y, center.z + 3);
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    const target = new THREE.WebGLRenderTarget(ICON_SIZE, ICON_SIZE, {
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const previousTarget = this.renderer.getRenderTarget();
    const previousClear = new THREE.Color();
    const previousAlpha = this.renderer.getClearAlpha();
    this.renderer.getClearColor(previousClear);
    const previousOutput = this.renderer.outputColorSpace;
    const previousTone = this.renderer.toneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(scene, camera);

    const pixels = new Uint8Array(ICON_SIZE * ICON_SIZE * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, ICON_SIZE, ICON_SIZE, pixels);
    this.renderer.setRenderTarget(previousTarget);
    this.renderer.setClearColor(previousClear, previousAlpha);
    this.renderer.outputColorSpace = previousOutput;
    this.renderer.toneMapping = previousTone;
    target.dispose();
    disposeSpecialIconPreview(model);

    const canvas = document.createElement('canvas');
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    const image = context.createImageData(ICON_SIZE, ICON_SIZE);
    for (let y = 0; y < ICON_SIZE; y += 1) {
      const src = (ICON_SIZE - 1 - y) * ICON_SIZE * 4;
      const dst = y * ICON_SIZE * 4;
      image.data.set(pixels.subarray(src, src + ICON_SIZE * 4), dst);
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }
}
