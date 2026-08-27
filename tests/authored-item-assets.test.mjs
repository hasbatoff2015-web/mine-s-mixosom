import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTHORED_ITEM_COPIES, POTION_COLORS, prepareAuthoredItems, composePotion } from '../scripts/authored-item-assets.mjs';
import { decodeRgbaPng, encodeRgbaPng } from '../scripts/png-rgba.mjs';

const source = resolve('assets/minecraft/textures');
const temporary = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) {
    const target = resolve(path), parent = resolve(tmpdir());
    if (!target.startsWith(parent + sep + 'frontier-authored-')) throw new Error('Unsafe temporary target');
    await rm(target, { recursive: true, force: true });
  }
});

describe('authored asset import and fallback precedence', () => {
  it('copies exact authored bytes and publishes deterministic 32px potion compositions', async () => {
    const outputs = new Map(await prepareAuthoredItems(source));
    for (const [input, output] of Object.entries(AUTHORED_ITEM_COPIES)) {
      expect(outputs.get(output).equals(await readFile(join(source, input)))).toBe(true);
    }
    for (const [output, bytes] of outputs) expect((await readFile(join('public/textures', output))).equals(bytes), output).toBe(true);
    const bottle = decodeRgbaPng(await readFile(join(source, 'items/potion_bottle_drinkable.png')));
    const overlay = decodeRgbaPng(await readFile(join(source, 'items/potion_overlay.png')));
    for (const [id, tint] of Object.entries(POTION_COLORS)) {
      const composed = composePotion(bottle, overlay, tint);
      expect([composed.width, composed.height]).toEqual([32, 32]);
      expect(decodeRgbaPng(encodeRgbaPng(composed))).toEqual(composed);
      for (let i = 0; i < composed.data.length; i += 4) {
        const a = bottle.data[i + 3] / 255, b = overlay.data[i + 3] / 255;
        expect(composed.data[i + 3]).toBe(Math.round((a + b * (1 - a)) * 255));
        if (a === 1) expect(composed.data.subarray(i, i + 4)).toEqual(bottle.data.subarray(i, i + 4));
      }
      expect(outputs.get(`item/${id}.png`)).toEqual(encodeRgbaPng(composed));
    }
  });

  it('overwrites stale placeholders, remains byte-stable on reimport and survives forced fallback generation', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'frontier-authored-')); temporary.push(folder);
    for (const input of [...Object.keys(AUTHORED_ITEM_COPIES), 'items/potion_bottle_drinkable.png', 'items/potion_overlay.png']) {
      const target = join(folder, 'assets/minecraft/textures', input);
      await mkdir(resolve(target, '..'), { recursive: true });
      await writeFile(target, await readFile(join(source, input)));
    }
    const destination = join(folder, 'public/textures');
    await mkdir(join(destination, 'item'), { recursive: true });
    await writeFile(join(destination, 'item/bucket.png'), 'old generated placeholder');
    await writeFile(join(destination, 'keep.txt'), 'unrelated curated asset');
    const importer = resolve('scripts/import-assets.mjs');
    execFileSync(process.execPath, [importer, '--items-cleanup'], { cwd: folder });
    execFileSync(process.execPath, [importer, '--items-cleanup'], { cwd: folder });
    execFileSync(process.execPath, [resolve('scripts/generate-missing-textures.mjs'), '--force'], { cwd: folder });
    for (const [output, bytes] of await prepareAuthoredItems(source)) {
      expect((await readFile(join(destination, output))).equals(bytes), output).toBe(true);
    }
    expect(await readFile(join(destination, 'keep.txt'), 'utf8')).toBe('unrelated curated asset');
  });

  it('fails on missing required layers before touching curated runtime files', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'frontier-authored-')); temporary.push(folder);
    await mkdir(join(folder, 'assets/minecraft/textures'), { recursive: true });
    await mkdir(join(folder, 'public/textures/item'), { recursive: true });
    const bucket = join(folder, 'public/textures/item/bucket.png');
    await writeFile(bucket, 'keep on failed import');
    expect(() => execFileSync(process.execPath, [resolve('scripts/import-assets.mjs'), '--items-cleanup'], { cwd: folder, stdio: 'pipe' })).toThrow();
    expect(await readFile(bucket, 'utf8')).toBe('keep on failed import');
  });
});
