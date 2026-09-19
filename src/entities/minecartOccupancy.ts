/** Occupancy is derived from live players' `ridingCartId`; `cart.rider` is only a cache. */

export interface MinecartOccupantCandidate {
  readonly id: string;
  readonly connected?: boolean;
  readonly survival?: { readonly dead?: boolean };
  readonly ridingCartId?: string;
}

function isLivePassenger(player: MinecartOccupantCandidate): boolean {
  return player.connected !== false
    && player.survival?.dead !== true
    && Boolean(player.ridingCartId);
}

export function findMinecartPassenger<T extends MinecartOccupantCandidate>(
  players: Iterable<T>,
  cartId: string,
  excludeId?: string,
): T | undefined {
  for (const player of players) {
    if (excludeId && player.id === excludeId) continue;
    if (!isLivePassenger(player)) continue;
    if (player.ridingCartId === cartId) return player;
  }
  return undefined;
}

export function minecartPassengerId(
  players: Iterable<MinecartOccupantCandidate>,
  cartId: string,
): string | undefined {
  return findMinecartPassenger(players, cartId)?.id;
}

export function isMinecartOccupied(
  players: Iterable<MinecartOccupantCandidate>,
  cartId: string,
  excludeId?: string,
): boolean {
  return Boolean(findMinecartPassenger(players, cartId, excludeId));
}

/** First live occupant per cart wins. Disconnected / dead riders are ignored. */
export function collectMinecartPassengers(
  players: Iterable<MinecartOccupantCandidate>,
): Map<string, string> {
  const occupants = new Map<string, string>();
  for (const player of players) {
    if (!isLivePassenger(player) || !player.ridingCartId) continue;
    if (occupants.has(player.ridingCartId)) continue;
    occupants.set(player.ridingCartId, player.id);
  }
  return occupants;
}

/** Extra live riders after the first occupant of each cart. */
export function extraMinecartOccupants<T extends MinecartOccupantCandidate>(
  players: Iterable<T>,
): T[] {
  const seen = new Map<string, string>();
  const extras: T[] = [];
  for (const player of players) {
    if (!isLivePassenger(player) || !player.ridingCartId) continue;
    if (!seen.has(player.ridingCartId)) {
      seen.set(player.ridingCartId, player.id);
      continue;
    }
    extras.push(player);
  }
  return extras;
}
