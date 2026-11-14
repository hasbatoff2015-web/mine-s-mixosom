import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const script = join(process.cwd(), 'scripts', 'clone-world-snapshot.mjs');
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fc-clone-'));
  dirs.push(dir);
  return dir;
}

async function runClone(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], {
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

async function writeSource(root: string, extra: {
  emptyMods?: boolean;
  lock?: boolean;
  corruptWorld?: boolean;
  omitClaims?: boolean;
  noArena?: boolean;
  spawnOutside?: boolean;
  claimWorldMismatch?: boolean;
} = {}): Promise<void> {
  const source = join(root, 'anarchy');
  await mkdir(join(source, 'plugin-data', 'claims'), { recursive: true });
  await mkdir(join(source, 'plugin-data', 'economy'), { recursive: true });
  await mkdir(join(source, 'plugin-data', 'auction'), { recursive: true });
  await mkdir(join(source, 'plugin-data', 'friends'), { recursive: true });
  await mkdir(join(source, 'plugin-data', 'home'), { recursive: true });
  await mkdir(join(source, 'plugin-data', 'duels'), { recursive: true });
  await mkdir(join(source, 'plugin-data', 'buyers'), { recursive: true });
  await mkdir(join(source, 'plugin-data', 'holograms'), { recursive: true });
  await mkdir(join(source, 'plugin-data', 'rtpportal'), { recursive: true });
  await mkdir(join(source, 'plugin-data', 'automine', 'originals'), { recursive: true });
  await mkdir(join(source, 'plugin-data', 'mega-zombie'), { recursive: true });
  await mkdir(join(source, 'plugin-data', 'world-events'), { recursive: true });
  await mkdir(join(source, 'plugin-data', 'config'), { recursive: true });
  await writeFile(join(source, 'meta.json'), `${JSON.stringify({
    worldId: 'anarchy',
    seed: 'anarchy-spawn-v1',
    worldgenVersion: 3,
    spawn: extra.spawnOutside ? [9000.5, 70, 9000.5] : [53.5, 68.01, 70.5],
    createdAt: 1,
    updatedAt: 2,
    readyState: 'READY',
  }, null, 2)}\n`);
  const world = {
    timeOfDay: 1000,
    modifications: extra.emptyMods ? {} : {
      '0,0': { '1': 3, '2': 4 },
      '1,0': { '8': 1 },
      '400,-12': { '20': 9, '21': 10 },
    },
    blockStates: {},
    chests: { '8000,70,8000': { slots: [{ item: 'diamond', count: 2 }] } },
    furnaces: {},
    signs: { '12,68,14': ['far sign'] },
    droppedItems: [],
    mobs: [],
    minecarts: [],
    fallingBlocks: [],
  };
  await writeFile(join(source, 'world.json'), extra.corruptWorld ? '{not json' : `${JSON.stringify(world, null, 2)}\n`);
  await writeFile(join(source, 'players.json'), `${JSON.stringify({
    players: {
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1': {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        sessionToken: 'secret-token',
      },
    },
  })}\n`);
  const claims = extra.noArena ? [
    {
      id: 'hub',
      name: 'Главный спавн',
      owner: 'server',
      worldId: extra.claimWorldMismatch ? 'other-world' : 'anarchy',
      volume: { minX: 40, minY: 60, minZ: 60, maxX: 80, maxY: 80, maxZ: 90 },
      members: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'],
      priority: 0,
      flags: { pvp: false, 'block-break': false },
    },
  ] : [
    {
      id: 'hub',
      name: '  Главный   спавн ',
      owner: 'server',
      worldId: 'anarchy',
      volume: { minX: 40, minY: 60, minZ: 60, maxX: 80, maxY: 80, maxZ: 90 },
      members: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'],
      priority: 0,
      flags: { pvp: false, 'block-break': false },
    },
    {
      id: 'cottage',
      name: 'дача',
      owner: 'server',
      worldId: 'anarchy',
      volume: { minX: 5000, minY: 40, minZ: 5000, maxX: 5064, maxY: 90, maxZ: 5064 },
      members: [],
      priority: 1,
      flags: { pvp: false },
    },
    {
      id: 'pit',
      name: 'бойцовская',
      owner: 'server',
      worldId: 'anarchy',
      volume: { minX: 10, minY: 60, minZ: 10, maxX: 20, maxY: 75, maxZ: 20 },
      members: [],
      priority: 10,
      flags: { pvp: true, 'block-break': false },
    },
  ];
  const claimsPath = join(source, 'plugin-data', 'claims', 'claims.json');
  if (extra.omitClaims) await rm(claimsPath, { force: true });
  else await writeFile(claimsPath, `${JSON.stringify({ claims }, null, 2)}\n`);
  await writeFile(join(source, 'plugin-data', 'economy', 'balances.json'), '{"balances":{"ada":99}}\n');
  await writeFile(join(source, 'plugin-data', 'auction', 'listings.json'), '{"listings":[{"id":"lot"}]}\n');
  await writeFile(join(source, 'plugin-data', 'friends', 'friends.json'), '{"friends":{"ada":["bob"]}}\n');
  await writeFile(join(source, 'plugin-data', 'home', 'homes.json'), '{"homes":{"ada":[]}}\n');
  await writeFile(join(source, 'plugin-data', 'permissions.json'), '{"ops":["ada"]}\n');
  await writeFile(join(source, 'plugin-data', 'duels', 'stats.json'), '{"players":{"ada":{"wins":4}}}\n');
  await writeFile(join(source, 'plugin-data', 'duels', 'arena.json'), `${JSON.stringify({
    spawn1: { worldId: 'anarchy', x: 12, y: 64, z: 12, yaw: 0, pitch: 0 },
  })}\n`);
  await writeFile(join(source, 'plugin-data', 'buyers', 'buyers.json'), `${JSON.stringify({
    buyers: [{ id: 'npc', name: 'Trader', worldId: 'anarchy', x: 12, y: 64, z: 12 }],
    purchases: [{ id: 'secret-purchase', playerId: 'ada' }],
    returns: { ada: [] },
  })}\n`);
  await writeFile(join(source, 'plugin-data', 'holograms', 'holograms.json'), `${JSON.stringify({
    holograms: [{ name: 'welcome', worldId: 'anarchy', x: 12, y: 70, z: 12, lines: ['anarchy'] }],
  })}\n`);
  await writeFile(join(source, 'plugin-data', 'rtpportal', 'portals.json'), `${JSON.stringify({
    portals: [{ name: 'gate', worldId: 'anarchy', volume: { minX: 1, minY: 60, minZ: 1, maxX: 3, maxY: 64, maxZ: 3 } }],
  })}\n`);
  await writeFile(join(source, 'plugin-data', 'automine', 'automines.json'), `${JSON.stringify({
    mines: [{ name: 'pit', worldId: 'anarchy', teleport: { worldId: 'anarchy', x: 5000, y: 70, z: 5000 } }],
  })}\n`);
  await writeFile(join(source, 'plugin-data', 'automine', 'originals', 'pit.json'), '{"blocks":[{"x":5000,"y":70,"z":5000,"block":1}]}\n');
  await writeFile(join(source, 'plugin-data', 'mega-zombie', 'config.json'), '{"spawn":{"x":15,"y":64,"z":15},"pos1":{"x":10,"y":60,"z":10},"pos2":{"x":20,"y":75,"z":20},"cycleSeconds":0,"warned":false}\n');
  await writeFile(join(source, 'plugin-data', 'world-events', 'state.json'), `${JSON.stringify({
    templates: [{ name: 'shrine' }],
    active: { id: 'live', worldId: 'anarchy', loot: [{ item: 'diamond' }] },
    journal: { phase: 'placing' },
  })}\n`);
  await writeFile(join(source, 'plugin-data', 'config', 'spawn.json'), '{"cooldownSeconds":5,"worldId":"anarchy"}\n');
  if (extra.lock) {
    await writeFile(join(source, '.instance.lock'), '{"pid":1,"mode":"anarchy","worldId":"anarchy","port":2567}\n');
  } else {
    await rm(join(source, '.instance.lock'), { force: true });
  }
}

function cloneArgs(root: string, survival = 'survival', peaceful = 'peaceful'): string[] {
  return [
    '--source', join(root, 'anarchy'),
    '--survival', join(root, survival),
    '--peaceful', join(root, peaceful),
  ];
}

describe('clone world snapshot', () => {
  it('copies the whole map into two independent worlds and drops personal data', async () => {
    const root = await tempDir();
    await writeSource(root);
    const run = await runClone(cloneArgs(root));
    expect(run.code, run.stderr).toBe(0);
    const summary = JSON.parse(run.stdout) as {
      seed: string;
      worldgenVersion: number;
      spawn: number[];
      modifications: number;
      modificationKeys: string[];
      review: {
        spawnInsideClaim: boolean;
        spawnPvp: boolean;
        explicitPvpClaims: Array<{ name: string }>;
        nameHints: Array<{ normalizedName: string; hint: string }>;
      };
      warnings: string[];
      copiedPluginData: string[];
    };
    expect(summary.seed).toBe('anarchy-spawn-v1');
    expect(summary.worldgenVersion).toBe(3);
    expect(summary.spawn).toEqual([53.5, 68.01, 70.5]);
    expect(summary.modifications).toBe(3);
    expect(summary.modificationKeys).toContain('400,-12');
    expect(summary.review.spawnInsideClaim).toBe(true);
    expect(summary.review.spawnPvp).toBe(false);
    expect(summary.review.explicitPvpClaims.map((claim) => claim.name)).toEqual(['бойцовская']);
    expect(summary.review.nameHints.some((entry) => entry.normalizedName === 'главный спавн' && entry.hint === 'spawn-like')).toBe(true);
    expect(summary.warnings).toEqual([]);
    expect(run.stderr).toContain('WORLD_SEED=anarchy-spawn-v1');
    expect(summary.copiedPluginData).toEqual([
      'automine/automines.json',
      'automine/originals/',
      'buyers/buyers.json',
      'claims/claims.json',
      'config/spawn.json',
      'duels/arena.json',
      'holograms/holograms.json',
      'mega-zombie/config.json',
      'rtpportal/portals.json',
      'world-events/state.json',
    ]);

    const survivalWorld = await readFile(join(root, 'survival', 'world.json'), 'utf8');
    const peacefulWorld = await readFile(join(root, 'peaceful', 'world.json'), 'utf8');
    const sourceWorld = await readFile(join(root, 'anarchy', 'world.json'), 'utf8');
    expect(survivalWorld).toBe(sourceWorld);
    expect(peacefulWorld).toBe(sourceWorld);
    expect(JSON.parse(survivalWorld).chests['8000,70,8000'].slots[0].count).toBe(2);
    expect(JSON.parse(survivalWorld).modifications['400,-12']['20']).toBe(9);

    for (const [dir, worldId] of [[join(root, 'survival'), 'survival'], [join(root, 'peaceful'), 'peaceful']] as const) {
      const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
      expect(meta).toMatchObject({ worldId, seed: 'anarchy-spawn-v1', worldgenVersion: 3, spawn: [53.5, 68.01, 70.5] });
      expect(JSON.parse(await readFile(join(dir, 'players.json'), 'utf8'))).toEqual({ players: {} });
      const claims = JSON.parse(await readFile(join(dir, 'plugin-data', 'claims', 'claims.json'), 'utf8'));
      expect(claims.claims).toHaveLength(3);
      expect(claims.claims.every((claim: { worldId: string }) => claim.worldId === worldId)).toBe(true);
      const arena = claims.claims.find((claim: { id: string }) => claim.id === 'pit');
      expect(arena.flags).toEqual({ pvp: true, 'block-break': false });
      expect(arena.volume).toEqual({ minX: 10, minY: 60, minZ: 10, maxX: 20, maxY: 75, maxZ: 20 });
      const cottage = claims.claims.find((claim: { id: string }) => claim.id === 'cottage');
      expect(cottage.volume.minX).toBe(5000);
      const buyers = JSON.parse(await readFile(join(dir, 'plugin-data', 'buyers', 'buyers.json'), 'utf8'));
      expect(buyers).toEqual({ buyers: [{ id: 'npc', name: 'Trader', worldId, x: 12, y: 64, z: 12 }] });
      const holograms = JSON.parse(await readFile(join(dir, 'plugin-data', 'holograms', 'holograms.json'), 'utf8'));
      expect(holograms.holograms[0].lines).toEqual(['anarchy']);
      expect(holograms.holograms[0].worldId).toBe(worldId);
      const events = JSON.parse(await readFile(join(dir, 'plugin-data', 'world-events', 'state.json'), 'utf8'));
      expect(events).toEqual({ templates: [{ name: 'shrine' }] });
      const config = JSON.parse(await readFile(join(dir, 'plugin-data', 'config', 'spawn.json'), 'utf8'));
      expect(config.worldId).toBe(worldId);
      const originals = await readFile(join(dir, 'plugin-data', 'automine', 'originals', 'pit.json'), 'utf8');
      expect(originals).toContain('5000');
      await expect(readFile(join(dir, 'plugin-data', 'economy', 'balances.json'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(dir, 'plugin-data', 'auction', 'listings.json'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(dir, 'plugin-data', 'friends', 'friends.json'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(dir, 'plugin-data', 'home', 'homes.json'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(dir, 'plugin-data', 'permissions.json'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(dir, 'plugin-data', 'duels', 'stats.json'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(dir, '.instance.lock'), 'utf8')).rejects.toThrow();
    }

    expect(await readFile(join(root, 'anarchy', 'players.json'), 'utf8')).toContain('secret-token');
    const peaceful = JSON.parse(await readFile(join(root, 'peaceful', 'world.json'), 'utf8'));
    peaceful.modifications['9,9'] = { '1': 1 };
    await writeFile(join(root, 'peaceful', 'world.json'), JSON.stringify(peaceful));
    const survivalAfter = JSON.parse(await readFile(join(root, 'survival', 'world.json'), 'utf8'));
    expect(survivalAfter.modifications['9,9']).toBeUndefined();
  });

  it('reports an uncovered spawn without refusing the rest of the map', async () => {
    const root = await tempDir();
    await writeSource(root, { spawnOutside: true });
    const run = await runClone(cloneArgs(root));
    expect(run.code, run.stderr).toBe(0);
    const summary = JSON.parse(run.stdout) as { review: { spawnInsideClaim: boolean }; warnings: string[] };
    expect(summary.review.spawnInsideClaim).toBe(false);
    expect(summary.warnings[0]).toContain('9000,70,9000');
    expect(JSON.parse(await readFile(join(root, 'survival', 'world.json'), 'utf8')).modifications['400,-12']).toBeDefined();
  });

  it('refuses an empty map, a live lock, a damaged file, a missing arena flag, and the source directory', async () => {
    const root = await tempDir();
    await writeSource(root, { emptyMods: true });
    const empty = await runClone(cloneArgs(root));
    expect(empty.code).not.toBe(0);
    expect(empty.stderr).toMatch(/modifications are empty/);
    await expect(readFile(join(root, 'survival', 'meta.json'), 'utf8')).rejects.toThrow();

    await writeSource(root, { corruptWorld: true });
    const corrupt = await runClone(cloneArgs(root));
    expect(corrupt.code).not.toBe(0);
    expect(corrupt.stderr).toMatch(/not JSON/);

    await writeSource(root, { omitClaims: true });
    const missingClaims = await runClone(cloneArgs(root));
    expect(missingClaims.code).not.toBe(0);
    expect(missingClaims.stderr).toMatch(/claims.json is missing/);

    await writeSource(root, { noArena: true });
    const noArena = await runClone(cloneArgs(root));
    expect(noArena.code).not.toBe(0);
    expect(noArena.stderr).toMatch(/flags\.pvp set to true/);
    expect(noArena.stderr).toContain('Главный спавн');

    await writeSource(root, { claimWorldMismatch: true, noArena: true });
    const mismatch = await runClone(cloneArgs(root));
    expect(mismatch.code).not.toBe(0);
    expect(mismatch.stderr).toMatch(/worldId is 'other-world'/);

    await writeSource(root, { lock: true });
    const locked = await runClone(cloneArgs(root));
    expect(locked.code).not.toBe(0);
    expect(locked.stderr).toMatch(/instance.lock/);

    await writeSource(root);
    const same = await runClone(cloneArgs(root, 'anarchy', 'peaceful'));
    expect(same.code).not.toBe(0);
    expect(same.stderr).toMatch(/is the source/);
    expect(await readFile(join(root, 'anarchy', 'players.json'), 'utf8')).toContain('secret-token');

    const created = await runClone(cloneArgs(root));
    expect(created.code, created.stderr).toBe(0);
    const again = await runClone(cloneArgs(root, 'survival', 'peaceful-2'));
    expect(again.code).not.toBe(0);
    expect(again.stderr).toMatch(/already has a world/);
    expect(JSON.parse(await readFile(join(root, 'survival', 'meta.json'), 'utf8')).worldId).toBe('survival');
    await expect(readFile(join(root, 'peaceful-2', 'meta.json'), 'utf8')).rejects.toThrow();
  });

  it('rolls back both targets when the second install fails', async () => {
    const root = await tempDir();
    await writeSource(root);
    const survival = join(root, 'survival');
    const peaceful = join(root, 'peaceful');
    await mkdir(survival, { recursive: true });
    await writeFile(join(survival, 'meta.json'), '{"worldId":"survival","marker":"old-dev"}\n');
    await writeFile(join(survival, 'world.json'), '{"modifications":{"keep":{}}}\n');
    const run = await runClone([
      '--source', join(root, 'anarchy'),
      '--survival', survival,
      '--peaceful', peaceful,
      '--force',
    ], { FC_CLONE_FAIL_INSTALL: 'peaceful' });
    expect(run.code).not.toBe(0);
    expect(run.stderr).toMatch(/injected failure installing peaceful/);
    expect(await readFile(join(survival, 'meta.json'), 'utf8')).toContain('old-dev');
    expect(await readFile(join(survival, 'world.json'), 'utf8')).toContain('keep');
    await expect(readFile(join(peaceful, 'meta.json'), 'utf8')).rejects.toThrow();
    expect(await readFile(join(root, 'anarchy', 'players.json'), 'utf8')).toContain('secret-token');
    expect(await readFile(join(root, 'anarchy', 'world.json'), 'utf8')).toContain('400,-12');
  });
});
