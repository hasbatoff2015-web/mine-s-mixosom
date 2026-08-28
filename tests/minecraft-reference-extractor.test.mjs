import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  objectDiskPath,
  parseArgs,
  rankIndexName,
  resolveRequest,
  selectIndexFile,
  extractReferenceSounds,
  REFERENCE_SOUND_REQUESTS,
} from '../scripts/extract-minecraft-reference-sounds.mjs';

describe('production SFX files', () => {
  it('ships the core MP3 pack under public/audio/sfx', () => {
    const files = readdirSync('public/audio/sfx').filter((name) => name.endsWith('.mp3'));
    expect(files.length).toBe(26);
    for (const name of [
      'stone_1.mp3', 'wood_2.mp3', 'dirt_1.mp3', 'sand_2.mp3', 'wool_1.mp3', 'glass_1.mp3',
      'explosion.mp3', 'bow_shoot.mp3', 'arrow_hit.mp3', 'food_eat.mp3', 'water_splash.mp3',
    ]) {
      expect(existsSync(join('public/audio/sfx', name)), name).toBe(true);
    }
  });
});

describe('Minecraft 1.8 reference extractor', () => {
  it('never stores SHA-1 hashes in the request catalog', () => {
    const blob = JSON.stringify(REFERENCE_SOUND_REQUESTS);
    expect(blob).not.toMatch(/[a-f0-9]{40}/);
    expect(REFERENCE_SOUND_REQUESTS.some((item) => item.patterns[0]?.includes('dig/stone'))).toBe(true);
  });

  it('prefers a 1.8 asset index and resolves objects through the index map', () => {
    expect(selectIndexFile(['1.12.json', '1.8.json', '1.8.9.json'])).toBe('1.8.json');
    expect(selectIndexFile(['1.7.json', '1.8.8.json', '1.8.9.json'])).toBe('1.8.9.json');
    expect(rankIndexName('1.8.json')).toBeGreaterThan(rankIndexName('1.8.9.json'));
    const hash = '0123456789abcdef0123456789abcdef01234567';
    const objects = {
      'minecraft/sounds/dig/stone1.ogg': { hash, size: 12 },
      'minecraft/sounds/random/bow.ogg': { hash, size: 8 },
    };
    expect(resolveRequest(objects, REFERENCE_SOUND_REQUESTS[0])?.key).toBe('minecraft/sounds/dig/stone1.ogg');
    expect(objectDiskPath('/assets/objects', hash)).toBe(join('/assets/objects', '01', hash));
    expect(objectDiskPath('/assets/objects', 'nope')).toBeUndefined();
  });

  it('parses CLI flags for assets/out without requiring the user to hunt hashes', () => {
    expect(parseArgs(['--assets', 'C:\\Users\\me\\AppData\\Roaming\\.minecraft\\assets', '--out', 'tmp/out'])).toMatchObject({
      assets: 'C:\\Users\\me\\AppData\\Roaming\\.minecraft\\assets',
      out: 'tmp/out',
    });
  });

  it('copies resolved objects as friendly .ogg names from a fake 1.8 index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-assets-'));
    const hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const objectsDir = join(root, 'objects', hash.slice(0, 2));
    await mkdir(objectsDir, { recursive: true });
    await mkdir(join(root, 'indexes'), { recursive: true });
    const payload = Buffer.from('fake-ogg');
    await writeFile(join(objectsDir, hash), payload);
    const objects = {};
    for (const request of REFERENCE_SOUND_REQUESTS) {
      objects[request.patterns[0]] = { hash, size: payload.length };
    }
    await writeFile(join(root, 'indexes', '1.8.json'), JSON.stringify({ objects }));
    const outDir = join(root, 'out');
    const result = await extractReferenceSounds({ assetsDir: root, outDir, indexName: '1.8.json' });
    expect(result.ok).toBe(true);
    expect(result.copied).toHaveLength(REFERENCE_SOUND_REQUESTS.length);
    const copied = await readFile(join(outDir, 'stone_1.ogg'));
    expect(copied.equals(payload)).toBe(true);
    const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'));
    expect(manifest.warning).toMatch(/DO NOT commit/i);
    expect(JSON.stringify(manifest.copied[0])).not.toMatch(/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  });
});
