import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

function pngSize(bytes) {
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bytes: bytes.length,
  };
}

describe('glowstone / lantern / chain pack textures', () => {
  it('ships Faithful 32px glowstone, not a generated 16px stub', async () => {
    const glowstone = pngSize(await readFile('public/textures/block/glowstone.png'));
    expect(glowstone.width).toBe(32);
    expect(glowstone.height).toBe(32);
    expect(glowstone.bytes).toBeGreaterThan(400);
  });

  it('ships authored lantern/chain item sprites and 32px block sheets', async () => {
    const itemLantern = pngSize(await readFile('public/textures/item/lantern.png'));
    const itemChain = pngSize(await readFile('public/textures/item/chain.png'));
    const blockLantern = pngSize(await readFile('public/textures/block/lantern.png'));
    const blockChain = pngSize(await readFile('public/textures/block/chain.png'));
    expect(itemLantern).toMatchObject({ width: 32, height: 32 });
    expect(itemChain).toMatchObject({ width: 32, height: 32 });
    expect(itemLantern.bytes).toBeGreaterThan(200);
    expect(itemChain.bytes).toBeGreaterThan(150);
    expect(blockLantern.width).toBe(32);
    expect(blockChain.width).toBe(32);
    expect(blockChain.height).toBe(32);
  });
});
