import type { ReferralMilestone, ReferralRelationStatus } from '../../shared/referral';
import type { RewardEntitlement, RewardPhase } from './benefits';

export interface ReferralScope {
  readonly deploymentId: string;
  readonly serverMode: string;
  readonly worldId: string;
}

export interface RelationRow {
  readonly referralId: string;
  readonly referrerId: string;
  readonly inviteeId: string;
  readonly acceptedAt: number;
  readonly qualifiedAt: number | null;
  readonly activeSeconds: number;
  readonly status: ReferralRelationStatus;
}

export interface KitClaimRow {
  readonly referralId: string;
  readonly inviteeId: string;
  readonly state: 'pending' | 'claimed';
}

export interface RewardRow extends RewardEntitlement {}

export type AcceptResult =
  | { readonly status: 'accepted'; readonly referralId: string; readonly referrerId: string }
  | { readonly status: 'already'; readonly referrerId: string }
  | { readonly status: 'self' }
  | { readonly status: 'not_found' };

export type FlushResult =
  | {
    readonly applied: true;
    readonly row: RelationRow;
    readonly justQualified: boolean;
    readonly qualifiedCount: number;
    readonly rewards: readonly RewardRow[];
  }
  | { readonly applied: false; readonly row: RelationRow | null };

export interface InviteePage {
  readonly total: number;
  readonly qualified: number;
  readonly rows: readonly RelationRow[];
}

export interface DevTimeResult {
  readonly row: RelationRow | null;
  readonly qualifiedCount: number;
  readonly rewards: readonly RewardRow[];
}

export interface ReferralRepository {
  ensureCode(ownerId: string): Promise<string>;
  codeOwner(code: string): Promise<string | null>;
  accept(inviteeId: string, code: string, now: number): Promise<AcceptResult>;
  invitee(inviteeId: string): Promise<RelationRow | null>;
  page(referrerId: string, limit: number, offset: number): Promise<InviteePage>;
  flush(referralId: string, expectedSeconds: number, deltaSeconds: number, now: number): Promise<FlushResult>;
  rewards(playerId: string): Promise<RewardRow[]>;
  ensureMilestones(playerId: string, qualifiedCount: number, now: number): Promise<RewardRow[]>;
  saveRewards(rows: readonly RewardRow[]): Promise<void>;
  kitClaim(inviteeId: string): Promise<KitClaimRow | null>;
  markKitClaimed(referralId: string, now: number): Promise<void>;
  devAddSeconds(inviteeId: string, seconds: number, now: number): Promise<DevTimeResult>;
}

export type { RewardPhase };
