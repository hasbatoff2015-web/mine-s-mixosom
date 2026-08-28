#!/usr/bin/env node
/**
 * Copy Minecraft Java 1.8 reference sounds for LOCAL A/B only.
 *
 * Original Mojang/Minecraft audio is NOT a production dependency:
 *   - do not commit
 *   - do not push
 *   - do not ship in the Yandex archive
 *
 * The script never stores object SHA-1 hashes in the repo. It reads the
 * selected 1.8 asset index, resolves logical sound paths, and copies objects.
 *
 * Windows (typical):
 *   npm run audio:extract-reference
 *
 * Equivalent:
 *   node scripts/extract-minecraft-reference-sounds.mjs
 *
 * Optional:
 *   node scripts/extract-minecraft-reference-sounds.mjs --assets "D:\\Games\\.minecraft\\assets"
 *   node scripts/extract-minecraft-reference-sounds.mjs --out .local/minecraft-reference-audio
 */
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_OUT = join(REPO_ROOT, '.local', 'minecraft-reference-audio');

/** Logical 1.8 families we want for Frontier Cubes core SFX. Hashes are never listed. */
export const REFERENCE_SOUND_REQUESTS = Object.freeze([
  { dest: 'stone_1.ogg', patterns: ['minecraft/sounds/dig/stone1.ogg', 'minecraft/sounds/step/stone1.ogg'] },
  { dest: 'stone_2.ogg', patterns: ['minecraft/sounds/dig/stone2.ogg', 'minecraft/sounds/step/stone2.ogg'] },
  { dest: 'wood_1.ogg', patterns: ['minecraft/sounds/dig/wood1.ogg', 'minecraft/sounds/step/wood1.ogg'] },
  { dest: 'wood_2.ogg', patterns: ['minecraft/sounds/dig/wood2.ogg', 'minecraft/sounds/step/wood2.ogg'] },
  { dest: 'dirt_1.ogg', patterns: ['minecraft/sounds/dig/grass1.ogg', 'minecraft/sounds/step/grass1.ogg'] },
  { dest: 'dirt_2.ogg', patterns: ['minecraft/sounds/dig/grass2.ogg', 'minecraft/sounds/step/grass2.ogg'] },
  { dest: 'sand_1.ogg', patterns: ['minecraft/sounds/dig/sand1.ogg', 'minecraft/sounds/dig/gravel1.ogg', 'minecraft/sounds/step/sand1.ogg'] },
  { dest: 'sand_2.ogg', patterns: ['minecraft/sounds/dig/sand2.ogg', 'minecraft/sounds/dig/gravel2.ogg', 'minecraft/sounds/step/sand2.ogg'] },
  { dest: 'wool_1.ogg', patterns: ['minecraft/sounds/dig/cloth1.ogg', 'minecraft/sounds/step/cloth1.ogg'] },
  { dest: 'wool_2.ogg', patterns: ['minecraft/sounds/dig/cloth2.ogg', 'minecraft/sounds/step/cloth2.ogg'] },
  { dest: 'glass_1.ogg', patterns: ['minecraft/sounds/random/glass1.ogg', 'minecraft/sounds/dig/glass1.ogg', 'minecraft/sounds/random/glass.ogg'] },
  { dest: 'explosion.ogg', patterns: ['minecraft/sounds/random/explode1.ogg', 'minecraft/sounds/random/explode.ogg'] },
  { dest: 'bow_shoot.ogg', patterns: ['minecraft/sounds/random/bow.ogg'] },
  { dest: 'arrow_hit.ogg', patterns: ['minecraft/sounds/random/bowhit1.ogg', 'minecraft/sounds/random/bowhit.ogg'] },
  { dest: 'combat_hit.ogg', patterns: ['minecraft/sounds/damage/hit1.ogg', 'minecraft/sounds/random/hurt.ogg', 'minecraft/sounds/mob/hurt.ogg'] },
  { dest: 'player_hurt.ogg', patterns: ['minecraft/sounds/damage/hit2.ogg', 'minecraft/sounds/damage/hit1.ogg', 'minecraft/sounds/game/player/hurt.ogg'] },
  { dest: 'item_pickup.ogg', patterns: ['minecraft/sounds/random/pop.ogg'] },
  { dest: 'food_eat.ogg', patterns: ['minecraft/sounds/random/eat1.ogg', 'minecraft/sounds/random/burp.ogg'] },
  { dest: 'potion_drink.ogg', patterns: ['minecraft/sounds/random/drink.ogg'] },
  { dest: 'door_open.ogg', patterns: ['minecraft/sounds/random/door_open.ogg'] },
  { dest: 'door_close.ogg', patterns: ['minecraft/sounds/random/door_close.ogg'] },
  { dest: 'chest_open.ogg', patterns: ['minecraft/sounds/random/chestopen.ogg'] },
  { dest: 'chest_close.ogg', patterns: ['minecraft/sounds/random/chestclosed.ogg'] },
  { dest: 'click.ogg', patterns: ['minecraft/sounds/random/click.ogg'] },
  { dest: 'fire_ignite.ogg', patterns: ['minecraft/sounds/fire/ignite.ogg', 'minecraft/sounds/random/fizz.ogg'] },
  { dest: 'water_splash.ogg', patterns: ['minecraft/sounds/liquid/splash.ogg', 'minecraft/sounds/liquid/splash2.ogg'] },
]);

