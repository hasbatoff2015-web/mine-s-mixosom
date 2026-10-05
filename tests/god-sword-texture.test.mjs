import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { decodeRgbaPng } from '../scripts/png-rgba.mjs';

const IRON = 'assets/minecraft/textures/items/iron_sword.png';
const STICK = 'assets/minecraft/textures/items/stick.png';
const TITANIUM = 'public/textures/item/titanium_sword.png';
const GOD = 'public/textures/item/god_sword.png';

const RED = new Set([
  '75,7,17',
  '112,11,25',
  '166,17,39',
  '217,30,55',
  '255,63,76',
  '255,119,109',
]);
const BRIGHT = new Set(['217,30,55', '255,63,76', '255,119,109']);
const CORE = '255,119,109';
const GRIP = new Set(['9,12,17', '17,23,32', '27,36,46', '44,57,69']);
const LIGHT_METAL = new Set(['56,75,91', '82,105,122']);

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
    let red = 0;
    let bright = 0;
    let core = 0;
    let lightMetal = 0;
    const metalColors = new Set();
    const godMetal = [];
    const titaniumMetal = [];
    for (let index = 0; index < iron.data.length; index += 4) {
      expect(god.data[index + 3]).toBe(iron.data[index + 3]);
      if (iron.data[index + 3] === 0) {
        expect(god.data[index + 3]).toBe(0);
        continue;
      }
      const sourceKey = keyAt(iron.data, index);
      const godKey = keyAt(god.data, index);
      if (RED.has(godKey)) {
        red += 1;
        if (BRIGHT.has(godKey)) bright += 1;
        if (godKey === CORE) core += 1;
        continue;
      }
      if (handles.has(sourceKey)) {
        expect(GRIP.has(godKey)).toBe(true);
        expect(godKey).not.toBe(sourceKey);
        continue;
      }
      metalColors.add(godKey);
      if (LIGHT_METAL.has(godKey)) lightMetal += 1;
      godMetal.push(luminance(god.data[index], god.data[index + 1], god.data[index + 2]));
      titaniumMetal.push(luminance(titanium.data[index], titanium.data[index + 1], titanium.data[index + 2]));
    }
    expect(red).toBeGreaterThanOrEqual(24);
    expect(red).toBeLessThanOrEqual(29);
    expect(bright).toBeLessThanOrEqual(7);
    expect(core).toBeLessThanOrEqual(2);
    expect(metalColors.size).toBeGreaterThanOrEqual(5);
    expect(lightMetal).toBeGreaterThanOrEqual(6);
    expect(lightMetal).toBeLessThanOrEqual(9);
    const godMean = godMetal.reduce((sum, value) => sum + value, 0) / godMetal.length;
    const titaniumMean = titaniumMetal.reduce((sum, value) => sum + value, 0) / titaniumMetal.length;
    expect(godMean).toBeGreaterThan(titaniumMean * 0.5);
    expect(godMean).toBeLessThan(titaniumMean * 0.7);
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
