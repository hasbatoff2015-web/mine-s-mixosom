/**
 * Release directory helpers. World data is never read or written here.
 * The shell deploy scripts own systemd restart and the atomic symlink swap.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { access, cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORLD_DATA_ROOT = '/var/lib/frontier-cubes';
export const BUNDLE_RELATIVE = 'dist/server/index.mjs';

/** Always packed, even when a fixture bundle does not import them. */
const REQUIRED_RUNTIME_PACKAGES = ['ws', 'pg'];

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

export function packageNameFromSpecifier(spec) {
  if (typeof spec !== 'string' || spec === '') return null;
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || spec.startsWith('file:')) return null;
  if (spec.startsWith('@')) {
    const [scope, name] = spec.split('/');
    if (!scope || !name) return null;
    return `${scope}/${name}`;
  }
  const name = spec.split('/')[0];
  return name || null;
}

export function externalPackageNames(source) {
  const names = new Set();
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const name = packageNameFromSpecifier(match[1]);
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

export function runtimePackageRoots(bundleSource) {
  return [...new Set([...REQUIRED_RUNTIME_PACKAGES, ...externalPackageNames(bundleSource)])].sort();
}

/**
 * Production dependencies only. devDependencies, optionalDependencies, and
 * peerDependencies are not runtime requirements of `ws` or `pg`.
 */
/**
 * `require.resolve(name + '/package.json')` fails when the package exports
 * map does not expose that subpath. Fall back to the entry file and walk up
 * to the manifest whose `name` matches.
 */
function resolvePackageRoot(require, root, name) {
  try {
    const manifestPath = require.resolve(`${name}/package.json`);
    return { manifestPath, dir: dirname(manifestPath) };
  } catch {
    // The exports map hid ./package.json. Resolve the entry instead.
  }
  let entry;
  try {
    entry = require.resolve(name);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`missing runtime package ${name} from ${root}: ${detail}`);
  }
  let dir = dirname(entry);
  while (true) {
    const manifestPath = join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.name === name) return { manifestPath, dir };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`missing runtime package ${name} from ${root}: no package.json above ${entry}`);
}

export function runtimeDependencyClosure(root, entryNames) {
  const require = createRequire(join(root, 'package.json'));
  const seen = new Set();
  const ordered = [];
  const queue = [...entryNames];
  while (queue.length > 0) {
    const name = queue.shift();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const located = resolvePackageRoot(require, root, name);
    const manifest = JSON.parse(readFileSync(located.manifestPath, 'utf8'));
    const dependencies = Object.keys(manifest.dependencies ?? {}).sort();
    ordered.push({ name, dir: located.dir, dependencies });
    for (const dep of dependencies) queue.push(dep);
  }
  return ordered;
}

export async function copyRuntimePackages(sourceRoot, destRoot, entryNames) {
  const closure = runtimeDependencyClosure(sourceRoot, entryNames);
  for (const pkg of closure) {
    const dest = join(destRoot, 'node_modules', ...pkg.name.split('/'));
    await mkdir(dirname(dest), { recursive: true });
    const packageRoot = normalize(pkg.dir);
    await cp(pkg.dir, dest, {
      recursive: true,
      dereference: true,
      filter(sourcePath) {
        const normalized = normalize(sourcePath);
        if (normalized === packageRoot) return true;
        if (!normalized.startsWith(`${packageRoot}/`)) return true;
        return !normalized.slice(packageRoot.length + 1).split('/').includes('node_modules');
      },
    });
  }
  return closure.map((pkg) => pkg.name);
}

async function assertPackageClosure(root, name, seen) {
  if (seen.has(name)) return;
  seen.add(name);
  const manifestPath = join(root, 'node_modules', ...name.split('/'), 'package.json');
  if (!await exists(manifestPath)) {
    throw new Error(
      `missing ${manifestPath}. The server bundle keeps npm packages external; copy the runtime dependency closure into the release.`,
    );
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const dep of Object.keys(manifest.dependencies ?? {}).sort()) {
    await assertPackageClosure(root, dep, seen);
  }
}

export async function assertReleaseBundle(source) {
  const root = await resolveReleaseSource(source);
  const bundlePath = join(root, BUNDLE_RELATIVE);
  if (!await exists(bundlePath)) throw new Error(`missing ${bundlePath}`);
  const bundle = await readFile(bundlePath, 'utf8');
  const seen = new Set();
  for (const name of runtimePackageRoots(bundle)) {
    await assertPackageClosure(root, name, seen);
  }
  return root;
}

async function copyAllowlist(source, dest, releaseId) {
  await mkdir(join(dest, 'dist/server'), { recursive: true });
  await mkdir(join(dest, 'node_modules'), { recursive: true });
  await cp(join(source, BUNDLE_RELATIVE), join(dest, BUNDLE_RELATIVE));
  const bundle = await readFile(join(source, BUNDLE_RELATIVE), 'utf8');
  await copyRuntimePackages(source, dest, runtimePackageRoots(bundle));
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
