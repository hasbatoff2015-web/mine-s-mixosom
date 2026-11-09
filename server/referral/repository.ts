import { randomUUID } from 'node:crypto';
import { REFERRAL_ACTIVE_SECONDS, REFERRAL_REWARD_MS, type ReferralMilestone } from '../../shared/referral';
import type { Database, Queryable } from '../db/types';
import { parseUuid } from '../db/uuid';
import { generateReferralCode } from './codes';
import type {
  AcceptResult,
  DevTimeResult,
  FlushResult,
  InviteePage,
  KitClaimRow,
  ReferralRepository,
  ReferralScope,
  RelationRow,
  RewardRow,
} from './types';

const CODE_ATTEMPTS = 5;

interface RelationSql {
  referral_id: string;
  referrer_player_id: string;
  invitee_player_id: string;
  accepted_at: Date | string;
  qualified_at: Date | string | null;
  active_seconds: number;
  status: 'pending' | 'qualified';
}

interface RewardSql {
  reward_id: string;
  milestone: ReferralMilestone;
  reward_rank: 'vip' | 'premium';
  status: RewardRow['status'];
  remaining_ms: string | number;
  revision: string | number;
  earned_at: Date | string;
  activated_at: Date | string | null;
  expires_at: Date | string | null;
}

function millis(value: Date | string | null): number | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function relation(row: RelationSql): RelationRow {
  return {
    referralId: row.referral_id,
    referrerId: row.referrer_player_id,
    inviteeId: row.invitee_player_id,
    acceptedAt: millis(row.accepted_at) ?? 0,
    qualifiedAt: millis(row.qualified_at),
    activeSeconds: row.active_seconds,
    status: row.status,
  };
}

