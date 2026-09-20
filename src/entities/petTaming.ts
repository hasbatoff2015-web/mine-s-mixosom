import { CAT_TAME_ITEMS, PET_TAME_CHANCE, WOLF_TAME_ITEM } from './petConstants';
import type { PetKind } from './petTypes';

export type PetInteractKind = 'tame' | 'sit' | 'stand';

export type PetInteractFailReason =
  | 'invalid'
  | 'item'
  | 'not_owner'
  | 'pet_limit'
  | 'pet_capacity'
  | 'tame_failed';

export interface PetInteractMob {
  readonly kind: PetKind;
  readonly alive: boolean;
  readonly ownerId?: string;
  sitting: boolean;
}

export interface PetInteractRequest {
  readonly playerId: string;
  readonly heldItemId?: string;
  readonly gamemode: 'survival' | 'creative';
  readonly ownedCount: number;
  readonly petLimit: number;
  readonly random: () => number;
}

export type PetInteractResult =
  | { readonly ok: true; readonly kind: PetInteractKind; readonly consume: boolean }
  | {
    readonly ok: false;
    readonly reason: PetInteractFailReason;
    readonly consume: boolean;
    readonly ownedCount?: number;
    readonly petLimit?: number;
  };

export function isWolfTameItem(itemId: string | undefined): boolean {
  return itemId === WOLF_TAME_ITEM;
}

export function isCatTameItem(itemId: string | undefined): boolean {
  return typeof itemId === 'string' && CAT_TAME_ITEMS.includes(itemId);
}

export function isCatFearSuppressed(itemId: string | undefined): boolean {
  return isCatTameItem(itemId);
}

export function isPetTameItem(kind: PetKind, itemId: string | undefined): boolean {
  return kind === 'wolf' ? isWolfTameItem(itemId) : isCatTameItem(itemId);
}

export function resolvePetInteract(mob: PetInteractMob, request: PetInteractRequest): PetInteractResult {
  if (!mob.alive) return { ok: false, reason: 'invalid', consume: false };
  if (mob.ownerId) {
    if (mob.ownerId !== request.playerId) return { ok: false, reason: 'not_owner', consume: false };
    return { ok: true, kind: mob.sitting ? 'stand' : 'sit', consume: false };
  }
  if (!isPetTameItem(mob.kind, request.heldItemId)) {
    return { ok: false, reason: 'item', consume: false };
  }
  if (request.ownedCount >= request.petLimit) {
    return {
      ok: false,
      reason: 'pet_limit',
      consume: false,
      ownedCount: request.ownedCount,
      petLimit: request.petLimit,
    };
  }
  const consume = request.gamemode === 'survival';
  if (request.random() >= PET_TAME_CHANCE) {
    return { ok: false, reason: 'tame_failed', consume };
  }
  return { ok: true, kind: 'tame', consume };
}
