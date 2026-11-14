/**
 * Build two independent world directories from one stopped Anarchy snapshot.
 *
 * The source must already be a consistent copy (fc-backup extract, lock removed).
 * This script only reads that directory. It does not talk to a live server or
 * PostgreSQL. Both copies are prepared and checked before either target is
 * replaced. If the second install fails, the first is rolled back.
 *
 * The whole world.json is copied, including modifications far from spawn.
 * Claims are copied in full. A claim is treated as a PvP arena only when its
 * own flags.pvp is boolean true. The claim name is reported, not required.
 *
 *   node scripts/clone-world-snapshot.mjs \
 *     --source /tmp/fc-restore/worlds/anarchy \
 *     --survival /var/lib/frontier-cubes/worlds/survival \
 *     --peaceful /var/lib/frontier-cubes/worlds/peaceful
 *
 * Before the first start of each copy, set WORLD_SEED to the printed seed.
 * The process generates new chunks from WORLD_SEED, then overwrites meta.seed
 * with that value.
 */
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAP_JSON = [
  'claims/claims.json',
  'holograms/holograms.json',
  'buyers/buyers.json',
  'rtpportal/portals.json',
  'automine/automines.json',
  'mega-zombie/config.json',
  'duels/arena.json',
  'world-events/state.json',
];

