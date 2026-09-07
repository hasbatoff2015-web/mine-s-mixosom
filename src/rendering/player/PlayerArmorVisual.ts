import * as THREE from 'three';
import type { PlayerEquipmentState } from '../../../shared/protocol';
import chainmailLayer1Url from '../../../assets/minecraft/textures/models/armor/chainmail_layer_1.png?url';
import chainmailLayer2Url from '../../../assets/minecraft/textures/models/armor/chainmail_layer_2.png?url';
import diamondLayer1Url from '../../../assets/minecraft/textures/models/armor/diamond_layer_1.png?url';
import diamondLayer2Url from '../../../assets/minecraft/textures/models/armor/diamond_layer_2.png?url';
import goldLayer1Url from '../../../assets/minecraft/textures/models/armor/gold_layer_1.png?url';
import goldLayer2Url from '../../../assets/minecraft/textures/models/armor/gold_layer_2.png?url';
import ironLayer1Url from '../../../assets/minecraft/textures/models/armor/iron_layer_1.png?url';
import ironLayer2Url from '../../../assets/minecraft/textures/models/armor/iron_layer_2.png?url';
import leatherLayer1Url from '../../../assets/minecraft/textures/models/armor/leather_layer_1.png?url';
import leatherLayer1OverlayUrl from '../../../assets/minecraft/textures/models/armor/leather_layer_1_overlay.png?url';
import leatherLayer2Url from '../../../assets/minecraft/textures/models/armor/leather_layer_2.png?url';
import leatherLayer2OverlayUrl from '../../../assets/minecraft/textures/models/armor/leather_layer_2_overlay.png?url';
import { tryGetItemDefinition, type ArmorSlot } from '../../items';
import { createTexturedCuboidGeometry, type TexturedCuboidDefinition } from '../TexturedCuboid';
import {
  cloneOwnedEntityMaterial,
  createEntityMaterial,
} from '../worldLighting';
import type { PlayerModelVariant } from '../../player/appearance/PlayerAppearance';
import { PLAYER_MODEL_PIXEL, type PlayerSkinPresentation } from './PlayerSkinGeometry';

export type ArmorTextureLayer = 1 | 2;
export type ArmorVisualMaterial = 'leather' | 'chainmail' | 'gold' | 'iron' | 'diamond';
export type ArmorVisualPart = 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg';
export type ArmorShell = 'inner' | 'outer';
export type ArmorTexturePass = 'base' | 'overlay';

export interface ArmorVisualDescriptor {
  readonly itemId: string;
  readonly slot: ArmorSlot;
  readonly material: ArmorVisualMaterial;
  readonly textureLayer: ArmorTextureLayer;
}

export interface PlayerArmorRig {
  readonly head: THREE.Group;
  readonly body: THREE.Group;
  readonly rightArm: THREE.Group;
  readonly leftArm: THREE.Group;
  readonly rightLeg: THREE.Group;
  readonly leftLeg: THREE.Group;
}

export interface ArmorMeshPair {
  readonly part: ArmorVisualPart;
  readonly base: THREE.Mesh;
  readonly overlay: THREE.Mesh;
}

const ARMOR_SLOT_NAMES: Readonly<Record<ArmorSlot, string>> = Object.freeze({
  head: 'helmet',
  chest: 'chestplate',
  legs: 'leggings',
  feet: 'boots',
});

const ARMOR_NAME_TO_SLOT: Readonly<Record<string, ArmorSlot>> = Object.freeze({
  helmet: 'head',
  chestplate: 'chest',
  leggings: 'legs',
  boots: 'feet',
});

export const ARMOR_VISUAL_MATERIALS: readonly ArmorVisualMaterial[] = Object.freeze([
  'leather',
  'chainmail',
  'gold',
  'iron',
  'diamond',
]);

export const PLAYER_ARMOR_INNER_INFLATE = 0.5 * PLAYER_MODEL_PIXEL;
export const PLAYER_ARMOR_OUTER_INFLATE = 1 * PLAYER_MODEL_PIXEL;
export const DEFAULT_LEATHER_ARMOR_COLOR = 0xa06540;

