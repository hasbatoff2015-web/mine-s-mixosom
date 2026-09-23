import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped release helper; the shell scripts call the same module
import { assertOutsideWorldData, assertReleaseId, cleanupPlan, gitReleaseId, installRelease, packRelease, WORLD_DATA_ROOT } from '../../scripts/release-ops.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const bashProbe = spawn('bash', ['-c', 'echo ok'], { stdio: 'ignore' });
const bashAvailable = await new Promise<boolean>((resolve) => {
  bashProbe.on('error', () => resolve(false));
  bashProbe.on('exit', (code) => resolve(code === 0));
});

async function fixtureRelease(parent: string, name: string): Promise<string> {
  const dir = join(parent, name);
  await mkdir(join(dir, 'dist/server'), { recursive: true });
  await mkdir(join(dir, 'node_modules/ws'), { recursive: true });
  await mkdir(join(dir, 'worlds/anarchy'), { recursive: true });
  await writeFile(join(dir, 'dist/server/index.mjs'), 'export {}\n');
  await writeFile(join(dir, 'node_modules/ws/package.json'), '{"name":"ws"}\n');
  await writeFile(join(dir, 'worlds/anarchy/world.json'), '{"keep":true}\n');
  return dir;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd: ROOT });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, out, err }));
  });
}

