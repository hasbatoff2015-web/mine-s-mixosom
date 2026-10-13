import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { WorldPersistence } from '../../server/persistence';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SCRIPT = join(ROOT, 'scripts/fc-backup.sh');
const SECRET = 'stage6-secret-value';
const ADMIN_HASH = 'fc-admin-hash-secret';
const SESSION = 'session-secret-token';
const PLAYER = '11111111-1111-4111-8111-111111111111';

const bashProbe = spawn('bash', ['-c', 'echo ok'], { stdio: 'ignore' });
const bashAvailable = await new Promise<boolean>((resolve) => {
  bashProbe.on('error', () => resolve(false));
  bashProbe.on('exit', (code) => resolve(code === 0));
});

interface Layout {
  readonly root: string;
  readonly worlds: string;
  readonly backup: string;
  readonly plugins: string;
  readonly envDir: string;
  readonly active: string;
  readonly syslog: string;
  readonly dumpLog: string;
  readonly production: string;
  env: NodeJS.ProcessEnv;
}

const roots: string[] = [];

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

async function writeWorld(root: string, id: string): Promise<void> {
  const dir = join(root, id);
  await mkdir(join(dir, 'plugin-data'), { recursive: true });
  await writeFile(join(dir, 'meta.json'), `${JSON.stringify({
    worldId: id,
    seed: 'stage6',
    spawn: [0, 64, 0],
    createdAt: 1,
    updatedAt: 1,
  })}\n`);
  await writeFile(join(dir, 'world.json'), `${JSON.stringify({
    timeOfDay: 1000,
    chests: { '1,2,3': { items: [{ id: 'diamond', count: 1 }] } },
    furnaces: { '4,5,6': { input: [] } },
    mobs: [],
  })}\n`);
  await writeFile(join(dir, 'players.json'), `${JSON.stringify({
    players: {
      [PLAYER]: {
        name: 'Tester',
        inventory: [{ id: 'diamond', count: 3 }],
        sessionToken: SESSION,
      },
    },
  })}\n`);
  await writeFile(join(dir, '.instance.lock'), '{"pid":1,"mode":"anarchy","worldId":"anarchy","port":1}\n');
  await writeFile(join(dir, 'plugin-data/claims.json'), '{"claims":[{"owner":"p1"}]}\n');
  await writeFile(join(dir, 'plugin-data/homes.json'), '{"homes":[{"name":"base"}]}\n');
  await writeFile(join(dir, 'plugin-data/auctions.json'), '{"lots":[]}\n');
  await writeFile(join(dir, 'plugin-data/clans.json'), '{"clans":[]}\n');
  await writeFile(join(dir, 'plugin-data/resource-accounting.json'), '{"items":[]}\n');
  await writeFile(join(dir, 'plugin-data/identity-incidents.json'), '{"incidents":[]}\n');
}

async function writeEnv(dir: string, databaseUrl = ''): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const name of ['anarchy', 'survival', 'peaceful']) {
    const lines = [
      `SERVER_MODE=${name}`,
      'FC_DEPLOYMENT_ID=dev',
      `FC_ADMIN_AUTH_HASHES=${ADMIN_HASH}`,
    ];
    if (databaseUrl) lines.push(`FC_DATABASE_URL=${databaseUrl}`);
    await writeFile(join(dir, `${name}.env`), `${lines.join('\n')}\n`, { mode: 0o600 });
  }
}