export const ARMOR_TEXTURE_URLS: Readonly<
  Record<ArmorVisualMaterial, Readonly<Record<ArmorTextureLayer, string>>>
> = Object.freeze({
  leather: Object.freeze({ 1: leatherLayer1Url, 2: leatherLayer2Url }),
  chainmail: Object.freeze({ 1: chainmailLayer1Url, 2: chainmailLayer2Url }),
  gold: Object.freeze({ 1: goldLayer1Url, 2: goldLayer2Url }),
  iron: Object.freeze({ 1: ironLayer1Url, 2: ironLayer2Url }),
  diamond: Object.freeze({ 1: diamondLayer1Url, 2: diamondLayer2Url }),
});

export const LEATHER_ARMOR_OVERLAY_URLS: Readonly<Record<ArmorTextureLayer, string>> = Object.freeze({
  1: leatherLayer1OverlayUrl,
  2: leatherLayer2OverlayUrl,
});

const PART_SIZE: Readonly<Record<ArmorVisualPart, readonly [number, number, number]>> = Object.freeze({
  head: [8, 8, 8],
  body: [8, 12, 4],
  rightArm: [4, 12, 4],
  leftArm: [4, 12, 4],
  rightLeg: [4, 12, 4],
  leftLeg: [4, 12, 4],
});

const PART_TEXTURE_OFFSET: Readonly<Record<ArmorVisualPart, readonly [number, number]>> = Object.freeze({
  head: [0, 0],
  body: [16, 16],
  rightArm: [40, 16],
  leftArm: [40, 16],
  rightLeg: [0, 16],
  leftLeg: [0, 16],
});

const SLOT_PARTS = Object.freeze({
  head: ['head'] as const,
  chest: ['body', 'rightArm', 'leftArm'] as const,
  legs: ['body', 'rightLeg', 'leftLeg'] as const,
  feet: ['rightLeg', 'leftLeg'] as const,
}) satisfies Readonly<Record<ArmorSlot, readonly ArmorVisualPart[]>>;

const EMPTY_EQUIPMENT: PlayerEquipmentState = Object.freeze({
  head: null,
  chest: null,
  legs: null,
  feet: null,
});

function isArmorVisualMaterial(value: string): value is ArmorVisualMaterial {
  return (ARMOR_VISUAL_MATERIALS as readonly string[]).includes(value);
}

/**
 * Resolves registered armor metadata. The chainmail ids are presentation-only
 * compatibility for the supplied vanilla atlas; chainmail is not added to the
 * gameplay registry, Creative catalog, recipes, defense, or durability here.
 */
export function resolveArmorVisual(itemId?: string | null): ArmorVisualDescriptor | undefined {
  if (!itemId) return undefined;
  const definition = tryGetItemDefinition(itemId);
  if (definition?.kind === 'armor' && isArmorVisualMaterial(definition.material)) {
    return {
      itemId,
      slot: definition.slot,
      material: definition.material,
      textureLayer: definition.slot === 'legs' ? 2 : 1,
    };
  }
  const match = /^(chainmail)_(helmet|chestplate|leggings|boots)$/.exec(itemId);
  if (!match) return undefined;
  const material = match[1]!;
  const slot = ARMOR_NAME_TO_SLOT[match[2]!];
  if (!slot || !isArmorVisualMaterial(material)) return undefined;
  return { itemId, slot, material, textureLayer: slot === 'legs' ? 2 : 1 };
}

export function armorVisualItemId(material: ArmorVisualMaterial, slot: ArmorSlot): string {
  return `${material}_${ARMOR_SLOT_NAMES[slot]}`;
}

export function playerArmorPartDefinition(
  part: ArmorVisualPart,
  shell: ArmorShell,
  presentation: PlayerSkinPresentation = 'world',
): TexturedCuboidDefinition {
  const size = PART_SIZE[part];
  const pixel = presentation === 'firstPerson' ? 0.04 : PLAYER_MODEL_PIXEL;
  return {
    size,
    textureOffset: PART_TEXTURE_OFFSET[part],
    logicalTextureSize: [64, 32],
    physicalSize: [size[0] * pixel, size[1] * pixel, size[2] * pixel],
    mirror: part === 'leftArm' || part === 'leftLeg',
    inflate: (shell === 'inner' ? 0.5 : 1) * pixel,
  };
}

