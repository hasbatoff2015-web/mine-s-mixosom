/**
 * Build two independent world directories from one stopped Anarchy snapshot.
 *
 * The source must already be a consistent copy (fc-backup extract, lock removed).
 * This script does not talk to a live server, PostgreSQL, or the original directory
 * except to read it. Existing targets are left in place unless --force is passed,
 * and even then the previous directory is renamed aside rather than deleted.
 *
 *   node scripts/clone-world-snapshot.mjs \
 *     --source /tmp/fc-restore/worlds/anarchy \
 *     --survival /var/lib/frontier-cubes/worlds/survival \
 *     --peaceful /var/lib/frontier-cubes/worlds/peaceful
 */
import { copyFile, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPAWN_NAMES = new Set(['spawn', 'спавн']);
const ALLOWED_PLUGIN_FILES = [
  'claims/claims.json',
  'holograms/holograms.json',
  'buyers/buyers.json',
  'rtpportal/portals.json',
  'automine/automines.json',
  'mega-zombie/config.json',
  'duels/arena.json',
];

export class CloneWorldError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CloneWorldError';
  }
}

function fail(message) {
  throw new CloneWorldError(message);
}

async function readJson(file, label) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') fail(`${label} is missing: ${file}`);
    fail(`${label} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function asRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is not an object.`);
  return value;
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function rewriteWorldId(value, fromId, toId) {
  if (Array.isArray(value)) return value.map((entry) => rewriteWorldId(entry, fromId, toId));
  if (!value || typeof value !== 'object') return value;
  const copy = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'worldId' && entry === fromId) copy[key] = toId;
    else copy[key] = rewriteWorldId(entry, fromId, toId);
  }
  return copy;
}

function assertWorldId(id, label) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
    fail(`${label} must be a short lowercase world id.`);
  }
  if (id === 'anarchy') fail(`${label} cannot be anarchy. That directory stays the original.`);
}

async function assertStoppedSource(source) {
  const lockPath = path.join(source, '.instance.lock');
  if (!existsSync(lockPath)) return;
  let pid = 'unknown';
  try {
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    if (typeof lock.pid === 'number') pid = String(lock.pid);
  } catch {
    pid = 'unreadable';
  }
  fail(
    `source still has .instance.lock (pid ${pid}). `
    + 'Clone from an fc-backup extract after the game process has stopped. '
    + 'This script does not copy a live world.',
  );
}

async function loadSource(source) {
  await assertStoppedSource(source);
  const meta = asRecord(await readJson(path.join(source, 'meta.json'), 'meta.json'), 'meta.json');
  if (typeof meta.worldId !== 'string' || meta.worldId.length === 0) fail('meta.json has no worldId.');
  if (typeof meta.seed !== 'string' || meta.seed.length === 0) fail('meta.json has no seed.');
  if (!Array.isArray(meta.spawn) || meta.spawn.length < 3 || meta.spawn.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    fail('meta.json spawn is not three finite numbers.');
  }
  const world = asRecord(await readJson(path.join(source, 'world.json'), 'world.json'), 'world.json');
  const modifications = world.modifications;
  if (!modifications || typeof modifications !== 'object' || Array.isArray(modifications)) {
    fail('world.json has no modifications object. The built map is not in this snapshot.');
  }
  const modificationCount = Object.keys(modifications).length;
  if (modificationCount === 0) {
    fail('world.json modifications are empty. The same seed does not contain the built spawn.');
  }
  if (!existsSync(path.join(source, 'players.json'))) {
    fail('players.json is missing. Refusing a partial world directory.');
  }
  const claimsFile = path.join(source, 'plugin-data', 'claims', 'claims.json');
  const claimStore = asRecord(await readJson(claimsFile, 'plugin-data/claims/claims.json'), 'claims');
  if (!Array.isArray(claimStore.claims) || claimStore.claims.length === 0) {
    fail('claims.json has no claims.');
  }
  const spawnClaim = claimStore.claims.find((claim) => (
    claim && typeof claim.name === 'string' && SPAWN_NAMES.has(claim.name.toLowerCase())
  ));
  const arenaClaim = claimStore.claims.find((claim) => claim?.flags?.pvp === true);
  if (!spawnClaim) {
    const names = claimStore.claims.map((claim) => claim?.name).filter(Boolean).join(', ') || '(none)';
    fail(`spawn claim was not found. Expected a claim named spawn or спавн. Present names: ${names}`);
  }
  if (!arenaClaim) {
    fail('PvP arena was not found. Expected a claim whose flags.pvp is true.');
  }
  for (const claim of [spawnClaim, arenaClaim]) {
    if (claim.worldId !== meta.worldId) {
      fail(`claim '${claim.name}' worldId is '${claim.worldId}', meta.worldId is '${meta.worldId}'.`);
    }
  }
  return {
    meta,
    modificationCount,
    claims: claimStore.claims,
    spawnClaim,
    arenaClaim,
  };
}