const PERSONAL_MARKERS = [
  'economy/',
  'auction/',
  'friends/',
  'home/',
  'clans/',
  'permissions.json',
  'donation/',
  'notifications/',
  'admin-bans.json',
  'identity-incidents.json',
  'resource-accounting.json',
  'back/',
  'kit/',
  'messages/',
  'duels/stats.json',
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

function normalizeClaimName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function nameHint(name) {
  const normalized = normalizeClaimName(name);
  if (normalized === 'spawn' || normalized === 'спавн' || normalized.includes('спавн') || normalized.split(' ').includes('spawn')) {
    return 'spawn-like';
  }
  if (normalized.includes('arena') || normalized.includes('арена') || normalized.includes('пвп') || normalized.split(' ').includes('pvp')) {
    return 'arena-like';
  }
  return null;
}

function volumeOf(claim) {
  const volume = claim?.volume;
  if (!volume || typeof volume !== 'object') return undefined;
  const keys = ['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ'];
  const box = {};
  for (const key of keys) {
    if (typeof volume[key] !== 'number' || !Number.isFinite(volume[key])) return undefined;
    box[key] = volume[key];
  }
  return box;
}

function volumeContains(volume, x, y, z) {
  return x >= volume.minX && x <= volume.maxX
    && y >= volume.minY && y <= volume.maxY
    && z >= volume.minZ && z <= volume.maxZ;
}

function effectivePvp(claims) {
  const setters = claims.filter((claim) => typeof claim?.flags?.pvp === 'boolean');
  if (setters.length === 0) return false;
  setters.sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
  return setters[0].flags.pvp === true;
}

function describeClaims(claims) {
  return claims.map((claim) => {
    const hint = nameHint(claim?.name);
    return `${claim?.name ?? '(unnamed)'}${hint ? ` [${hint}]` : ''} pvp=${String(claim?.flags?.pvp)} priority=${claim?.priority ?? 0}`;
  }).join('; ') || '(none)';
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
  const modificationKeys = Object.keys(modifications);
  if (modificationKeys.length === 0) {
    fail('world.json modifications are empty. The same seed does not contain the built map.');
  }
  if (!existsSync(path.join(source, 'players.json'))) {
    fail('players.json is missing. Refusing a partial world directory.');
  }
  const claimsFile = path.join(source, 'plugin-data', 'claims', 'claims.json');
  const claimStore = asRecord(await readJson(claimsFile, 'plugin-data/claims/claims.json'), 'claims');
  if (!Array.isArray(claimStore.claims) || claimStore.claims.length === 0) {
    fail('claims.json has no claims.');
  }
  for (const claim of claimStore.claims) {
    if (!volumeOf(claim)) fail(`claim '${claim?.name ?? '(unnamed)'}' has no finite volume.`);
    if (claim.worldId !== meta.worldId) {
      fail(`claim '${claim?.name ?? '(unnamed)'}' worldId is '${claim.worldId}', meta.worldId is '${meta.worldId}'.`);
    }
  }
  const explicitPvp = claimStore.claims.filter((claim) => claim?.flags?.pvp === true);
  if (explicitPvp.length === 0) {
    fail(
      'No claim has flags.pvp set to true. Peaceful arena PvP needs that explicit flag. '
      + `Present claims: ${describeClaims(claimStore.claims)}. `
      + 'The claim name is not used for this check.',
    );
  }
  const spawnBlock = meta.spawn.map((value) => Math.floor(value));
  const covering = claimStore.claims.filter((claim) => volumeContains(volumeOf(claim), spawnBlock[0], spawnBlock[1], spawnBlock[2]));
  const review = {
    spawnBlock,
    spawnInsideClaim: covering.length > 0,
    spawnPvp: covering.length > 0 ? effectivePvp(covering) : null,
    explicitPvpClaims: explicitPvp.map((claim) => ({
      name: claim.name ?? null,
      normalizedName: normalizeClaimName(claim.name),
      priority: claim.priority ?? 0,
      volume: volumeOf(claim),
    })),
    nameHints: claimStore.claims.map((claim) => ({
      name: claim.name ?? null,
      normalizedName: normalizeClaimName(claim.name),
      hint: nameHint(claim.name),
    })).filter((entry) => entry.hint),
  };
  const warnings = [];
  if (!review.spawnInsideClaim) {
    warnings.push(
      `Saved spawn block ${spawnBlock.join(',')} is not inside any claim. `
      + `Claims: ${describeClaims(claimStore.claims)}. Confirm this against the real backup before starting the copies.`,
    );
  } else if (review.spawnPvp === true) {
    warnings.push(
      `Saved spawn block ${spawnBlock.join(',')} has effective pvp=true. `
      + 'Confirm that this block is the intended arena and not an unprotected spawn.',
    );
  }
  return {
    meta,
    modificationKeys,
    claims: claimStore.claims,
    review,
    warnings,
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

function stripBuyerPersonalData(store) {
  return { buyers: Array.isArray(store.buyers) ? store.buyers : [] };
}

function stripWorldEvents(store) {
  return { templates: Array.isArray(store.templates) ? store.templates : [] };
}

async function copyOptionalJson(sourceRoot, partial, relativePath, fromId, toId, transform) {
  const from = path.join(sourceRoot, 'plugin-data', relativePath);
  if (!existsSync(from)) return false;
  const raw = asRecord(await readJson(from, relativePath), relativePath);
  const rewritten = rewriteWorldId(transform ? transform(raw) : raw, fromId, toId);
  await writeJson(path.join(partial, 'plugin-data', relativePath), rewritten);
  return true;
}

async function copyConfig(source, partial, fromId, toId, copied) {
  const dir = path.join(source, 'plugin-data', 'config');
  if (!existsSync(dir)) return;
  const names = await readdir(dir);
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const relativePath = `config/${name}`;
    if (await copyOptionalJson(source, partial, relativePath, fromId, toId)) copied.push(relativePath);
  }
}

async function buildPartial(source, partial, worldId, loaded) {
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  const meta = { ...loaded.meta, worldId };
  await writeJson(path.join(partial, 'meta.json'), meta);
  await copyFile(path.join(source, 'world.json'), path.join(partial, 'world.json'));
  await writeJson(path.join(partial, 'players.json'), { players: {} });
  const copied = [];
  for (const relativePath of MAP_JSON) {
    const transform = relativePath === 'buyers/buyers.json'
      ? stripBuyerPersonalData
      : relativePath === 'world-events/state.json'
        ? stripWorldEvents
        : undefined;
    if (await copyOptionalJson(source, partial, relativePath, loaded.meta.worldId, worldId, transform)) {
      copied.push(relativePath);
    }
  }
  const originals = path.join(source, 'plugin-data', 'automine', 'originals');
  if (existsSync(originals)) {
    await cp(originals, path.join(partial, 'plugin-data', 'automine', 'originals'), { recursive: true });
    copied.push('automine/originals/');
  }
  await copyConfig(source, partial, loaded.meta.worldId, worldId, copied);
  copied.sort();
  return copied;
}

async function listFiles(root) {
  if (!existsSync(root)) return [];
  const found = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else found.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  await walk(root);
  return found.sort();
}

function leftoverWorldId(value, sourceId, pathName, found) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => leftoverWorldId(entry, sourceId, `${pathName}[${index}]`, found));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'worldId' && entry === sourceId) found.push(pathName || key);
    else leftoverWorldId(entry, sourceId, pathName ? `${pathName}.${key}` : key, found);
  }
}

