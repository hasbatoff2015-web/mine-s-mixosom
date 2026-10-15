import type { ServerConfig } from '../config';
import type { Database } from '../db/types';
import { canonicalPlayerId, isPlayerId } from '../services/permissionSubject';
import {
  insertProviderLink,
  selectLinkConflicts,
  selectPlayerProviderIds,
  selectProviderLink,
  type IdentityScope,
} from './providerLinksRepository';

export type { IdentityScope };

/** A provider subject that this process has already verified. A raw client field is not this type. */
export interface VerifiedProviderIdentity {
  readonly verified: true;
  readonly provider: 'yandex';
  readonly providerUserId: string;
}

export type ProviderLinkStatus =
  | 'linked'
  | 'already_linked'
  | 'provider_conflict'
  | 'player_conflict'
  | 'invalid_player'
  | 'unknown_player'
  | 'unavailable'
  | 'unverified';

export interface ProviderLinkResult {
  readonly status: ProviderLinkStatus;
}

export type ProviderLookup =
  | { readonly status: 'found'; readonly playerId: string }
  | { readonly status: 'absent' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'unverified' };

const PROVIDER_USER_MAX = 128;

export function identityScopeFromServer(config: ServerConfig): IdentityScope | undefined {
  if (!config.database.enabled) return undefined;
  return {
    deploymentId: config.database.deploymentId,
    serverMode: config.serverMode,
    worldId: config.worldId,
  };
}

export function asVerifiedProviderIdentity(value: unknown): VerifiedProviderIdentity | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (row.verified !== true || row.provider !== 'yandex') return undefined;
  if (!isProviderUserId(row.providerUserId)) return undefined;
  return { verified: true, provider: 'yandex', providerUserId: row.providerUserId };
}

export async function lookupVerifiedProviderIdentity(
  db: Database,
  scope: IdentityScope,
  identity: unknown,
): Promise<ProviderLookup> {
  if (!db.enabled) return { status: 'unavailable' };
  const verified = asVerifiedProviderIdentity(identity);
  if (!verified) return { status: 'unverified' };
  if (!validScope(scope)) return { status: 'unverified' };
  const playerId = await selectProviderLink(db, scope, verified.providerUserId);
  return playerId ? { status: 'found', playerId } : { status: 'absent' };
}

export async function lookupPlayerLinks(
  db: Database,
  scope: IdentityScope,
  playerId: string,
): Promise<{ readonly status: 'found'; readonly providerUserIds: readonly string[] } | { readonly status: 'absent' | 'unavailable' | 'invalid_player' }> {
  if (!db.enabled) return { status: 'unavailable' };
  if (!isPlayerId(playerId) || !validScope(scope)) return { status: 'invalid_player' };
  const ids = await selectPlayerProviderIds(db, scope, canonicalPlayerId(playerId));
  return ids.length > 0 ? { status: 'found', providerUserIds: ids } : { status: 'absent' };
}

/**
 * Binds one already-verified provider subject to an existing player in this scope.
 * There is no network entry point. A caller must pass `verified: true` only after
 * its own server-side check, which Stage C has not added.
 */
export async function bindVerifiedProviderIdentity(
  db: Database,
  scope: IdentityScope,
  identity: unknown,
  playerId: string,
  playerExists: (playerId: string) => boolean,
): Promise<ProviderLinkResult> {
  if (!db.enabled) return { status: 'unavailable' };
  const verified = asVerifiedProviderIdentity(identity);
  if (!verified || !validScope(scope)) return { status: 'unverified' };
  if (!isPlayerId(playerId)) return { status: 'invalid_player' };
  const canonical = canonicalPlayerId(playerId);
  if (!playerExists(canonical)) return { status: 'unknown_player' };
  try {
    return await db.transaction(async (tx) => {
      await tx.query('SAVEPOINT provider_link_insert');
      try {
        await insertProviderLink(tx, scope, verified.providerUserId, canonical);
        await tx.query('RELEASE SAVEPOINT provider_link_insert');
        return { status: 'linked' };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        await tx.query('ROLLBACK TO SAVEPOINT provider_link_insert');
        const conflicts = await selectLinkConflicts(tx, scope, verified.providerUserId, canonical);
        const same = conflicts.find((row) => row.playerId === canonical && row.providerUserId === verified.providerUserId);
        if (same) return { status: 'already_linked' };
        if (conflicts.some((row) => row.providerUserId === verified.providerUserId && row.playerId !== canonical)) {
          return { status: 'provider_conflict' };
        }
        return { status: 'player_conflict' };
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'provider_conflict' };
    throw error;
  }
}

function isProviderUserId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= PROVIDER_USER_MAX
    && value === value.trim()
    && !/[\u0000-\u001F\u007F]/.test(value);
}

function validScope(scope: IdentityScope): boolean {
  return bounded(scope.deploymentId, 64) && bounded(scope.serverMode, 32) && bounded(scope.worldId, 128);
}

function bounded(value: string, max: number): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim();
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === '23505');
}
