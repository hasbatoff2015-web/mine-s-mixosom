import * as THREE from 'three';
import { blockKey } from '../core/constants';
import type { HorizontalFacing } from '../blocks';
import { TextureAtlas } from './TextureAtlas';
import { bindEntityLightReceiver, createEntityMaterial } from './worldLighting';
import {
  CHEST_LID_PIVOT,
  CHEST_TEXTURE_KEY,
  chestLidAngle,
  chestYaw,
  createChestBodyGeometry,
  createChestLatchGeometry,
  createChestLidGeometry,
  defaultChestFacing,
  stepChestOpenProgress,
} from './chestModel';

export interface ChestRenderCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing?: HorizontalFacing;
}

interface ChestInstance {
  readonly key: string;
  readonly group: THREE.Group;
  readonly lidPivot: THREE.Group;
  targetOpen: number;
  progress: number;
}

export class ChestRenderer {
  readonly group = new THREE.Group();
  private readonly bodyGeometry: THREE.BufferGeometry;
  private readonly lidGeometry: THREE.BufferGeometry;
  private readonly latchGeometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly instances = new Map<string, ChestInstance>();
  private openKey?: string;

  constructor() {
    this.group.name = 'chests';
    this.bodyGeometry = createChestBodyGeometry();
    this.lidGeometry = createChestLidGeometry();
    this.latchGeometry = createChestLatchGeometry();
    const texture = typeof document === 'undefined'
      ? new THREE.Texture()
      : new THREE.TextureLoader().load(TextureAtlas.url(CHEST_TEXTURE_KEY));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    this.material = createEntityMaterial({ map: texture });
    this.material.userData.chestEntityTexture = CHEST_TEXTURE_KEY;
  }

  setOpenTarget(key?: string): void {
    this.openKey = key;
  }

  getOpenTarget(): string | undefined {
    return this.openKey;
  }

  sync(cells: readonly ChestRenderCell[], dtSeconds: number): void {
    const seen = new Set<string>();
    for (const cell of cells) {
      const key = blockKey(cell.x, cell.y, cell.z);
      seen.add(key);
      let instance = this.instances.get(key);
      if (!instance) {
        instance = this.createInstance(key);
        this.instances.set(key, instance);
        this.group.add(instance.group);
      }
      instance.group.position.set(cell.x + 0.5, cell.y, cell.z + 0.5);
      instance.group.rotation.y = chestYaw(defaultChestFacing(cell.facing));
      instance.targetOpen = this.openKey === key ? 1 : 0;
      instance.progress = stepChestOpenProgress(instance.progress, instance.targetOpen, dtSeconds);
      instance.lidPivot.rotation.x = chestLidAngle(instance.progress);
    }
    for (const [key, instance] of this.instances) {
      if (seen.has(key)) continue;
      this.group.remove(instance.group);
      this.instances.delete(key);
    }
  }

  progressFor(key: string): number {
    return this.instances.get(key)?.progress ?? 0;
  }

  targetFor(key: string): number {
    return this.instances.get(key)?.targetOpen ?? 0;
  }

  get instanceCount(): number {
    return this.instances.size;
  }

  dispose(): void {
    this.group.clear();
    this.instances.clear();
    this.bodyGeometry.dispose();
    this.lidGeometry.dispose();
    this.latchGeometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
  }

  private createInstance(key: string): ChestInstance {
    const group = new THREE.Group();
    group.name = `chest:${key}`;
    group.userData.chestKey = key;
    const body = new THREE.Mesh(this.bodyGeometry, this.material);
    body.position.set(-0.5, 0, -0.5);
    bindEntityLightReceiver(body);
    const lidPivot = new THREE.Group();
    lidPivot.position.set(CHEST_LID_PIVOT.x - 0.5, CHEST_LID_PIVOT.y, CHEST_LID_PIVOT.z - 0.5);
    const lid = new THREE.Mesh(this.lidGeometry, this.material);
    const latch = new THREE.Mesh(this.latchGeometry, this.material);
    bindEntityLightReceiver(lid);
    bindEntityLightReceiver(latch);
    lidPivot.add(lid, latch);
    group.add(body, lidPivot);
    return { key, group, lidPivot, targetOpen: 0, progress: 0 };
  }
}
