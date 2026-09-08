import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { decodeRgbaPng } from '../scripts/png-rgba.mjs';
import { inflateSync } from 'node:zlib';

function decodeRgbOrRgba(bytes) {
  const colorType = bytes[25];
  if (colorType === 6) return decodeRgbaPng(bytes);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const channels = 3;
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      chunks.push(bytes.subarray(offset + 8, offset + 8 + size));
    }
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const prev = Buffer.alloc(stride);
  const data = Buffer.alloc(width * height * 4);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const row = Buffer.from(raw.subarray(src, src + stride));
    src += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x];
      const ul = x >= channels ? prev[x - channels] : 0;
      const p = left + up - ul;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - ul);
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? (left + up) >> 1
              : pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      row[x] = (row[x] + predictor) & 255;
    }
    row.copy(prev);
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = row[x * 3];
      data[i + 1] = row[x * 3 + 1];
      data[i + 2] = row[x * 3 + 2];
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function isRed(r, g, b) {
  return r > 100 && r >= g + 40 && r >= b + 40;
}

describe('TNT variant textures', () => {
  it('recolors only the red TNT body to black / dark purple at 32×32', async () => {
    const ordinary = decodeRgbOrRgba(await readFile('public/textures/block/tnt.png'));
    const powerful = decodeRgbaPng(await readFile('public/textures/block/tnt_powerful.png'));
    const destructive = decodeRgbaPng(await readFile('public/textures/block/tnt_destructive.png'));
    expect(ordinary.width).toBe(32);
    expect(powerful.width).toBe(32);
    expect(destructive.width).toBe(32);
    expect(powerful.height).toBe(ordinary.height);
    expect(destructive.height).toBe(ordinary.height);

    let redOrdinary = 0;
    let redPowerful = 0;
    let redDestructive = 0;
    let blackBody = 0;
    let purpleBody = 0;
    let letterMatches = 0;
    const n = ordinary.width * ordinary.height;
    for (let i = 0; i < n; i += 1) {
      const o = i * 4;
      const or = ordinary.data[o];
      const og = ordinary.data[o + 1];
      const ob = ordinary.data[o + 2];
      const pr = powerful.data[o];
      const pg = powerful.data[o + 1];
      const pb = powerful.data[o + 2];
      const dr = destructive.data[o];
      const dg = destructive.data[o + 1];
      const db = destructive.data[o + 2];
      if (isRed(or, og, ob)) {
        redOrdinary += 1;
        if (isRed(pr, pg, pb)) redPowerful += 1;
        if (isRed(dr, dg, db)) redDestructive += 1;
        if (pr < 56 && pg < 56 && pb < 56 && Math.abs(pr - pg) < 4 && Math.abs(pg - pb) < 4) blackBody += 1;
        if (db > dr && db > dg && dr < 90 && dg < 40) purpleBody += 1;
      } else {
        if (pr === or && pg === og && pb === ob) letterMatches += 1;
        expect([dr, dg, db]).toEqual([or, og, ob]);
      }
    }
    expect(redOrdinary).toBeGreaterThan(400);
    expect(redPowerful).toBe(0);
    expect(redDestructive).toBe(0);
    expect(blackBody).toBe(redOrdinary);
    expect(purpleBody).toBe(redOrdinary);
    expect(letterMatches).toBe(n - redOrdinary);
  });
});
