/**
 * Append-only referral tables. Versions 0001–0010 are not edited.
 * Scope is deployment + server mode + world, same as provider links.
 */

export const REFERRAL_CODES_SQL = `CREATE TABLE referral_codes (
  deployment_id TEXT NOT NULL,
  server_mode TEXT NOT NULL,
  world_id TEXT NOT NULL,
  owner_player_id UUID NOT NULL,
  public_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT referral_codes_owner_unique UNIQUE (deployment_id, server_mode, world_id, owner_player_id),
  CONSTRAINT referral_codes_code_unique UNIQUE (deployment_id, server_mode, world_id, public_code),
  CONSTRAINT referral_codes_deployment_len CHECK (char_length(deployment_id) BETWEEN 1 AND 64),
  CONSTRAINT referral_codes_mode_len CHECK (char_length(server_mode) BETWEEN 1 AND 32),
  CONSTRAINT referral_codes_world_len CHECK (char_length(world_id) BETWEEN 1 AND 128),
  CONSTRAINT referral_codes_alphabet CHECK (public_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$')
)`;

export const REFERRAL_RELATIONS_SQL = `CREATE TABLE referral_relations (
  referral_id UUID PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  server_mode TEXT NOT NULL,
  world_id TEXT NOT NULL,
  referrer_player_id UUID NOT NULL,
  invitee_player_id UUID NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  qualified_at TIMESTAMPTZ NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  last_accounted_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL,
  CONSTRAINT referral_relations_invitee_unique UNIQUE (deployment_id, server_mode, world_id, invitee_player_id),
  CONSTRAINT referral_relations_not_self CHECK (referrer_player_id <> invitee_player_id),
  CONSTRAINT referral_relations_seconds CHECK (active_seconds >= 0 AND active_seconds <= 10800),
  CONSTRAINT referral_relations_status CHECK (status IN ('pending', 'qualified')),
  CONSTRAINT referral_relations_qualified_shape CHECK (
    (status = 'pending' AND qualified_at IS NULL)
    OR (status = 'qualified' AND qualified_at IS NOT NULL)
  ),
  CONSTRAINT referral_relations_deployment_len CHECK (char_length(deployment_id) BETWEEN 1 AND 64),
  CONSTRAINT referral_relations_mode_len CHECK (char_length(server_mode) BETWEEN 1 AND 32),
  CONSTRAINT referral_relations_world_len CHECK (char_length(world_id) BETWEEN 1 AND 128)
)`;

export const REFERRAL_RELATIONS_REFERRER_INDEX_SQL = `CREATE INDEX referral_relations_referrer_idx
  ON referral_relations (deployment_id, server_mode, world_id, referrer_player_id, status)`;

export const REFERRAL_RELATIONS_RECENT_INDEX_SQL = `CREATE INDEX referral_relations_recent_idx
  ON referral_relations (deployment_id, server_mode, world_id, referrer_player_id, accepted_at DESC)`;

export const REFERRAL_REWARDS_SQL = `CREATE TABLE referral_rewards (
  reward_id UUID PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  server_mode TEXT NOT NULL,
  world_id TEXT NOT NULL,
  player_id UUID NOT NULL,
  milestone TEXT NOT NULL,
  reward_rank TEXT NOT NULL,
  status TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NULL,
  remaining_ms BIGINT NOT NULL,
  CONSTRAINT referral_rewards_milestone_unique UNIQUE (deployment_id, server_mode, world_id, player_id, milestone),
  CONSTRAINT referral_rewards_milestone CHECK (milestone IN ('3_confirmed', '5_confirmed')),
  CONSTRAINT referral_rewards_rank CHECK (reward_rank IN ('vip', 'premium')),
  CONSTRAINT referral_rewards_status CHECK (status IN ('pending', 'active', 'paused', 'expired')),
  CONSTRAINT referral_rewards_remaining CHECK (remaining_ms >= 0 AND remaining_ms <= 604800000),
  CONSTRAINT referral_rewards_active_expiry CHECK (status <> 'active' OR expires_at IS NOT NULL),
  CONSTRAINT referral_rewards_pair CHECK (
    (milestone = '3_confirmed' AND reward_rank = 'vip')
    OR (milestone = '5_confirmed' AND reward_rank = 'premium')
  ),
  CONSTRAINT referral_rewards_deployment_len CHECK (char_length(deployment_id) BETWEEN 1 AND 64),
  CONSTRAINT referral_rewards_mode_len CHECK (char_length(server_mode) BETWEEN 1 AND 32),
  CONSTRAINT referral_rewards_world_len CHECK (char_length(world_id) BETWEEN 1 AND 128)
)`;

export const REFERRAL_REWARDS_PLAYER_INDEX_SQL = `CREATE INDEX referral_rewards_player_idx
  ON referral_rewards (deployment_id, server_mode, world_id, player_id)`;

export const REFERRAL_KIT_CLAIMS_SQL = `CREATE TABLE referral_kit_claims (
  deployment_id TEXT NOT NULL,
  server_mode TEXT NOT NULL,
  world_id TEXT NOT NULL,
  referral_id UUID NOT NULL,
  invitee_player_id UUID NOT NULL,
  reward_code TEXT NOT NULL DEFAULT 'referral_starter',
  state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ NULL,
  CONSTRAINT referral_kit_claims_pk PRIMARY KEY (deployment_id, server_mode, world_id, invitee_player_id),
  CONSTRAINT referral_kit_claims_referral_unique UNIQUE (referral_id),
  CONSTRAINT referral_kit_claims_relation_fk FOREIGN KEY (referral_id) REFERENCES referral_relations (referral_id),
  CONSTRAINT referral_kit_claims_state CHECK (state IN ('pending', 'claimed')),
  CONSTRAINT referral_kit_claims_code CHECK (reward_code = 'referral_starter'),
  CONSTRAINT referral_kit_claims_claimed_shape CHECK (
    (state = 'pending' AND claimed_at IS NULL)
    OR (state = 'claimed' AND claimed_at IS NOT NULL)
  ),
  CONSTRAINT referral_kit_claims_deployment_len CHECK (char_length(deployment_id) BETWEEN 1 AND 64),
  CONSTRAINT referral_kit_claims_mode_len CHECK (char_length(server_mode) BETWEEN 1 AND 32),
  CONSTRAINT referral_kit_claims_world_len CHECK (char_length(world_id) BETWEEN 1 AND 128)
)`;

export const REFERRAL_REWARDS_REVISION_SQL = `ALTER TABLE referral_rewards
  ADD COLUMN revision BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT referral_rewards_revision_nonnegative CHECK (revision >= 0)`;

export const REFERRAL_REWARDS_REVISION_STATEMENTS = [
  REFERRAL_REWARDS_REVISION_SQL,
] as const;

export const REFERRAL_MIGRATION_STATEMENTS = [
  REFERRAL_CODES_SQL,
  REFERRAL_RELATIONS_SQL,
  REFERRAL_RELATIONS_REFERRER_INDEX_SQL,
  REFERRAL_RELATIONS_RECENT_INDEX_SQL,
  REFERRAL_REWARDS_SQL,
  REFERRAL_REWARDS_PLAYER_INDEX_SQL,
  REFERRAL_KIT_CLAIMS_SQL,
] as const;
