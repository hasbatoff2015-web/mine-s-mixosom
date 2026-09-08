import { volumeContains, type SelectionVolume } from './selection';
import { claimAnchorVolume } from './claimAnchors';

export const CLAIM_FLAGS = [
  'pvp',
  'mob-spawn',
  'mob-damage',
  'block-break',
  'block-place',
  'explosions',
  'player-damage',
  'item-drop',
  'item-pickup',
] as const;

export type ClaimFlag = (typeof CLAIM_FLAGS)[number];

/** Explicit flags only. Missing keys inherit the global default via priority resolution. */
export type ClaimFlagMap = Partial<Record<ClaimFlag, boolean>>;

export const CLAIM_PRIORITY_MIN = -1_000_000;
export const CLAIM_PRIORITY_MAX = 1_000_000;
export const CLAIM_PRIORITY_DEFAULT = 0;

export const DEFAULT_CLAIM_FLAGS: Record<ClaimFlag, boolean> = {
  pvp: false,
  'mob-spawn': true,
  'mob-damage': true,
  'block-break': false,
  'block-place': false,
  explosions: true,
  'player-damage': true,
  'item-drop': true,
  'item-pickup': true,
};

export type ClaimAnchorBlock = 'iron_block' | 'gold_block' | 'diamond_block';

export interface ClaimAnchor {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly block: ClaimAnchorBlock;
}

export interface Claim {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly worldId: string;
  readonly volume: SelectionVolume;
  members: string[];
  priority: number;
  flags: ClaimFlagMap;
  /** Present only on claims created by placing an iron/gold/diamond block. */
  readonly anchor?: ClaimAnchor;
}

export interface ClaimStore {
  claims: Claim[];
  /** Last allocated per-owner block-claim number. Deleted names are not reused. */
  blockClaimSeq?: Record<string, number>;
}

export function isClaimFlag(raw: string): raw is ClaimFlag {
  return (CLAIM_FLAGS as readonly string[]).includes(raw.toLowerCase());
}

export function clampClaimPriority(value: number): number {
  if (!Number.isFinite(value)) return CLAIM_PRIORITY_DEFAULT;
  return Math.max(CLAIM_PRIORITY_MIN, Math.min(CLAIM_PRIORITY_MAX, Math.trunc(value)));
}

export function claimsAt(
  claims: readonly Claim[],
  worldId: string,
  x: number,
  y: number,
  z: number,
): Claim[] {
  return claims.filter((claim) => claim.worldId === worldId && volumeContains(claim.volume, x, y, z));
}

/** Highest priority first. Equal priority keeps original (stable) order. */
export function sortClaimsByPriority(claims: readonly Claim[]): Claim[] {
  return [...claims].sort((left, right) => right.priority - left.priority);
}

export function flagSetter(claims: readonly Claim[], flag: ClaimFlag): Claim | undefined {
  const setters = claims.filter((claim) => typeof claim.flags[flag] === 'boolean');
  if (setters.length === 0) return undefined;
  return sortClaimsByPriority(setters)[0];
}

export function effectiveFlag(claims: readonly Claim[], flag: ClaimFlag): boolean {
  const setter = flagSetter(claims, flag);
  if (!setter) return DEFAULT_CLAIM_FLAGS[flag];
  return setter.flags[flag] === true;
}

export function effectiveFlags(claims: readonly Claim[]): Record<ClaimFlag, boolean> {
  const resolved = {} as Record<ClaimFlag, boolean>;
  for (const flag of CLAIM_FLAGS) resolved[flag] = effectiveFlag(claims, flag);
  return resolved;
}

export function ownFlagLines(claim: Claim): string[] {
  const lines: string[] = [];
  for (const flag of CLAIM_FLAGS) {
    if (typeof claim.flags[flag] === 'boolean') lines.push(`${flag}: ${claim.flags[flag]}`);
  }
  return lines;
}

export function isTrusted(claim: Claim, playerKey: string): boolean {
  const key = playerKey.toLowerCase();
  return claim.owner === key || claim.members.includes(key);
}

