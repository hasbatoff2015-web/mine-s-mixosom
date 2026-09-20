/** Base tame slots for every player. Roles can only raise this, never below it. */
export const DEFAULT_PET_LIMIT = 2;
/** Hard cap against `pets.limit.999999` role misconfiguration. */
export const MAX_PET_LIMIT = 10;
export const PET_LIMIT_PERMISSION_PREFIX = 'pets.limit.';

const LIMIT_NODE = /^pets\.limit\.(\d+)$/i;

export function parsePetLimitNode(node: string): number | undefined {
  const match = LIMIT_NODE.exec(node.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value < DEFAULT_PET_LIMIT || value > MAX_PET_LIMIT) return undefined;
  return value;
}

/** Highest valid `pets.limit.N` among granted nodes. Operators are not unlimited. */
export function resolvePetLimitFromPermissions(permissions: readonly string[]): number {
  let limit = DEFAULT_PET_LIMIT;
  for (const node of permissions) {
    const parsed = parsePetLimitNode(node);
    if (parsed !== undefined) limit = Math.max(limit, parsed);
  }
  return Math.min(limit, MAX_PET_LIMIT);
}

export function petLimitReachedMessage(ownedCount: number, petLimit: number): string {
  return `Достигнут лимит питомцев: ${ownedCount}/${petLimit}.`;
}

export function tameSuccessMessage(kind: 'wolf' | 'cat'): string {
  return kind === 'wolf' ? 'Волк приручён.' : 'Кот приручён.';
}
