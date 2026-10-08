import * as THREE from 'three';
import { BlockId } from '../blocks';
import type { HorizontalFacing } from '../blocks';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../core/constants';
import {
  collectiblePaintingTexture,
  isCollectiblePaintingItemId,
} from '../items/collectiblePaintings';
import type { VoxelWorld } from '../world/World';
import {
  PAINTING_ART,
  PAINTING_ART_Z0,
  PAINTING_ART_Z1,
  PAINTING_BACKPLATE,
  PAINTING_BACK_Z0,
  PAINTING_BACK_Z1,
  PAINTING_OUTER,
  PAINTING_RAIL,
  PAINTING_RAIL_Z0,
  PAINTING_RAIL_Z1,
  PAINTING_WOOD_TINT,
  paintingPlaneCenterZ,
  paintingYaw,
} from '../world/painting';
import { TextureAtlas } from './TextureAtlas';
import { composeWorldLight, worldDaylightUniform } from './worldLighting';

interface PaintingVisual {
  root: THREE.Group;
  signature: string;
  art: THREE.MeshBasicMaterial;
  wood: THREE.MeshBasicMaterial;
  x: number;
  y: number;
  z: number;
}

/**
 * Wall art lives outside the 32px block atlas. One shared oak frame, one
 * texture per design, rebuilt only when paintings or chunk visibility change.
 * Light colors refresh every frame from the same daylight uniform as chunks.
 */
export class PaintingRenderer {
  readonly group = new THREE.Group();
  private readonly visuals = new Map<string, PaintingVisual>();
  private readonly artTextures = new Map<string, THREE.Texture>();
  private readonly backplateGeometry: THREE.BoxGeometry;
  private readonly artGeometry: THREE.PlaneGeometry;
  private readonly railWideGeometry: THREE.BoxGeometry;
  private readonly railTallGeometry: THREE.BoxGeometry;
  private woodTexture: THREE.Texture | undefined;
  private lastVersion = -1;
  private visibilityDirty = true;

  constructor(
    private readonly world: VoxelWorld,
    private readonly hasChunk: (key: string) => boolean,
  ) {
    this.group.name = 'collectible-paintings';
    const backDepth = PAINTING_BACK_Z1 - PAINTING_BACK_Z0;
    const railDepth = PAINTING_RAIL_Z1 - PAINTING_RAIL_Z0;
    const inner = PAINTING_OUTER - PAINTING_RAIL * 2;
    this.backplateGeometry = new THREE.BoxGeometry(PAINTING_BACKPLATE, PAINTING_BACKPLATE, backDepth);
    this.artGeometry = new THREE.PlaneGeometry(PAINTING_ART, PAINTING_ART);
    this.railWideGeometry = new THREE.BoxGeometry(PAINTING_OUTER, PAINTING_RAIL, railDepth);
    this.railTallGeometry = new THREE.BoxGeometry(PAINTING_RAIL, inner, railDepth);
  }

  invalidateVisibility(): void {
    this.visibilityDirty = true;
  }

  sync(): void {
    if (this.visibilityDirty || this.lastVersion !== this.world.paintingVersion) {
      this.visibilityDirty = false;
      this.lastVersion = this.world.paintingVersion;
      this.rebuild();
    }
    this.refreshLight();
  }

  dispose(): void {
    for (const key of [...this.visuals.keys()]) this.remove(key);
    this.backplateGeometry.dispose();
    this.artGeometry.dispose();
    this.railWideGeometry.dispose();
    this.railTallGeometry.dispose();
    this.woodTexture?.dispose();
    this.woodTexture = undefined;
    for (const texture of this.artTextures.values()) texture.dispose();
    this.artTextures.clear();
  }

