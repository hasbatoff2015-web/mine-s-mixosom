import * as THREE from 'three';
import type { ItemDefinition } from '../items/types';
import type { ItemVisualFamily } from '../items/itemRenderProfiles';
import { createTexturedCuboidGeometry } from './TexturedCuboid';

export type FamilyColorRole = 'primary' | 'secondary' | 'accent';

export interface FamilyPart {
  readonly role: FamilyColorRole;
  readonly geometry: THREE.BufferGeometry;
}

export interface ItemPalette {
  readonly primary: number;
  readonly secondary: number;
  readonly accent: number;
}

type Vec3 = readonly [number, number, number];

interface BoxSpec {
  readonly center: Vec3;
  readonly size: Vec3;
  readonly role: FamilyColorRole;
}

const CUBE_FACES: readonly {
  readonly normal: Vec3;
  readonly corners: readonly Vec3[];
}[] = [
  { normal: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

const HANDLE = 0x6b4a24;
const HANDLE_DARK = 0x4a3218;
const WOOD_HEAD = 0x8d6a3a;
const STONE = 0x8a8a8a;
const IRON = 0xd0d0d0;
const DIAMOND = 0x3ad4c8;
const DIAMOND_DARK = 0x1a8f88;

const TIER_HEAD: Readonly<Record<string, number>> = {
  wood: WOOD_HEAD,
  stone: STONE,
  iron: IRON,
  diamond: DIAMOND,
};

const ARMOR_BODY: Readonly<Record<string, number>> = {
  leather: 0x8a5a32,
  iron: 0xb8b8b8,
  gold: 0xe8c040,
  diamond: 0x48e0d0,
};

const FOOD_CUT: Readonly<Record<string, number>> = {
  beef: 0xb04040,
  cooked_beef: 0x6a3a20,
  porkchop: 0xe8a0a0,
  cooked_porkchop: 0xc07040,
  chicken: 0xe8d0b0,
  cooked_chicken: 0xc88838,
};

/** Palette sampled from each item PNG identity, not a 1:1 UV of the 32×32 icon. */
export function itemPalette(item: ItemDefinition): ItemPalette {
  if (item.kind === 'tool' || (item.kind === 'weapon' && item.weapon === 'sword')) {
    const head = TIER_HEAD[item.tier ?? 'wood'] ?? WOOD_HEAD;
    return { primary: head, secondary: HANDLE, accent: HANDLE_DARK };
  }
  if (item.kind === 'armor') {
    const body = ARMOR_BODY[item.material] ?? STONE;
    return { primary: body, secondary: darken(body), accent: 0x222222 };
  }
  if (item.kind === 'food') {
    if (item.id === 'apple') return { primary: 0xc03028, secondary: 0x8a2018, accent: 0x5a3818 };
    if (item.id === 'bread') return { primary: 0xc8a050, secondary: 0x8a6830, accent: 0xe8c878 };
    const cut = FOOD_CUT[item.id] ?? 0xb04040;
    return { primary: cut, secondary: darken(cut), accent: 0xf0d0c0 };
  }
  switch (item.id) {
    case 'stick': return { primary: HANDLE, secondary: HANDLE, accent: HANDLE_DARK };
    case 'iron_ingot': return { primary: 0xd8d8d8, secondary: 0x8c8c8c, accent: 0xf4f4f4 };
    case 'gold_ingot': return { primary: 0xfcf14a, secondary: 0xc88814, accent: 0xfff6a0 };
    case 'brick': return { primary: 0x8a4030, secondary: 0x5a2818, accent: 0xb06048 };
    case 'diamond': return { primary: DIAMOND, secondary: DIAMOND_DARK, accent: 0xd8ffff };
    case 'coal': return { primary: 0x2a2a2a, secondary: 0x4a4a4a, accent: 0x111111 };
    case 'charcoal': return { primary: 0x3a3028, secondary: 0x1a1510, accent: 0x5a4a38 };
    case 'flint': return { primary: 0x6a6a6a, secondary: 0x3a3a3a, accent: 0x9a9a9a };
    case 'clay_ball': return { primary: 0xa0a8b8, secondary: 0x708090, accent: 0xc0c8d0 };
    case 'gunpowder': return { primary: 0x5a5a5a, secondary: 0x3a3a3a, accent: 0x7a7a7a };
    case 'redstone_dust': return { primary: 0xc02020, secondary: 0x701010, accent: 0xe04040 };
    case 'string': return { primary: 0xd0d0c8, secondary: 0xb0b0a8, accent: 0xf0f0e8 };
    case 'feather': return { primary: 0xf0f0e8, secondary: 0xc8b070, accent: 0xffffff };
    case 'leather': return { primary: 0x8a5a32, secondary: 0x5a3818, accent: 0xb07848 };
    case 'book': return { primary: 0x8a2018, secondary: 0xe8dcc0, accent: 0x5a140e };
    case 'arrow': return { primary: STONE, secondary: HANDLE, accent: 0xf2f2ea };
    case 'bow': return { primary: 0x6b4a24, secondary: 0x4a3218, accent: 0xd8d0c0 };
    case 'shield': return { primary: 0x8a6a3a, secondary: 0x9aa0a4, accent: 0x4a3218 };
    case 'lever': return { primary: STONE, secondary: HANDLE, accent: HANDLE_DARK };
    default: return { primary: 0xd332ce, secondary: 0x171419, accent: 0xffffff };
  }
}

export function colorForRole(palette: ItemPalette, role: FamilyColorRole): number {
  if (role === 'secondary') return palette.secondary;
  if (role === 'accent') return palette.accent;
  return palette.primary;
}

function darken(hex: number): number {
  const r = hex >> 16 & 255;
  const g = hex >> 8 & 255;
  const b = hex & 255;
  return (Math.floor(r * 0.65) << 16) | (Math.floor(g * 0.65) << 8) | Math.floor(b * 0.65);
}

function boxesToGeometry(boxes: readonly BoxSpec[], family: string, role: FamilyColorRole): THREE.BufferGeometry | undefined {
  const subset = boxes.filter((box) => box.role === role);
  if (subset.length === 0) return undefined;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const box of subset) {
    for (const face of CUBE_FACES) {
      const base = positions.length / 3;
      for (const corner of face.corners) {
        positions.push(
          box.center[0] + (corner[0] - 0.5) * box.size[0],
          box.center[1] + (corner[1] - 0.5) * box.size[1],
          box.center[2] + (corner[2] - 0.5) * box.size[2],
        );
        normals.push(...face.normal);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.userData.itemFamily = Object.freeze({
    family,
    role,
    boxes: subset.length,
    triangles: indices.length / 3,
  });
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function partsFromBoxes(family: string, boxes: readonly BoxSpec[]): readonly FamilyPart[] {
  const parts: FamilyPart[] = [];
  for (const role of ['primary', 'secondary', 'accent'] as const) {
    const geometry = boxesToGeometry(boxes, family, role);
    if (geometry) parts.push({ role, geometry });
  }
  return parts;
}

const FAMILY_BOXES: Partial<Record<ItemVisualFamily, readonly BoxSpec[]>> = {
  sword: [
    { role: 'secondary', center: [0, -0.22, 0], size: [0.05, 0.20, 0.05] },
    { role: 'primary', center: [0, 0.18, 0], size: [0.055, 0.62, 0.018] },
    { role: 'primary', center: [0, -0.12, 0], size: [0.20, 0.045, 0.045] },
    { role: 'accent', center: [0, -0.34, 0], size: [0.07, 0.055, 0.07] },
  ],
  pickaxe: [
    { role: 'secondary', center: [0, -0.06, 0], size: [0.055, 0.78, 0.055] },
    { role: 'primary', center: [0, 0.36, 0], size: [0.48, 0.09, 0.09] },
    { role: 'primary', center: [-0.26, 0.28, 0], size: [0.12, 0.18, 0.09] },
    { role: 'primary', center: [0.26, 0.28, 0], size: [0.12, 0.18, 0.09] },
  ],
  axe: [
    { role: 'secondary', center: [0, -0.08, 0], size: [0.055, 0.76, 0.055] },
    { role: 'primary', center: [0.16, 0.32, 0], size: [0.22, 0.28, 0.05] },
    { role: 'primary', center: [-0.10, 0.34, 0], size: [0.12, 0.12, 0.10] },
  ],
  shovel: [
    { role: 'secondary', center: [0, -0.04, 0], size: [0.05, 0.72, 0.05] },
    { role: 'primary', center: [0, 0.40, 0], size: [0.18, 0.22, 0.04] },
    { role: 'primary', center: [0, 0.28, 0], size: [0.08, 0.10, 0.05] },
  ],
  arrow: [
    { role: 'secondary', center: [0, 0.02, 0], size: [0.028, 0.70, 0.028] },
    { role: 'primary', center: [0, 0.42, 0], size: [0.06, 0.16, 0.06] },
    { role: 'accent', center: [0, -0.30, 0], size: [0.10, 0.16, 0.012] },
    { role: 'accent', center: [0, -0.30, 0], size: [0.012, 0.16, 0.10] },
  ],
  stick: [
    { role: 'primary', center: [0, 0, 0], size: [0.045, 0.78, 0.045] },
  ],
  ingot: [
    { role: 'primary', center: [0, 0, 0], size: [0.58, 0.14, 0.28] },
    { role: 'secondary', center: [0, 0.05, 0], size: [0.50, 0.06, 0.22] },
  ],
  brick: [
    { role: 'primary', center: [0, 0, 0], size: [0.40, 0.20, 0.26] },
    { role: 'secondary', center: [0, 0.04, 0], size: [0.34, 0.08, 0.20] },
  ],
  chunk: [
    { role: 'primary', center: [0, 0, 0], size: [0.28, 0.22, 0.24] },
    { role: 'secondary', center: [0.08, 0.06, 0.04], size: [0.16, 0.16, 0.18] },
    { role: 'accent', center: [-0.08, -0.05, -0.04], size: [0.14, 0.12, 0.14] },
  ],
  flint: [
    { role: 'primary', center: [0.02, 0.04, 0], size: [0.22, 0.28, 0.06] },
    { role: 'secondary', center: [-0.06, -0.06, 0.01], size: [0.16, 0.18, 0.05] },
  ],
  'clay-ball': [
    { role: 'primary', center: [0, 0, 0], size: [0.26, 0.24, 0.26] },
    { role: 'secondary', center: [0.04, 0.08, 0.03], size: [0.16, 0.14, 0.16] },
  ],
  pile: [
    { role: 'primary', center: [0, -0.04, 0], size: [0.32, 0.10, 0.28] },
    { role: 'secondary', center: [0.02, 0.04, 0.01], size: [0.22, 0.08, 0.20] },
    { role: 'accent', center: [-0.03, 0.10, -0.02], size: [0.12, 0.06, 0.12] },
  ],
  string: [
    { role: 'primary', center: [0.14, 0, 0], size: [0.08, 0.08, 0.22] },
    { role: 'primary', center: [-0.14, 0, 0], size: [0.08, 0.08, 0.22] },
    { role: 'primary', center: [0, 0, 0.14], size: [0.22, 0.08, 0.08] },
    { role: 'primary', center: [0, 0, -0.14], size: [0.22, 0.08, 0.08] },
  ],
  feather: [
    { role: 'secondary', center: [0, -0.12, 0], size: [0.03, 0.44, 0.03] },
    { role: 'primary', center: [0.05, 0.08, 0], size: [0.14, 0.36, 0.03] },
    { role: 'accent', center: [-0.04, 0.10, 0], size: [0.10, 0.28, 0.02] },
  ],
  leather: [
    { role: 'primary', center: [0, 0, 0], size: [0.42, 0.08, 0.32] },
    { role: 'secondary', center: [0.06, 0.03, -0.04], size: [0.28, 0.06, 0.22] },
  ],
  book: [
    { role: 'primary', center: [0, 0, 0.04], size: [0.34, 0.44, 0.03] },
    { role: 'primary', center: [0, 0, -0.04], size: [0.34, 0.44, 0.03] },
    { role: 'secondary', center: [0.01, 0, 0], size: [0.30, 0.40, 0.06] },
    { role: 'accent', center: [-0.16, 0, 0], size: [0.04, 0.44, 0.10] },
  ],
  'food-round': [
    { role: 'primary', center: [0, -0.02, 0], size: [0.28, 0.26, 0.28] },
    { role: 'secondary', center: [0, 0.08, 0], size: [0.22, 0.12, 0.22] },
    { role: 'accent', center: [0, 0.18, 0], size: [0.03, 0.10, 0.03] },
  ],
  'food-loaf': [
    { role: 'primary', center: [0, 0, 0], size: [0.42, 0.18, 0.24] },
    { role: 'secondary', center: [0, 0.06, 0], size: [0.36, 0.10, 0.18] },
  ],
  'food-cut': [
    { role: 'primary', center: [0, 0, 0], size: [0.36, 0.10, 0.26] },
    { role: 'secondary', center: [0.04, 0.04, 0.02], size: [0.22, 0.06, 0.16] },
  ],
  'armor-helmet': [
    { role: 'primary', center: [0, 0.06, 0], size: [0.32, 0.16, 0.32] },
    { role: 'primary', center: [0, 0.18, 0], size: [0.24, 0.12, 0.24] },
    { role: 'secondary', center: [0, -0.04, 0.12], size: [0.28, 0.10, 0.08] },
  ],
  'armor-chest': [
    { role: 'primary', center: [0, 0.04, 0], size: [0.40, 0.42, 0.16] },
    { role: 'secondary', center: [0, -0.18, 0], size: [0.36, 0.10, 0.14] },
  ],
  'armor-legs': [
    { role: 'primary', center: [-0.09, -0.04, 0], size: [0.14, 0.40, 0.14] },
    { role: 'primary', center: [0.09, -0.04, 0], size: [0.14, 0.40, 0.14] },
    { role: 'secondary', center: [0, 0.18, 0], size: [0.30, 0.10, 0.16] },
  ],
  'armor-boots': [
    { role: 'primary', center: [-0.10, -0.04, 0.04], size: [0.14, 0.14, 0.24] },
    { role: 'primary', center: [0.10, -0.04, 0.04], size: [0.14, 0.14, 0.24] },
  ],
  lever: [
    { role: 'primary', center: [0, -0.16, 0], size: [0.36, 0.10, 0.28] },
    { role: 'secondary', center: [0, 0.08, -0.04], size: [0.07, 0.42, 0.07] },
  ],
  'generic-fallback': [
    { role: 'primary', center: [0, 0, 0], size: [0.36, 0.36, 0.10] },
  ],
};

const partCache = new Map<string, readonly FamilyPart[]>();
const namedBoxCache = new Map<string, THREE.BufferGeometry>();

export function familyParts(family: ItemVisualFamily): readonly FamilyPart[] {
  const cached = partCache.get(family);
  if (cached) return cached;
  const parts = family === 'gem'
    ? [{ role: 'primary' as const, geometry: createOctahedronGeometry('gem', 0.16, 0.22, 0.16) }]
    : partsFromBoxes(family, FAMILY_BOXES[family] ?? []);
  partCache.set(family, parts);
  return parts;
}

function createOctahedronGeometry(
  family: string,
  radiusX: number,
  radiusY: number,
  radiusZ: number,
): THREE.BufferGeometry {
  const top: Vec3 = [0, radiusY, 0];
  const bottom: Vec3 = [0, -radiusY, 0];
  const px: Vec3 = [radiusX, 0, 0];
  const nx: Vec3 = [-radiusX, 0, 0];
  const pz: Vec3 = [0, 0, radiusZ];
  const nz: Vec3 = [0, 0, -radiusZ];
  const faces: readonly (readonly [Vec3, Vec3, Vec3])[] = [
    [top, pz, px], [top, px, nz], [top, nz, nx], [top, nx, pz],
    [bottom, px, pz], [bottom, nz, px], [bottom, nx, nz], [bottom, pz, nx],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const [a, b, c] of faces) {
    const base = positions.length / 3;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];
    const nxv = aby * acz - abz * acy;
    const nyv = abz * acx - abx * acz;
    const nzv = abx * acy - aby * acx;
    const length = Math.hypot(nxv, nyv, nzv) || 1;
    const normal: Vec3 = [nxv / length, nyv / length, nzv / length];
    positions.push(...a, ...b, ...c);
    normals.push(...normal, ...normal, ...normal);
    indices.push(base, base + 1, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.userData.itemFamily = Object.freeze({
    family,
    role: 'primary',
    boxes: 0,
    triangles: indices.length / 3,
  });
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function familyGeometryCacheSize(): number {
  let count = 0;
  for (const parts of partCache.values()) count += parts.length;
  return count + namedBoxCache.size;
}

export function disposeFamilyPartCache(): void {
  for (const parts of partCache.values()) {
    for (const part of parts) part.geometry.dispose();
  }
  for (const geometry of namedBoxCache.values()) geometry.dispose();
  partCache.clear();
  namedBoxCache.clear();
}

export function familyTriangleCount(family: ItemVisualFamily): number {
  return familyParts(family).reduce((sum, part) => sum + part.geometry.userData.itemFamily.triangles, 0);
}

function namedBoxGeometry(name: string, center: Vec3, size: Vec3): THREE.BufferGeometry {
  const cached = namedBoxCache.get(name);
  if (cached) return cached;
  const geometry = boxesToGeometry([{ center, size, role: 'primary' }], name, 'primary')!;
  namedBoxCache.set(name, geometry);
  return geometry;
}

function coloredBoxMesh(
  name: string,
  center: Vec3,
  size: Vec3,
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(namedBoxGeometry(name, center, size), material);
  mesh.name = name;
  return mesh;
}

function addBowLimb(
  pivot: THREE.Group,
  direction: 1 | -1,
  material: THREE.Material,
): void {
  const inner = coloredBoxMesh(
    `bow:${direction > 0 ? 'upper' : 'lower'}-inner`,
    [0, direction * 0.11, 0.02],
    [0.045, 0.22, 0.04],
    material,
  );
  const outerPivot = new THREE.Group();
  outerPivot.name = `bow:${direction > 0 ? 'upper' : 'lower'}-outer-pivot`;
  outerPivot.position.set(0, direction * 0.22, 0.03);
  outerPivot.rotation.z = direction * -0.22;
  const outer = coloredBoxMesh(
    `bow:${direction > 0 ? 'upper' : 'lower'}-outer`,
    [0, direction * 0.11, 0.03],
    [0.04, 0.22, 0.035],
    material,
  );
  outerPivot.add(outer);
  pivot.add(inner, outerPivot);
}

/** Low-poly bow with named limb/string children so draw charge can pose the mesh. */
export function createBowVisual(materials: { limb: THREE.Material; grip: THREE.Material; string: THREE.Material }): THREE.Group {
  const root = new THREE.Group();
  root.userData.bowVisual = true;
  const grip = coloredBoxMesh('bow:grip', [0, 0, 0], [0.07, 0.18, 0.06], materials.grip);
  const upperPivot = new THREE.Group();
  upperPivot.name = 'bow:upper-pivot';
  upperPivot.position.set(0, 0.09, 0);
  addBowLimb(upperPivot, 1, materials.limb);
  const lowerPivot = new THREE.Group();
  lowerPivot.name = 'bow:lower-pivot';
  lowerPivot.position.set(0, -0.09, 0);
  addBowLimb(lowerPivot, -1, materials.limb);
  const string = coloredBoxMesh('bow:string', [0, 0, 0.14], [0.012, 0.78, 0.012], materials.string);
  root.add(grip, upperPivot, lowerPivot, string);
  applyBowDrawPose(root, 0);
  return root;
}

export function applyBowDrawPose(root: THREE.Object3D, charge: number): void {
  if (root.userData.bowVisual !== true) return;
  const eased = 1 - Math.pow(1 - THREE.MathUtils.clamp(charge, 0, 1), 2);
  const upper = root.getObjectByName('bow:upper-pivot');
  const lower = root.getObjectByName('bow:lower-pivot');
  const string = root.getObjectByName('bow:string');
  if (upper) upper.rotation.z = -0.12 - eased * 0.38;
  if (lower) lower.rotation.z = 0.12 + eased * 0.38;
  if (string) {
    string.position.z = 0.14 + eased * 0.18;
    string.scale.y = 1 + eased * 0.10;
  }
}

/** Shield plate uses the 128×128 atlas; rim/handle stay solid palette colors. */
export function createShieldVisual(
  plateMaterial: THREE.Material,
  rimMaterial: THREE.Material,
  handleMaterial: THREE.Material,
): THREE.Group {
  const root = new THREE.Group();
  let plateGeometry = namedBoxCache.get('shield:plate');
  if (!plateGeometry) {
    plateGeometry = createTexturedCuboidGeometry({
      size: [12, 22, 1],
      textureOffset: [0, 0],
      logicalTextureSize: [64, 64],
      physicalSize: [0.52, 0.84, 0.06],
    });
    plateGeometry.userData.itemFamily = Object.freeze({ family: 'shield', role: 'primary', triangles: 12 });
    plateGeometry.computeBoundingBox();
    namedBoxCache.set('shield:plate', plateGeometry);
  }
  const plate = new THREE.Mesh(plateGeometry, plateMaterial);
  plate.name = 'shield:plate';
  const rim = coloredBoxMesh('shield:rim', [0, 0, 0], [0.58, 0.90, 0.04], rimMaterial);
  const handle = coloredBoxMesh('shield:handle', [0, -0.04, -0.10], [0.06, 0.22, 0.10], handleMaterial);
  root.add(rim, plate, handle);
  return root;
}
