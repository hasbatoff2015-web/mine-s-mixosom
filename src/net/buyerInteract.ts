/**
 * Shared buyer aim. Desktop use and the mobile tap classifier both call this
 * so a finger ray and a crosshair ray obey the same reach and occluders.
 * The client only chooses the target. The server still accepts or rejects the trade.
 */

export interface BuyerRayHit {
  readonly id: string;
  readonly distance: number;
}

export interface BuyerInteractPick {
  readonly buyers: readonly BuyerRayHit[];
  readonly hologram?: { readonly name: string; readonly distance: number };
  readonly buyerIdForHologram?: (name: string) => string | undefined;
  /** Closest block, mob, cart, or remote player in front of the buyer. */
  readonly occluderDistance?: number;
}

export function pickBuyerInteractTarget(input: BuyerInteractPick): BuyerRayHit | undefined {
  let closest: BuyerRayHit | undefined;
  for (const hit of input.buyers) {
    if (!Number.isFinite(hit.distance) || hit.distance < 0) continue;
    if (!closest || hit.distance < closest.distance) closest = hit;
  }
  const hologram = input.hologram;
  if (hologram && input.buyerIdForHologram) {
    const id = input.buyerIdForHologram(hologram.name);
    if (id && (!closest || hologram.distance <= closest.distance + 0.05)) {
      closest = { id, distance: hologram.distance };
    }
  }
  if (!closest) return undefined;
  if (input.occluderDistance !== undefined && input.occluderDistance < closest.distance) return undefined;
  return closest;
}
