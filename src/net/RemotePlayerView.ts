import * as THREE from 'three';
import type { PlayerSnapshot, RemotePlayerInfo } from '../../shared/protocol';
import { PLAYER_HEIGHT, PLAYER_WIDTH } from '../core/constants';

interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  at: number;
}

export class RemotePlayerView {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private previous: Pose;
  private current: Pose;

  constructor(info: RemotePlayerInfo, now = performance.now()) {
    const geometry = new THREE.BoxGeometry(PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_WIDTH);
    const material = new THREE.MeshLambertMaterial({ color: 0xc48a5a });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = PLAYER_HEIGHT / 2;
    this.group.add(this.mesh);
    const pose = { x: info.x, y: info.y, z: info.z, yaw: info.yaw, at: now };
    this.previous = pose;
    this.current = pose;
    this.group.position.set(info.x, info.y, info.z);
    this.group.rotation.y = info.yaw;
  }

  applySnapshot(snapshot: PlayerSnapshot | RemotePlayerInfo, now = performance.now()): void {
    this.previous = this.current;
    this.current = { x: snapshot.x, y: snapshot.y, z: snapshot.z, yaw: snapshot.yaw, at: now };
  }

  interpolate(now = performance.now()): void {
    const span = Math.max(1, this.current.at - this.previous.at);
    const alpha = Math.max(0, Math.min(1, (now - this.current.at) / span + 1));
    const x = this.previous.x + (this.current.x - this.previous.x) * Math.min(1, alpha);
    const y = this.previous.y + (this.current.y - this.previous.y) * Math.min(1, alpha);
    const z = this.previous.z + (this.current.z - this.previous.z) * Math.min(1, alpha);
    this.group.position.set(x, y, z);
    this.group.rotation.y = this.current.yaw;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
