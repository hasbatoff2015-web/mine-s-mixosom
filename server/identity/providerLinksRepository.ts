import type { Queryable } from '../db/types';

export interface IdentityScope {
  readonly deploymentId: string;
  readonly serverMode: string;
  readonly worldId: string;
}

export const INSERT_PROVIDER_LINK_SQL = `INSERT INTO player_identity_links (
  deployment_id, server_mode, world_id, provider, provider_user_id, player_id
) VALUES ($1, $2, $3, 'yandex', $4, $5::uuid)`;

export const SELECT_PROVIDER_LINK_SQL = `SELECT player_id::text AS player_id
FROM player_identity_links
WHERE deployment_id = $1
  AND server_mode = $2
  AND world_id = $3
  AND provider = 'yandex'
  AND provider_user_id = $4`;

export const SELECT_PLAYER_LINKS_SQL = `SELECT provider_user_id
FROM player_identity_links
WHERE deployment_id = $1
  AND server_mode = $2
  AND world_id = $3
  AND provider = 'yandex'
  AND player_id = $4::uuid`;

export const SELECT_LINK_CONFLICT_SQL = `SELECT player_id::text AS player_id, provider_user_id
FROM player_identity_links
WHERE deployment_id = $1
  AND server_mode = $2
  AND world_id = $3
  AND provider = 'yandex'
  AND (provider_user_id = $4 OR player_id = $5::uuid)`;

export interface StoredProviderLink {
  readonly playerId: string;
  readonly providerUserId: string;
}

export async function insertProviderLink(
  tx: Queryable,
  scope: IdentityScope,
  providerUserId: string,
  playerId: string,
): Promise<void> {
  await tx.query(INSERT_PROVIDER_LINK_SQL, [
    scope.deploymentId,
    scope.serverMode,
    scope.worldId,
    providerUserId,
    playerId,
  ]);
}

export async function selectProviderLink(
  db: Queryable,
  scope: IdentityScope,
  providerUserId: string,
): Promise<string | undefined> {
  const result = await db.query<{ player_id: string }>(SELECT_PROVIDER_LINK_SQL, [
    scope.deploymentId,
    scope.serverMode,
    scope.worldId,
    providerUserId,
  ]);
  return result.rows[0]?.player_id;
}

export async function selectPlayerProviderIds(
  db: Queryable,
  scope: IdentityScope,
  playerId: string,
): Promise<readonly string[]> {
  const result = await db.query<{ provider_user_id: string }>(SELECT_PLAYER_LINKS_SQL, [
    scope.deploymentId,
    scope.serverMode,
    scope.worldId,
    playerId,
  ]);
  return result.rows.map((row) => row.provider_user_id);
}

export async function selectLinkConflicts(
  tx: Queryable,
  scope: IdentityScope,
  providerUserId: string,
  playerId: string,
): Promise<readonly StoredProviderLink[]> {
  const result = await tx.query<{ player_id: string; provider_user_id: string }>(SELECT_LINK_CONFLICT_SQL, [
    scope.deploymentId,
    scope.serverMode,
    scope.worldId,
    providerUserId,
    playerId,
  ]);
  return result.rows.map((row) => ({ playerId: row.player_id, providerUserId: row.provider_user_id }));
}
