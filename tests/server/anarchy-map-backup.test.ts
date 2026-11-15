import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SCRIPT = join(ROOT, 'scripts/fc-backup-anarchy-map.sh');
const SECRET = 'postgres-secret-should-not-leak';
const SESSION = 'session-secret-token';
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

async function layout(options?: { failExport?: boolean; anarchyDown?: boolean; dropSurvival?: boolean }): Promise<{
  root: string;
  worlds: string;
  backup: string;
  env: NodeJS.ProcessEnv;
}> {
  const root = await mkdtemp(join(tmpdir(), 'fc-anarchy-map-'));
  roots.push(root);
  const worlds = join(root, 'worlds');
  const backup = join(root, 'backups');
  const envDir = join(root, 'env');
  const bin = join(root, 'bin');
  const active = join(root, 'active');
  const syslog = join(root, 'systemctl.log');
  await mkdir(backup, { recursive: true });
  await mkdir(bin, { recursive: true });
  await mkdir(envDir, { recursive: true });
  for (const id of ['anarchy', 'survival', 'peaceful']) {
    const dir = join(worlds, id);
    await mkdir(join(dir, 'plugin-data', 'config'), { recursive: true });
    await mkdir(join(dir, 'plugin-data', 'claims'), { recursive: true });
    await mkdir(join(dir, 'plugin-data', 'economy'), { recursive: true });
    await writeFile(join(dir, 'meta.json'), `${JSON.stringify({
      worldId: id, seed: 'anarchy-spawn-v1', worldgenVersion: 3, spawn: [53.5, 68, 70.5],
    })}\n`);
    await writeFile(join(dir, 'world.json'), `${JSON.stringify({
      modifications: { '0,0': { '1': 3 }, '400,-12': { '9': 1 } },
      chests: { '8,70,8': { slots: [] } },
    })}\n`);
    await writeFile(join(dir, 'players.json'), `${JSON.stringify({
      players: { ada: { sessionToken: SESSION, inventory: [{ id: 'diamond' }] } },
    })}\n`);
    await writeFile(join(dir, 'plugin-data', 'claims', 'claims.json'), `${JSON.stringify({
      claims: [
        {
          id: 'hub', name: 'Главный спавн', worldId: id, priority: 0,
          volume: { minX: 40, minY: 60, minZ: 60, maxX: 80, maxY: 90, maxZ: 90 },
          flags: { pvp: false },
        },
        {
          id: 'pit', name: 'бойцовская', worldId: id, priority: 10,
          volume: { minX: 10, minY: 60, minZ: 10, maxX: 20, maxY: 80, maxZ: 20 },
          flags: { pvp: true },
        },
      ],
    })}\n`);
    await writeFile(join(dir, 'plugin-data', 'economy', 'balances.json'), '{"balances":{"ada":99}}\n');
    await writeFile(join(dir, 'plugin-data', 'config', 'spawn.json'), '{"cooldownSeconds":5,"sessionToken":"secret-config"}\n');
    await writeFile(join(dir, 'plugin-data', 'config', 'auction.json'), `{"apiToken":"${SECRET}"}\n`);
    await writeFile(join(dir, 'only-this-world.txt'), `${id}-marker\n`);
  }
  const urls = {
    anarchy: `postgresql://anarchy:${SECRET}@127.0.0.1:5432/anarchy_db`,
    survival: `postgresql://survival:${SECRET}@127.0.0.1:5432/survival_db`,
    peaceful: `postgresql://peaceful:${SECRET}@127.0.0.1:5432/peaceful_db`,
  };
  for (const name of ['anarchy', 'survival', 'peaceful'] as const) {
    const port = name === 'anarchy' ? 18081 : name === 'survival' ? 18082 : 18083;
    await writeFile(join(envDir, `${name}.env`), [
      `SERVER_MODE=${name}`,
      `WORLD=${name}`,
      `PORT=${port}`,
      `WORLD_PATH=${worlds}`,
      `FC_DEPLOYMENT_ID=${name}-deployment`,
      `FC_DATABASE_URL=${urls[name]}`,
      '',
    ].join('\n'), { mode: 0o600 });
  }
  const activeUnits = ['frontier-cubes-survival.service', 'frontier-cubes-peaceful.service'];
  if (!options?.anarchyDown) activeUnits.unshift('frontier-cubes-anarchy.service');
  await writeFile(active, `${activeUnits.join('\n')}\n`);
  await writeFile(syslog, '');
  const systemctl = join(bin, 'systemctl');
  await writeFile(systemctl, `#!/bin/bash
set -u
printf '%s\\n' "$*" >> "$SYSTEMCTL_LOG"
cmd=$1
shift || true
case "$cmd" in
  is-active)
    if grep -qx "$1" "$ACTIVE_FILE"; then echo active; exit 0; fi
    echo inactive
    exit 3
    ;;
  stop)
    for unit in "$@"; do
      if [[ "$unit" != frontier-cubes-anarchy.service ]]; then
        echo "stopped-forbidden $unit" >> "$SYSTEMCTL_LOG"
        exit 1
      fi
      grep -vx "$unit" "$ACTIVE_FILE" > "$ACTIVE_FILE.tmp" || true
      mv "$ACTIVE_FILE.tmp" "$ACTIVE_FILE"
      if [[ "\${DROP_SURVIVAL:-}" == 1 ]]; then
        grep -vx frontier-cubes-survival.service "$ACTIVE_FILE" > "$ACTIVE_FILE.tmp" || true
        mv "$ACTIVE_FILE.tmp" "$ACTIVE_FILE"
      fi
    done
    ;;
  start)
    for unit in "$@"; do
      if [[ "$unit" != frontier-cubes-anarchy.service ]]; then
        echo "started-forbidden $unit" >> "$SYSTEMCTL_LOG"
        exit 1
      fi
      if ! grep -qx "$unit" "$ACTIVE_FILE"; then printf '%s\\n' "$unit" >> "$ACTIVE_FILE"; fi
    done
    ;;
  *)
    exit 1
    ;;
esac
`);
  await chmod(systemctl, 0o755);
  const nodeWrapper = join(bin, 'node-wrapper');
  await writeFile(nodeWrapper, `#!/bin/bash
if [[ "\${FAIL_EXPORT:-}" == 1 && "$*" == *export-map.mjs* ]]; then
  exit 1
fi
exec ${JSON.stringify(process.execPath)} "$@"
`);
  await chmod(nodeWrapper, 0o755);
  const status = join(bin, 'status.mjs');
  await writeFile(status, `import { createServer } from 'node:http';
const server = createServer((req, res) => {
  if (req.url !== '/status') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ name: 'Anarchy', world: 'anarchy', mode: 'anarchy', ready: true, online: 0, maxPlayers: 4, tickRate: 20 }));
});
server.listen(18081, '127.0.0.1');
`);
  const statusChild = spawn(process.execPath, [status], { stdio: 'ignore' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  roots.push(`pid:${statusChild.pid}`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FC_BACKUP_DIR: backup,
    FC_ENV_FILE: join(envDir, 'anarchy.env'),
    FC_SYSTEMCTL: systemctl,
    FC_NODE: nodeWrapper,
    FC_STATUS_HOST: '127.0.0.1',
    FC_HEALTH_TIMEOUT: '5',
    FC_HEALTH_INTERVAL: '0',
    SYSTEMCTL_LOG: syslog,
    ACTIVE_FILE: active,
    FAIL_EXPORT: options?.failExport ? '1' : '',
    DROP_SURVIVAL: options?.dropSurvival ? '1' : '',
  };
  return { root, worlds, backup, env };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (entry) => {
    if (entry.startsWith('pid:')) {
      const pid = Number(entry.slice(4));
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
      return;
    }
    await rm(entry, { recursive: true, force: true });
  }));
});

