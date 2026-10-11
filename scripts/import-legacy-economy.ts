/**
 * One-shot legacy JSON balance import. Not run on server startup.
 *
 *   FC_DATABASE_URL=... FC_DEPLOYMENT_ID=dev npm run economy:import -- --dry-run balances.json
 *   FC_DATABASE_URL=... FC_DEPLOYMENT_ID=dev npm run economy:import -- --apply balances.json --batch <uuid>
 *
 * The file is `{ "players": [{ "playerId", "name"|"displayName", "balance" }] }`
 * or a bare array of those accounts. `--apply` without `--batch` refuses to run.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/db/database';
import {
  applyLegacyBalanceImport,
  inspectLegacyBalances,
  planLegacyImport,
} from '../server/economy/legacyImport';
import { MegacoinService } from '../server/economy/service';
import type { EconomyJsonImportAccount } from '../server/economy/types';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readAccounts(path: string): EconomyJsonImportAccount[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { players?: unknown }).players)
      ? (parsed as { players: unknown[] }).players
      : [];
  return rows.map((row) => {
    const record = row as { playerId?: string; name?: string; displayName?: string; balance?: number };
    return {
      playerId: record.playerId ?? '',
      displayName: record.displayName ?? record.name ?? '',
      balance: record.balance ?? Number.NaN,
    };
  });
}

const dryRun = process.argv.includes('--dry-run');
const apply = process.argv.includes('--apply');
const file = arg('--file');
if (!file || dryRun === apply) {
  console.error('Usage: npm run economy:import -- --dry-run --file <balances.json>');
  console.error('       npm run economy:import -- --apply --file <balances.json> --batch <uuid>');
  process.exit(1);
}

const inspected = inspectLegacyBalances(readAccounts(file));
if (inspected.issues.invalidPlayers.length > 0 || inspected.issues.duplicatePlayers.length > 0) {
  console.error(JSON.stringify({ ...planLegacyImport([]), ...inspected.issues, applied: false }, null, 2));
  process.exit(1);
}
const batch = arg('--batch') ?? (dryRun ? randomUUID() : '');
const plan = planLegacyImport(inspected.accounts, batch || randomUUID());
if (!apply) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}
if (!arg('--batch')) {
  console.error('--apply requires --batch so the same import cannot be given a new identity by accident');
  process.exit(1);
}

const url = process.env.FC_DATABASE_URL?.trim() ?? '';
const deploymentId = process.env.FC_DEPLOYMENT_ID?.trim() ?? '';
if (!url || !deploymentId) {
  console.error('FC_DATABASE_URL and FC_DEPLOYMENT_ID are required');
  process.exit(1);
}
const database = new PostgresDatabase({ url, deploymentId, poolMax: 2 });
await database.start();
try {
  const megacoin = new MegacoinService(database, deploymentId);
  const applied = await applyLegacyBalanceImport(megacoin, inspected.accounts, arg('--batch')!);
  console.log(JSON.stringify(applied, null, 2));
} finally {
  await database.close();
}
