import * as THREE from 'three';
import { MIN_WORLD_Y, WORLD_HEIGHT } from '../core/constants';
import {
  WORLD_BORDER_MAX,
  WORLD_BORDER_MIN,
  WORLD_BORDER_SPAN,
  worldBorderOpacity,
  type WorldBorderSide,
  distanceToWorldBorderPlane,
} from '../world/worldBorder';

export const WORLD_BORDER_COLOR = 0xff2020;
const VERTICAL_MARGIN = 16;
const SIDES: readonly WorldBorderSide[] = ['east', 'west', 'north', 'south'];

function planePosition(side: WorldBorderSide): { x: number; y: number; z: number; rotY: number } {
  const y = (MIN_WORLD_Y + WORLD_HEIGHT) * 0.5;
  if (side === 'east') return { x: WORLD_BORDER_MAX, y, z: 0, rotY: Math.PI / 2 };
  if (side === 'west') return { x: WORLD_BORDER_MIN, y, z: 0, rotY: Math.PI / 2 };
  if (side === 'south') return { x: 0, y, z: WORLD_BORDER_MAX, rotY: 0 };
  return { x: 0, y, z: WORLD_BORDER_MIN, rotY: 0 };
}

export class WorldBorderRenderer {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<WorldBorderSide, THREE.Mesh>();
  private readonly materials = new Map<WorldBorderSide, THREE.MeshBasicMaterial>();
  private readonly geometry: THREE.PlaneGeometry;

  constructor(scene: THREE.Scene) {
    this.group.name = 'world-border';
    const height = WORLD_HEIGHT + VERTICAL_MARGIN * 2;
    this.geometry = new THREE.PlaneGeometry(WORLD_BORDER_SPAN, height);
    for (const side of SIDES) {
      const material = new THREE.MeshBasicMaterial({
        color: WORLD_BORDER_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.name = `world-border-${side}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      mesh.visible = false;
      const pose = planePosition(side);
      mesh.position.set(pose.x, pose.y, pose.z);
      mesh.rotation.y = pose.rotY;
      this.group.add(mesh);
      this.meshes.set(side, mesh);
      this.materials.set(side, material);
    }
    scene.add(this.group);
  }

  get sideCount(): number {
    return this.meshes.size;
  }

  sideMesh(side: WorldBorderSide): THREE.Mesh | undefined {
    return this.meshes.get(side);
  }

  update(cameraX: number, cameraZ: number): void {
    for (const side of SIDES) {
      const material = this.materials.get(side)!;
      const mesh = this.meshes.get(side)!;
      const alpha = worldBorderOpacity(distanceToWorldBorderPlane(cameraX, cameraZ, side));
      material.opacity = alpha;
      mesh.visible = alpha > 0.001;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const mesh of this.meshes.values()) this.group.remove(mesh);
    for (const material of this.materials.values()) material.dispose();
    this.geometry.dispose();
    this.meshes.clear();
    this.materials.clear();
  }
}
