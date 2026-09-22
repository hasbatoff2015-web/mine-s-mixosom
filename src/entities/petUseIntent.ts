import { isPetKind } from './petTypes';

export interface PetUseHit {
  readonly id: string;
  readonly distance: number;
  readonly renderTick?: number;
  readonly kind?: string;
  readonly alive?: boolean;
}

export interface PetUseTarget {
  readonly id: string;
  readonly distance: number;
  readonly renderTick?: number;
}

/**
 * Visible pet interaction wins over ordinary food/block use, but a closer
 * occluding block or minecart still takes priority.
 */
export function resolvePetUseTarget(options: {
  readonly petHit?: PetUseHit;
  readonly blockDistance?: number;
  readonly cartDistance?: number;
}): PetUseTarget | undefined {
  const hit = options.petHit;
  if (!hit || hit.alive === false) return undefined;
  if (hit.kind !== undefined && !isPetKind(hit.kind)) return undefined;
  if (options.blockDistance !== undefined && options.blockDistance < hit.distance) return undefined;
  if (options.cartDistance !== undefined && options.cartDistance < hit.distance) return undefined;
  return {
    id: hit.id,
    distance: hit.distance,
    ...(hit.renderTick !== undefined ? { renderTick: hit.renderTick } : {}),
  };
}
