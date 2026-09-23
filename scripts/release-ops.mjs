/**
 * Release directory helpers. World data is never read or written here.
 * The shell deploy scripts own systemd restart and the atomic symlink swap.
 */
import { execFileSync } from 'node:child_process';
import { access, cp, lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORLD_DATA_ROOT = '/var/lib/frontier-cubes';
export const BUNDLE_RELATIVE = 'dist/server/index.mjs';

const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

function normalize(path) {
  return resolve(path).replaceAll('\\', '/');
}

export function assertReleaseId(id) {
  if (typeof id !== 'string' || !RELEASE_ID.test(id)) {
    throw new Error(`invalid release id "${id ?? ''}". Use a git SHA or another single path segment.`);
  }
}

export function assertOutsideWorldData(path, worldRoot = WORLD_DATA_ROOT) {
  const resolved = normalize(path);
  const root = normalize(worldRoot);
  if (resolved === root || resolved.startsWith(`${root}/`)) {
    throw new Error(`refusing to touch world data: ${resolved}`);
  }
}

export function releaseDirectory(root, id) {
  assertReleaseId(id);
  assertOutsideWorldData(root);
  const dest = join(root, 'releases', id);
  const rel = relative(join(root, 'releases'), dest);
  if (rel.startsWith('..') || rel.includes(sep) || rel === '') {
    throw new Error(`release id escapes the releases directory: ${id}`);
  }
  assertOutsideWorldData(dest);
  return dest;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveReleaseSource(source) {
  assertOutsideWorldData(source);
  if (await exists(join(source, BUNDLE_RELATIVE))) return source;
  let names;
  try {
    names = await readdir(source);
  } catch {
    throw new Error(`release source has no ${BUNDLE_RELATIVE}: ${source}`);
  }
  const matches = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const child = join(source, name);
    const info = await lstat(child);
    if (info.isDirectory() && await exists(join(child, BUNDLE_RELATIVE))) matches.push(child);
  }
  if (matches.length === 1) return matches[0];
  throw new Error(`release source has no ${BUNDLE_RELATIVE}: ${source}`);
}

export async function assertReleaseBundle(source) {
  const root = await resolveReleaseSource(source);
  const bundle = join(root, BUNDLE_RELATIVE);
  const wsPackage = join(root, 'node_modules/ws/package.json');
  if (!await exists(bundle)) throw new Error(`missing ${bundle}`);
  if (!await exists(wsPackage)) {
    throw new Error(`missing ${wsPackage}. The server bundle keeps ws external; copy node_modules/ws into the release.`);
  }
  return root;
}

async function copyAllowlist(source, dest, releaseId) {
  await mkdir(join(dest, 'dist/server'), { recursive: true });
  await mkdir(join(dest, 'node_modules'), { recursive: true });
  await cp(join(source, BUNDLE_RELATIVE), join(dest, BUNDLE_RELATIVE));
  await cp(join(source, 'node_modules/ws'), join(dest, 'node_modules/ws'), {
    recursive: true,
    dereference: true,
  });
  const manifest = {
    name: 'frontier-cubes-server',
    private: true,
    type: 'module',
  };
  await writeFile(join(dest, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(dest, 'RELEASE_ID'), `${releaseId}\n`);
}

export async function installRelease({ root, source, releaseId }) {
  assertReleaseId(releaseId);
  assertOutsideWorldData(root);
  assertOutsideWorldData(source);
  const resolved = await assertReleaseBundle(source);
  const dest = releaseDirectory(root, releaseId);
  if (await exists(dest)) throw new Error(`release already exists: ${dest}`);
  if (normalize(resolved) === normalize(dest)) throw new Error('refusing to install a release onto itself');
  await mkdir(join(root, 'releases'), { recursive: true });
  await mkdir(dest, { recursive: false });
  try {
    await copyAllowlist(resolved, dest, releaseId);
    await assertReleaseBundle(dest);
  } catch (error) {
    await rm(dest, { recursive: true, force: true });
    throw error;
  }
  return dest;
}

export function gitReleaseId(repo) {
  const sha = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assertReleaseId(sha);
  return sha;
}

export function defaultReleaseOut(repo, releaseId) {
  assertReleaseId(releaseId);
  const out = join(repo, 'release', releaseId);
  assertOutsideWorldData(out);
  const rel = relative(join(repo, 'release'), out);
  if (rel.startsWith('..') || rel.includes(sep) || rel === '') {
    throw new Error(`release id escapes the local release directory: ${releaseId}`);
  }
  return out;
}

export async function packRelease({ repo, out, releaseId }) {
  const id = releaseId || gitReleaseId(repo);
  assertReleaseId(id);
  assertOutsideWorldData(repo);
  const destination = out ?? defaultReleaseOut(repo, id);
  assertOutsideWorldData(destination);
  if (normalize(destination) === normalize(repo)) throw new Error('refusing to pack a release onto the repository root');
  await assertReleaseBundle(repo);
  if (await exists(destination)) {
    if (out) throw new Error(`pack output already exists: ${destination}`);
    await rm(destination, { recursive: true, force: true });
  }
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(destination, { recursive: false });
  try {
    await copyAllowlist(repo, destination, id);
    await assertReleaseBundle(destination);
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
  return { id, out: destination };
}

export async function cleanupPlan(root, current, previous) {
  assertOutsideWorldData(root);
  const releasesDir = join(root, 'releases');
  if (!current || !previous || current === previous) return [];
  assertReleaseId(current);
  assertReleaseId(previous);
  let names;
  try {
    names = await readdir(releasesDir);
  } catch {
    return [];
  }
  const plan = [];
  for (const name of names) {
    if (!RELEASE_ID.test(name) || name === current || name === previous) continue;
    const path = join(releasesDir, name);
    const info = await lstat(path);
    if (!info.isDirectory()) continue;
    assertOutsideWorldData(path);
    plan.push(name);
  }
  return plan.sort();
}

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main() {
  const command = process.argv[2];
  try {
    if (command === 'install') {
      const dest = await installRelease({
        root: arg('--root'),
        source: arg('--source'),
        releaseId: arg('--release-id'),
      });
      console.log(dest);
      return;
    }
    if (command === 'pack') {
      const packed = await packRelease({
        repo: arg('--repo') || process.cwd(),
        out: arg('--out'),
        releaseId: arg('--release-id'),
      });
      console.error(`release ${packed.id}`);
      console.log(packed.out);
      return;
    }
    if (command === 'validate') {
      const root = await assertReleaseBundle(arg('--source'));
      console.log(root);
      return;
    }
    if (command === 'cleanup-plan') {
      const ids = await cleanupPlan(arg('--root'), arg('--current') ?? '', arg('--previous') ?? '');
      for (const id of ids) console.log(id);
      return;
    }
    if (command === 'release-id') {
      console.log(gitReleaseId(arg('--repo') || process.cwd()));
      return;
    }
    throw new Error('usage: release-ops.mjs <install|pack|validate|cleanup-plan|release-id>');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) await main();
