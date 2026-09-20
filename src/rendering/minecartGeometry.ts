import * as THREE from 'three';
import { TextureAtlas } from './TextureAtlas';
import { createTexturedCuboidGeometry } from './TexturedCuboid';
import { bindEntityLightReceiver, createEntityMaterial } from './worldLighting';

export const MINECART_ENTITY_KIND = 'minecart-entity';
export const MINECART_TEXTURE_KEY = 'entity/minecart';
export const MINECART_TNT_TEXTURE_KEY = 'block/tnt';
export const MINECART_FLOOR_NAME = 'minecart-floor';
export const MINECART_TNT_CARGO_NAME = 'tnt-cargo';

const PX = 1 / 16;
const SHEET = [64, 32] as const;

/** World size of the open-top cart, in blocks. Vanilla ModelMinecart 20×16×(2+8). */
export const MINECART_WIDTH = 16 * PX;
export const MINECART_LENGTH = 20 * PX;
export const MINECART_WALL = 2 * PX;
export const MINECART_FLOOR_THICKNESS = 2 * PX;
/** Top of the solid inner floor; must sit above the 2/16 rail strip. */
export const MINECART_FLOOR_TOP = 5 * PX;
export const MINECART_HEIGHT = MINECART_FLOOR_TOP + 8 * PX;
export const RAIL_STRIP_HEIGHT = 2 / 16;
export const MINECART_TNT_SIZE = 0.76;
/** Sit the cargo on the inner floor without sharing the floor plane (z-fight). */
export const MINECART_TNT_SEAT = 0.006;
/** Extra height so arrows/use hit the TNT cube above the rim. */
export const MINECART_HIT_HEIGHT = 1.15;

export interface MinecartVisual extends THREE.Group {
  userData: THREE.Object3D['userData'] & {
    kind: typeof MINECART_ENTITY_KIND;
    variant: 'normal' | 'tnt';
    tntTextureKey?: string;
  };
}

export function isMinecartEntityVisual(object: THREE.Object3D): boolean {
  return object.userData.kind === MINECART_ENTITY_KIND;
}

export function minecartFloorMesh(visual: THREE.Object3D): THREE.Mesh | undefined {
  const found = visual.getObjectByName(MINECART_FLOOR_NAME);
  return found instanceof THREE.Mesh ? found : undefined;
}

/**
 * Vanilla ModelMinecart: one 20×16×2 floor (sheet 0,10) plus four 16×8×2 walls
 * (sheet 0,0). Interior is the reverse of those faces (DoubleSide), not a gray box.
 */
export class MinecartVisualFactory {
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private cart?: THREE.MeshBasicMaterial;
  private tntByKey = new Map<string, THREE.MeshBasicMaterial>();
  private floorGeometry?: THREE.BufferGeometry;
  private wallGeometry?: THREE.BufferGeometry;
  private disposed = false;

  create(): MinecartVisual {
    const group = new THREE.Group() as MinecartVisual;
    group.name = 'minecart-entity';
    group.userData.kind = MINECART_ENTITY_KIND;
    group.userData.variant = 'normal';

    const cart = this.cart ??= this.texturedMaterial(MINECART_TEXTURE_KEY);
    const floorGeometry = this.floorGeometry ??= this.createFloorGeometry();
    const wallGeometry = this.wallGeometry ??= this.createWallGeometry();

    const floor = new THREE.Mesh(floorGeometry, cart);
    floor.name = MINECART_FLOOR_NAME;
    floor.rotation.x = Math.PI / 2;
    floor.position.y = MINECART_FLOOR_TOP - MINECART_FLOOR_THICKNESS / 2;
    bindEntityLightReceiver(floor);
    group.add(floor);

    const wallY = MINECART_FLOOR_TOP + 4 * PX;
    this.addWall(group, wallGeometry, cart, [0, wallY, -7 * PX], 0);
    this.addWall(group, wallGeometry, cart, [0, wallY, 7 * PX], Math.PI);
    this.addWall(group, wallGeometry, cart, [-9 * PX, wallY, 0], Math.PI / 2);
    this.addWall(group, wallGeometry, cart, [9 * PX, wallY, 0], -Math.PI / 2);

    const tnt = new THREE.Mesh(
      this.boxGeometry(MINECART_TNT_SIZE),
      this.tntMaterial(MINECART_TNT_TEXTURE_KEY),
    );
    tnt.name = MINECART_TNT_CARGO_NAME;
    tnt.position.set(0, MINECART_FLOOR_TOP + MINECART_TNT_SEAT + MINECART_TNT_SIZE / 2, 0);
    tnt.visible = false;
    bindEntityLightReceiver(tnt);
    group.add(tnt);

    return group;
  }

  setVariant(visual: THREE.Object3D, variant: 'normal' | 'tnt', textureKey = MINECART_TNT_TEXTURE_KEY): void {
    visual.userData.variant = variant;
    visual.userData.tntTextureKey = textureKey;
    const cargo = visual.getObjectByName(MINECART_TNT_CARGO_NAME);
    if (!(cargo instanceof THREE.Mesh)) return;
    cargo.visible = variant === 'tnt';
    if (variant === 'tnt') cargo.material = this.tntMaterial(textureKey);
  }

  pulsePrimed(visual: THREE.Object3D, fuseRatio: number): void {
    const cargo = visual.getObjectByName(MINECART_TNT_CARGO_NAME);
    if (!cargo) return;
    const pulse = fuseRatio > 0 ? 1 + Math.sin(fuseRatio * 40) * 0.04 * fuseRatio : 1;
    cargo.scale.setScalar(pulse);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.textures.length = 0;
    this.tntByKey.clear();
    this.floorGeometry = undefined;
    this.wallGeometry = undefined;
  }

  private addWall(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: readonly [number, number, number],
    yaw: number,
  ): void {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.rotation.y = yaw;
    bindEntityLightReceiver(mesh);
    parent.add(mesh);
  }

  private createFloorGeometry(): THREE.BufferGeometry {
    const geometry = createTexturedCuboidGeometry({
      size: [20, 16, 2],
      textureOffset: [0, 10],
      logicalTextureSize: SHEET,
      physicalSize: [20 * PX, 16 * PX, 2 * PX],
    });
    this.geometries.push(geometry);
    return geometry;
  }

  private createWallGeometry(): THREE.BufferGeometry {
    const geometry = createTexturedCuboidGeometry({
      size: [16, 8, 2],
      textureOffset: [0, 0],
      logicalTextureSize: SHEET,
      physicalSize: [16 * PX, 8 * PX, 2 * PX],
    });
    this.geometries.push(geometry);
    return geometry;
  }

  private boxGeometry(size: number): THREE.BufferGeometry {
    const geometry = new THREE.BoxGeometry(size, size, size);
    this.geometries.push(geometry);
    return geometry;
  }

  private tntMaterial(textureKey: string): THREE.MeshBasicMaterial {
    const existing = this.tntByKey.get(textureKey);
    if (existing) return existing;
    const material = this.texturedMaterial(textureKey);
    this.tntByKey.set(textureKey, material);
    return material;
  }

  private texturedMaterial(textureKey: string): THREE.MeshBasicMaterial {
    const map = typeof document === 'undefined'
      ? new THREE.Texture()
      : new THREE.TextureLoader().load(TextureAtlas.url(textureKey));
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    map.generateMipmaps = false;
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    this.textures.push(map);
    const material = createEntityMaterial({
      map,
      transparent: false,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.materials.push(material);
    return material;
  }
}
