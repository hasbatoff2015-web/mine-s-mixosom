import { randomUUID } from 'node:crypto';
import { REFERRAL_ACTIVE_SECONDS, REFERRAL_REWARD_MS, type ReferralMilestone } from '../../shared/referral';
import { parseUuid } from '../db/uuid';
import { generateReferralCode } from './codes';
import type {
  AcceptResult,
  DevTimeResult,
  FlushResult,
  InviteePage,
  KitClaimRow,
  ReferralRepository,
  RelationRow,
  RewardRow,
} from './types';

interface CodeRow { ownerId: string; code: string }
interface MutableRelation {
  referralId: string;
  referrerId: string;
  inviteeId: string;
  acceptedAt: number;
  qualifiedAt: number | null;
  activeSeconds: number;
  status: 'pending' | 'qualified';
}
interface StoredReward {
  rewardId: string;
  playerId: string;
  milestone: RewardRow['milestone'];
  rank: RewardRow['rank'];
  status: RewardRow['status'];
  remainingMs: number;
  earnedAt: number;
  activatedAt: number | null;
  expiresAt: number | null;
  revision: number;
}
interface MutableKit {
  referralId: string;
  inviteeId: string;
  state: 'pending' | 'claimed';
}

/**
 * One scope, with the same uniqueness rules as PostgreSQL.
 * Calls are serialized so two accepts cannot both insert.
 */
export class MemoryReferralRepository implements ReferralRepository {
  private readonly codes: CodeRow[] = [];
  private readonly relations: MutableRelation[] = [];
  private readonly rewardRows: StoredReward[] = [];
  private readonly kits: MutableKit[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  readonly attempts = { codeInserts: 0, accepts: 0, flushes: 0 };

  constructor(private readonly nextCode: () => string = generateReferralCode) {}

  ensureCode(ownerId: string): Promise<string> {
    const owner = uuid(ownerId);
    return this.tx(() => {
      const existing = this.codes.find((row) => row.ownerId === owner);
      if (existing) return existing.code;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = this.nextCode();
        if (this.codes.some((row) => row.code === code)) continue;
        this.codes.push({ ownerId: owner, code });
        this.attempts.codeInserts += 1;
        return code;
      }
      throw new Error('referral code was not stored');
    });
  }

  codeOwner(code: string): Promise<string | null> {
    return this.tx(() => this.codes.find((row) => row.code === code)?.ownerId ?? null);
  }

  accept(inviteeId: string, code: string, now: number): Promise<AcceptResult> {
    const invitee = uuid(inviteeId);
    return this.tx(() => {
      this.attempts.accepts += 1;
      const referrer = this.codes.find((row) => row.code === code)?.ownerId;
      if (!referrer) return { status: 'not_found' };
      if (referrer === invitee) return { status: 'self' };
      const current = this.relations.find((row) => row.inviteeId === invitee);
      if (current) return { status: 'already', referrerId: current.referrerId };
      const referralId = randomUUID();
      this.relations.push({
        referralId,
        referrerId: referrer,
        inviteeId: invitee,
        acceptedAt: now,
        qualifiedAt: null,
        activeSeconds: 0,
        status: 'pending',
      });
      this.kits.push({ referralId, inviteeId: invitee, state: 'pending' });
      return { status: 'accepted', referralId, referrerId: referrer };
    });
  }

  invitee(inviteeId: string): Promise<RelationRow | null> {
    const invitee = uuid(inviteeId);
    return this.tx(() => this.copy(this.relations.find((row) => row.inviteeId === invitee)));
  }

  page(referrerId: string, limit: number, offset: number): Promise<InviteePage> {
    const referrer = uuid(referrerId);
    return this.tx(() => {
      const mine = this.relations.filter((row) => row.referrerId === referrer);
      const rows = [...mine].sort((a, b) => b.acceptedAt - a.acceptedAt || a.referralId.localeCompare(b.referralId));
      return {
        total: mine.length,
        qualified: mine.filter((row) => row.status === 'qualified').length,
        rows: rows.slice(offset, offset + limit).map((row) => this.copy(row)!),
      };
    });
  }

  flush(referralId: string, expectedSeconds: number, deltaSeconds: number, now: number): Promise<FlushResult> {
    return this.tx(() => this.apply(uuid(referralId), expectedSeconds, deltaSeconds, now));
  }

  rewards(playerId: string): Promise<RewardRow[]> {
    const player = uuid(playerId);
    return this.tx(() => this.rewardRows.filter((row) => row.playerId === player).map((row) => ({ ...row })));
  }

  ensureMilestones(playerId: string, qualifiedCount: number, now: number): Promise<RewardRow[]> {
    const player = uuid(playerId);
    return this.tx(() => {
      this.insertMilestones(player, qualifiedCount, now);
      return this.rewardRows.filter((row) => row.playerId === player).map((row) => ({ ...row }));
    });
  }

