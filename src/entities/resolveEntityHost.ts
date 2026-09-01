import { isEntityHost, type EntityHost } from './EntityHost';

/**
 * Options forwarded when tests still pass a scene graph root instead of an
 * EntityHost. Typed as unknown so this module stays Three-free.
 */
export interface LegacyEntityRootOptions {
  readonly itemVisuals?: unknown;
  readonly arrowVisuals?: unknown;
  readonly ownsItemVisuals?: boolean;
  readonly ownsArrowVisuals?: boolean;
}

type LegacyRootWrapper = (root: object, options?: LegacyEntityRootOptions) => EntityHost;

let wrapLegacyRoot: LegacyRootWrapper | undefined;

/**
 * Client tests register Three wrapping. Production Game and the server pass
 * EntityHost and never hit the wrapper. Shared simulation does not import Three.
 */
export function registerLegacyEntityRootWrapper(wrapper: LegacyRootWrapper): void {
  wrapLegacyRoot = wrapper;
}

export function resolveEntityHost(
  sceneOrHost: EntityHost | object,
  options?: LegacyEntityRootOptions,
): EntityHost {
  if (isEntityHost(sceneOrHost)) return sceneOrHost;
  if (wrapLegacyRoot) return wrapLegacyRoot(sceneOrHost, options);
  throw new Error(
    'Entity managers require an EntityHost. Pass HeadlessEntityHost or ThreeEntityHost.',
  );
}