/**
 * Claim that actually denied `flag` via per-flag priority.
 * Used for the temporary client wireframe — not “first overlapping claim”.
 */
export function protectionSource(
  claims: readonly Claim[],
  flag: ClaimFlag,
  playerName: string,
): Claim | undefined {
  return protectionSources(claims, flag, playerName)[0];
}

/**
 * Every overlapping untrusted claim that participates in this deny.
 * Explicit `flag=false` claims are all shown (nested spawn + arena).
 * When nobody set the flag, every untrusted overlapping region is shown.
 */
export function protectionSources(
  claims: readonly Claim[],
  flag: ClaimFlag,
  playerName: string,
): Claim[] {
  if (effectiveFlag(claims, flag)) return [];
  const setter = flagSetter(claims, flag);
  if (setter) {
    if (isTrusted(setter, playerName)) return [];
    return sortClaimsByPriority(claims).filter(
      (claim) => claim.flags[flag] === false && !isTrusted(claim, playerName),
    );
  }
  return sortClaimsByPriority(claims).filter((claim) => !isTrusted(claim, playerName));
}

/**
 * Old claims stored every flag as a boolean, including removed `fire-spread`.
 * Keep those stored booleans as explicit so previous behaviour is preserved.
 * Drop `fire-spread`. Default priority 0.
 */
export function migrateClaim(raw: unknown): Claim | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.name !== 'string' || typeof record.owner !== 'string') {
    return undefined;
  }
  if (typeof record.worldId !== 'string' || !isVolume(record.volume)) return undefined;
  const members = Array.isArray(record.members)
    ? record.members.filter((member): member is string => typeof member === 'string').map((member) => member.toLowerCase())
    : [];
  const anchor = migrateAnchor(record.anchor);
  return {
    id: record.id,
    name: record.name,
    owner: record.owner.toLowerCase(),
    worldId: record.worldId,
    volume: anchor
      ? claimAnchorVolume(anchor.x, anchor.y, anchor.z, anchor.block)
      : record.volume,
    members,
    priority: clampClaimPriority(typeof record.priority === 'number' ? record.priority : CLAIM_PRIORITY_DEFAULT),
    flags: migrateFlags(record.flags),
    ...(anchor ? { anchor } : {}),
  };
}

export function migrateClaimStore(raw: unknown): ClaimStore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { claims: [] };
  const claims = Array.isArray((raw as { claims?: unknown }).claims)
    ? (raw as { claims: unknown[] }).claims.map(migrateClaim).filter((claim): claim is Claim => Boolean(claim))
    : [];
  const blockClaimSeq = migrateBlockClaimSeq((raw as { blockClaimSeq?: unknown }).blockClaimSeq);
  return blockClaimSeq ? { claims, blockClaimSeq } : { claims };
}

function migrateFlags(raw: unknown): ClaimFlagMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const flags: ClaimFlagMap = {};
  const record = raw as Record<string, unknown>;
  for (const flag of CLAIM_FLAGS) {
    if (typeof record[flag] === 'boolean') flags[flag] = record[flag];
  }
  return flags;
}

function isVolume(value: unknown): value is SelectionVolume {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const volume = value as Record<string, unknown>;
  return ['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ'].every((key) => Number.isInteger(volume[key]));
}

function isClaimAnchorBlock(value: unknown): value is ClaimAnchorBlock {
  return value === 'iron_block' || value === 'gold_block' || value === 'diamond_block';
}

function migrateAnchor(raw: unknown): ClaimAnchor | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (!isClaimAnchorBlock(record.block)) return undefined;
  const x = record.x;
  const y = record.y;
  const z = record.z;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return undefined;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return undefined;
  return { x, y, z, block: record.block };
}

function migrateBlockClaimSeq(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const seq: Record<string, number> = {};
  for (const [owner, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    seq[owner.toLowerCase()] = Math.trunc(value);
  }
  return Object.keys(seq).length > 0 ? seq : undefined;
}
