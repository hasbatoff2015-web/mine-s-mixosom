import type { Object3D } from 'three';
import { createThreeEntityHost, type ThreeEntityHostOptions } from '../src/entities/ThreeEntityHost';
import { registerLegacyEntityRootWrapper } from '../src/entities/resolveEntityHost';

/**
 * Vitest convenience: `new MobManager(new THREE.Scene(), world)` still wraps
 * through ThreeEntityHost. Production Game and the server pass EntityHost
 * and never register this. Isolated sim smoke does not load this file.
 */
registerLegacyEntityRootWrapper((root, options) =>
  createThreeEntityHost(root as Object3D, options as ThreeEntityHostOptions | undefined),
);
