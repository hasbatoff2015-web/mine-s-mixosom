import * as THREE from 'three';
import { BlockId } from '../blocks';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../core/constants';
import type { VoxelWorld } from '../world/World';
import { signVisualParts } from './specialBlockGeometry';

interface SignVisual {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  texture: THREE.CanvasTexture;
  geometry: THREE.PlaneGeometry;
  signature: string;
}

/** Text is rebuilt only on sign data/state or chunk visibility changes. */
export class SignRenderer {
  readonly group = new THREE.Group();
  private readonly visuals = new Map<string, SignVisual>();
  private lastVersion = -1;
  private visibilityDirty = true;

  constructor(private readonly world: VoxelWorld, private readonly hasChunk: (key: string) => boolean) {
    this.group.name = 'sign-text';
  }

  invalidateVisibility(): void { this.visibilityDirty = true; }

  sync(): void {
    if (!this.visibilityDirty && this.lastVersion === this.world.signVersion) return;
    this.visibilityDirty = false;
    this.lastVersion = this.world.signVersion;
    const wanted = new Set<string>();
    for (const [key, lines] of this.world.signs) {
      const [x, y, z] = key.split(',').map(Number);
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)
        || !this.hasChunk(chunkKey(floorDiv(x!, CHUNK_SIZE), floorDiv(z!, CHUNK_SIZE)))
        || this.world.getBlock(x!, y!, z!, false) !== BlockId.OakSign) continue;
      wanted.add(key);
      const state = this.world.getBlockState(x!, y!, z!);
      const signature = JSON.stringify([lines, state?.attachment, state?.facing, state?.signRotation]);
      if (this.visuals.get(key)?.signature === signature) continue;
      this.remove(key);
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 128;
      const context = canvas.getContext('2d');
      if (!context) continue;
      context.fillStyle = '#25170e';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = '22px sans-serif';
      for (let row = 0; row < 4; row += 1) context.fillText(lines[row] ?? '', 128, 18 + row * 30, 246);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false,
        side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: -1 });
      const board = signVisualParts(state?.attachment === 'wall' ? 'wall' : 'floor')[0]!;
      const geometry = new THREE.PlaneGeometry(board.size[0] * 0.9, board.size[1] * 0.72);
      const mesh = new THREE.Mesh(geometry, material);
      const facing = state?.facing ?? 'south';
      const angle = state?.attachment === 'floor' && state.signRotation !== undefined
        ? state.signRotation * Math.PI / 8
        : facing === 'north' ? Math.PI : facing === 'east' ? Math.PI / 2 : facing === 'west' ? -Math.PI / 2 : 0;
      mesh.rotation.y = angle;
      const local = new THREE.Vector3(board.center[0], board.center[1], board.center[2] + board.size[2] / 2 + 0.006)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      mesh.position.set(x! + 0.5 + local.x, y! + local.y, z! + 0.5 + local.z);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.visuals.set(key, { mesh, texture, geometry, signature });
    }
    for (const key of this.visuals.keys()) if (!wanted.has(key)) this.remove(key);
  }

  private remove(key: string): void {
    const visual = this.visuals.get(key);
    if (!visual) return;
    this.group.remove(visual.mesh);
    visual.mesh.material.dispose();
    visual.texture.dispose();
    visual.geometry.dispose();
    this.visuals.delete(key);
  }

  dispose(): void {
    for (const key of [...this.visuals.keys()]) this.remove(key);
  }
}