export function parseArgs(argv) {
  const args = { assets: undefined, out: DEFAULT_OUT, index: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '--assets' && next) { args.assets = next; i += 1; }
    else if (token === '--out' && next) { args.out = next; i += 1; }
    else if (token === '--index' && next) { args.index = next; i += 1; }
  }
  return args;
}

export function candidateAssetsDirs(env = process.env) {
  const dirs = [];
  if (env.APPDATA) dirs.push(join(env.APPDATA, '.minecraft', 'assets'));
  if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, '.minecraft', 'assets'));
  const home = env.HOME || env.USERPROFILE || homedir();
  if (home) {
    dirs.push(join(home, 'AppData', 'Roaming', '.minecraft', 'assets'));
    dirs.push(join(home, '.minecraft', 'assets'));
    dirs.push(join(home, 'Library', 'Application Support', 'minecraft', 'assets'));
  }
  return [...new Set(dirs.map((dir) => resolve(dir)))];
}

export function findAssetsDir(explicit, env = process.env) {
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) throw new Error(`Assets directory not found: ${resolved}`);
    return resolved;
  }
  for (const dir of candidateAssetsDirs(env)) {
    if (existsSync(join(dir, 'indexes')) && existsSync(join(dir, 'objects'))) return dir;
  }
  return undefined;
}

const INDEX_NAME = /^1\.8(?:\.(\d+))?\.json$/;

export function rankIndexName(name) {
  const match = name.match(INDEX_NAME);
  if (!match) return -1;
  if (name === '1.8.json') return 1_000;
  const patch = match[1] === undefined ? 0 : Number(match[1]);
  return 800 + patch;
}

export function selectIndexFile(fileNames, preferred) {
  if (preferred) {
    const exact = fileNames.find((name) => name === preferred || name === `${preferred}.json`);
    if (exact) return exact;
  }
  let best;
  let bestRank = -1;
  for (const name of fileNames) {
    const rank = rankIndexName(name);
    if (rank > bestRank) {
      best = name;
      bestRank = rank;
    }
  }
  return best;
}

export function objectDiskPath(objectsDir, hash) {
  if (typeof hash !== 'string' || hash.length < 3) return undefined;
  const clean = hash.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(clean)) return undefined;
  return join(objectsDir, clean.slice(0, 2), clean);
}

export function lookupIndexObject(objects, logicalKey) {
  if (!objects || typeof objects !== 'object') return undefined;
  const entry = objects[logicalKey];
  if (!entry || typeof entry.hash !== 'string') return undefined;
  return { key: logicalKey, hash: entry.hash, size: entry.size };
}

export function resolveRequest(objects, request) {
  const keys = Object.keys(objects ?? {});
  for (const pattern of request.patterns) {
    const exact = lookupIndexObject(objects, pattern);
    if (exact) return exact;
    const needle = pattern.replace(/\\/g, '/');
    const found = keys.find((key) => key.replace(/\\/g, '/') === needle || key.endsWith(needle));
    if (found) return lookupIndexObject(objects, found);
  }
  const destStem = request.dest.replace(/\.ogg$/, '').replace(/_/g, '');
  const loose = keys.find((key) => {
    const lower = key.toLowerCase();
    return lower.includes('/sounds/') && lower.endsWith('.ogg') && lower.includes(destStem);
  });
  if (loose) return lookupIndexObject(objects, loose);
  return undefined;
}