function reward(row: RewardSql): RewardRow {
  return {
    rewardId: row.reward_id,
    milestone: row.milestone,
    rank: row.reward_rank,
    status: row.status,
    remainingMs: Number(row.remaining_ms),
    revision: Number(row.revision ?? 0),
    earnedAt: millis(row.earned_at) ?? 0,
    activatedAt: millis(row.activated_at),
    expiresAt: millis(row.expires_at),
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/** Expected race on one invitee. Other unique violations stay real database errors. */
export function isInviteeConflict(error: unknown): boolean {
  return isUniqueViolation(error)
    && (error as { constraint?: string }).constraint === 'referral_relations_invitee_unique';
}

export class PostgresReferralRepository implements ReferralRepository {
  constructor(
    private readonly database: Database,
    private readonly scope: ReferralScope,
    /** Test seam. Production leaves this unset. Both racers wait here after the empty read. */
    private readonly beforeRelationInsert?: () => Promise<void>,
  ) {}

  async ensureCode(ownerId: string): Promise<string> {
    const owner = this.uuid(ownerId);
    const existing = await this.readCode(owner);
    if (existing) return existing;
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const code = generateReferralCode();
      try {
        return await this.database.transaction(async (tx) => {
          const again = await this.readCode(owner, tx);
          if (again) return again;
          await tx.query(
            `INSERT INTO referral_codes (
              deployment_id, server_mode, world_id, owner_player_id, public_code
            ) VALUES ($1, $2, $3, $4::uuid, $5)`,
            [this.scope.deploymentId, this.scope.serverMode, this.scope.worldId, owner, code],
          );
          return code;
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const winner = await this.readCode(owner);
        if (winner) return winner;
      }
    }
    throw new Error('referral code was not stored');
  }

  async codeOwner(code: string): Promise<string | null> {
    const found = await this.database.query<{ owner_player_id: string }>(
      `SELECT owner_player_id FROM referral_codes
       WHERE deployment_id = $1 AND server_mode = $2 AND world_id = $3 AND public_code = $4`,
      [this.scope.deploymentId, this.scope.serverMode, this.scope.worldId, code],
    );
    return found.rows[0]?.owner_player_id ?? null;
  }

  async accept(inviteeId: string, code: string, now: number): Promise<AcceptResult> {
    const invitee = this.uuid(inviteeId);
    return this.database.transaction(async (tx) => {
      const owner = await tx.query<{ owner_player_id: string }>(
        `SELECT owner_player_id FROM referral_codes
         WHERE deployment_id = $1 AND server_mode = $2 AND world_id = $3 AND public_code = $4`,
        [this.scope.deploymentId, this.scope.serverMode, this.scope.worldId, code],
      );
      const referrer = owner.rows[0]?.owner_player_id;
      if (!referrer) return { status: 'not_found' };
      if (referrer === invitee) return { status: 'self' };
      const current = await this.readInvitee(invitee, tx);
      if (current) return { status: 'already', referrerId: current.referrerId };
      if (this.beforeRelationInsert) await this.beforeRelationInsert();
      const referralId = randomUUID();
      const acceptedAt = new Date(now).toISOString();
      let inserted: { rows: { referral_id: string }[]; rowCount?: number | null };
      try {
        inserted = await tx.query<{ referral_id: string }>(
          `INSERT INTO referral_relations (
            referral_id, deployment_id, server_mode, world_id,
            referrer_player_id, invitee_player_id, accepted_at, active_seconds, status
          ) VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::uuid, $7::timestamptz, 0, 'pending')
          ON CONFLICT ON CONSTRAINT referral_relations_invitee_unique DO NOTHING
          RETURNING referral_id`,
          [referralId, this.scope.deploymentId, this.scope.serverMode, this.scope.worldId, referrer, invitee, acceptedAt],
        );
      } catch (error) {
        if (!isInviteeConflict(error)) throw error;
        const winner = await this.readInvitee(invitee, tx);
        if (!winner) throw error;
        return { status: 'already', referrerId: winner.referrerId };
      }
      if ((inserted.rowCount ?? 0) === 0) {
        const winner = await this.readInvitee(invitee, tx);
        if (!winner) throw new Error('referral accept lost the invitee row');
        return { status: 'already', referrerId: winner.referrerId };
      }
      await tx.query(
        `INSERT INTO referral_kit_claims (
          deployment_id, server_mode, world_id, referral_id, invitee_player_id, reward_code, state
        ) VALUES ($1, $2, $3, $4::uuid, $5::uuid, 'referral_starter', 'pending')`,
        [this.scope.deploymentId, this.scope.serverMode, this.scope.worldId, referralId, invitee],
      );
      return { status: 'accepted', referralId, referrerId: referrer };
    });
  }

  async invitee(inviteeId: string): Promise<RelationRow | null> {
    return this.readInvitee(this.uuid(inviteeId));
  }

  async page(referrerId: string, limit: number, offset: number): Promise<InviteePage> {
    const referrer = this.uuid(referrerId);
    const counts = await this.database.query<{ total: string; qualified: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE status = 'qualified')::text AS qualified
       FROM referral_relations
       WHERE deployment_id = $1 AND server_mode = $2 AND world_id = $3 AND referrer_player_id = $4::uuid`,
      [this.scope.deploymentId, this.scope.serverMode, this.scope.worldId, referrer],
    );
    const rows = await this.database.query<RelationSql>(
      `SELECT referral_id, referrer_player_id, invitee_player_id, accepted_at, qualified_at, active_seconds, status
       FROM referral_relations
       WHERE deployment_id = $1 AND server_mode = $2 AND world_id = $3 AND referrer_player_id = $4::uuid
       ORDER BY accepted_at DESC, referral_id ASC
       LIMIT $5 OFFSET $6`,
      [this.scope.deploymentId, this.scope.serverMode, this.scope.worldId, referrer, limit, offset],
    );
    return {
      total: Number(counts.rows[0]?.total ?? 0),
      qualified: Number(counts.rows[0]?.qualified ?? 0),
      rows: rows.rows.map(relation),
    };
  }

  async flush(referralId: string, expectedSeconds: number, deltaSeconds: number, now: number): Promise<FlushResult> {
    const id = this.uuid(referralId);
    const delta = Math.max(0, Math.min(REFERRAL_ACTIVE_SECONDS, Math.floor(deltaSeconds)));
    const expected = Math.max(0, Math.min(REFERRAL_ACTIVE_SECONDS, Math.floor(expectedSeconds)));
    return this.database.transaction(async (tx) => this.applySeconds(tx, id, expected, delta, now, false));
  }

  async rewards(playerId: string): Promise<RewardRow[]> {
    return this.readRewards(this.uuid(playerId));
  }

  async ensureMilestones(playerId: string, qualifiedCount: number, now: number): Promise<RewardRow[]> {
    const player = this.uuid(playerId);
    return this.database.transaction(async (tx) => {
      await this.insertMilestones(tx, player, qualifiedCount, now);
      return this.readRewards(player, tx);
    });
  }

  async saveRewards(rows: readonly RewardRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.database.transaction(async (tx) => {
      for (const row of rows) {
        await tx.query(
          `UPDATE referral_rewards
           SET status = $1, remaining_ms = $2, activated_at = $3::timestamptz, expires_at = $4::timestamptz, revision = $5
           WHERE deployment_id = $6 AND server_mode = $7 AND world_id = $8 AND reward_id = $9::uuid
             AND revision < $5`,
          [
            row.status,
            Math.max(0, Math.min(REFERRAL_REWARD_MS, Math.floor(row.remainingMs))),
            row.activatedAt === null ? null : new Date(row.activatedAt).toISOString(),
            row.expiresAt === null ? null : new Date(row.expiresAt).toISOString(),
            Math.max(0, Math.floor(row.revision ?? 0)),
            this.scope.deploymentId,
            this.scope.serverMode,
            this.scope.worldId,
            this.uuid(row.rewardId),
          ],
        );
      }
    });
  }

  async kitClaim(inviteeId: string): Promise<KitClaimRow | null> {
    const found = await this.database.query<{ referral_id: string; invitee_player_id: string; state: 'pending' | 'claimed' }>(
      `SELECT referral_id, invitee_player_id, state FROM referral_kit_claims
       WHERE deployment_id = $1 AND server_mode = $2 AND world_id = $3 AND invitee_player_id = $4::uuid`,
      [this.scope.deploymentId, this.scope.serverMode, this.scope.worldId, this.uuid(inviteeId)],
    );
    const row = found.rows[0];
    if (!row) return null;
    return { referralId: row.referral_id, inviteeId: row.invitee_player_id, state: row.state };
  }

  async markKitClaimed(referralId: string, now: number): Promise<void> {
    await this.database.query(
      `UPDATE referral_kit_claims
       SET state = 'claimed', claimed_at = $1::timestamptz
       WHERE deployment_id = $2 AND server_mode = $3 AND world_id = $4
         AND referral_id = $5::uuid AND state = 'pending'`,
      [new Date(now).toISOString(), this.scope.deploymentId, this.scope.serverMode, this.scope.worldId, this.uuid(referralId)],
    );
  }

  async devAddSeconds(inviteeId: string, seconds: number, now: number): Promise<DevTimeResult> {
    const invitee = this.uuid(inviteeId);
    const add = Math.max(0, Math.min(REFERRAL_ACTIVE_SECONDS, Math.floor(seconds)));
    return this.database.transaction(async (tx) => {
      const current = await this.readInvitee(invitee, tx);
      if (!current || current.status !== 'pending') {
        const rewards = current ? await this.readRewards(current.referrerId, tx) : [];
        return { row: current, qualifiedCount: current ? await this.countQualified(tx, current.referrerId) : 0, rewards };
      }
      const applied = await this.applySeconds(tx, current.referralId, current.activeSeconds, add, now, true);
      return {
        row: applied.row,
        qualifiedCount: applied.applied ? applied.qualifiedCount : 0,
        rewards: applied.applied ? applied.rewards : [],
      };
    });
  }

  private async applySeconds(
    tx: Queryable,
    referralId: string,
    expectedSeconds: number,
    deltaSeconds: number,
    now: number,
    fromDev: boolean,
  ): Promise<FlushResult> {
    const stamp = new Date(now).toISOString();
    const updated = await tx.query<RelationSql>(
      `UPDATE referral_relations
       SET active_seconds = LEAST(10800, active_seconds + $1),
           last_accounted_at = $2::timestamptz,
           status = CASE WHEN active_seconds + $1 >= 10800 THEN 'qualified' ELSE status END,
           qualified_at = CASE
             WHEN active_seconds + $1 >= 10800 AND qualified_at IS NULL THEN $2::timestamptz
             ELSE qualified_at
           END
       WHERE referral_id = $3::uuid
         AND deployment_id = $4 AND server_mode = $5 AND world_id = $6
         AND status = 'pending'
         AND active_seconds = $7
         AND ($8::boolean OR $1 > 0)
       RETURNING referral_id, referrer_player_id, invitee_player_id, accepted_at, qualified_at, active_seconds, status`,
      [deltaSeconds, stamp, referralId, this.scope.deploymentId, this.scope.serverMode, this.scope.worldId, expectedSeconds, fromDev],
    );
    const written = updated.rows[0];
    if (!written) {
      const current = await tx.query<RelationSql>(
        `SELECT referral_id, referrer_player_id, invitee_player_id, accepted_at, qualified_at, active_seconds, status
         FROM referral_relations
         WHERE referral_id = $1::uuid AND deployment_id = $2 AND server_mode = $3 AND world_id = $4`,
        [referralId, this.scope.deploymentId, this.scope.serverMode, this.scope.worldId],
      );
      return { applied: false, row: current.rows[0] ? relation(current.rows[0]) : null };
    }
    const row = relation(written);
    const justQualified = row.status === 'qualified' && expectedSeconds < REFERRAL_ACTIVE_SECONDS;
    let rewards: RewardRow[] = [];
    let qualifiedCount = 0;
    if (row.status === 'qualified') {
      qualifiedCount = await this.countQualified(tx, row.referrerId);
      if (justQualified) await this.insertMilestones(tx, row.referrerId, qualifiedCount, now);
      rewards = await this.readRewards(row.referrerId, tx);
    }
    return { applied: true, row, justQualified, qualifiedCount, rewards };
  }

  private async insertMilestones(tx: Queryable, referrerId: string, qualifiedCount: number, now: number): Promise<void> {
    const milestones: ReferralMilestone[] = [];
    if (qualifiedCount >= 3) milestones.push('3_confirmed');
    if (qualifiedCount >= 5) milestones.push('5_confirmed');
    const earnedAt = new Date(now).toISOString();
    for (const milestone of milestones) {
      const rank = milestone === '3_confirmed' ? 'vip' : 'premium';
      await tx.query(
        `INSERT INTO referral_rewards (
          reward_id, deployment_id, server_mode, world_id, player_id,
          milestone, reward_rank, status, earned_at, remaining_ms
        ) VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7, 'pending', $8::timestamptz, $9)
        ON CONFLICT (deployment_id, server_mode, world_id, player_id, milestone) DO NOTHING`,
        [randomUUID(), this.scope.deploymentId, this.scope.serverMode, this.scope.worldId, referrerId, milestone, rank, earnedAt, REFERRAL_REWARD_MS],
      );
    }
  }

  private async countQualified(tx: Queryable, referrerId: string): Promise<number> {
    const found = await tx.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM referral_relations
       WHERE deployment_id = $1 AND server_mode = $2 AND world_id = $3
         AND referrer_player_id = $4::uuid AND status = 'qualified'`,
      [this.scope.deploymentId, this.scope.serverMode, this.scope.worldId, referrerId],
    );
    return Number(found.rows[0]?.count ?? 0);
  }

  private async readRewards(playerId: string, tx: Queryable = this.database): Promise<RewardRow[]> {
    const found = await tx.query<RewardSql>(
      `SELECT reward_id, milestone, reward_rank, status, remaining_ms, revision, earned_at, activated_at, expires_at
       FROM referral_rewards
       WHERE deployment_id = $1 AND server_mode = $2 AND world_id = $3 AND player_id = $4::uuid
       ORDER BY milestone ASC`,
      [this.scope.deploymentId, this.scope.serverMode, this.scope.worldId, playerId],
    );
    return found.rows.map(reward);
  }

  private async readInvitee(inviteeId: string, tx: Queryable = this.database): Promise<RelationRow | null> {
    const found = await tx.query<RelationSql>(
      `SELECT referral_id, referrer_player_id, invitee_player_id, accepted_at, qualified_at, active_seconds, status
       FROM referral_relations
       WHERE deployment_id = $1 AND server_mode = $2 AND world_id = $3 AND invitee_player_id = $4::uuid`,
      [this.scope.deploymentId, this.scope.serverMode, this.scope.worldId, inviteeId],
    );
    return found.rows[0] ? relation(found.rows[0]) : null;
  }

  private async readCode(ownerId: string, tx: Queryable = this.database): Promise<string | null> {
    const found = await tx.query<{ public_code: string }>(
      `SELECT public_code FROM referral_codes
       WHERE deployment_id = $1 AND server_mode = $2 AND world_id = $3 AND owner_player_id = $4::uuid`,
      [this.scope.deploymentId, this.scope.serverMode, this.scope.worldId, ownerId],
    );
    return found.rows[0]?.public_code ?? null;
  }

  private uuid(value: string): string {
    const parsed = parseUuid(value);
    if (!parsed) throw new Error('referral player id is not a uuid');
    return parsed;
  }
}
