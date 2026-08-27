import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeRgbaPng, encodeRgbaPng } from './png-rgba.mjs';

export const AUTHORED_ITEM_COPIES = Object.freeze({
  'items/bucket_empty.png': 'item/bucket.png',
  'items/bucket_water.png': 'item/water_bucket.png',
  'items/bucket_lava.png': 'item/lava_bucket.png',
  'items/minecart_normal.png': 'item/minecart.png',
  'entity/minecart.png': 'entity/minecart.png',
  'items/potion_bottle_empty.png': 'item/glass_bottle.png',
});
export const POTION_COLORS = Object.freeze({
  potion_invisibility: [127, 131, 146],
  potion_regeneration: [205, 92, 171],
});
export const AUTHORED_ITEM_TARGETS = Object.freeze([
  ...Object.values(AUTHORED_ITEM_COPIES), ...Object.keys(POTION_COLORS).map((id) => `item/${id}.png`),
]);

export function composePotion(bottle, overlay, tint) {
  if (bottle.width !== overlay.width || bottle.height !== overlay.height) throw new Error('Potion layer dimensions differ');
  const data = Buffer.alloc(bottle.data.length);
  for (let i = 0; i < data.length; i += 4) {
    // Authored glass/cork OVER tinted authored liquid. No invented bottle pixels.
    const a = bottle.data[i + 3] / 255, b = overlay.data[i + 3] / 255;
    const alpha = a + b * (1 - a);
    for (let c = 0; c < 3; c++) data[i + c] = alpha ? Math.round(
      (bottle.data[i + c] * a + overlay.data[i + c] * tint[c] / 255 * b * (1 - a)) / alpha,
    ) : 0;
    data[i + 3] = Math.round(alpha * 255);
  }
  return { width: bottle.width, height: bottle.height, data };
}

/** Preflight and composition finish before the importer writes any destination. */
export async function prepareAuthoredItems(sourceRoot) {
  const outputs = [];
  for (const [source, target] of Object.entries(AUTHORED_ITEM_COPIES)) {
    outputs.push([target, await readFile(join(sourceRoot, source))]);
  }
  const bottle = decodeRgbaPng(await readFile(join(sourceRoot, 'items/potion_bottle_drinkable.png')));
  const overlay = decodeRgbaPng(await readFile(join(sourceRoot, 'items/potion_overlay.png')));
  for (const [id, tint] of Object.entries(POTION_COLORS)) {
    outputs.push([`item/${id}.png`, encodeRgbaPng(composePotion(bottle, overlay, tint))]);
  }
  return outputs;
}
