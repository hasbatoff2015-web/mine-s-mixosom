import * as THREE from 'three';

export interface RenderLookSource {
  readonly yaw: number;
  readonly pitch: number;
}

/** Applies the freshest input orientation on every RAF without changing fixed-tick authority. */
export function applyImmediateRenderLook(
  camera: THREE.PerspectiveCamera,
  look: Readonly<RenderLookSource>,
  roll = 0,
): void {
  camera.rotation.set(look.pitch, look.yaw, roll, 'YXZ');
}