async function layout(options?: { databaseUrl?: string; active?: string[] }): Promise<Layout> {
  const root = await mkdtemp(join(tmpdir(), 'fc-backup-'));
  roots.push(root);
  const worlds = join(root, 'worlds');
  const backup = join(root, 'backups');
  const plugins = join(root, 'plugins');
  const envDir = join(root, 'env');
  const bin = join(root, 'bin');
  const active = join(root, 'active');
  const syslog = join(root, 'systemctl.log');
  const dumpLog = join(root, 'dump.log');
  const production = join(root, 'production-worlds');
  await mkdir(backup, { recursive: true });
  await mkdir(plugins, { recursive: true });
  await mkdir(bin, { recursive: true });
  await mkdir(production, { recursive: true });
  await writeFile(join(production, 'sentinel.txt'), 'do-not-touch\n');
  for (const id of ['anarchy', 'survival', 'peaceful']) await writeWorld(worlds, id);
  await writeFile(join(worlds, 'anarchy/plugin-data/claims.json'), '{"claims":[{"owner":"kept"}]}\n');
  await writeEnv(envDir, options?.databaseUrl ?? '');
  const activeUnits = options?.active ?? [
    'frontier-cubes-anarchy.service',
    'frontier-cubes-survival.service',
  ];
  await writeFile(active, `${activeUnits.join('\n')}\n`);
  await writeFile(syslog, '');
  const systemctl = join(bin, 'systemctl');
  const pgDump = join(bin, 'pg_dump');
  const pgRestore = join(bin, 'pg_restore');
  await writeFile(systemctl, `#!/bin/bash
set -u
printf '%s\\n' "$*" >> "$SYSTEMCTL_LOG"
cmd=$1
shift || true
case "$cmd" in
  is-active)
    unit=$1
    if grep -qx "$unit" "$ACTIVE_FILE"; then echo active; exit 0; fi
    echo inactive
    exit 3
    ;;
  stop)
    if [[ -n "\${STOP_STARTED:-}" ]]; then : > "$STOP_STARTED"; fi
    if [[ -n "\${SLOW_STOP:-}" ]]; then sleep "$SLOW_STOP"; fi
    if [[ -n "\${FAIL_STOP:-}" ]]; then exit 1; fi
    for unit in "$@"; do
      grep -vx "$unit" "$ACTIVE_FILE" > "$ACTIVE_FILE.tmp" || true
      mv "$ACTIVE_FILE.tmp" "$ACTIVE_FILE"
    done
    ;;
  start)
    if [[ -n "\${FAIL_START:-}" ]]; then exit 1; fi
    for unit in "$@"; do
      if ! grep -qx "$unit" "$ACTIVE_FILE"; then printf '%s\\n' "$unit" >> "$ACTIVE_FILE"; fi
    done
    ;;
  *)
    exit 1
    ;;
esac
`);
  await writeFile(pgDump, `#!/bin/bash
printf '%s\\n' "$*" >> "$DUMP_LOG"
out=""
args=("$@")
i=0
while (( i < \${#args[@]} )); do
  if [[ "\${args[$i]}" == "-f" ]]; then out=\${args[$((i + 1))]}; fi
  i=$((i + 1))
done
if [[ -z "$out" ]]; then
  echo "pg_dump (fake) 16"
  exit 0
fi
if [[ -n "\${FAIL_DUMP:-}" ]]; then exit 1; fi
if [[ -n "\${EMPTY_DUMP:-}" ]]; then exit 0; fi
printf 'PGDMP-fake\\n' > "$out"
`);
  await writeFile(pgRestore, `#!/bin/bash
if [[ "\${FAIL_RESTORE:-}" == 1 ]]; then exit 1; fi
[[ "\${1:-}" == "--list" && -f "\${2:-}" ]] || exit 1
head -c 5 "\${2}" | grep -q PGDMP
`);
  await chmod(systemctl, 0o755);
  await chmod(pgDump, 0o755);
  await chmod(pgRestore, 0o755);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FC_BACKUP_DIR: backup,
    FC_WORLD_ROOT: worlds,
    FC_PLUGIN_DIR: plugins,
    FC_ENV_DIR: envDir,
    FC_OPT_ROOT: join(root, 'opt'),
    FC_SYSTEMCTL: systemctl,
    FC_PG_DUMP: pgDump,
    FC_PG_RESTORE: pgRestore,
    FC_KEEP: '3',
    FC_BACKUP_STAMP: '2026-10-13_040000',
    FC_RELEASE_ID: '4440e11',
    SYSTEMCTL_LOG: syslog,
    ACTIVE_FILE: active,
    DUMP_LOG: dumpLog,
    SLOW_STOP: '',
    FAIL_STOP: '',
    FAIL_START: '',
    FAIL_DUMP: '',
    EMPTY_DUMP: '',
    FAIL_RESTORE: '',
  };
  delete env.FC_DATABASE_URL;
  delete env.PGPASSWORD;
  return { root, worlds, backup, plugins, envDir, active, syslog, dumpLog, production, env };
}