async function verifyPartial(partial, worldId, loaded) {
  const meta = asRecord(await readJson(path.join(partial, 'meta.json'), 'copied meta.json'), 'copied meta');
  if (meta.worldId !== worldId) fail(`${partial} meta.worldId is ${meta.worldId}, expected ${worldId}.`);
  if (meta.seed !== loaded.meta.seed) fail(`${partial} seed changed.`);
  if (meta.worldgenVersion !== loaded.meta.worldgenVersion) fail(`${partial} worldgenVersion changed.`);
  if (JSON.stringify(meta.spawn) !== JSON.stringify(loaded.meta.spawn)) fail(`${partial} spawn changed.`);
  const worldText = await readFile(path.join(partial, 'world.json'), 'utf8');
  const sourceText = await readFile(path.join(loaded.source, 'world.json'), 'utf8');
  if (worldText !== sourceText) fail(`${partial} world.json is not a full copy of the source.`);
  const world = asRecord(JSON.parse(worldText), 'copied world');
  const keys = Object.keys(world.modifications);
  if (keys.length !== loaded.modificationKeys.length) {
    fail(`${partial} modification count is ${keys.length}, source has ${loaded.modificationKeys.length}.`);
  }
  const players = asRecord(await readJson(path.join(partial, 'players.json'), 'copied players.json'), 'copied players');
  const table = players.players && typeof players.players === 'object' ? players.players : null;
  if (!table || Object.keys(table).length !== 0) fail(`${partial} players.json is not an empty player list.`);
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
    const sourceClaim = loaded.claims.find((entry) => entry.id === claim.id);
    if (!sourceClaim) fail(`${partial} has an unexpected claim '${claim.name}'.`);
    if (JSON.stringify(claim.volume) !== JSON.stringify(sourceClaim.volume)) {
      fail(`claim '${claim.name}' volume changed.`);
    }
    if (JSON.stringify(claim.flags) !== JSON.stringify(sourceClaim.flags)) {
      fail(`claim '${claim.name}' flags changed.`);
    }
  }
  const files = await listFiles(path.join(partial, 'plugin-data'));
  for (const file of files) {
    const portable = file.endsWith('/') ? file : file;
    if (PERSONAL_MARKERS.some((marker) => portable === marker || portable.startsWith(marker) || portable.includes(`/${marker}`))) {
      fail(`${partial} still has personal data at plugin-data/${portable}.`);
    }
    if (!portable.endsWith('.json')) continue;
    const parsed = JSON.parse(await readFile(path.join(partial, 'plugin-data', file), 'utf8'));
    const leftovers = [];
    leftoverWorldId(parsed, loaded.meta.worldId, file, leftovers);
    if (leftovers.length > 0) fail(`${partial} still points ${leftovers.join(', ')} at ${loaded.meta.worldId}.`);
  }
  const buyersPath = path.join(partial, 'plugin-data', 'buyers', 'buyers.json');
  if (existsSync(buyersPath)) {
    const buyers = asRecord(await readJson(buyersPath, 'copied buyers'), 'copied buyers');
    for (const key of ['purchases', 'returns', 'settledPurchases', 'grantedPurchaseIds']) {
      if (buyers[key] !== undefined) fail(`${partial} buyers.json still has ${key}.`);
    }
  }
  const eventsPath = path.join(partial, 'plugin-data', 'world-events', 'state.json');
  if (existsSync(eventsPath)) {
    const events = asRecord(await readJson(eventsPath, 'copied world-events'), 'copied world-events');
    if (events.active !== undefined || events.journal !== undefined) {
      fail(`${partial} world-events still has a live event.`);
    }
  }
  return { modificationCount: keys.length, claimCount: claims.claims.length, worldText };
}