function print(message) {
  process.stdout.write(`${message}\n`);
}

function printErr(message) {
  process.stderr.write(`${message}\n`);
}

export async function extractReferenceSounds({ assetsDir, outDir, indexName } = {}) {
  const assets = assetsDir;
  if (!assets) {
    return {
      ok: false,
      reason: 'no-assets',
      message: [
        'Minecraft assets directory was not found.',
        'On Windows the extractor looks at %APPDATA%\\.minecraft\\assets',
        'Install Minecraft Java 1.8 (or any launcher that keeps that assets tree), then run:',
        '  npm run audio:extract-reference',
        'Or pass the folder explicitly:',
        '  node scripts/extract-minecraft-reference-sounds.mjs --assets "%APPDATA%\\.minecraft\\assets"',
      ].join('\n'),
    };
  }
  const indexesDir = join(assets, 'indexes');
  const objectsDir = join(assets, 'objects');
  const names = await readdir(indexesDir);
  const selected = selectIndexFile(names, indexName);
  if (!selected) {
    return {
      ok: false,
      reason: 'no-index',
      available: names,
      message: `No 1.8 asset index in ${indexesDir}. Found: ${names.join(', ') || '(empty)'}`,
    };
  }
  const indexPath = join(indexesDir, selected);
  const indexJson = JSON.parse(await readFile(indexPath, 'utf8'));
  const objects = indexJson.objects ?? {};
  await mkdir(outDir, { recursive: true });
  const copied = [];
  const missing = [];
  for (const request of REFERENCE_SOUND_REQUESTS) {
    const resolved = resolveRequest(objects, request);
    if (!resolved) {
      missing.push({ dest: request.dest, patterns: request.patterns });
      continue;
    }
    const source = objectDiskPath(objectsDir, resolved.hash);
    if (!source || !existsSync(source)) {
      missing.push({ dest: request.dest, key: resolved.key, hashPrefix: resolved.hash.slice(0, 2) });
      continue;
    }
    const destination = join(outDir, request.dest);
    await copyFile(source, destination);
    copied.push({ dest: request.dest, key: resolved.key, bytes: resolved.size ?? 0 });
  }

  const manifest = {
    generatedBy: 'scripts/extract-minecraft-reference-sounds.mjs',
    warning: 'LOCAL REFERENCE ONLY. Minecraft original sounds. Do not commit, push, or ship.',
    assetsDir: assets,
    index: selected,
    copied,
    missing,
  };
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(outDir, 'README.txt'), [
    'LOCAL MINECRAFT REFERENCE AUDIO',
    '',
    'These files are copied from a local Minecraft Java 1.8 assets index.',
    'They are for developer A/B comparison only.',
    '',
    'DO NOT commit.',
    'DO NOT push.',
    'DO NOT include in the production / Yandex archive.',
    'Frontier Cubes ships original procedural samples from public/audio/sfx/.',
    '',
  ].join('\n'));

  return { ok: missing.length === 0, assetsDir: assets, index: selected, outDir, copied, missing };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let assetsDir;
  try {
    assetsDir = findAssetsDir(args.assets);
  } catch (error) {
    printErr(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  const outDir = isAbsolute(args.out) ? args.out : resolve(REPO_ROOT, args.out);
  const result = await extractReferenceSounds({ assetsDir, outDir, indexName: args.index });
  if (result.reason === 'no-assets' || result.reason === 'no-index') {
    printErr(result.message);
    process.exitCode = 2;
    return;
  }
  print(`Index: ${result.index}`);
  print(`Output: ${result.outDir}`);
  print(`Copied ${result.copied.length} / ${REFERENCE_SOUND_REQUESTS.length} reference sounds.`);
  if (result.missing.length) {
    printErr(`Missing ${result.missing.length}:`);
    for (const item of result.missing) printErr(`  - ${item.dest}`);
    process.exitCode = 3;
  } else {
    print('Done. These files stay gitignored.');
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error) => {
    printErr(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