describe('anarchy map backup', () => {
  it('stops only Anarchy and archives the map without players, economy, or database secrets', async () => {
    const box = await layout();
    const survivalBefore = await readFile(join(box.worlds, 'survival', 'only-this-world.txt'), 'utf8');
    const peacefulBefore = await readFile(join(box.worlds, 'peaceful', 'players.json'), 'utf8');
    const result = await run('bash', [SCRIPT], box.env);
    expect(result.code, `${result.out}\n${result.err}`).toBe(0);
    expect(result.out).toContain('backup: success');
    expect(result.out).toContain('players: empty');
    expect(result.out).toContain('postgres: not included');
    expect(`${result.out}\n${result.err}`).not.toContain(SECRET);
    expect(`${result.out}\n${result.err}`).not.toContain(SESSION);
    const log = await readFile(join(box.root, 'systemctl.log'), 'utf8');
    expect(log).toContain('stop frontier-cubes-anarchy.service');
    expect(log).toContain('start frontier-cubes-anarchy.service');
    expect(log).not.toContain('frontier-cubes-survival.service stop');
    expect(log).not.toContain('stop frontier-cubes-survival');
    expect(log).not.toContain('stop frontier-cubes-peaceful');
    expect(log).not.toContain('forbidden');
    expect(await readFile(join(box.worlds, 'survival', 'only-this-world.txt'), 'utf8')).toBe(survivalBefore);
    expect(await readFile(join(box.worlds, 'peaceful', 'players.json'), 'utf8')).toBe(peacefulBefore);
    const archiveLine = result.out.split('\n').find((line) => line.startsWith('archive: '));
    const archive = archiveLine?.slice('archive: '.length) ?? '';
    const verified = await run('bash', [SCRIPT, 'verify', archive], box.env);
    expect(verified.code, verified.err).toBe(0);
    const extracted = join(box.root, 'extracted');
    await mkdir(extracted);
    const unpack = await run('tar', ['-xzf', archive, '-C', extracted], box.env);
    expect(unpack.code).toBe(0);
    const world = JSON.parse(await readFile(join(extracted, 'worlds/anarchy/world.json'), 'utf8'));
    expect(world.modifications['400,-12']['9']).toBe(1);
    const players = JSON.parse(await readFile(join(extracted, 'worlds/anarchy/players.json'), 'utf8'));
    expect(players).toEqual({ players: {} });
    const claims = JSON.parse(await readFile(join(extracted, 'worlds/anarchy/plugin-data/claims/claims.json'), 'utf8'));
    expect(claims.claims.find((claim: { flags?: { pvp?: boolean } }) => claim.flags?.pvp === true)?.name).toBe('бойцовская');
    const spawnConfig = JSON.parse(await readFile(join(extracted, 'worlds/anarchy/plugin-data/config/spawn.json'), 'utf8'));
    expect(spawnConfig).toEqual({ cooldownSeconds: 5 });
    await expect(readFile(join(extracted, 'worlds/anarchy/plugin-data/economy/balances.json'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(extracted, 'worlds/anarchy/plugin-data/config/auction.json'), 'utf8')).rejects.toThrow();
    const packed = await readFile(archive);
    expect(packed.includes(Buffer.from(SESSION))).toBe(false);
    expect(packed.includes(Buffer.from(SECRET))).toBe(false);
    const listing = await run('tar', ['-tzf', archive], box.env);
    expect(listing.out).not.toContain('worlds/survival');
    expect(listing.out).not.toContain('worlds/peaceful');
    expect(listing.out).not.toContain('postgres');
    expect(listing.out).not.toContain('players.json.bak');
  });

  it('does not start Anarchy when it was already stopped', async () => {
    const box = await layout({ anarchyDown: true });
    const result = await run('bash', [SCRIPT], box.env);
    expect(result.code, `${result.out}\n${result.err}`).toBe(0);
    const log = await readFile(join(box.root, 'systemctl.log'), 'utf8');
    expect(log).not.toContain('stop ');
    expect(log).not.toContain('start ');
    const active = await readFile(join(box.root, 'active'), 'utf8');
    expect(active).not.toContain('frontier-cubes-anarchy.service');
    expect(active).toContain('frontier-cubes-survival.service');
    expect(active).toContain('frontier-cubes-peaceful.service');
  });

  it('keeps the archive and restarts Anarchy if Survival changes state', async () => {
    const box = await layout({ dropSurvival: true });
    const result = await run('bash', [SCRIPT], box.env);
    expect(result.code).not.toBe(0);
    expect(`${result.out}\n${result.err}`).toContain('backup: prepared');
    const active = await readFile(join(box.root, 'active'), 'utf8');
    expect(active).toContain('frontier-cubes-anarchy.service');
    const log = await readFile(join(box.root, 'systemctl.log'), 'utf8');
    expect(log).toContain('start frontier-cubes-anarchy.service');
    expect(log).not.toContain('stop frontier-cubes-survival');
    expect(log).not.toContain('stop frontier-cubes-peaceful');
  });

  it('never names Survival or Peaceful in a stop or start command', async () => {
    const source = await readFile(SCRIPT, 'utf8');
    expect(source).not.toMatch(/systemctl[^\\n]*stop[^\\n]*survival/i);
    expect(source).not.toMatch(/systemctl[^\\n]*stop[^\\n]*peaceful/i);
    expect(source).not.toMatch(/"\$FC_SYSTEMCTL" stop "\$SURVIVAL_UNIT"/);
    expect(source).not.toMatch(/"\$FC_SYSTEMCTL" stop "\$PEACEFUL_UNIT"/);
    expect(source).not.toMatch(/"\$FC_SYSTEMCTL" start "\$SURVIVAL_UNIT"/);
    expect(source).not.toMatch(/"\$FC_SYSTEMCTL" start "\$PEACEFUL_UNIT"/);
    expect(source).not.toContain('pg_dump');
    expect(source).not.toMatch(/read_env_value "\$FC_ENV_FILE" FC_DATABASE_URL/);
  });

  it('starts Anarchy again when map export fails and does not stop the other modes', async () => {
    const box = await layout({ failExport: true });
    const result = await run('bash', [SCRIPT], box.env);
    expect(result.code).not.toBe(0);
    expect(result.err).toContain('backup: failed');
    const active = await readFile(join(box.root, 'active'), 'utf8');
    expect(active).toContain('frontier-cubes-anarchy.service');
    expect(active).toContain('frontier-cubes-survival.service');
    expect(active).toContain('frontier-cubes-peaceful.service');
    const log = await readFile(join(box.root, 'systemctl.log'), 'utf8');
    expect(log).not.toContain('stop frontier-cubes-survival');
    expect(log).not.toContain('stop frontier-cubes-peaceful');
  });
});