export class PlayerArmorGeometryCache {
  private readonly geometries = new Map<string, THREE.BufferGeometry>();

  get(
    part: ArmorVisualPart,
    shell: ArmorShell,
    presentation: PlayerSkinPresentation = 'world',
  ): THREE.BufferGeometry {
    const key = `${presentation}:${shell}:${part}`;
    let geometry = this.geometries.get(key);
    if (!geometry) {
      geometry = createTexturedCuboidGeometry(playerArmorPartDefinition(part, shell, presentation));
      geometry.name = `player-armor:${key}`;
      this.geometries.set(key, geometry);
    }
    return geometry;
  }

  get size(): number {
    return this.geometries.size;
  }

  dispose(): void {
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
  }
}

function textureUrl(
  material: ArmorVisualMaterial,
  layer: ArmorTextureLayer,
  pass: ArmorTexturePass,
): string | undefined {
  if (pass === 'overlay') return material === 'leather' ? LEATHER_ARMOR_OVERLAY_URLS[layer] : undefined;
  return ARMOR_TEXTURE_URLS[material][layer];
}

/** Shared decoded textures and material templates; entity-owned clones keep voxel light isolated. */
export class PlayerArmorMaterialCache {
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly templates = new Map<string, THREE.MeshBasicMaterial>();
  private disposed = false;

  template(
    material: ArmorVisualMaterial,
    layer: ArmorTextureLayer,
    pass: ArmorTexturePass = 'base',
  ): THREE.MeshBasicMaterial {
    if (this.disposed) throw new Error('PlayerArmorMaterialCache is disposed.');
    const url = textureUrl(material, layer, pass);
    if (!url) throw new Error(`Armor texture does not exist for ${material}:${layer}:${pass}.`);
    const key = `${material}:${layer}:${pass}`;
    let template = this.templates.get(key);
    if (!template) {
      let texture = this.textures.get(url);
      if (!texture) {
        texture = typeof document === 'undefined'
          ? new THREE.Texture()
          : new THREE.TextureLoader().load(
            url,
            undefined,
            undefined,
            (error) => console.error(`[player-armor] Unable to load ${url}.`, error),
          );
        texture.name = `player-armor-texture:${key}`;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        this.textures.set(url, texture);
      }
      template = createEntityMaterial({
        map: texture,
        color: material === 'leather' && pass === 'base' ? DEFAULT_LEATHER_ARMOR_COLOR : 0xffffff,
        alphaTest: 0.1,
        transparent: true,
        depthWrite: true,
      });
      template.name = `player-armor-material:${key}`;
      this.templates.set(key, template);
    }
    return template;
  }

  owned(
    material: ArmorVisualMaterial,
    layer: ArmorTextureLayer,
    pass: ArmorTexturePass = 'base',
  ): THREE.MeshBasicMaterial {
    return cloneOwnedEntityMaterial(this.template(material, layer, pass));
  }

  get textureCount(): number {
    return this.textures.size;
  }

  get materialCount(): number {
    return this.templates.size;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const material of this.templates.values()) material.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.templates.clear();
    this.textures.clear();
    this.disposed = true;
  }
}

export interface PlayerArmorResources {
  readonly materials: PlayerArmorMaterialCache;
  readonly geometries: PlayerArmorGeometryCache;
}

function equipmentSignature(equipment: PlayerEquipmentState, leatherColor: THREE.ColorRepresentation): string {
  return `${equipment.head ?? ''}|${equipment.chest ?? ''}|${equipment.legs ?? ''}|${equipment.feet ?? ''}|${new THREE.Color(leatherColor).getHexString()}`;
}

