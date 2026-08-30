import type * as THREE from 'three';
import { isEntityHost, type EntityHost } from './EntityHost';
import { createThreeEntityHost, type ThreeEntityHostOptions } from './ThreeEntityHost';

export function resolveEntityHost(
  sceneOrHost: THREE.Object3D | EntityHost,
  options?: ThreeEntityHostOptions,
): EntityHost {
  if (isEntityHost(sceneOrHost)) return sceneOrHost;
  return createThreeEntityHost(sceneOrHost, options);
}
