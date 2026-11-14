import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fc-clone-'));
  dirs.push(dir);
  return dir;
}

async function writeSource(root: string, extra: { emptyMods?: boolean; lock?: boolean } = {}): Promise<void> {
  const source = join(root, 'anarchy');
  await mkdir(join(source, 'plugin-data', 'claims'), { recursive: true });
  await mkdir(join(source, 'plugin-data', 'economy'), { recursive: true });
  await mkdir(join(source, 'plugin-data', 'buyers'), { recursive: true });
  await mkdir(join(source, 'plugin-data', 'holograms'), { recursive: true });
  await writeFile(join(source, 'meta.json'), `${JSON.stringify({
    worldId: 'anarchy',
    seed: 'anarchy-spawn-v1',
    worldgenVersion: 3,
    spawn: [53.5, 68.01, 70.5],
    createdAt: 1,
    updatedAt: 2,
    readyState: 'READY',
  }, null, 2)}\n`);
  await writeFile(join(source, 'world.json'), `${JSON.stringify({
    timeOfDay: 1000,
    modifications: extra.emptyMods ? {} : { '0,0': { '1': 3, '2': 4 }, '1,0': { '8': 1 } },
    blockStates: {},
    chests: { '10,64,12': { slots: [] } },
    furnaces: {},
    signs: {},
    droppedItems: [],
    mobs: [],
    minecarts: [],
    fallingBlocks: [],
  }, null, 2)}\n`);
  await writeFile(join(source, 'players.json'), `${JSON.stringify({
    players: {
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1': { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', sessionToken: 'secret-token' },
    },
  })}\n`);
  await writeFile(join(source, 'plugin-data', 'claims', 'claims.json'), `${JSON.stringify({
    claims: [
      {
        id: 'spawn',
        name: 'spawn',
        owner: 'server',
        worldId: 'anarchy',
        volume: { minX: 0, minY: 0, minZ: 0, maxX: 40, maxY: 80, maxZ: 40 },
        members: [],
        priority: 0,
        flags: { pvp: false, 'block-break': false },
      },
      {
        id: 'arena',
        name: 'arena',
        owner: 'server',
        worldId: 'anarchy',
        volume: { minX: 10, minY: 60, minZ: 10, maxX: 20, maxY: 75, maxZ: 20 },
        members: [],
        priority: 10,
        flags: { pvp: true },
      },
    ],
  })}\n`);
  await writeFile(join(source, 'plugin-data', 'economy', 'balances.json'), '{"balances":{"ada":99}}\n');
  await writeFile(join(source, 'plugin-data', 'buyers', 'buyers.json'), `${JSON.stringify({
    buyers: [{ id: 'npc', name: 'Trader', worldId: 'anarchy', x: 12, y: 64, z: 12 }],
    purchases: [{ id: 'secret-purchase', playerId: 'ada' }],
    returns: { ada: [] },
  })}\n`);
  await writeFile(join(source, 'plugin-data', 'holograms', 'holograms.json'), `${JSON.stringify({
    holograms: [{ name: 'welcome', worldId: 'anarchy', x: 12, y: 70, z: 12, lines: ['spawn'] }],
  })}\n`);
  if (extra.lock) {
    await writeFile(join(source, '.instance.lock'), '{"pid":1,"mode":"anarchy","worldId":"anarchy","port":2567}\n');
  } else {
    await rm(join(source, '.instance.lock'), { force: true });
  }
}

const script = join(process.cwd(), 'scripts', 'clone-world-snapshot.mjs');