/** Slot-independent cuboid shells parented to the canonical animated player pivots. */
export class PlayerArmorVisual {
  private readonly pieces = new Map<ArmorSlot, readonly ArmorMeshPair[]>();
  private readonly ownedMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private readonly placeholder = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private equipmentValue: PlayerEquipmentState = EMPTY_EQUIPMENT;
  private leatherColor: THREE.ColorRepresentation = DEFAULT_LEATHER_ARMOR_COLOR;
  private signature = '';
  private hidden = false;
  private disposed = false;

  constructor(
    private readonly rig: PlayerArmorRig,
    private readonly resources: PlayerArmorResources,
    private model: PlayerModelVariant,
  ) {
    for (const slot of Object.keys(SLOT_PARTS) as ArmorSlot[]) {
      const shell: ArmorShell = slot === 'legs' ? 'inner' : 'outer';
      const pairs = SLOT_PARTS[slot].map((part) => this.createPair(slot, part, shell));
      this.pieces.set(slot, Object.freeze(pairs));
    }
    this.setModel(model);
    this.syncVisibilityAndMaterials();
  }

  get equipment(): PlayerEquipmentState {
    return { ...this.equipmentValue };
  }

  setEquipment(
    equipment: PlayerEquipmentState = EMPTY_EQUIPMENT,
    leatherColor: THREE.ColorRepresentation = DEFAULT_LEATHER_ARMOR_COLOR,
  ): void {
    if (this.disposed) return;
    const signature = equipmentSignature(equipment, leatherColor);
    if (signature === this.signature) return;
    this.signature = signature;
    this.equipmentValue = { ...equipment };
    this.leatherColor = leatherColor;
    this.syncVisibilityAndMaterials();
  }

  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.syncVisibilityAndMaterials();
  }

  setModel(model: PlayerModelVariant): void {
    this.model = model;
    for (const pairs of this.pieces.values()) {
      for (const pair of pairs) this.positionPair(pair);
    }
  }

  meshes(slot: ArmorSlot): readonly ArmorMeshPair[] {
    return this.pieces.get(slot) ?? [];
  }

  dispose(): void {
    if (this.disposed) return;
    for (const pairs of this.pieces.values()) {
      for (const pair of pairs) {
        pair.base.removeFromParent();
        pair.overlay.removeFromParent();
      }
    }
    for (const material of this.ownedMaterials.values()) material.dispose();
    this.ownedMaterials.clear();
    this.placeholder.dispose();
    this.pieces.clear();
    this.disposed = true;
  }

  private createPair(slot: ArmorSlot, part: ArmorVisualPart, shell: ArmorShell): ArmorMeshPair {
    const geometry = this.resources.geometries.get(part, shell);
    const base = new THREE.Mesh(geometry, this.placeholder);
    const overlay = new THREE.Mesh(geometry, this.placeholder);
    base.name = `player-armor:${slot}:${part}:shell-base`;
    overlay.name = `player-armor:${slot}:${part}:shell-overlay`;
    base.renderOrder = 2;
    overlay.renderOrder = 3;
    base.visible = false;
    overlay.visible = false;
    this.rig[part].add(base, overlay);
    return { part, base, overlay };
  }

  private positionPair(pair: ArmorMeshPair): void {
    const part = pair.part;
    let x = 0;
    let y = 0;
    if (part === 'head') y = 4 * PLAYER_MODEL_PIXEL;
    else if (part === 'body') y = 6 * PLAYER_MODEL_PIXEL;
    else if (part === 'rightLeg' || part === 'leftLeg') y = -6 * PLAYER_MODEL_PIXEL;
    else {
      x = (part === 'rightArm' ? -1 : 1) * (this.model === 'slim' ? 0.5 : 1) * PLAYER_MODEL_PIXEL;
      y = -4 * PLAYER_MODEL_PIXEL;
    }
    pair.base.position.set(x, y, 0);
    pair.overlay.position.set(x, y, 0);
  }

  private ownedMaterial(
    slot: ArmorSlot,
    descriptor: ArmorVisualDescriptor,
    pass: ArmorTexturePass,
  ): THREE.MeshBasicMaterial {
    const key = `${slot}:${descriptor.material}:${descriptor.textureLayer}:${pass}`;
    let material = this.ownedMaterials.get(key);
    if (!material) {
      material = this.resources.materials.owned(descriptor.material, descriptor.textureLayer, pass);
      material.name = `player-armor-owned:${key}`;
      this.ownedMaterials.set(key, material);
    }
    if (descriptor.material === 'leather' && pass === 'base') material.color.set(this.leatherColor);
    return material;
  }

  private syncVisibilityAndMaterials(): void {
    for (const slot of Object.keys(SLOT_PARTS) as ArmorSlot[]) {
      const descriptor = resolveArmorVisual(this.equipmentValue[slot]);
      const visible = !this.hidden && descriptor?.slot === slot;
      for (const pair of this.pieces.get(slot) ?? []) {
        pair.base.visible = visible;
        pair.overlay.visible = visible && descriptor?.material === 'leather';
        if (!visible || !descriptor) continue;
        pair.base.material = this.ownedMaterial(slot, descriptor, 'base');
        if (descriptor.material === 'leather') {
          pair.overlay.material = this.ownedMaterial(slot, descriptor, 'overlay');
        }
      }
    }
  }
}