async function archives(dir: string): Promise<string[]> {
  const names = await readdir(dir);
  const regular: string[] = [];
  for (const name of names) {
    if (!/^frontier-cubes-\d{4}-\d{2}-\d{2}_\d{6}\.tar\.gz$/.test(name)) continue;
    if ((await lstat(join(dir, name))).isSymbolicLink()) continue;
    regular.push(name);
  }
  return regular.sort();
}

async function listing(archive: string): Promise<string[]> {
  const result = await run('tar', ['-tzf', archive], process.env);
  expect(result.code).toBe(0);
  return result.out.split('\n').map((line) => line.replace(/^\.\//, '')).filter(Boolean);
}

describe.skipIf(!bashAvailable || process.platform === 'win32')('stage 6 backup', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('B1 B2 includes all three worlds and plugin-data', async () => {
    const box = await layout();
    const result = await run('bash', [SCRIPT, 'backup'], box.env);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain('backup: success');
    const names = await archives(box.backup);
    expect(names).toEqual(['frontier-cubes-2026-10-13_040000.tar.gz']);
    const files = await listing(join(box.backup, names[0]!));
    for (const world of ['anarchy', 'survival', 'peaceful']) {
      expect(files).toContain(`worlds/${world}/meta.json`);
      expect(files).toContain(`worlds/${world}/world.json`);
      expect(files).toContain(`worlds/${world}/players.json`);
      expect(files).toContain(`worlds/${world}/plugin-data/claims.json`);
      expect(files).toContain(`worlds/${world}/plugin-data/homes.json`);
      expect(files).toContain(`worlds/${world}/plugin-data/auctions.json`);
      expect(files).not.toContain(`worlds/${world}/.instance.lock`);
    }
    expect(files.some((file) => file.endsWith('.env'))).toBe(false);
  });

  it('B3 includes a shared custom plugin directory when it has files', async () => {
    const box = await layout();
    await writeFile(join(box.plugins, 'example.js'), 'plugin\n');
    const result = await run('bash', [SCRIPT, 'backup'], box.env);
    expect(result.code, result.err).toBe(0);
    const [name] = await archives(box.backup);
    const files = await listing(join(box.backup, name!));
    expect(files).toContain('plugins/example.js');
  });

  it('B4 includes one PostgreSQL dump when every mode shares a database', async () => {
    const box = await layout({
      databaseUrl: `postgresql://backupuser:${SECRET}@127.0.0.1:5432/fc_backup_unit`,
    });
    const result = await run('bash', [SCRIPT, 'backup'], box.env);
    expect(result.code, result.err).toBe(0);
    const [name] = await archives(box.backup);
    const files = await listing(join(box.backup, name!));
    expect(files).toContain('postgres/anarchy+survival+peaceful.dump');
    const dumpLog = await readFile(box.dumpLog, 'utf8');
    expect(dumpLog.split('\n').filter((line) => line.includes(' -f ')).length).toBe(1);
    expect(dumpLog).not.toContain(SECRET);
    expect(result.out + result.err).not.toContain(SECRET);
  });

  it('backs up each distinct database when the env files differ', async () => {
    const box = await layout();
    const shared = `postgresql://backupuser:${SECRET}@127.0.0.1:5432/fc_shared`;
    const other = `postgresql://backupuser:${SECRET}@127.0.0.1:5432/fc_peaceful`;
    for (const name of ['anarchy', 'survival']) {
      await writeFile(join(box.envDir, `${name}.env`), `FC_DEPLOYMENT_ID=dev\nFC_DATABASE_URL=${shared}\n`);
    }
    await writeFile(join(box.envDir, 'peaceful.env'), `FC_DEPLOYMENT_ID=dev\nFC_DATABASE_URL=${other}\n`);
    const result = await run('bash', [SCRIPT, 'backup'], box.env);
    expect(result.code, result.err).toBe(0);
    const [name] = await archives(box.backup);
    const files = await listing(join(box.backup, name!));
    expect(files).toContain('postgres/anarchy+survival.dump');
    expect(files).toContain('postgres/peaceful.dump');
    expect(result.out + result.err).not.toContain(SECRET);
  });

  it('B5 a configured database with no dump does not publish an archive', async () => {
    const box = await layout({
      databaseUrl: `postgresql://backupuser:${SECRET}@127.0.0.1:5432/fc_backup_unit`,
    });
    box.env.EMPTY_DUMP = '1';
    const result = await run('bash', [SCRIPT, 'backup'], box.env);
    expect(result.code).not.toBe(0);
    expect(result.err).toContain('backup: failed');
    expect(await archives(box.backup)).toEqual([]);
  });

  it('B6 B7 a failed run publishes nothing and keeps older archives', async () => {
    const box = await layout();
    await rm(join(box.worlds, 'peaceful'), { recursive: true });
    const older = join(box.backup, 'frontier-cubes-2020-01-01_000001.tar.gz');
    await writeFile(older, 'previous\n');
    await writeFile(`${older}.sha256`, 'previous\n');
    const result = await run('bash', [SCRIPT, 'backup'], box.env);
    expect(result.code).not.toBe(0);
    expect(result.err).toContain('backup: failed');
    expect(await archives(box.backup)).toEqual(['frontier-cubes-2020-01-01_000001.tar.gz']);
    expect(await readFile(older, 'utf8')).toBe('previous\n');
    const leftovers = (await readdir(box.backup)).filter((name) => name.startsWith('.partial') || name.startsWith('.work'));
    expect(leftovers).toEqual([]);
  });

  it('B8 B9 B10 retention keeps three archives and stays inside the backup directory', async () => {
    const box = await layout();
    await writeFile(join(box.plugins, 'example.js'), 'plugin\n');
    const worldSentinel = join(box.worlds, 'anarchy/world.json');
    const before = await readFile(worldSentinel, 'utf8');
    const outside = join(box.root, 'outside-target.txt');
    await writeFile(outside, 'outside\n');
    await symlink(outside, join(box.backup, 'frontier-cubes-2019-01-01_000000.tar.gz'));
    await writeFile(join(box.backup, 'notes.txt'), 'keep\n');
    await writeFile(join(box.backup, 'frontier-cubes-not-a-date.tar.gz'), 'keep\n');
    await writeFile(join(box.worlds, 'anarchy/frontier-cubes-1999-01-01_000000.tar.gz'), 'world-file\n');
    for (const stamp of ['2020-01-01_000001', '2020-01-01_000002', '2020-01-01_000003', '2020-01-01_000004']) {
      const file = join(box.backup, `frontier-cubes-${stamp}.tar.gz`);
      await writeFile(file, `old ${stamp}\n`);
      await writeFile(`${file}.sha256`, `old ${stamp}\n`);
    }
    const result = await run('bash', [SCRIPT, 'backup'], box.env);
    expect(result.code, result.err).toBe(0);
    expect(await archives(box.backup)).toEqual([
      'frontier-cubes-2020-01-01_000003.tar.gz',
      'frontier-cubes-2020-01-01_000004.tar.gz',
      'frontier-cubes-2026-10-13_040000.tar.gz',
    ]);
    await expect(stat(join(box.backup, 'frontier-cubes-2020-01-01_000001.tar.gz'))).rejects.toThrow();
    await expect(stat(join(box.backup, 'frontier-cubes-2020-01-01_000001.tar.gz.sha256'))).rejects.toThrow();
    expect(await readFile(join(box.backup, 'notes.txt'), 'utf8')).toBe('keep\n');
    expect(await readFile(join(box.backup, 'frontier-cubes-not-a-date.tar.gz'), 'utf8')).toBe('keep\n');
    expect(await readFile(outside, 'utf8')).toBe('outside\n');
    expect((await lstat(join(box.backup, 'frontier-cubes-2019-01-01_000000.tar.gz'))).isSymbolicLink()).toBe(true);
    expect(await readFile(worldSentinel, 'utf8')).toBe(before);
    expect(await readFile(join(box.worlds, 'anarchy/frontier-cubes-1999-01-01_000000.tar.gz'), 'utf8')).toBe('world-file\n');
    expect(await readFile(join(box.production, 'sentinel.txt'), 'utf8')).toBe('do-not-touch\n');
  });

  it('B11 a second invocation does not run while the lock is held', async () => {
    const box = await layout();
    const started = join(box.root, 'stop-started');
    box.env.SLOW_STOP = '2';
    box.env.STOP_STARTED = started;
    const first = run('bash', [SCRIPT, 'backup'], box.env);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        await stat(started);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    const second = await run('bash', [SCRIPT, 'backup'], box.env);
    const finished = await first;
    expect(second.code).not.toBe(0);
    expect(second.err).toContain('another backup is already running');
    expect(finished.code, finished.err).toBe(0);
    expect(await archives(box.backup)).toHaveLength(1);
  }, 20_000);

  it('B12 a failed pg_dump still restarts the services that were running', async () => {
    const box = await layout({
      databaseUrl: `postgresql://backupuser:${SECRET}@127.0.0.1:5432/fc_backup_unit`,
    });
    box.env.FAIL_DUMP = '1';
    const result = await run('bash', [SCRIPT, 'backup'], box.env);
    expect(result.code).not.toBe(0);
    expect(result.err).toContain('pg_dump failed');
    expect(await archives(box.backup)).toEqual([]);
    const log = await readFile(box.syslog, 'utf8');
    expect(log).toContain('stop frontier-cubes-anarchy.service frontier-cubes-survival.service');
    expect(log).toContain('start frontier-cubes-anarchy.service frontier-cubes-survival.service');
    expect(log).not.toContain('start frontier-cubes-peaceful.service');
    const active = await readFile(box.active, 'utf8');
    expect(active).toContain('frontier-cubes-anarchy.service');
    expect(active).toContain('frontier-cubes-survival.service');
    expect(active).not.toContain('frontier-cubes-peaceful.service');
  });

  it('B13 a failed graceful stop does not copy or publish', async () => {
    const box = await layout();
    const before = await readFile(join(box.worlds, 'anarchy/players.json'), 'utf8');
    box.env.FAIL_STOP = '1';
    const result = await run('bash', [SCRIPT, 'backup'], box.env);
    expect(result.code).not.toBe(0);
    expect(result.err).toContain('graceful stop failed');
    expect(await archives(box.backup)).toEqual([]);
    expect(await readFile(join(box.worlds, 'anarchy/players.json'), 'utf8')).toBe(before);
    const log = await readFile(box.syslog, 'utf8');
    expect(log).toContain('stop ');
    expect(log).toContain('start frontier-cubes-anarchy.service frontier-cubes-survival.service');
  });

  it('B14 does not start a service that was already stopped', async () => {
    const box = await layout();
    const result = await run('bash', [SCRIPT, 'backup'], box.env);
    expect(result.code, result.err).toBe(0);
    const active = await readFile(box.active, 'utf8');
    expect(active).toContain('frontier-cubes-anarchy.service');
    expect(active).toContain('frontier-cubes-survival.service');
    expect(active).not.toContain('frontier-cubes-peaceful.service');
    expect(result.out).toContain('service: frontier-cubes-peaceful.service inactive');
  });

  it('B15 manifest exists and does not contain secrets', async () => {
    const box = await layout({
      databaseUrl: `postgresql://backupuser:${SECRET}@127.0.0.1:5432/fc_backup_unit`,
    });
    const result = await run('bash', [SCRIPT, 'backup'], box.env);
    expect(result.code, result.err).toBe(0);
    const [name] = await archives(box.backup);
    const archive = join(box.backup, name!);
    const manifestText = (await run('tar', ['-xOf', archive, 'manifest.json'], process.env)).out;
    const manifest = JSON.parse(manifestText) as {
      formatVersion: number;
      deploymentId: string;
      releaseId: string;
      worlds: string[];
      postgresql: { included: boolean; format: string; dumps: string[] };
      status: string;
    };
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.deploymentId).toBe('dev');
    expect(manifest.releaseId).toBe('4440e11');
    expect(manifest.worlds).toEqual(['anarchy', 'survival', 'peaceful']);
    expect(manifest.postgresql.included).toBe(true);
    expect(manifest.postgresql.format).toBe('custom');
    expect(manifest.status).toBe('complete');
    const combined = `${manifestText}\n${result.out}\n${result.err}`;
    expect(combined).not.toContain(SECRET);
    expect(combined).not.toContain(ADMIN_HASH);
    expect(combined).not.toContain(SESSION);
    expect(combined).not.toContain('postgresql://');
    const players = (await run('tar', ['-xOf', archive, 'worlds/anarchy/players.json'], process.env)).out;
    expect(players).toContain(SESSION);
  });

  it('B16 B17 checksum verification accepts the archive and rejects corruption', async () => {
    const box = await layout();
    const created = await run('bash', [SCRIPT, 'backup'], box.env);
    expect(created.code, created.err).toBe(0);
    const [name] = await archives(box.backup);
    const archive = join(box.backup, name!);
    const verified = await run('bash', [SCRIPT, 'verify', archive], box.env);
    expect(verified.code, verified.err).toBe(0);
    expect(verified.out).toContain('verify: ok');
    const sidecar = await readFile(`${archive}.sha256`, 'utf8');
    const expected = sidecar.split(/\s+/)[0];
    const actual = createHash('sha256').update(await readFile(archive)).digest('hex');
    expect(actual).toBe(expected);
    const bytes = await readFile(archive);
    bytes[20] = bytes[20]! ^ 0xff;
    await writeFile(archive, bytes);
    const corrupt = await run('bash', [SCRIPT, 'verify', archive], box.env);
    expect(corrupt.code).not.toBe(0);
    expect(corrupt.err).toContain('verify: failed');
  });

  it('B18 extracting into a temporary directory leaves the source worlds untouched', async () => {
    const box = await layout();
    const source = await readFile(join(box.worlds, 'survival/players.json'), 'utf8');
    const created = await run('bash', [SCRIPT, 'backup'], box.env);
    expect(created.code, created.err).toBe(0);
    const [name] = await archives(box.backup);
    const restored = join(box.root, 'restored');
    await mkdir(restored);
    const extracted = await run('tar', ['-xzf', join(box.backup, name!), '-C', restored], process.env);
    expect(extracted.code).toBe(0);
    const loaded = await new WorldPersistence(join(restored, 'worlds/survival')).loadRecords();
    expect(loaded?.meta.worldId).toBe('survival');
    expect(loaded?.players.players[PLAYER]?.name).toBe('Tester');
    await writeFile(join(restored, 'worlds/survival/players.json'), '{"players":{}}\n');
    expect(await readFile(join(box.worlds, 'survival/players.json'), 'utf8')).toBe(source);
    expect(await readFile(join(box.production, 'sentinel.txt'), 'utf8')).toBe('do-not-touch\n');
    const archiveStat = await stat(join(box.backup, name!));
    expect(archiveStat.mode & 0o007).toBe(0);
    const dirStat = await stat(box.backup);
    expect(dirStat.mode & 0o007).toBe(0);
  });

  it('B19 installs and runs from a stable sbin path', async () => {
    const box = await layout();
    const sbin = join(box.root, 'sbin');
    await mkdir(sbin);
    const installed = join(sbin, 'fc-backup');
    await copyFile(SCRIPT, installed);
    await chmod(installed, 0o750);
    const result = await run(installed, ['backup'], box.env);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain('backup: success');
    const staged = join(box.root, 'download');
    await mkdir(staged, { mode: 0o750 });
    const [name] = await archives(box.backup);
    const download = await run(installed, ['stage-download', join(box.backup, name!), staged], box.env);
    expect(download.code, download.err).toBe(0);
    expect(await readFile(join(staged, name!), 'utf8')).toBe(await readFile(join(box.backup, name!), 'utf8'));
    expect(await readFile(join(staged, `${name}.sha256`), 'utf8')).toContain(name);
  });

  it('refuses mixed deployment ids before stopping services', async () => {
    const box = await layout({
      databaseUrl: `postgresql://backupuser:${SECRET}@127.0.0.1:5432/fc_backup_unit`,
    });
    await writeFile(join(box.envDir, 'peaceful.env'), `FC_DEPLOYMENT_ID=other\nFC_DATABASE_URL=postgresql://backupuser:${SECRET}@127.0.0.1:5432/fc_backup_unit\n`);
    const result = await run('bash', [SCRIPT, 'backup'], box.env);
    expect(result.code).not.toBe(0);
    expect(result.err).toContain('FC_DEPLOYMENT_ID differs');
    expect(await readFile(box.syslog, 'utf8')).toBe('');
    expect(await archives(box.backup)).toEqual([]);
  });
});