async function runClone(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

describe('clone world snapshot', () => {
  it('builds two independent copies and drops personal data', async () => {
    const root = await tempDir();
    await writeSource(root);
    const survival = join(root, 'survival');
    const peaceful = join(root, 'peaceful');
    const run = await runClone([
      '--source', join(root, 'anarchy'),
      '--survival', survival,
      '--peaceful', peaceful,
    ]);
    expect(run.code, run.stderr).toBe(0);
    const summary = JSON.parse(run.stdout) as {
      seed: string;
      spawn: number[];
      modifications: number;
      claims: Array<{ name: string; pvp?: boolean }>;
      copiedPluginData: string[];
    };
    expect(summary.seed).toBe('anarchy-spawn-v1');
    expect(summary.spawn).toEqual([53.5, 68.01, 70.5]);
    expect(summary.modifications).toBe(2);
    expect(summary.claims.map((claim) => claim.name).sort()).toEqual(['arena', 'spawn']);
    expect(summary.copiedPluginData).toEqual([
      'claims/claims.json',
      'holograms/holograms.json',
      'buyers/buyers.json',
    ]);

    const survivalMeta = JSON.parse(await readFile(join(survival, 'meta.json'), 'utf8'));
    const peacefulMeta = JSON.parse(await readFile(join(peaceful, 'meta.json'), 'utf8'));
    expect(survivalMeta.worldId).toBe('survival');
    expect(peacefulMeta.worldId).toBe('peaceful');
    expect(survivalMeta.seed).toBe(peacefulMeta.seed);
    expect(survivalMeta.spawn).toEqual(peacefulMeta.spawn);

    const survivalWorld = JSON.parse(await readFile(join(survival, 'world.json'), 'utf8'));
    const peacefulWorld = JSON.parse(await readFile(join(peaceful, 'world.json'), 'utf8'));
    expect(Object.keys(survivalWorld.modifications)).toEqual(Object.keys(peacefulWorld.modifications));
    expect(survivalWorld.chests).toEqual(peacefulWorld.chests);

    for (const [dir, worldId] of [[survival, 'survival'], [peaceful, 'peaceful']] as const) {
      const players = JSON.parse(await readFile(join(dir, 'players.json'), 'utf8'));
      expect(players).toEqual({ players: {} });
      const claims = JSON.parse(await readFile(join(dir, 'plugin-data', 'claims', 'claims.json'), 'utf8'));
      expect(claims.claims.every((claim: { worldId: string }) => claim.worldId === worldId)).toBe(true);
      const buyers = JSON.parse(await readFile(join(dir, 'plugin-data', 'buyers', 'buyers.json'), 'utf8'));
      expect(buyers.purchases).toBeUndefined();
      expect(buyers.returns).toBeUndefined();
      expect(buyers.buyers[0].worldId).toBe(worldId);
      await expect(readFile(join(dir, 'plugin-data', 'economy', 'balances.json'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(dir, '.instance.lock'), 'utf8')).rejects.toThrow();
    }

    const sourcePlayers = await readFile(join(root, 'anarchy', 'players.json'), 'utf8');
    expect(sourcePlayers).toContain('secret-token');
    peacefulWorld.modifications['9,9'] = { '1': 1 };
    await writeFile(join(peaceful, 'world.json'), JSON.stringify(peacefulWorld));
    const survivalAfter = JSON.parse(await readFile(join(survival, 'world.json'), 'utf8'));
    expect(survivalAfter.modifications['9,9']).toBeUndefined();
  });

  it('refuses an empty map, a live lock, the source directory, and an existing target', async () => {
    const root = await tempDir();
    const args = (survival: string, peaceful: string) => [
      '--source', join(root, 'anarchy'),
      '--survival', survival,
      '--peaceful', peaceful,
    ];
    await writeSource(root, { emptyMods: true });
    const empty = await runClone(args(join(root, 'survival'), join(root, 'peaceful')));
    expect(empty.code).not.toBe(0);
    expect(empty.stderr).toMatch(/modifications are empty/);

    await writeSource(root, { lock: true });
    const locked = await runClone(args(join(root, 'survival'), join(root, 'peaceful')));
    expect(locked.code).not.toBe(0);
    expect(locked.stderr).toMatch(/instance.lock/);

    await writeSource(root);
    const same = await runClone(args(join(root, 'anarchy'), join(root, 'peaceful')));
    expect(same.code).not.toBe(0);
    expect(same.stderr).toMatch(/is the source/);

    const created = await runClone(args(join(root, 'survival'), join(root, 'peaceful')));
    expect(created.code, created.stderr).toBe(0);
    const again = await runClone(args(join(root, 'survival'), join(root, 'peaceful-2')));
    expect(again.code).not.toBe(0);
    expect(again.stderr).toMatch(/already has a world/);
    expect(JSON.parse(await readFile(join(root, 'survival', 'meta.json'), 'utf8')).worldId).toBe('survival');
  });

  it('prints the seed and claims from the command line', async () => {
    const root = await tempDir();
    await writeSource(root);
    const run = await runClone([
      '--source', join(root, 'anarchy'),
      '--survival', join(root, 'out-survival'),
      '--peaceful', join(root, 'out-peaceful'),
    ]);
    expect(run.code, run.stderr).toBe(0);
    const summary = JSON.parse(run.stdout) as {
      seed: string;
      modifications: number;
      claims: Array<{ name: string; pvp?: boolean }>;
    };
    expect(summary.seed).toBe('anarchy-spawn-v1');
    expect(summary.modifications).toBe(2);
    expect(summary.claims.some((claim) => claim.name === 'arena' && claim.pvp === true)).toBe(true);
  });
});
