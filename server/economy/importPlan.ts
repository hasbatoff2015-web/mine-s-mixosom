import { ECONOMY_MAX_BALANCE } from '../services/economy';
import { EconomyValidationError } from './errors';
import type { EconomyJsonImportAccount } from './types';

/**
 * Checks a future import plan and returns a copy.
 * It does not open a database connection and it does not mint balances.
 */
export function validateEconomyJsonImport(
  accounts: readonly EconomyJsonImportAccount[],
): readonly EconomyJsonImportAccount[] {
  if (!Array.isArray(accounts)) throw new EconomyValidationError('import accounts must be a list');
  const seen = new Set<string>();
  const planned: EconomyJsonImportAccount[] = [];
  for (const account of accounts) {
    const playerId = requireToken(account?.playerId, 'playerId', 128);
    const displayName = requireToken(account?.displayName, 'displayName', 64);
    if (!Number.isSafeInteger(account?.balance) || account.balance < 0 || account.balance > ECONOMY_MAX_BALANCE) {
      throw new EconomyValidationError('import balance must be an integer from 0 to the maximum');
    }
    if (seen.has(playerId)) throw new EconomyValidationError('import lists the same player twice');
    seen.add(playerId);
    planned.push({ playerId, displayName, balance: account.balance });
  }
  return planned;
}

function requireToken(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new EconomyValidationError(`${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) throw new EconomyValidationError(`${field} length is invalid`);
  return trimmed;
}
