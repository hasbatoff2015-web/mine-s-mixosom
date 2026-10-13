import type { Queryable } from '../db/types';

export const SELECT_ACTIVE_BANS_SQL = `SELECT player_id, reason, admin_id
FROM admin_player_bans
WHERE deployment_id = $1 AND world_id = $2 AND banned = true`;

export const SELECT_BAN_SQL = `SELECT banned, reason, admin_id
FROM admin_player_bans
WHERE deployment_id = $1 AND world_id = $2 AND player_id = $3`;

export const UPSERT_BAN_SQL = `INSERT INTO admin_player_bans (
  deployment_id, world_id, player_id, banned, reason, admin_id, updated_at
) VALUES ($1, $2, $3, true, $4, $5, NOW())
ON CONFLICT (deployment_id, world_id, player_id) DO UPDATE SET
  banned = true,
  reason = EXCLUDED.reason,
  admin_id = EXCLUDED.admin_id,
  updated_at = NOW()`;

export const UNBAN_SQL = `UPDATE admin_player_bans
SET banned = false, reason = $4, admin_id = $5, updated_at = NOW()
WHERE deployment_id = $1 AND world_id = $2 AND player_id = $3 AND banned = true`;

export const IMPORT_LEGACY_BAN_SQL = `INSERT INTO admin_player_bans (
  deployment_id, world_id, player_id, banned, reason, admin_id, updated_at
) VALUES ($1, $2, $3, true, $4, $5, NOW())
ON CONFLICT (deployment_id, world_id, player_id) DO NOTHING`;

export interface BanRow {
  readonly playerId: string;
  readonly reason: string;
  readonly adminId: string;
  readonly banned: boolean;
}

export async function listActiveBans(
  db: Queryable,
  deploymentId: string,
  worldId: string,
): Promise<BanRow[]> {
  const found = await db.query<{ player_id: string; reason: string; admin_id: string }>(
    SELECT_ACTIVE_BANS_SQL,
    [deploymentId, worldId],
  );
  return found.rows.map((row) => ({
    playerId: row.player_id,
    reason: row.reason,
    adminId: row.admin_id,
    banned: true,
  }));
}

export async function readBan(
  db: Queryable,
  deploymentId: string,
  worldId: string,
  playerId: string,
): Promise<BanRow | null> {
  const found = await db.query<{ banned: boolean; reason: string; admin_id: string }>(
    SELECT_BAN_SQL,
    [deploymentId, worldId, playerId],
  );
  const row = found.rows[0];
  if (!row) return null;
  return {
    playerId,
    reason: row.reason,
    adminId: row.admin_id,
    banned: row.banned === true,
  };
}

export async function upsertBan(
  db: Queryable,
  input: { deploymentId: string; worldId: string; playerId: string; reason: string; adminId: string },
): Promise<void> {
  await db.query(UPSERT_BAN_SQL, [
    input.deploymentId,
    input.worldId,
    input.playerId,
    input.reason,
    input.adminId,
  ]);
}

export async function clearBan(
  db: Queryable,
  input: { deploymentId: string; worldId: string; playerId: string; reason: string; adminId: string },
): Promise<boolean> {
  const result = await db.query(UNBAN_SQL, [
    input.deploymentId,
    input.worldId,
    input.playerId,
    input.reason,
    input.adminId,
  ]);
  return result.rowCount === 1;
}

export async function importLegacyBan(
  db: Queryable,
  input: { deploymentId: string; worldId: string; playerId: string; reason: string; adminId: string },
): Promise<void> {
  await db.query(IMPORT_LEGACY_BAN_SQL, [
    input.deploymentId,
    input.worldId,
    input.playerId,
    input.reason,
    input.adminId,
  ]);
}
