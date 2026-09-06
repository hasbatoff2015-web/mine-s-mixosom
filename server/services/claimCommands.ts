import { isClaimFlag, type Claim, type ClaimFlag } from './claims';

export function parseBoolToken(raw: string | undefined): boolean | undefined {
  const value = raw?.toLowerCase();
  if (value === 'true' || value === 'on') return true;
  if (value === 'false' || value === 'off') return false;
  return undefined;
}

export type ParsedClaimFlagArgs =
  | { readonly ok: true; readonly claimName?: string; readonly flag: ClaimFlag; readonly value: boolean }
  | { readonly ok: false };

/**
 * `/claim flag <flag> <true|false>` — current claim under the player.
 * `/claim flag <name> <flag> <true|false>` — named claim, no standing required.
 *
 * If the first token is a known flag and the second is a boolean, that is the
 * standing form even when a claim happens to share that flag's name.
 */
export function parseClaimFlagArgs(rest: readonly string[]): ParsedClaimFlagArgs {
  const first = rest[0]?.toLowerCase();
  const second = rest[1]?.toLowerCase();
  const third = rest[2]?.toLowerCase();
  const standingValue = parseBoolToken(second);
  if (first && isClaimFlag(first) && standingValue !== undefined && third === undefined) {
    return { ok: true, flag: first, value: standingValue };
  }
  const namedValue = parseBoolToken(third);
  if (first && second && isClaimFlag(second) && namedValue !== undefined) {
    return { ok: true, claimName: first, flag: second, value: namedValue };
  }
  return { ok: false };
}

export type ParsedClaimMemberArgs =
  | { readonly ok: true; readonly claimName?: string; readonly player: string }
  | { readonly ok: false };

/** One arg = player on the standing claim. Two args = claim name then player. */
export function parseClaimMemberArgs(rest: readonly string[]): ParsedClaimMemberArgs {
  const first = rest[0]?.toLowerCase();
  const second = rest[1]?.toLowerCase();
  if (first && !second) return { ok: true, player: first };
  if (first && second) return { ok: true, claimName: first, player: second };
  return { ok: false };
}

export function findClaimByName(
  claims: readonly Claim[],
  name: string,
  preferredOwner?: string,
): Claim | undefined {
  const key = name.toLowerCase();
  const matches = claims.filter((claim) => claim.name === key);
  if (preferredOwner) {
    const own = matches.find((claim) => claim.owner === preferredOwner.toLowerCase());
    if (own) return own;
  }
  return matches[0];
}