async function rollbackInstall(journal) {
  const errors = [];
  for (const step of [...journal].reverse()) {
    try {
      if (step.kind === 'installed' && existsSync(step.target)) {
        const trash = `${step.target}.failed-${process.pid}`;
        await rm(trash, { recursive: true, force: true });
        await rename(step.target, trash);
        await rm(trash, { recursive: true, force: true });
      }
      if (step.kind === 'aside') {
        if (existsSync(step.target)) {
          throw new Error(`cannot restore ${step.target}: the path is still occupied`);
        }
        await rename(step.aside, step.target);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (errors.length > 0) {
    fail(`rollback did not finish cleanly: ${errors.join('; ')}`);
  }
}

async function installBoth(steps, force) {
  const journal = [];
  try {
    for (const step of steps) {
      if (await targetOccupied(step.target)) {
        if (!force) {
          fail(`${step.target} already has a world. Pass --force to move it aside. Nothing was replaced.`);
        }
        if (existsSync(path.join(step.target, '.instance.lock'))) {
          fail(`${step.target} has .instance.lock. Stop that process before replacing the directory.`);
        }
        const aside = `${step.target}.rollback-${Date.now()}-${process.pid}-${step.id}`;
        if (existsSync(aside)) fail(`refusing to replace ${step.target}: ${aside} already exists.`);
        await rename(step.target, aside);
        journal.push({ kind: 'aside', target: step.target, aside });
      }
      if (process.env.FC_CLONE_FAIL_INSTALL === step.id) {
        throw new CloneWorldError(`injected failure installing ${step.id}`);
      }
      await mkdir(path.dirname(step.target), { recursive: true });
      await rename(step.partial, step.target);
      journal.push({ kind: 'installed', target: step.target, partial: step.partial });
    }
  } catch (error) {
    await rollbackInstall(journal);
    throw error;
  }
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
  const loaded = { ...(await loadSource(source)), source };
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
    if (survivalCheck.worldText !== peacefulCheck.worldText) {
      fail('the two prepared copies do not have the same world.json.');
    }
    if (JSON.stringify(survivalCopied) !== JSON.stringify(peacefulCopied)) {
      fail('the two prepared copies do not have the same map files.');
    }
    await installBoth([
      { id: survivalId, partial: survivalPartial, target: survivalDir },
      { id: peacefulId, partial: peacefulPartial, target: peacefulDir },
    ], force);
    return {
      source,
      seed: loaded.meta.seed,
      worldgenVersion: typeof loaded.meta.worldgenVersion === 'number' ? loaded.meta.worldgenVersion : null,
      spawn: loaded.meta.spawn.slice(0, 3),
      modifications: loaded.modificationKeys.length,
      modificationKeys: loaded.modificationKeys,
      sourceWorldId: loaded.meta.worldId,
      review: loaded.review,
      warnings: loaded.warnings,
      copiedPluginData: survivalCopied,
      targets: [
        { id: survivalId, directory: survivalDir, modificationCount: survivalCheck.modificationCount, claimCount: survivalCheck.claimCount },
        { id: peacefulId, directory: peacefulDir, modificationCount: peacefulCheck.modificationCount, claimCount: peacefulCheck.claimCount },
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
  if (summary.warnings.length > 0) {
    for (const warning of summary.warnings) console.error(`review: ${warning}`);
  }
  console.error(`Set WORLD_SEED=${summary.seed} before the first start of each copy.`);
  console.log(JSON.stringify(summary, null, 2));
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry && entry === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
