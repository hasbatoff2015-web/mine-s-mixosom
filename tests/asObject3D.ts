import type { Object3D } from 'three';
import type { EntityVisual } from '../src/entities/EntityHost';

/** Client-test helper: EntityVisual is an opaque sim handle whose runtime is Object3D. */
export function asObject3D(visual: EntityVisual | undefined | null): Object3D | undefined {
  return visual as Object3D | undefined;
}
