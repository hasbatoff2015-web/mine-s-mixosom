import { CAT_TAME_ITEMS, PET_TAME_REQUIRED_FEEDS, WOLF_TAME_ITEM } from './petConstants';
import type { PetKind } from './petTypes';

export type PetInteractKind = 'feed' | 'tame' | 'sit' | 'stand';

export type PetInteractFailReason =
  | 'invalid'
  | 'item'
  | 'not_owner'
  | 'pet_limit'
  | 'pet_capacity';

export interface PetInteractMob {
  readonly kind: PetKind;
  readonly alive: boolean;
  readonly ownerId?: string;
  sitting: boolean;
  readonly tameProgress?: number;
  readonly tameProgressPlayerId?: string;
}

export interface PetInteractRequest {
  readonly playerId: string;
  readonly heldItemId?: string;
  readonly gamemode: 'survival' | 'creative';
  readonly ownedCount: number;
  readonly petLimit: number;
  readonly tamedCount: number;
  readonly maxTamedPets: number;
}

export type PetInteractResult =
  | { readonly ok: true; readonly kind: 'feed'; readonly progress: 1 | 2; readonly consume: boolean }
  | { readonly ok: true; readonly kind: 'tame' | 'sit' | 'stand'; readonly consume: boolean }
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

export function sanitizeTameProgress(
  progress: unknown,
  playerId: unknown,
  ownerId?: string,
): { readonly progress: number; readonly playerId?: string } {
  if (ownerId) return { progress: 0 };
  if (typeof playerId !== 'string' || playerId.length === 0) return { progress: 0 };
  if (progress !== 1 && progress !== 2) return { progress: 0 };
  return { progress, playerId };
}

function canAcceptTameFeed(request: PetInteractRequest): PetInteractResult | undefined {
  if (request.ownedCount >= request.petLimit) {
    return {
      ok: false,
      reason: 'pet_limit',
      consume: false,
      ownedCount: request.ownedCount,
      petLimit: request.petLimit,
    };
  }
  if (request.tamedCount >= request.maxTamedPets) {
    return { ok: false, reason: 'pet_capacity', consume: false };
  }
  return undefined;
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
  const blocked = canAcceptTameFeed(request);
  if (blocked) return blocked;
  const consume = request.gamemode === 'survival';
  const sanitized = sanitizeTameProgress(mob.tameProgress, mob.tameProgressPlayerId);
  const sameCandidate = sanitized.playerId === request.playerId;
  const current = sameCandidate ? sanitized.progress : 0;
  const next = current + 1;
  if (next >= PET_TAME_REQUIRED_FEEDS) {
    return { ok: true, kind: 'tame', consume };
  }
  return { ok: true, kind: 'feed', progress: next as 1 | 2, consume };
}