  saveRewards(rows: readonly RewardRow[]): Promise<void> {
    return this.tx(() => {
      for (const row of rows) {
        const current = this.rewardRows.find((entry) => entry.rewardId === row.rewardId);
        if (!current) continue;
        const nextRevision = Math.max(0, Math.floor(row.revision ?? 0));
        if (nextRevision <= current.revision) continue;
        current.status = row.status;
        current.remainingMs = row.remainingMs;
        current.activatedAt = row.activatedAt;
        current.expiresAt = row.expiresAt;
        current.revision = nextRevision;
      }
    });
  }

  kitClaim(inviteeId: string): Promise<KitClaimRow | null> {
    const invitee = uuid(inviteeId);
    return this.tx(() => {
      const row = this.kits.find((entry) => entry.inviteeId === invitee);
      return row ? { ...row } : null;
    });
  }

  markKitClaimed(referralId: string, now: number): Promise<void> {
    return this.tx(() => {
      const row = this.kits.find((entry) => entry.referralId === uuid(referralId));
      if (!row || row.state === 'claimed') return;
      row.state = 'claimed';
      void now;
    });
  }

  devAddSeconds(inviteeId: string, seconds: number, now: number): Promise<DevTimeResult> {
    const invitee = uuid(inviteeId);
    return this.tx(() => {
      const current = this.relations.find((row) => row.inviteeId === invitee);
      if (!current || current.status !== 'pending') {
        return {
          row: this.copy(current),
          qualifiedCount: current ? this.qualifiedCount(current.referrerId) : 0,
          rewards: current ? this.rewardRows.filter((row) => row.playerId === current.referrerId).map((row) => ({ ...row })) : [],
        };
      }
      const applied = this.apply(current.referralId, current.activeSeconds, seconds, now);
      return {
        row: applied.row,
        qualifiedCount: applied.applied ? applied.qualifiedCount : 0,
        rewards: applied.applied ? [...applied.rewards] : [],
      };
    });
  }

  private apply(referralId: string, expectedSeconds: number, deltaSeconds: number, now: number): FlushResult {
    this.attempts.flushes += 1;
    const current = this.relations.find((row) => row.referralId === referralId);
    const delta = Math.max(0, Math.min(REFERRAL_ACTIVE_SECONDS, Math.floor(deltaSeconds)));
    const expected = Math.max(0, Math.min(REFERRAL_ACTIVE_SECONDS, Math.floor(expectedSeconds)));
    if (!current || current.status !== 'pending' || current.activeSeconds !== expected || delta <= 0) {
      return { applied: false, row: this.copy(current) };
    }
    const before = current.activeSeconds;
    current.activeSeconds = Math.min(REFERRAL_ACTIVE_SECONDS, current.activeSeconds + delta);
    if (current.activeSeconds >= REFERRAL_ACTIVE_SECONDS) {
      current.status = 'qualified';
      current.qualifiedAt = now;
    }
    const row = this.copy(current)!;
    const justQualified = row.status === 'qualified' && before < REFERRAL_ACTIVE_SECONDS;
    let rewards: RewardRow[] = [];
    let qualifiedCount = 0;
    if (row.status === 'qualified') {
      qualifiedCount = this.qualifiedCount(row.referrerId);
      if (justQualified) this.insertMilestones(row.referrerId, qualifiedCount, now);
      rewards = this.rewardRows.filter((entry) => entry.playerId === row.referrerId).map((entry) => ({ ...entry }));
    }
    return { applied: true, row, justQualified, qualifiedCount, rewards };
  }

  private insertMilestones(playerId: string, qualifiedCount: number, now: number): void {
    const milestones: ReferralMilestone[] = [];
    if (qualifiedCount >= 3) milestones.push('3_confirmed');
    if (qualifiedCount >= 5) milestones.push('5_confirmed');
    for (const milestone of milestones) {
      if (this.rewardRows.some((row) => row.playerId === playerId && row.milestone === milestone)) continue;
      this.rewardRows.push({
        rewardId: randomUUID(),
        playerId,
        milestone,
        rank: milestone === '3_confirmed' ? 'vip' : 'premium',
        status: 'pending',
        remainingMs: REFERRAL_REWARD_MS,
        earnedAt: now,
        activatedAt: null,
        expiresAt: null,
        revision: 0,
      });
    }
  }

  private qualifiedCount(referrerId: string): number {
    return this.relations.filter((row) => row.referrerId === referrerId && row.status === 'qualified').length;
  }

  private copy(row: RelationRow | undefined): RelationRow | null {
    return row ? { ...row } : null;
  }

  private tx<T>(fn: () => T): Promise<T> {
    const run = this.tail.then(() => fn());
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}

function uuid(value: string): string {
  const parsed = parseUuid(value);
  if (!parsed) throw new Error('referral player id is not a uuid');
  return parsed;
}
