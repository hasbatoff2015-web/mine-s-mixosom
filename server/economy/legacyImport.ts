import { randomUUID } from 'node:crypto';
import { ECONOMY_INITIAL_BALANCE, ECONOMY_MAX_BALANCE } from '../services/economy';
import { EconomySourceConflictError, EconomyValidationError } from './errors';
import type { MegacoinService } from './service';
import type { EconomyJsonImportAccount } from './types';
import { validateEconomyJsonImport } from './importPlan';

export interface LegacyImportReport {
  readonly batchId: string;
  readonly playerCount: number;
  readonly totalLegacyCurrency: number;
  readonly minBalance: number | null;
  readonly maxBalance: number | null;
  readonly invalidPlayers: readonly string[];
  readonly duplicatePlayers: readonly string[];
  readonly expectedPostgresTotal: number;
  readonly applied: boolean;
}

export interface LegacyImportIssue {
  readonly invalidPlayers: string[];
  readonly duplicatePlayers: string[];
}

/**
 * Reads a legacy balance list and does not write.
 * `applyLegacyBalanceImport` is the only writer, and only when called.
 */
export function inspectLegacyBalances(raw: readonly EconomyJsonImportAccount[]): {
  readonly accounts: readonly EconomyJsonImportAccount[];
  readonly issues: LegacyImportIssue;
} {
  const issues: LegacyImportIssue = { invalidPlayers: [], duplicatePlayers: [] };
  if (!Array.isArray(raw)) throw new EconomyValidationError('import accounts must be a list');
  const seen = new Set<string>();
  for (const account of raw) {
    const playerId = typeof account?.playerId === 'string' ? account.playerId.trim() : '';
    if (!playerId) {
      issues.invalidPlayers.push(String(account?.playerId ?? ''));
      continue;
    }
    if (seen.has(playerId)) issues.duplicatePlayers.push(playerId);
    seen.add(playerId);
    if (!Number.isSafeInteger(account?.balance) || account.balance < 0 || account.balance > ECONOMY_MAX_BALANCE) {
      issues.invalidPlayers.push(playerId);
    }
  }
  if (issues.invalidPlayers.length > 0 || issues.duplicatePlayers.length > 0) {
    return { accounts: [], issues };
  }
  return { accounts: validateEconomyJsonImport(raw), issues };
}

export function planLegacyImport(accounts: readonly EconomyJsonImportAccount[], batchId: string = randomUUID()): LegacyImportReport {
  const balances = accounts.map((account) => account.balance);
  const total = balances.reduce((sum, value) => sum + value, 0);
  return {
    batchId,
    playerCount: accounts.length,
    totalLegacyCurrency: total,
    minBalance: balances.length === 0 ? null : Math.min(...balances),
    maxBalance: balances.length === 0 ? null : Math.max(...balances),
    invalidPlayers: [],
    duplicatePlayers: [],
    expectedPostgresTotal: total,
    applied: false,
  };
}

/**
 * One batch id imports each player once.
 * Final balance 100 is the opening grant alone.
 * Any other final balance is that grant plus one LEGACY_IMPORT adjustment.
 * The same batch does not move money again. A different target for the same
 * batch fails instead of rewriting the account.
 */
export async function applyLegacyBalanceImport(
  megacoin: MegacoinService,
  accounts: readonly EconomyJsonImportAccount[],
  batchId: string,
): Promise<LegacyImportReport> {
  if (!UUID_TEXT.test(batchId)) throw new EconomyValidationError('import batch id must be a UUID');
  const planned = validateEconomyJsonImport(accounts);
  for (const account of planned) {
    await megacoin.ensureAccount({ playerId: account.playerId, displayName: account.displayName });
    if (account.balance === ECONOMY_INITIAL_BALANCE) continue;
    try {
      await megacoin.setBalance({
        playerId: account.playerId,
        displayName: account.displayName,
        balance: account.balance,
        reason: 'LEGACY_IMPORT',
        source: { type: 'LEGACY_IMPORT', id: `${batchId}:${account.playerId}` },
      });
    } catch (error) {
      if (error instanceof EconomySourceConflictError) {
        throw new EconomyValidationError(`import conflict for ${account.playerId}`);
      }
      throw error;
    }
  }
  const plan = planLegacyImport(planned, batchId);
  return { ...plan, applied: true };
}

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
