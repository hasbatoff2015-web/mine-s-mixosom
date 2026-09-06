import * as THREE from 'three';
import type { PlayerModelVariant } from '../../player/appearance/PlayerAppearance';
import { tryGetItemDefinition, type ArmorSlot } from '../../items';
import {
  EMPTY_EQUIPPED_ARMOR,
  equippedArmorFromPartial,
  type EquippedArmorPresentation,
} from '../../../shared/playerPresentation';
import { TextureAtlas } from '../TextureAtlas';
import { bindEntityLightReceiver, createEntityMaterial } from '../worldLighting';
import {
  PLAYER_MODEL_PIXEL,
  playerSkinPartSize,
  type PlayerSkinPart,
} from './PlayerSkinGeometry';

/** Vanilla layer-1 inflate (helmet / chest / boots), in skin pixels. */
export const ARMOR_LAYER1_INFLATE_PX = 1;
/** Vanilla layer-2 inflate (leggings). */
export const ARMOR_LAYER2_INFLATE_PX = 0.5;

const ARMOR_TINT: Readonly<Record<string, number>> = Object.freeze({
  leather: 0xc65c3a,
  iron: 0xd8d8d8,
  gold: 0xf8d547,
  diamond: 0x4aedd8,
});

export function armorIdsEqual(a: EquippedArmorPresentation, b: EquippedArmorPresentation): boolean {
  return a.head === b.head && a.chest === b.chest && a.legs === b.legs && a.feet === b.feet;
}

function armorItemIdForSlot(itemId: string | null, slot: ArmorSlot): string | null {
  if (!itemId) return null;
  const definition = tryGetItemDefinition(itemId);
  return definition?.kind === 'armor' && definition.slot === slot ? itemId : null;
}

export function sanitizeEquippedArmor(armor?: EquippedArmorPresentation | null): EquippedArmorPresentation {
  const next = equippedArmorFromPartial(armor);
  return {
    head: armorItemIdForSlot(next.head, 'head'),
    chest: armorItemIdForSlot(next.chest, 'chest'),
    legs: armorItemIdForSlot(next.legs, 'legs'),
    feet: armorItemIdForSlot(next.feet, 'feet'),
  };
}

interface ArmorAttach {
  readonly part: PlayerSkinPart;
  readonly inflatePx: number;
}

function attachmentsForSlot(slot: ArmorSlot): readonly ArmorAttach[] {
  if (slot === 'head') return [{ part: 'head', inflatePx: ARMOR_LAYER1_INFLATE_PX }];
  if (slot === 'chest') {
    return [
      { part: 'body', inflatePx: ARMOR_LAYER1_INFLATE_PX },
      { part: 'rightArm', inflatePx: ARMOR_LAYER2_INFLATE_PX },
      { part: 'leftArm', inflatePx: ARMOR_LAYER2_INFLATE_PX },
    ];
  }
  if (slot === 'legs') {
    return [
      { part: 'rightLeg', inflatePx: ARMOR_LAYER2_INFLATE_PX },
      { part: 'leftLeg', inflatePx: ARMOR_LAYER2_INFLATE_PX },
    ];
  }
  return [
    { part: 'rightLeg', inflatePx: ARMOR_LAYER1_INFLATE_PX },
    { part: 'leftLeg', inflatePx: ARMOR_LAYER1_INFLATE_PX },
  ];
}

/** Inflated cuboid shells parented to the player rig. Uses item icons; the pack has no armor UV sheets. */
export class PlayerArmorOverlay {
  private readonly meshes: THREE.Mesh[] = [];
  private readonly geometries = new Map<string, THREE.BoxGeometry>();
  private readonly textures = new Map<string, THREE.Texture>();
  private current: EquippedArmorPresentation = EMPTY_EQUIPPED_ARMOR;