async function targetOccupied(directory) {
  return existsSync(path.join(directory, 'meta.json'))
    || existsSync(path.join(directory, 'world.json'))
    || existsSync(path.join(directory, 'plugin-data'))
    || existsSync(path.join(directory, '.instance.lock'));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function copyOptionalJson(sourceRoot, partial, relativePath, fromId, toId, transform) {
  const from = path.join(sourceRoot, 'plugin-data', relativePath);
  if (!existsSync(from)) return false;
  const raw = asRecord(await readJson(from, relativePath), relativePath);
  const rewritten = rewriteWorldId(transform ? transform(raw) : raw, fromId, toId);
  await writeJson(path.join(partial, 'plugin-data', relativePath), rewritten);
  return true;
}

function stripBuyerPersonalData(store) {
  return { buyers: Array.isArray(store.buyers) ? store.buyers : [] };
}

async function buildPartial(source, partial, worldId, loaded) {
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  const meta = { ...loaded.meta, worldId };
  await writeJson(path.join(partial, 'meta.json'), meta);
  await copyFile(path.join(source, 'world.json'), path.join(partial, 'world.json'));
  await writeJson(path.join(partial, 'players.json'), { players: {} });
  const copied = ['claims/claims.json'];
  await copyOptionalJson(source, partial, 'claims/claims.json', loaded.meta.worldId, worldId);
  for (const relativePath of ALLOWED_PLUGIN_FILES) {
    if (relativePath === 'claims/claims.json') continue;
    const transform = relativePath === 'buyers/buyers.json' ? stripBuyerPersonalData : undefined;
    if (await copyOptionalJson(source, partial, relativePath, loaded.meta.worldId, worldId, transform)) {
      copied.push(relativePath);
    }
  }
  const originals = path.join(source, 'plugin-data', 'automine', 'originals');
  if (existsSync(originals)) {
    await cp(originals, path.join(partial, 'plugin-data', 'automine', 'originals'), { recursive: true });
    copied.push('automine/originals/');
  }
  return copied;
}

async function verifyPartial(partial, worldId, loaded) {
  const meta = asRecord(await readJson(path.join(partial, 'meta.json'), 'copied meta.json'), 'copied meta');
  if (meta.worldId !== worldId) fail(`${partial} meta.worldId is ${meta.worldId}, expected ${worldId}.`);
  if (meta.seed !== loaded.meta.seed) fail(`${partial} seed changed.`);
  if (JSON.stringify(meta.spawn) !== JSON.stringify(loaded.meta.spawn)) fail(`${partial} spawn changed.`);
  const world = asRecord(await readJson(path.join(partial, 'world.json'), 'copied world.json'), 'copied world');
  const count = world.modifications && typeof world.modifications === 'object'
    ? Object.keys(world.modifications).length
    : 0;
  if (count !== loaded.modificationCount) fail(`${partial} modification count is ${count}, source has ${loaded.modificationCount}.`);
  const players = asRecord(await readJson(path.join(partial, 'players.json'), 'copied players.json'), 'copied players');
  const table = players.players && typeof players.players === 'object' ? players.players : players;
  if (Object.keys(table).length !== 0) fail(`${partial} players.json is not empty.`);
  if (existsSync(path.join(partial, '.instance.lock'))) fail(`${partial} contains .instance.lock.`);
  const claims = asRecord(
    await readJson(path.join(partial, 'plugin-data', 'claims', 'claims.json'), 'copied claims'),
    'copied claims',
  );
  if (!Array.isArray(claims.claims) || claims.claims.length !== loaded.claims.length) {
    fail(`${partial} claim count changed.`);
  }
  for (const claim of claims.claims) {
    if (claim.worldId !== worldId) fail(`claim '${claim.name}' in ${partial} still has worldId ${claim.worldId}.`);
  }
  const arena = claims.claims.find((claim) => claim?.flags?.pvp === true);
  const spawn = claims.claims.find((claim) => SPAWN_NAMES.has(String(claim?.name ?? '').toLowerCase()));
  if (!arena || !spawn) fail(`${partial} lost the spawn claim or the pvp=true arena.`);
  const buyersPath = path.join(partial, 'plugin-data', 'buyers', 'buyers.json');
  if (existsSync(buyersPath)) {
    const buyers = asRecord(await readJson(buyersPath, 'copied buyers'), 'copied buyers');
    for (const key of ['purchases', 'returns', 'settledPurchases', 'grantedPurchaseIds']) {
      if (buyers[key] !== undefined) fail(`${partial} buyers.json still has ${key}.`);
    }
  }
  return { modificationCount: count, claimCount: claims.claims.length };
}

async function commitDirectory(partial, target, force) {
  if (await targetOccupied(target)) {
    if (!force) {
      fail(`${target} already has a world. Pass --force to move it aside. Nothing was replaced.`);
    }
    if (existsSync(path.join(target, '.instance.lock'))) {
      fail(`${target} has .instance.lock. Stop that process before replacing the directory.`);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const aside = `${target}.previous-${stamp}`;
    if (existsSync(aside)) fail(`refusing to replace ${target}: ${aside} already exists.`);
    await rename(target, aside);
  }
  await mkdir(path.dirname(target), { recursive: true });
  await rename(partial, target);
}

/**
 * @param {{
 *   source: string,
 *   survivalDir: string,
 *   peacefulDir: string,
 *   survivalId?: string,
 *   peacefulId?: string,
 *   force?: boolean,
 * }} options
 */
export async function cloneWorldSnapshot(options) {
  const source = path.resolve(options.source);
  const survivalDir = path.resolve(options.survivalDir);
  const peacefulDir = path.resolve(options.peacefulDir);
  const survivalId = options.survivalId ?? 'survival';
  const peacefulId = options.peacefulId ?? 'peaceful';
  const force = options.force === true;
  if (!existsSync(source)) fail(`source does not exist: ${source}`);
  assertWorldId(survivalId, 'survival world id');
  assertWorldId(peacefulId, 'peaceful world id');
  if (survivalId === peacefulId) fail('the two copies need different world ids.');
  for (const target of [survivalDir, peacefulDir]) {
    if (samePath(source, target)) fail(`target ${target} is the source. The original snapshot is not modified.`);
  }
  if (samePath(survivalDir, peacefulDir)) fail('the two target directories are the same.');
  const loaded = await loadSource(source);
  if (!force) {
    for (const target of [survivalDir, peacefulDir]) {
      if (await targetOccupied(target)) {
        fail(`${target} already has a world. Pass --force to move it aside. Nothing was written.`);
      }
    }
  }
  const survivalPartial = `${survivalDir}.partial-${process.pid}`;
  const peacefulPartial = `${peacefulDir}.partial-${process.pid}`;
  try {
    const survivalCopied = await buildPartial(source, survivalPartial, survivalId, loaded);
    const peacefulCopied = await buildPartial(source, peacefulPartial, peacefulId, loaded);
    const survivalCheck = await verifyPartial(survivalPartial, survivalId, loaded);
    const peacefulCheck = await verifyPartial(peacefulPartial, peacefulId, loaded);
    if (survivalCheck.modificationCount !== peacefulCheck.modificationCount) {
      fail('the two copies do not have the same modification count.');
    }
    await commitDirectory(survivalPartial, survivalDir, force);
    try {
      await commitDirectory(peacefulPartial, peacefulDir, force);
    } catch (error) {
      fail(
        `survival copy is at ${survivalDir}, peaceful copy was not committed: `
        + (error instanceof Error ? error.message : String(error)),
      );
    }
    const claimLines = loaded.claims.map((claim) => ({
      name: claim.name,
      priority: claim.priority ?? 0,
      pvp: claim.flags?.pvp,
    }));
    return {
      source,
      seed: loaded.meta.seed,
      worldgenVersion: typeof loaded.meta.worldgenVersion === 'number' ? loaded.meta.worldgenVersion : null,
      spawn: loaded.meta.spawn.slice(0, 3),
      modifications: loaded.modificationCount,
      sourceWorldId: loaded.meta.worldId,
      claims: claimLines,
      copiedPluginData: survivalCopied,
      targets: [
        { id: survivalId, directory: survivalDir, ...survivalCheck, copiedPluginData: survivalCopied },
        { id: peacefulId, directory: peacefulDir, ...peacefulCheck, copiedPluginData: peacefulCopied },
      ],
    };
  } catch (error) {
    await rm(survivalPartial, { recursive: true, force: true }).catch(() => undefined);
    await rm(peacefulPartial, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) fail(`missing value for ${name}`);
  return value;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: node scripts/clone-world-snapshot.mjs --source DIR --survival DIR --peaceful DIR [--force]');
    return;
  }
  const source = optionValue(argv, '--source');
  const survivalDir = optionValue(argv, '--survival');
  const peacefulDir = optionValue(argv, '--peaceful');
  if (!source || !survivalDir || !peacefulDir) {
    fail('Usage: node scripts/clone-world-snapshot.mjs --source DIR --survival DIR --peaceful DIR [--force]');
  }
  const summary = await cloneWorldSnapshot({
    source,
    survivalDir,
    peacefulDir,
    survivalId: optionValue(argv, '--survival-id'),
    peacefulId: optionValue(argv, '--peaceful-id'),
    force: argv.includes('--force'),
  });
  console.log(JSON.stringify(summary, null, 2));
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry && entry === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
