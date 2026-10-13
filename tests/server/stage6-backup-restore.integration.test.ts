import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresDatabase } from '../../server/db/database';
import { WorldPersistence } from '../../server/persistence';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SCRIPT = join(ROOT, 'scripts/fc-backup.sh');
const databaseUrl = process.env.FC_TEST_DATABASE_URL?.trim() ?? '';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const BANNED = '22222222-2222-4222-8222-222222222222';

function assertSafeTestUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('FC_TEST_DATABASE_URL is not a valid URL');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('FC_TEST_DATABASE_URL must use the postgres or postgresql scheme');
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (name === '' || /prod/i.test(name) || name === 'template0' || name === 'template1') {
    throw new Error('refusing FC_TEST_DATABASE_URL database name');
  }
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('invalid database name');
  return `"${name}"`;
}

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function redact(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://redacted'));
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

async function commandPath(name: string): Promise<string> {
  const result = await run('bash', ['-c', `command -v ${name}`], process.env);
  return result.code === 0 ? result.out.trim() : '';
}

describe.skipIf(databaseUrl === '')('stage 6 restore rehearsal', () => {
  const created: string[] = [];
  let admin: pg.Client | undefined;
  let directory = '';

  afterAll(async () => {
    if (admin) {
      for (const name of created) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`).catch(() => undefined);
      }
      await admin.end().catch(() => undefined);
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  }, 30_000);

  it('restores worlds and PostgreSQL into disposable locations', async (ctx) => {
    assertSafeTestUrl(databaseUrl);
    const pgDump = await commandPath('pg_dump');
    const pgRestore = await commandPath('pg_restore');
    if (!pgDump || !pgRestore) {
      ctx.skip();
      return;
    }
    admin = new pg.Client({ connectionString: databaseUrl });
    try {
      await admin.connect();
    } catch (error) {
      throw redact(error);
    }
    const suffix = randomBytes(4).toString('hex');
    const sourceName = `fc_bk_src_${suffix}`;
    const targetName = `fc_bk_dst_${suffix}`;
    try {
      await admin.query(`CREATE DATABASE ${quoteIdent(sourceName)}`);
      created.push(sourceName);
      await admin.query(`CREATE DATABASE ${quoteIdent(targetName)}`);
      created.push(targetName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/permission denied|must be superuser|createdb/i.test(message)) {
        ctx.skip();
        return;
      }
      throw redact(error);
    }
    const sourceUrl = withDatabase(databaseUrl, sourceName);
    const source = new PostgresDatabase({ url: sourceUrl, deploymentId: 'dev', poolMax: 2 });
    await source.start();
    const operationId = randomUUID();
    const entryId = randomUUID();
    const eventId = randomUUID();
    const requestId = randomUUID();
    await source.query(
      `INSERT INTO economy_accounts (deployment_id, economy_scope, player_id, balance, display_name)
       VALUES ('dev', 'anarchy', $1, 40, 'Tester')`,
      [PLAYER],
    );
    await source.query(
      `INSERT INTO economy_operations (deployment_id, economy_scope, operation_id, kind, actor_id)
       VALUES ('dev', 'anarchy', $1, 'ADJUSTMENT', 'admin-owner')`,
      [operationId],
    );
    await source.query(
      `INSERT INTO economy_ledger (
         entry_id, deployment_id, economy_scope, operation_id, leg_index, player_id,
         delta, balance_before, balance_after, reason
       ) VALUES ($1, 'dev', 'anarchy', $2, 0, $3, 40, 0, 40, 'ADMIN_SET')`,
      [entryId, operationId, PLAYER],
    );
    await source.query(
      `INSERT INTO admin_audit_log (
         event_id, deployment_id, request_id, admin_id, action, target_type, target_id, reason, success
       ) VALUES ($1, 'dev', $2, 'admin-owner', 'balance', 'player', $3, 'stage6 rehearsal', true)`,
      [eventId, requestId, PLAYER],
    );
    await source.query(
      `INSERT INTO idempotency_requests (
         deployment_id, request_scope, request_id, operation, actor_id, payload_hash, state, committed_at
       ) VALUES ('dev', 'global', $1, 'admin.balance', 'admin-owner', $2, 'committed', NOW())`,
      [requestId, 'ab'.repeat(32)],
    );
    await source.query(
      `INSERT INTO admin_player_bans (deployment_id, world_id, player_id, banned, reason, admin_id)
       VALUES ('dev', 'anarchy', $1, true, 'stage6 ban', 'admin-owner')`,
      [BANNED],
    );
    await source.close();

    directory = await mkdtemp(join(tmpdir(), 'fc-restore-'));
    const worlds = join(directory, 'worlds');
    const backup = join(directory, 'backups');
    const envDir = join(directory, 'env');
    const plugins = join(directory, 'plugins');
    const bin = join(directory, 'bin');
    await mkdir(worlds, { recursive: true });
    await mkdir(backup, { recursive: true });
    await mkdir(plugins, { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(envDir, { recursive: true });
    await writeFile(join(plugins, 'example.js'), 'plugin\n');
    for (const id of ['anarchy', 'survival', 'peaceful']) {
      const dir = join(worlds, id);
      await mkdir(join(dir, 'plugin-data'), { recursive: true });
      await writeFile(join(dir, 'meta.json'), `${JSON.stringify({
        worldId: id,
        seed: 'stage6',
        spawn: [0, 64, 0],
        createdAt: 1,
        updatedAt: 1,
      })}\n`);
      await writeFile(join(dir, 'world.json'), '{"timeOfDay":1000,"chests":{},"furnaces":{},"mobs":[]}\n');
      await writeFile(join(dir, 'players.json'), `${JSON.stringify({
        players: { [PLAYER]: { name: 'Tester', inventory: [{ id: 'diamond', count: 3 }] } },
      })}\n`);
      await writeFile(join(dir, 'plugin-data/claims.json'), '{"claims":[{"owner":"p1"}]}\n');
    }
    const sourcePlayers = await readFile(join(worlds, 'anarchy/players.json'), 'utf8');
    for (const name of ['anarchy', 'survival', 'peaceful']) {
      await writeFile(
        join(envDir, `${name}.env`),
        `FC_DEPLOYMENT_ID=dev\nFC_DATABASE_URL=${sourceUrl}\n`,
        { mode: 0o600 },
      );
    }
    const systemctl = join(bin, 'systemctl');
    const active = join(directory, 'active');
    await writeFile(active, '');
    await writeFile(systemctl, `#!/bin/bash
printf '%s\\n' "$*" >> "$SYSTEMCTL_LOG"
cmd=$1
shift || true
case "$cmd" in
  is-active) echo inactive; exit 3 ;;
  stop|start) exit 0 ;;
  *) exit 1 ;;
esac
`);
    await chmod(systemctl, 0o755);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FC_BACKUP_DIR: backup,
      FC_WORLD_ROOT: worlds,
      FC_PLUGIN_DIR: plugins,
      FC_ENV_DIR: envDir,
      FC_OPT_ROOT: join(directory, 'opt'),
      FC_SYSTEMCTL: systemctl,
      FC_PG_DUMP: pgDump,
      FC_PG_RESTORE: pgRestore,
      FC_KEEP: '3',
      FC_BACKUP_STAMP: '2026-10-13_041500',
      FC_RELEASE_ID: 'stage6-restore',
      FC_DEPLOYMENT_ID: '',
      SYSTEMCTL_LOG: join(directory, 'systemctl.log'),
      ACTIVE_FILE: active,
    };
    delete env.PGPASSWORD;
    const createdBackup = await run('bash', [SCRIPT, 'backup'], env);
    expect(createdBackup.code, createdBackup.err.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://redacted')).toBe(0);
    expect(createdBackup.out + createdBackup.err).not.toContain(new URL(sourceUrl).password);

    const archive = join(backup, 'frontier-cubes-2026-10-13_041500.tar.gz');
    const verified = await run('bash', [SCRIPT, 'verify', archive], env);
    expect(verified.code, verified.err).toBe(0);
    const restored = join(directory, 'restored');
    await mkdir(restored);
    const extracted = await run('tar', ['-xzf', archive, '-C', restored], process.env);
    expect(extracted.code).toBe(0);
    const loaded = await new WorldPersistence(join(restored, 'worlds/anarchy')).loadRecords();
    expect(loaded?.meta.worldId).toBe('anarchy');
    expect(loaded?.players.players[PLAYER]?.name).toBe('Tester');
    expect(await readFile(join(restored, 'worlds/anarchy/plugin-data/claims.json'), 'utf8')).toContain('p1');
    expect(await readFile(join(restored, 'plugins/example.js'), 'utf8')).toBe('plugin\n');
    expect(await readFile(join(worlds, 'anarchy/players.json'), 'utf8')).toBe(sourcePlayers);

    const targetUrl = withDatabase(databaseUrl, targetName);
    const target = new URL(targetUrl);
    const password = decodeURIComponent(target.password);
    const escapePgpass = (value: string): string => value.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
    const pgpass = join(directory, 'pgpass');
    await writeFile(
      pgpass,
      `${escapePgpass(target.hostname)}:${escapePgpass(target.port || '5432')}:${escapePgpass(targetName)}:${escapePgpass(decodeURIComponent(target.username))}:${escapePgpass(password)}\n`,
      { mode: 0o600 },
    );
    const dump = join(restored, 'postgres/anarchy+survival+peaceful.dump');
    const restoreEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PGHOST: target.hostname,
      PGPORT: target.port || '5432',
      PGUSER: decodeURIComponent(target.username),
      PGDATABASE: targetName,
      PGPASSFILE: pgpass,
    };
    delete restoreEnv.PGPASSWORD;
    const restoredDump = await run(pgRestore, [
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      '-d', targetName,
      dump,
    ], restoreEnv);
    expect(restoredDump.code, restoredDump.err.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://redacted')).toBe(0);

    const check = new pg.Client({ connectionString: targetUrl });
    await check.connect();
    try {
      const migrations = await check.query<{ n: string }>('SELECT count(*)::text AS n FROM schema_migrations');
      expect(migrations.rows[0]?.n).toBe('7');
      const ledger = await check.query<{ balance_after: string; reason: string }>(
        `SELECT balance_after::text, reason FROM economy_ledger WHERE player_id = $1`,
        [PLAYER],
      );
      expect(ledger.rows[0]).toMatchObject({ balance_after: '40', reason: 'ADMIN_SET' });
      const audit = await check.query<{ action: string }>(
        `SELECT action FROM admin_audit_log WHERE target_id = $1`,
        [PLAYER],
      );
      expect(audit.rows[0]?.action).toBe('balance');
      const idempotency = await check.query<{ state: string }>(
        `SELECT state FROM idempotency_requests WHERE request_id = $1`,
        [requestId],
      );
      expect(idempotency.rows[0]?.state).toBe('committed');
      const ban = await check.query<{ banned: boolean; reason: string }>(
        `SELECT banned, reason FROM admin_player_bans WHERE player_id = $1`,
        [BANNED],
      );
      expect(ban.rows[0]).toMatchObject({ banned: true, reason: 'stage6 ban' });
    } finally {
      await check.end();
    }
  }, 60_000);
});