/** Camera-space right-arm shell only; no head/body/leg geometry can intersect the near plane. */
export class FirstPersonArmorSleeve {
  readonly base: THREE.Mesh;
  readonly overlay: THREE.Mesh;
  private readonly ownedMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private equipmentSignature = '';
  private descriptor?: ArmorVisualDescriptor;
  private hidden = false;

  constructor(
    parent: THREE.Group,
    private readonly resources: PlayerArmorResources,
  ) {
    const geometry = resources.geometries.get('rightArm', 'outer', 'firstPerson');
    const placeholder = new THREE.MeshBasicMaterial({ color: 0xffffff });
    placeholder.name = 'first-person-armor-placeholder';
    placeholder.visible = false;
    this.ownedMaterials.set('placeholder', placeholder);
    this.base = new THREE.Mesh(geometry, placeholder);
    this.overlay = new THREE.Mesh(geometry, placeholder);
    this.base.name = 'first-person:armor-sleeve:base';
    this.overlay.name = 'first-person:armor-sleeve:overlay';
    this.base.position.y = -0.22;
    this.overlay.position.y = -0.22;
    this.base.renderOrder = 2;
    this.overlay.renderOrder = 3;
    this.base.visible = false;
    this.overlay.visible = false;
    parent.add(this.base, this.overlay);
  }

  setEquipment(equipment: PlayerEquipmentState): void {
    const signature = equipment.chest ?? '';
    if (signature === this.equipmentSignature) return;
    this.equipmentSignature = signature;
    const descriptor = resolveArmorVisual(equipment.chest);
    this.descriptor = descriptor?.slot === 'chest' ? descriptor : undefined;
    if (this.descriptor) {
      this.base.material = this.owned(this.descriptor, 'base');
      if (this.descriptor.material === 'leather') {
        this.overlay.material = this.owned(this.descriptor, 'overlay');
      }
    }
    this.syncVisibility();
  }

  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.syncVisibility();
  }

  dispose(): void {
    this.base.removeFromParent();
    this.overlay.removeFromParent();
    for (const material of this.ownedMaterials.values()) material.dispose();
    this.ownedMaterials.clear();
  }

  private owned(descriptor: ArmorVisualDescriptor, pass: ArmorTexturePass): THREE.MeshBasicMaterial {
    const key = `${descriptor.material}:${descriptor.textureLayer}:${pass}`;
    let material = this.ownedMaterials.get(key);
    if (!material) {
      material = this.resources.materials.owned(descriptor.material, descriptor.textureLayer, pass);
      material.name = `first-person-armor-owned:${key}`;
      this.ownedMaterials.set(key, material);
    }
    return material;
  }

  private syncVisibility(): void {
    this.base.visible = !this.hidden && this.descriptor !== undefined;
    this.overlay.visible = this.base.visible && this.descriptor?.material === 'leather';
  }
}