  private rebuild(): void {
    const wanted = new Set<string>();
    for (const [key, state] of this.world.blockStates) {
      const itemId = state.paintingItemId;
      if (!isCollectiblePaintingItemId(itemId)) continue;
      const [x, y, z] = key.split(',').map(Number);
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) continue;
      if (!this.hasChunk(chunkKey(floorDiv(x!, CHUNK_SIZE), floorDiv(z!, CHUNK_SIZE)))) continue;
      if (this.world.getBlock(x!, y!, z!, false) !== BlockId.CollectiblePainting) continue;
      const facing = state.facing ?? 'south';
      const signature = `${itemId}|${facing}|${state.attachment ?? 'wall'}`;
      wanted.add(key);
      const existing = this.visuals.get(key);
      if (existing?.signature === signature) continue;
      this.remove(key);
      const visual = this.createVisual(x!, y!, z!, facing, itemId, signature);
      this.visuals.set(key, visual);
    }
    for (const key of this.visuals.keys()) {
      if (!wanted.has(key)) this.remove(key);
    }
  }

  private createVisual(
    x: number,
    y: number,
    z: number,
    facing: HorizontalFacing,
    itemId: string,
    signature: string,
  ): PaintingVisual {
    const root = new THREE.Group();
    root.position.set(x + 0.5, y + 0.5, z + 0.5);
    root.rotation.y = paintingYaw(facing);
    const wood = this.woodMaterial();
    const art = this.artMaterial(itemId);
    const back = new THREE.Mesh(this.backplateGeometry, wood);
    back.position.set(0, 0, paintingPlaneCenterZ(PAINTING_BACK_Z0, PAINTING_BACK_Z1));
    const picture = new THREE.Mesh(this.artGeometry, art);
    picture.position.set(0, 0, paintingPlaneCenterZ(PAINTING_ART_Z0, PAINTING_ART_Z1));
    const railZ = paintingPlaneCenterZ(PAINTING_RAIL_Z0, PAINTING_RAIL_Z1);
    const outerHalf = PAINTING_OUTER / 2;
    const railHalf = PAINTING_RAIL / 2;
    const top = new THREE.Mesh(this.railWideGeometry, wood);
    top.position.set(0, outerHalf - railHalf, railZ);
    const bottom = new THREE.Mesh(this.railWideGeometry, wood);
    bottom.position.set(0, -(outerHalf - railHalf), railZ);
    const left = new THREE.Mesh(this.railTallGeometry, wood);
    left.position.set(-(outerHalf - railHalf), 0, railZ);
    const right = new THREE.Mesh(this.railTallGeometry, wood);
    right.position.set(outerHalf - railHalf, 0, railZ);
    root.add(back, picture, top, bottom, left, right);
    this.group.add(root);
    return { root, signature, art, wood, x, y, z };
  }

  private refreshLight(): void {
    const daylight = worldDaylightUniform.value;
    for (const visual of this.visuals.values()) {
      const sky = this.world.readMeshSkyLight(visual.x, visual.y, visual.z);
      const block = this.world.readMeshBlockLight(visual.x, visual.y, visual.z);
      const [r, g, b] = composeWorldLight(sky, block, 0, 1, daylight);
      visual.art.color.setRGB(r, g, b);
      visual.wood.color.setRGB(
        r * PAINTING_WOOD_TINT[0],
        g * PAINTING_WOOD_TINT[1],
        b * PAINTING_WOOD_TINT[2],
      );
    }
  }

  private woodMaterial(): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      map: this.sharedWoodTexture(),
      side: THREE.FrontSide,
      fog: true,
    });
  }

  private artMaterial(itemId: string): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      map: this.artTexture(itemId),
      side: THREE.FrontSide,
      fog: true,
    });
  }

  private sharedWoodTexture(): THREE.Texture {
    if (!this.woodTexture) {
      this.woodTexture = this.loadTexture(TextureAtlas.url('block/oak_planks'));
    }
    return this.woodTexture;
  }

  private artTexture(itemId: string): THREE.Texture | null {
    const key = collectiblePaintingTexture(itemId);
    if (!key) return null;
    let texture = this.artTextures.get(key);
    if (!texture) {
      texture = this.loadTexture(TextureAtlas.url(key));
      this.artTextures.set(key, texture);
    }
    return texture;
  }

  private loadTexture(url: string): THREE.Texture {
    const texture = new THREE.Texture();
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    if (typeof Image === 'undefined') return texture;
    const loader = new THREE.TextureLoader();
    loader.load(url, (loaded) => {
      texture.image = loaded.image;
      texture.needsUpdate = true;
      loaded.dispose();
    });
    return texture;
  }

  private remove(key: string): void {
    const visual = this.visuals.get(key);
    if (!visual) return;
    this.group.remove(visual.root);
    visual.art.dispose();
    visual.wood.dispose();
    this.visuals.delete(key);
  }
}