  constructor(
    private readonly pivots: Readonly<Record<PlayerSkinPart, THREE.Object3D>>,
    private readonly getVariant: () => PlayerModelVariant,
    private readonly positionPartMeshes: (part: PlayerSkinPart, ...meshes: THREE.Mesh[]) => void,
  ) {}

  get equipped(): EquippedArmorPresentation {
    return this.current;
  }

  setArmor(armor: EquippedArmorPresentation | undefined, invisible: boolean): void {
    const next = sanitizeEquippedArmor(armor);
    if (armorIdsEqual(next, this.current)) {
      this.setVisible(!invisible);
      return;
    }
    this.clearMeshes();
    this.current = next;
    const variant = this.getVariant();
    for (const slot of ['head', 'chest', 'legs', 'feet'] as const) {
      const itemId = next[slot];
      if (!itemId) continue;
      for (const attach of attachmentsForSlot(slot)) {
        this.attachPiece(slot, itemId, attach, variant);
      }
    }
    this.setVisible(!invisible);
  }

  rebuild(invisible: boolean): void {
    const equipped = this.current;
    this.current = EMPTY_EQUIPPED_ARMOR;
    this.clearMeshes();
    this.setArmor(equipped, invisible);
  }

  setVisible(visible: boolean): void {
    for (const mesh of this.meshes) mesh.visible = visible;
  }

  dispose(): void {
    this.clearMeshes();
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
    this.current = EMPTY_EQUIPPED_ARMOR;
  }

  private attachPiece(
    slot: ArmorSlot,
    itemId: string,
    attach: ArmorAttach,
    variant: PlayerModelVariant,
  ): void {
    const mesh = new THREE.Mesh(this.geometryFor(attach.part, variant, attach.inflatePx), this.materialFor(itemId));
    mesh.name = `player-armor:${slot}:${attach.part}`;
    mesh.renderOrder = 2;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.positionPartMeshes(attach.part, mesh);
    this.pivots[attach.part].add(mesh);
    bindEntityLightReceiver(mesh);
    this.meshes.push(mesh);
  }

  private materialFor(itemId: string): THREE.MeshBasicMaterial {
    const definition = tryGetItemDefinition(itemId);
    const tint = definition?.kind === 'armor' ? ARMOR_TINT[definition.material] ?? 0xffffff : 0xffffff;
    return createEntityMaterial({
      map: this.textureFor(itemId, definition?.kind === 'armor' ? definition.texture : undefined),
      color: tint,
      alphaTest: 0.05,
      transparent: true,
      depthWrite: true,
    });
  }

  private textureFor(itemId: string, textureKey?: string): THREE.Texture {
    const cached = this.textures.get(itemId);
    if (cached) return cached;
    const texture = typeof document === 'undefined' || !textureKey
      ? new THREE.Texture()
      : new THREE.TextureLoader().load(TextureAtlas.url(textureKey));
    texture.name = `player-armor:${itemId}`;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    this.textures.set(itemId, texture);
    return texture;
  }

  private geometryFor(part: PlayerSkinPart, variant: PlayerModelVariant, inflatePx: number): THREE.BoxGeometry {
    const key = `${variant}:${part}:${inflatePx}`;
    let geometry = this.geometries.get(key);
    if (geometry) return geometry;
    const [sx, sy, sz] = playerSkinPartSize(part, variant);
    const inflate = inflatePx * PLAYER_MODEL_PIXEL;
    geometry = new THREE.BoxGeometry(
      sx * PLAYER_MODEL_PIXEL + inflate * 2,
      sy * PLAYER_MODEL_PIXEL + inflate * 2,
      sz * PLAYER_MODEL_PIXEL + inflate * 2,
    );
    geometry.name = `player-armor-geo:${key}`;
    this.geometries.set(key, geometry);
    return geometry;
  }

  private clearMeshes(): void {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      const material = mesh.material;
      if (material instanceof THREE.Material) material.dispose();
    }
    this.meshes.length = 0;
  }
}
