import { RANK_ORDER, type EffectiveRank } from '../../shared/donationRanks';
import { REFERRAL_REWARD_MS, type ReferralMilestone } from '../../shared/referral';

export type RewardPhase = 'pending' | 'active' | 'paused' | 'expired';

export interface RewardEntitlement {
  rewardId: string;
  milestone: ReferralMilestone;
  rank: 'vip' | 'premium';
  status: RewardPhase;
  remainingMs: number;
  earnedAt: number;
  activatedAt: number | null;
  expiresAt: number | null;
}

export interface ResolvedRewards {
  readonly rows: RewardEntitlement[];
  readonly changed: boolean;
  readonly activeRank: EffectiveRank;
  readonly activeExpiresAt: number | null;
}

const WEEK = REFERRAL_REWARD_MS;

export function blankEntitlement(
  rewardId: string,
  milestone: ReferralMilestone,
  earnedAt: number,
): RewardEntitlement {
  return {
    rewardId,
    milestone,
    rank: milestone === '3_confirmed' ? 'vip' : 'premium',
    status: 'pending',
    remainingMs: WEEK,
    earnedAt,
    activatedAt: null,
    expiresAt: null,
  };
}

/**
 * Calendar time runs only for the referral rank that is actually in front.
 * A higher paid rank, or a higher referral rank, banks the lower remainder.
 * Calling this twice at the same `now` does not add time.
 */
export function resolveEntitlements(
  rows: readonly RewardEntitlement[],
  paidRank: EffectiveRank,
  now: number,
): ResolvedRewards {
  const next = rows.map((row) => materialize(row, now));
  const order = [...next].sort((a, b) => RANK_ORDER[b.rank] - RANK_ORDER[a.rank]);
  let cover: EffectiveRank = paidRank;
  for (const row of order) {
    if (row.status === 'expired' || row.remainingMs <= 0) {
      row.status = 'expired';
      row.remainingMs = 0;
      row.expiresAt = null;
      continue;
    }
    if (RANK_ORDER[cover] >= RANK_ORDER[row.rank]) {
      if (row.status === 'active') row.status = row.activatedAt === null ? 'pending' : 'paused';
      else if (row.status !== 'paused') row.status = row.activatedAt === null ? 'pending' : 'paused';
      row.expiresAt = null;
      continue;
    }
    if (row.status === 'active' && row.expiresAt !== null && row.expiresAt > now) {
      cover = row.rank;
      continue;
    }
    row.status = 'active';
    row.activatedAt = row.activatedAt ?? now;
    row.expiresAt = now + row.remainingMs;
    cover = row.rank;
  }
  let activeRank: EffectiveRank = 'default';
  let activeExpiresAt: number | null = null;
  for (const row of next) {
    if (row.status !== 'active' || row.expiresAt === null || row.expiresAt <= now) continue;
    if (RANK_ORDER[row.rank] > RANK_ORDER[activeRank]) {
      activeRank = row.rank;
      activeExpiresAt = row.expiresAt;
    }
  }
  const changed = next.some((row, index) => !sameEntitlement(row, rows[index]!));
  return { rows: next, changed, activeRank, activeExpiresAt };
}

function materialize(row: RewardEntitlement, now: number): RewardEntitlement {
  const copy: RewardEntitlement = { ...row };
  if (copy.status === 'active' && copy.expiresAt !== null) {
    if (copy.expiresAt <= now) {
      copy.status = 'expired';
      copy.remainingMs = 0;
      copy.expiresAt = null;
    } else {
      copy.remainingMs = copy.expiresAt - now;
    }
  }
  if (copy.remainingMs < 0) copy.remainingMs = 0;
  if (copy.remainingMs > WEEK) copy.remainingMs = WEEK;
  return copy;
}

function sameEntitlement(a: RewardEntitlement, b: RewardEntitlement): boolean {
  if (a.status !== b.status || a.activatedAt !== b.activatedAt || a.milestone !== b.milestone) return false;
  if (a.status === 'active') return a.expiresAt === b.expiresAt;
  return a.remainingMs === b.remainingMs && a.expiresAt === b.expiresAt;
}

export function higherRank(left: EffectiveRank, right: EffectiveRank): EffectiveRank {
  return RANK_ORDER[left] >= RANK_ORDER[right] ? left : right;
}
