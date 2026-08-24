import * as THREE from 'three';
import { TextureAtlas } from './TextureAtlas';
import { bindEntityLightReceiver, createEntityMaterial } from './worldLighting';

export const MINECART_ENTITY_KIND = 'minecart-entity';
export const MINECART_TEXTURE_KEY = 'entity/minecart';
export const MINECART_TNT_TEXTURE_KEY = 'block/tnt';
export const MINECART_FLOOR_NAME = 'minecart-floor';
export const MINECART_TNT_CARGO_NAME = 'tnt-cargo';

/** World size of the open-top cart, in blocks. */
export const MINECART_WIDTH = 0.98;
export const MINECART_LENGTH = 0.98;
export const MINECART_HEIGHT = 0.62;
export const MINECART_WALL = 0.08;
/** Top of the solid inner floor; must sit above the 2/16 rail strip. */
export const MINECART_FLOOR_TOP = 0.16;
export const MINECART_FLOOR_THICKNESS = 0.12;
export const RAIL_STRIP_HEIGHT = 2 / 16;
export const MINECART_TNT_SIZE = 0.76;
/** Sit the cargo on the inner floor without sharing the floor plane (z-fight). */
export const MINECART_TNT_SEAT = 0.006;
/** Extra height so arrows/use hit the TNT cube above the rim. */
export const MINECART_HIT_HEIGHT = 1.15;

const INNER_GRAY = 0x3d3d44;
const FLOOR_GRAY = 0x4a4a52;
const WHEEL_GRAY = 0x1c1c20;

export interface MinecartVisual extends THREE.Group {
  userData: THREE.Object3D['userData'] & {
    kind: typeof MINECART_ENTITY_KIND;
    variant: 'normal' | 'tnt';
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
 * Open-top metal cart: four thick walls, opaque full-width floor, inner lining, wheels.
 * Exterior uses `entity/minecart`; interior/floor are solid gray. Top stays open.
 */
export class MinecartVisualFactory {
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private outer?: THREE.MeshBasicMaterial;
  private inner?: THREE.MeshBasicMaterial;
  private floor?: THREE.MeshBasicMaterial;
  private wheel?: THREE.MeshBasicMaterial;
  private tnt?: THREE.MeshBasicMaterial;
  private disposed = false;

  create(): MinecartVisual {
    const group = new THREE.Group() as MinecartVisual;
    group.name = 'minecart-entity';
    group.userData.kind = MINECART_ENTITY_KIND;
    group.userData.variant = 'normal';

    const outer = this.outer ??= this.texturedMaterial(MINECART_TEXTURE_KEY);
    const inner = this.inner ??= this.colorMaterial(INNER_GRAY);
    const floor = this.floor ??= this.colorMaterial(FLOOR_GRAY);
    const wheel = this.wheel ??= this.colorMaterial(WHEEL_GRAY);

    const halfW = MINECART_WIDTH / 2;
    const halfL = MINECART_LENGTH / 2;
    const wallH = MINECART_HEIGHT - MINECART_FLOOR_TOP;
    const innerW = MINECART_WIDTH - MINECART_WALL * 2;
    const innerL = MINECART_LENGTH - MINECART_WALL * 2;
    const floorCenterY = MINECART_FLOOR_TOP - MINECART_FLOOR_THICKNESS / 2;

    const floorMesh = this.addBox(
      group,
      [MINECART_WIDTH, MINECART_FLOOR_THICKNESS, MINECART_LENGTH],
      [0, floorCenterY, 0],
      floor,
    );
    floorMesh.name = MINECART_FLOOR_NAME;

    const wallY = MINECART_FLOOR_TOP + wallH / 2;
    this.addBox(group, [MINECART_WIDTH, wallH, MINECART_WALL], [0, wallY, halfL - MINECART_WALL / 2], outer);
    this.addBox(group, [MINECART_WIDTH, wallH, MINECART_WALL], [0, wallY, -(halfL - MINECART_WALL / 2)], outer);
    this.addBox(group, [MINECART_WALL, wallH, innerL], [halfW - MINECART_WALL / 2, wallY, 0], outer);
    this.addBox(group, [MINECART_WALL, wallH, innerL], [-(halfW - MINECART_WALL / 2), wallY, 0], outer);

    const innerH = wallH - 0.02;
    const innerY = MINECART_FLOOR_TOP + innerH / 2 + 0.01;
    const inset = MINECART_WALL + 0.012;
    this.addBox(group, [innerW, innerH, 0.02], [0, innerY, halfL - inset], inner);
    this.addBox(group, [innerW, innerH, 0.02], [0, innerY, -(halfL - inset)], inner);
    this.addBox(group, [0.02, innerH, innerL - 0.04], [halfW - inset, innerY, 0], inner);
    this.addBox(group, [0.02, innerH, innerL - 0.04], [-(halfW - inset), innerY, 0], inner);

    const wheelSize: [number, number, number] = [0.14, 0.12, 0.14];
    const wheelY = 0.04;
    const wheelX = halfW - 0.16;
    const wheelZ = halfL - 0.18;
    this.addBox(group, wheelSize, [wheelX, wheelY, wheelZ], wheel);
    this.addBox(group, wheelSize, [-wheelX, wheelY, wheelZ], wheel);
    this.addBox(group, wheelSize, [wheelX, wheelY, -wheelZ], wheel);
    this.addBox(group, wheelSize, [-wheelX, wheelY, -wheelZ], wheel);

    const tnt = this.addBox(
      group,
      [MINECART_TNT_SIZE, MINECART_TNT_SIZE, MINECART_TNT_SIZE],
      [0, MINECART_FLOOR_TOP + MINECART_TNT_SEAT + MINECART_TNT_SIZE / 2, 0],
      this.tnt ??= this.texturedMaterial(MINECART_TNT_TEXTURE_KEY),
    );
    tnt.name = MINECART_TNT_CARGO_NAME;
    tnt.visible = false;

    return group;
  }

  setVariant(visual: THREE.Object3D, variant: 'normal' | 'tnt'): void {
    visual.userData.variant = variant;
    const cargo = visual.getObjectByName(MINECART_TNT_CARGO_NAME);
    if (cargo) cargo.visible = variant === 'tnt';
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
  }

  private addBox(
    parent: THREE.Object3D,
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    material: THREE.Material,
  ): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    this.geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0], position[1], position[2]);
    bindEntityLightReceiver(mesh);
    parent.add(mesh);
    return mesh;
  }

  private colorMaterial(color: number): THREE.MeshBasicMaterial {
    const material = createEntityMaterial({
      color,
      transparent: false,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.materials.push(material);
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
