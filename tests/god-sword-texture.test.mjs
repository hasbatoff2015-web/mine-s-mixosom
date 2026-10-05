import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { decodeRgbaPng } from '../scripts/png-rgba.mjs';

const IRON = 'assets/minecraft/textures/items/iron_sword.png';
const STICK = 'assets/minecraft/textures/items/stick.png';
const TITANIUM = 'public/textures/item/titanium_sword.png';
const GOD = 'public/textures/item/god_sword.png';

const RED = new Set([
  '74,8,18',
  '122,16,32',
  '196,20,44',
  '255,36,56',
  '255,90,98',
  '255,232,226',
]);
const CORE = '255,232,226';
const GRIP = new Set(['9,12,17', '17,23,32', '27,36,46', '44,57,69']);

function luminance(red, green, blue) {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function keyAt(data, index) {
  return `${data[index]},${data[index + 1]},${data[index + 2]}`;
}

function handleColors(stick) {
  const colors = new Set();
  for (let index = 0; index < stick.data.length; index += 4) {
    if (stick.data[index + 3] === 0) continue;
    colors.add(keyAt(stick.data, index));
  }
  return colors;
}

describe('God Sword texture', () => {
  it('keeps the iron sword silhouette, a darker readable blade, and a dark grip', async () => {
    const god = decodeRgbaPng(await readFile(GOD));
    const iron = decodeRgbaPng(await readFile(IRON));
    const titanium = decodeRgbaPng(await readFile(TITANIUM));
    const stick = decodeRgbaPng(await readFile(STICK));
    expect([god.width, god.height]).toEqual([32, 32]);
    expect(god.data.length).toBe(32 * 32 * 4);

    const handles = handleColors(stick);
    let opaque = 0;
    let red = 0;
    let core = 0;
    const metalColors = new Set();
    const godMetal = [];
    const titaniumMetal = [];
    const at = (x, y) => (y * 32 + x) * 4;
    for (let index = 0; index < iron.data.length; index += 4) {
      expect(god.data[index + 3]).toBe(iron.data[index + 3]);
      if (iron.data[index + 3] === 0) {
        expect(god.data[index + 3]).toBe(0);
        continue;
      }
      opaque += 1;
      const sourceKey = keyAt(iron.data, index);
      const godKey = keyAt(god.data, index);
      if (RED.has(godKey)) {
        red += 1;
        if (godKey === CORE) core += 1;
        continue;
      }
      if (handles.has(sourceKey)) {
        expect(GRIP.has(godKey)).toBe(true);
        expect(godKey).not.toBe(sourceKey);
        continue;
      }
      metalColors.add(godKey);
      godMetal.push(luminance(god.data[index], god.data[index + 1], god.data[index + 2]));
      titaniumMetal.push(luminance(titanium.data[index], titanium.data[index + 1], titanium.data[index + 2]));
    }
    // The 24–29 red cap and the 6–9 grey-ridge cap described the previous outline.
    // The reference needs a glowing edge, an inner vein, and guard/pommel cores.
    expect(red).toBeGreaterThanOrEqual(60);
    expect(red).toBeLessThan(opaque / 2);
    expect(core).toBeGreaterThanOrEqual(6);
    expect(keyAt(god.data, at(28, 0))).toBe(CORE);
    expect(keyAt(god.data, at(22, 9))).toBe(CORE);
    expect(keyAt(god.data, at(8, 18))).toBe(CORE);
    expect(keyAt(god.data, at(1, 29))).toBe(CORE);
    expect(metalColors.size).toBeGreaterThanOrEqual(4);
    const godMean = godMetal.reduce((sum, value) => sum + value, 0) / godMetal.length;
    const titaniumMean = titaniumMetal.reduce((sum, value) => sum + value, 0) / titaniumMetal.length;
    expect(godMean).toBeGreaterThan(titaniumMean * 0.28);
    expect(godMean).toBeLessThan(titaniumMean * 0.85);
  });

  it('matches a second run of the generator', async () => {
    const before = await readFile(GOD);
    const titaniumBefore = await readFile(TITANIUM);
    const rubyBefore = await readFile('public/textures/item/ruby_sword.png');
    execFileSync('python3', ['scripts/generate-tier-assets.py', '--check', '--no-preview'], { stdio: 'pipe' });
    execFileSync('python3', ['scripts/generate-tier-assets.py', '--no-preview'], { stdio: 'pipe' });
    expect(await readFile(GOD)).toEqual(before);
    expect(await readFile(TITANIUM)).toEqual(titaniumBefore);
    expect(await readFile('public/textures/item/ruby_sword.png')).toEqual(rubyBefore);
  });
});
