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

async function layout(options?: {
  failExport?: boolean;
  anarchyDown?: boolean;
  dropSurvival?: boolean;
  claimsMode?: 'default' | 'missing' | 'empty' | 'no-arena' | 'omitted-flag' | 'clamped-priority';
}): Promise<{
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
    await mkdir(join(dir, 'plugin-data', 'friends'), { recursive: true });
    await mkdir(join(dir, 'plugin-data', 'home'), { recursive: true });
    await mkdir(join(dir, 'plugin-data', 'clans'), { recursive: true });
    await mkdir(join(dir, 'plugin-data', 'messages'), { recursive: true });
    await mkdir(join(dir, 'plugin-data', 'kit'), { recursive: true });
    await mkdir(join(dir, 'plugin-data', 'duels'), { recursive: true });
    await mkdir(join(dir, 'plugin-data', 'holograms'), { recursive: true });
    await writeFile(join(dir, 'meta.json'), `${JSON.stringify({
      worldId: id, seed: 'anarchy-spawn-v1', worldgenVersion: 3, spawn: [53.5, 68, 70.5],
    })}\n`);
    await writeFile(join(dir, 'world.json'), `${JSON.stringify({
      modifications: { '0,0': { '1': 3 }, '400,-12': { '9': 1 } },
      chests: { '8,70,8': { slots: [] } },
    })}\n`);
    await writeFile(join(dir, 'players.json'), `${JSON.stringify({
      players: { ada: { sessionToken: SESSION, inventory: [{ id: 'inventory-secret-stack' }] } },
    })}\n`);
    const claimsMode = options?.claimsMode ?? 'default';
    const spawnVolume = { minX: 40, minY: 60, minZ: 60, maxX: 80, maxY: 90, maxZ: 90 };
    const claims = claimsMode === 'empty' ? []
      : claimsMode === 'no-arena' ? [
        { id: 'hub', name: 'Главный спавн', owner: 'server', worldId: id, priority: 0, volume: spawnVolume, flags: { pvp: false } },
      ]
      : claimsMode === 'omitted-flag' ? [
        { id: 'high', name: 'высокий', owner: 'server', worldId: id, priority: 100, volume: spawnVolume, flags: { 'block-break': false } },
        { id: 'low', name: 'низкий', owner: 'server', worldId: id, priority: 1, volume: spawnVolume, flags: { pvp: true } },
      ]
      : claimsMode === 'clamped-priority' ? [
        { id: 'wide', name: 'ранний', owner: 'server', worldId: id, priority: 1_000_000, volume: spawnVolume, flags: { pvp: true } },
        { id: 'over', name: 'поздний', owner: 'server', worldId: id, priority: 5_000_000, volume: spawnVolume, flags: { pvp: false } },
      ]
      : [
        { id: 'hub', name: 'Главный спавн', owner: 'server', worldId: id, priority: 0, volume: spawnVolume, flags: { pvp: false } },
        {
          id: 'pit', name: 'бойцовская', owner: 'server', worldId: id, priority: 10,
          volume: { minX: 10, minY: 60, minZ: 10, maxX: 20, maxY: 80, maxZ: 20 },
          flags: { pvp: true },
        },
      ];
    const claimsPath = join(dir, 'plugin-data', 'claims', 'claims.json');
    if (claimsMode === 'missing') await rm(claimsPath, { force: true });
    else await writeFile(claimsPath, `${JSON.stringify({ claims })}\n`);
    await writeFile(join(dir, 'plugin-data', 'economy', 'balances.json'), '{"balances":{"ada":99}}\n');
    await writeFile(join(dir, 'plugin-data', 'friends', 'friends.json'), '{"friends":{"ada":["bob"]}}\n');
    await writeFile(join(dir, 'plugin-data', 'home', 'homes.json'), '{"homes":{"ada":[]}}\n');
    await writeFile(join(dir, 'plugin-data', 'clans', 'clans.json'), '{"clans":[]}\n');
    await writeFile(join(dir, 'plugin-data', 'permissions.json'), '{"ops":["ada"]}\n');
    await writeFile(join(dir, 'plugin-data', 'messages', 'inbox.json'), '{"messages":["hello"]}\n');
    await writeFile(join(dir, 'plugin-data', 'kit', 'kits.json'), '{"kits":[]}\n');
    await writeFile(join(dir, 'plugin-data', 'duels', 'stats.json'), '{"players":{"ada":{"wins":4}}}\n');
    await writeFile(join(dir, 'plugin-data', 'duels', 'arena.json'), '{"spawn1":{"x":12,"y":64,"z":12}}\n');
    await writeFile(join(dir, 'plugin-data', 'holograms', 'holograms.json'), '{"holograms":[{"name":"welcome"}]}\n');
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
    expect(packed.includes(Buffer.from('inventory-secret-stack'))).toBe(false);
    const listing = await run('tar', ['-tzf', archive], box.env);
    expect(listing.out).not.toContain('worlds/survival');
    expect(listing.out).not.toContain('worlds/peaceful');
    expect(listing.out).not.toContain('postgres');
    expect(listing.out).not.toContain('players.json.bak');
    for (const entry of [
      'manifest.json',
      'export-summary.json',
      'worlds/anarchy/meta.json',
      'worlds/anarchy/world.json',
      'worlds/anarchy/players.json',
      'worlds/anarchy/map-review.json',
      'worlds/anarchy/plugin-data/claims/claims.json',
      'worlds/anarchy/plugin-data/duels/arena.json',
      'worlds/anarchy/plugin-data/holograms/holograms.json',
      'worlds/anarchy/plugin-data/config/spawn.json',
    ]) {
      expect(listing.out.split('\n').map((line) => line.replace(/^\.\//, ''))).toContain(entry);
    }
    for (const banned of [
      'economy/',
      'friends/',
      'home/',
      'clans/',
      'permissions.json',
      'messages/',
      'kit/',
      'duels/stats.json',
    ]) {
      expect(listing.out).not.toContain(banned);
    }
    expect(verified.out).toContain('verify: worlds/anarchy/world.json');
    expect(verified.out).toContain('verify: worlds/anarchy/meta.json');
    const review = JSON.parse(await readFile(join(extracted, 'worlds/anarchy/map-review.json'), 'utf8'));
    expect(review.claimsStatus).toBe('ok');
    expect(review.spawnPvp).toBe(false);
    expect(review.warnings).toEqual([]);
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

  it('warns when claims.json is missing and still publishes the map', async () => {
    const box = await layout({ claimsMode: 'missing' });
    const result = await run('bash', [SCRIPT], box.env);
    expect(result.code, `${result.out}\n${result.err}`).toBe(0);
    expect(result.err).toContain('claims.json is missing');
    const archive = result.out.split('\n').find((line) => line.startsWith('archive: '))?.slice('archive: '.length) ?? '';
    const extracted = join(box.root, 'missing-extracted');
    await mkdir(extracted);
    expect((await run('tar', ['-xzf', archive, '-C', extracted], box.env)).code).toBe(0);
    const review = JSON.parse(await readFile(join(extracted, 'worlds/anarchy/map-review.json'), 'utf8'));
    expect(review.claimsStatus).toBe('missing');
    expect(review.warnings.join('\n')).toContain('claims.json is missing');
    await expect(readFile(join(extracted, 'worlds/anarchy/plugin-data/claims/claims.json'), 'utf8')).rejects.toThrow();
  });

  it('warns when claims are empty or have no explicit arena', async () => {
    const empty = await layout({ claimsMode: 'empty' });
    const emptyResult = await run('bash', [SCRIPT], empty.env);
    expect(emptyResult.code, emptyResult.err).toBe(0);
    expect(emptyResult.err).toContain('claims.json has no claims');
    const noArena = await layout({ claimsMode: 'no-arena' });
    const noArenaResult = await run('bash', [SCRIPT], noArena.env);
    expect(noArenaResult.code, noArenaResult.err).toBe(0);
    expect(noArenaResult.err).toContain('no usable arena');
  });

  it('resolves pvp from the explicit flag setter, not the highest claim that omits the flag', async () => {
    const omitted = await layout({ claimsMode: 'omitted-flag' });
    const omittedResult = await run('bash', [SCRIPT], omitted.env);
    expect(omittedResult.code, omittedResult.err).toBe(0);
    const omittedArchive = omittedResult.out.split('\n').find((line) => line.startsWith('archive: '))?.slice('archive: '.length) ?? '';
    const omittedDir = join(omitted.root, 'review');
    await mkdir(omittedDir);
    expect((await run('tar', ['-xzf', omittedArchive, '-C', omittedDir], omitted.env)).code).toBe(0);
    const omittedReview = JSON.parse(await readFile(join(omittedDir, 'worlds/anarchy/map-review.json'), 'utf8'));
    expect(omittedReview.spawnPvp).toBe(true);
    expect(omittedReview.spawnPvpSetter).toBe('низкий');
    const clamped = await layout({ claimsMode: 'clamped-priority' });
    const clampedResult = await run('bash', [SCRIPT], clamped.env);
    expect(clampedResult.code, clampedResult.err).toBe(0);
    const clampedArchive = clampedResult.out.split('\n').find((line) => line.startsWith('archive: '))?.slice('archive: '.length) ?? '';
    const clampedDir = join(clamped.root, 'review');
    await mkdir(clampedDir);
    expect((await run('tar', ['-xzf', clampedArchive, '-C', clampedDir], clamped.env)).code).toBe(0);
    const clampedReview = JSON.parse(await readFile(join(clampedDir, 'worlds/anarchy/map-review.json'), 'utf8'));
    expect(clampedReview.spawnPvp).toBe(true);
    expect(clampedReview.spawnPvpSetter).toBe('ранний');
  });

  it('rejects an archive whose checksum matches but a required map file is absent', async () => {
    const box = await layout({ anarchyDown: true });
    const dir = join(box.root, 'crafted');
    await mkdir(join(dir, 'worlds/anarchy'), { recursive: true });
    await writeFile(join(dir, 'manifest.json'), '{}\n');
    await writeFile(join(dir, 'worlds/anarchy/meta.json'), '{}\n');
    const archive = join(box.backup, 'frontier-cubes-anarchy-map-2026-11-15_120000.tar.gz');
    expect((await run('tar', ['-C', dir, '-czf', archive, 'manifest.json', 'worlds'], box.env)).code).toBe(0);
    const sum = await run('sha256sum', [archive], box.env);
    expect(sum.code).toBe(0);
    const hash = sum.out.split(/\s+/)[0];
    await writeFile(`${archive}.sha256`, `${hash}  ${archive.split('/').pop()}\n`);
    const missingWorld = await run('bash', [SCRIPT, 'verify', archive], box.env);
    expect(missingWorld.code).not.toBe(0);
    expect(missingWorld.err).toContain('archive is missing worlds/anarchy/world.json');
    expect(missingWorld.out).not.toContain('verify: ok');
    await writeFile(join(dir, 'worlds/anarchy/world.json'), '{}\n');
    expect((await run('tar', ['-C', dir, '-czf', archive, 'manifest.json', 'worlds'], box.env)).code).toBe(0);
    const sum2 = await run('sha256sum', [archive], box.env);
    await writeFile(`${archive}.sha256`, `${sum2.out.split(/\s+/)[0]}  ${archive.split('/').pop()}\n`);
    const complete = await run('bash', [SCRIPT, 'verify', archive], box.env);
    expect(complete.code, complete.err).toBe(0);
    expect(complete.out).toContain('verify: worlds/anarchy/world.json');
    expect(complete.out).toContain('verify: worlds/anarchy/meta.json');
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
