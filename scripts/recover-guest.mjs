#!/usr/bin/env node
/**
 * Offline guest recovery for one world directory.
 * Does not print the previous session token.
 *
 *   node scripts/recover-guest.mjs inspect --world /path/to/world
 *   node scripts/recover-guest.mjs rotate --world /path/to/world --player <uuid>
 *   node scripts/recover-guest.mjs rotate --world /path/to/world --player <uuid> --apply
 */
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return '';
  return process.argv[index + 1] ?? '';
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const command = process.argv[2];
const worldDir = arg('--world');
const playerId = arg('--player');
const apply = process.argv.includes('--apply');

if (command !== 'inspect' && command !== 'rotate') {
  fail('use inspect or rotate');
}
if (!worldDir) fail('--world is required');

const playersPath = join(worldDir, 'players.json');
const lockPath = join(worldDir, '.instance.lock');

let raw;
try {
  raw = await readFile(playersPath, 'utf8');
} catch {
  fail('players.json is not readable');
}
let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  fail('players.json is not valid JSON');
}
const table = parsed && typeof parsed === 'object' && parsed.players && typeof parsed.players === 'object'
  ? parsed.players
  : null;
if (!table) fail('players.json has no players table');

function summary(id, row) {
  const inventory = row && typeof row.inventory === 'object' && row.inventory ? row.inventory : {};
  const slots = Array.isArray(inventory.slots) ? inventory.slots.filter(Boolean).length : 0;
  return {
    playerId: id,
    name: typeof row?.name === 'string' ? row.name : '',
    updatedAt: typeof row?.updatedAt === 'number' ? row.updatedAt : 0,
    occupiedSlots: slots,
    worldHint: worldDir,
  };
}

if (command === 'inspect') {
  const rows = Object.entries(table).map(([id, row]) => summary(id, row));
  console.log(JSON.stringify({ world: worldDir, players: rows }, null, 2));
  process.exit(0);
}

if (!playerId) fail('--player is required');
const current = table[playerId];
if (!current || typeof current !== 'object') fail('player id was not found in this world');

try {
  await readFile(lockPath, 'utf8');
  fail('world lock is present; stop the game process before rotating a credential');
} catch (error) {
  if (error && error.code !== 'ENOENT') fail('could not check the world lock');
}

const before = summary(playerId, current);
if (!apply) {
  console.log(JSON.stringify({
    dryRun: true,
    player: before,
    note: 'Pass --apply to rotate the recovery credential. The player id stays the same.',
  }, null, 2));
  process.exit(0);
}

const nextToken = randomUUID();
const next = {
  ...parsed,
  players: {
    ...table,
    [playerId]: { ...current, sessionToken: nextToken, updatedAt: Date.now() },
  },
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = join(worldDir, `players.json.recover-backup-${stamp}`);
await copyFile(playersPath, backup);
const temp = `${playersPath}.tmp-${process.pid}`;
await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
await rename(temp, playersPath);
console.log(JSON.stringify({
  applied: true,
  player: before,
  backup,
}, null, 2));
console.log(`recovery-token: ${nextToken}`);