describe('release layout', () => {
  it('accepts a git sha and rejects path segments', () => {
    expect(assertReleaseId('228492d')).toBeUndefined();
    expect(assertReleaseId('228492d6607b')).toBeUndefined();
    expect(gitReleaseId(ROOT)).toMatch(/^[0-9a-f]{12,}$/);
    for (const id of ['', '.', '..', '../etc', 'a/b', 'rel ease', '/opt/frontier-cubes']) {
      expect(() => assertReleaseId(id)).toThrow(/invalid release id/);
    }
  });

  it('refuses world data paths and keeps them out of an installed release', async () => {
    expect(() => assertOutsideWorldData(`${WORLD_DATA_ROOT}/worlds/anarchy`)).toThrow(/world data/);
    expect(() => assertOutsideWorldData(WORLD_DATA_ROOT)).toThrow(/world data/);

    const parent = await mkdtemp(join(tmpdir(), 'fc-release-'));
    const source = await fixtureRelease(parent, 'source');
    const worlds = join(parent, 'var-worlds');
    await mkdir(join(worlds, 'anarchy'), { recursive: true });
    const sentinel = join(worlds, 'anarchy', 'world.json');
    await writeFile(sentinel, '{"blocks":1}\n');
    try {
      const dest = await installRelease({ root: join(parent, 'opt'), source, releaseId: '228492d6607b' });
      expect(dest).toBe(join(parent, 'opt', 'releases', '228492d6607b'));
      expect(await readFile(join(dest, 'dist/server/index.mjs'), 'utf8')).toContain('export');
      expect(await readFile(join(dest, 'node_modules/ws/package.json'), 'utf8')).toContain('ws');
      expect(await readFile(join(dest, 'RELEASE_ID'), 'utf8')).toBe('228492d6607b\n');
      await expect(readFile(join(dest, 'worlds/anarchy/world.json'), 'utf8')).rejects.toThrow();
      expect(await readFile(sentinel, 'utf8')).toBe('{"blocks":1}\n');
      await expect(installRelease({
        root: join(parent, 'opt'),
        source,
        releaseId: '228492d6607b',
      })).rejects.toThrow(/already exists/);

      const packed = await packRelease({ repo: source, releaseId: 'aabbccddee01' });
      expect(packed.out).toBe(join(source, 'release', 'aabbccddee01'));
      expect(await readFile(join(packed.out, 'dist/server/index.mjs'), 'utf8')).toContain('export');
      expect(await readFile(join(packed.out, 'node_modules/ws/package.json'), 'utf8')).toContain('ws');
      expect(await readFile(join(packed.out, 'package.json'), 'utf8')).toContain('frontier-cubes-server');
      expect(await readFile(join(packed.out, 'RELEASE_ID'), 'utf8')).toBe('aabbccddee01\n');
      await expect(readFile(join(packed.out, 'worlds/anarchy/world.json'), 'utf8')).rejects.toThrow();
      const again = await packRelease({ repo: source, releaseId: 'aabbccddee01' });
      expect(again.out).toBe(packed.out);
      const explicit = join(parent, 'explicit-pack');
      await packRelease({ repo: source, out: explicit, releaseId: 'aabbccddee01' });
      await expect(packRelease({ repo: source, out: explicit, releaseId: 'aabbccddee01' })).rejects.toThrow(/already exists/);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('plans cleanup without current, previous, or world paths', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'fc-clean-'));
    const root = join(parent, 'opt');
    await mkdir(join(root, 'releases/currentish'), { recursive: true });
    await mkdir(join(root, 'releases/previousish'), { recursive: true });
    await mkdir(join(root, 'releases/oldone'), { recursive: true });
    try {
      expect(await cleanupPlan(root, '', 'previousish')).toEqual([]);
      expect(await cleanupPlan(root, 'currentish', 'currentish')).toEqual([]);
      expect(await cleanupPlan(root, 'currentish', 'previousish')).toEqual(['oldone']);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe('release shell scripts', () => {
  const scripts = [
    'scripts/deploy-release.sh',
    'scripts/rollback-release.sh',
    'scripts/cleanup-releases.sh',
    'scripts/lib/release-common.sh',
  ];

  it('names the three systemd services, the bundle, and the atomic symlink', async () => {
    const deploy = await readFile(join(ROOT, 'scripts/deploy-release.sh'), 'utf8');
    const rollback = await readFile(join(ROOT, 'scripts/rollback-release.sh'), 'utf8');
    const common = await readFile(join(ROOT, 'scripts/lib/release-common.sh'), 'utf8');
    const health = await readFile(join(ROOT, 'scripts/check-game-servers.mjs'), 'utf8');
    expect(common).toContain('frontier-cubes-anarchy.service');
    expect(common).toContain('frontier-cubes-survival.service');
    expect(common).toContain('frontier-cubes-peaceful.service');
    expect(common).toContain('ln -s "$target" "$root/current.new"');
    expect(common).toContain('mv -Tf "$root/current.new" "$root/current"');
    expect(common).toContain('dist/server/index.mjs');
    expect(common).toContain('check-game-servers.mjs');
    expect(deploy).not.toMatch(/systemctl daemon-reload/);
    expect(rollback).toContain('switch_current');
    for (const mode of ['anarchy', 'survival', 'peaceful']) {
      expect(health).toContain(`mode: '${mode}'`);
      expect(health).toContain(`world: '${mode}'`);
    }
    expect(health).toContain('2567');
    expect(health).toContain('2568');
    expect(health).toContain('2569');
    for (const script of scripts) {
      const text = await readFile(join(ROOT, script), 'utf8');
      expect(text).not.toContain('vite-node');
      expect(text).not.toContain('dev:server');
      expect(text).not.toContain('npm install');
      expect(text).not.toContain('npm ci');
      expect(text).not.toMatch(/rm\s+-rf\s+\/var\/lib\/frontier-cubes/);
      expect(text).not.toContain('worlds/*');
    }
  });

  it.skipIf(!bashAvailable || process.platform === 'win32')('deploys, rolls back, and leaves world bytes untouched', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'fc-deploy-sh-'));
    const opt = join(parent, 'opt');
    const worlds = join(parent, 'worlds', 'anarchy');
    const sentinel = join(worlds, 'world.json');
    await mkdir(worlds, { recursive: true });
    await writeFile(sentinel, '{"keep":1}\n');
    const sourceA = await fixtureRelease(parent, 'pack-a');
    const sourceB = await fixtureRelease(parent, 'pack-b');
    const sourceC = await fixtureRelease(parent, 'pack-c');
    const systemctlLog = join(parent, 'systemctl.log');
    const systemctl = join(parent, 'systemctl');
    const health = join(parent, 'health.sh');
    await writeFile(systemctl, '#!/bin/bash\nprintf \'%s\\n\' "$*" >> "$SYSTEMCTL_LOG"\nexit 0\n');
    await writeFile(health, `#!/bin/bash
id=$(basename "$(readlink "$FC_OPT_ROOT/current")")
if [[ "$id" == "$UNHEALTHY_ID" ]]; then
  echo "unhealthy $id" >&2
  exit 1
fi
echo "[status:servers] anarchy, survival, peaceful ready"
`);
    await chmod(systemctl, 0o755);
    await chmod(health, 0o755);
    const env = {
      ...process.env,
      FC_OPT_ROOT: opt,
      FC_SYSTEMCTL: systemctl,
      SYSTEMCTL_LOG: systemctlLog,
      FC_HEALTHCHECK: health,
      FC_HEALTH_TIMEOUT: '1',
      FC_HEALTH_INTERVAL: '0.2',
      UNHEALTHY_ID: 'none',
    };
    try {
      const refused = await run('bash', [
        'scripts/deploy-release.sh',
        '--release-id', 'aabbccd',
        '--source', sourceA,
        '--root', '/var/lib/frontier-cubes',
      ], env);
      expect(refused.code).not.toBe(0);
      expect(refused.err).toContain('refusing to touch world data');

      const first = await run('bash', [
        'scripts/deploy-release.sh',
        '--release-id', 'aaaaaaa',
        '--source', sourceA,
        '--root', opt,
      ], env);
      expect(first.code).toBe(0);
      expect(first.out).toContain('deployed aaaaaaa');
      expect(await readFile(join(opt, 'current', 'RELEASE_ID'), 'utf8')).toBe('aaaaaaa\n');
      await expect(readFile(join(opt, 'releases', 'aaaaaaa', 'worlds/anarchy/world.json'), 'utf8')).rejects.toThrow();

      const failed = await run('bash', [
        'scripts/deploy-release.sh',
        '--release-id', 'bbbbbbb',
        '--source', sourceB,
        '--root', opt,
      ], { ...env, UNHEALTHY_ID: 'bbbbbbb' });
      expect(failed.code).not.toBe(0);
      expect(failed.err).toContain('restoring release aaaaaaa');
      expect(await readFile(join(opt, 'current', 'RELEASE_ID'), 'utf8')).toBe('aaaaaaa\n');
      expect(await readFile(join(opt, 'releases', 'bbbbbbb', 'RELEASE_ID'), 'utf8')).toBe('bbbbbbb\n');

      const second = await run('bash', [
        'scripts/deploy-release.sh',
        '--release-id', 'ccccccc',
        '--source', sourceC,
        '--root', opt,
      ], { ...env, UNHEALTHY_ID: 'none' });
      expect(second.code).toBe(0);
      expect(await readFile(join(opt, 'previous'), 'utf8')).toBe('aaaaaaa\n');
      expect(await readFile(join(opt, 'current', 'RELEASE_ID'), 'utf8')).toBe('ccccccc\n');

      const dry = await run('bash', ['scripts/cleanup-releases.sh', '--root', opt], env);
      expect(dry.code).toBe(0);
      expect(dry.out).toContain('would remove');
      expect(dry.out).toContain('bbbbbbb');
      expect(await readFile(join(opt, 'releases', 'bbbbbbb', 'RELEASE_ID'), 'utf8')).toContain('bbbbbbb');

      const applied = await run('bash', ['scripts/cleanup-releases.sh', '--root', opt, '--apply'], env);
      expect(applied.code).toBe(0);
      await expect(readFile(join(opt, 'releases', 'bbbbbbb', 'RELEASE_ID'), 'utf8')).rejects.toThrow();
      expect(await readFile(join(opt, 'releases', 'aaaaaaa', 'RELEASE_ID'), 'utf8')).toContain('aaaaaaa');
      expect(await readFile(join(opt, 'releases', 'ccccccc', 'RELEASE_ID'), 'utf8')).toContain('ccccccc');

      const back = await run('bash', ['scripts/rollback-release.sh', '--root', opt], env);
      expect(back.code).toBe(0);
      expect(back.out).toContain('rolled back to aaaaaaa');
      expect(await readFile(join(opt, 'current', 'RELEASE_ID'), 'utf8')).toBe('aaaaaaa\n');
      expect(await readFile(join(opt, 'previous'), 'utf8')).toBe('ccccccc\n');
      expect(await readFile(sentinel, 'utf8')).toBe('{"keep":1}\n');

      const failedBack = await run('bash', ['scripts/rollback-release.sh', '--root', opt], {
        ...env,
        UNHEALTHY_ID: 'ccccccc',
      });
      expect(failedBack.code).not.toBe(0);
      expect(failedBack.err).toContain('returning current to aaaaaaa');
      expect(failedBack.err).toContain('restored release is healthy; rollback still failed');
      expect(await readFile(join(opt, 'current', 'RELEASE_ID'), 'utf8')).toBe('aaaaaaa\n');
      expect(await readFile(join(opt, 'previous'), 'utf8')).toBe('ccccccc\n');
      expect(await readFile(sentinel, 'utf8')).toBe('{"keep":1}\n');

      const log = await readFile(systemctlLog, 'utf8');
      expect(log).toContain('frontier-cubes-anarchy.service');
      expect(log).toContain('frontier-cubes-survival.service');
      expect(log).toContain('frontier-cubes-peaceful.service');
      expect(log).toContain('restart');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }, 30_000);
});
