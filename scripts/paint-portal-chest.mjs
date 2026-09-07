/**
 * Authored portal-chest entity atlas (64×64 logical, shipped at 128×128).
 * Copies the existing gold/lime latch 12×10 1:1; only the body/lid islands change.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeRgbaPng, encodeRgbaPng } from './png-rgba.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const portalPath = join(root, 'public/textures/entity/chest/portal.png');
const blockPath = join(root, 'public/textures/block/portal_chest.png');

const px = (r, g, b, a = 255) => [r, g, b, a];

const PALETTE = {
  ' ': px(0, 0, 0),
  '#': px(8, 12, 18),
  '@': px(6, 10, 16),
  '.': px(10, 16, 26),
  ':': px(14, 24, 36),
  '+': px(18, 34, 48),
  t: px(12, 40, 48),
  T: px(16, 54, 58),
  C: px(22, 72, 70),
  c: px(28, 96, 92),
  Y: px(36, 128, 118),
  i: px(28, 16, 56),
  I: px(48, 22, 92),
  p: px(92, 36, 168),
  P: px(148, 58, 230),
  '*': px(196, 92, 255),
  n: px(22, 32, 42),
  N: px(18, 26, 36),
};

function createImage(width, height, fill = px(0, 0, 0)) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  return { width, height, data };
}

function put(img, x, y, color) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = color[0];
  img.data[i + 1] = color[1];
  img.data[i + 2] = color[2];
  img.data[i + 3] = color[3] ?? 255;
}

function get(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

function blit(src, sx, sy, sw, sh, dst, dx, dy) {
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      put(dst, dx + x, dy + y, get(src, sx + x, sy + y));
    }
  }
}

function scaleNearest(src, scale) {
  const dst = createImage(src.width * scale, src.height * scale);
  for (let y = 0; y < dst.height; y += 1) {
    for (let x = 0; x < dst.width; x += 1) {
      put(dst, x, y, get(src, Math.floor(x / scale), Math.floor(y / scale)));
    }
  }
  return dst;
}

function paintMap(img, ox, oy, rows) {
  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y];
    if (row.length !== rows[0].length) {
      throw new Error(`Row ${y} width ${row.length} != ${rows[0].length}`);
    }
    for (let x = 0; x < row.length; x += 1) {
      const color = PALETTE[row[x]];
      if (!color) throw new Error(`Unknown palette '${row[x]}' at ${ox + x},${oy + y}`);
      put(img, ox + x, oy + y, color);
    }
  }
}

/** Subtle navy/teal grain on fill pixels so faces are not flat floods. */
function grain(img, ox, oy, w, h, seed) {
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a] = get(img, ox + x, oy + y);
      const isFill = (r === 10 && g === 16 && b === 26)
        || (r === 14 && g === 24 && b === 36)
        || (r === 18 && g === 34 && b === 48);
      if (!isFill) continue;
      const n = (x * 17 + y * 31 + seed * 13) & 7;
      if (n === 0) put(img, ox + x, oy + y, PALETTE['@']);
      else if (n === 1) put(img, ox + x, oy + y, PALETTE.t);
      else if (n === 2) put(img, ox + x, oy + y, PALETTE['+']);
      else put(img, ox + x, oy + y, [r, g, b, a]);
    }
  }
}

const LID_TOP = [
  '##############',
  '#P+:......:+P#',
  '#:+.i....i.+:#',
  '#:..ip..pi..:#',
  '#..ipP**Ppi..#',
  '#.ip*I@@I*pi.#',
  '#.ip*@..@*pi.#',
  '#.ip*@..@*pi.#',
  '#.ip*I@@I*pi.#',
  '#..ipP**Ppi..#',
  '#:..ipTTpi..:#',
  '#:+.i....i.+:#',
  '#P+:......:+P#',
  '##############',
];

const LID_UNDER = [
  '@@@@@@@@@@@@@@',
  '@iiiiiiiiiiii@',
  '@iIIIIIIIIIii@',
  '@iIPppppppPIi@',
  '@iIp******pIi@',
  '@iIp*I@@I*pIi@',
  '@iIp*@..@*pIi@',
  '@iIp*@..@*pIi@',
  '@iIp*I@@I*pIi@',
  '@iIp******pIi@',
  '@iIPppppppPIi@',
  '@iIIIIIIIIIii@',
  '@iiiiiiiiiiii@',
  '@@@@@@@@@@@@@@',
];

const BODY_IN = [
  '##############',
  '#@@@@@@@@@@@@#',
  '#@..........@#',
  '#@..........@#',
  '#@....ii....@#',
  '#@....iI....@#',
  '#@..........@#',
  '#@..........@#',
  '#@..........@#',
  '#@..........@#',
  '#@..........@#',
  '#@..........@#',
  '#@@@@@@@@@@@@#',
  '##############',
];

const BODY_BOTTOM = [
  '##############',
  '#............#',
  '#.+......+..+#',
  '#..t......t..#',
  '#............#',
  '#....ii......#',
  '#............#',
  '#..t......t..#',
  '#.+......+..+#',
  '#p.P......P.p#',
  '#P*p......p*P#',
  '#p.P......P.p#',
  '#............#',
  '##############',
];

const LID_WEST = [
  '##############',
  '#:T:t:T:t:T:t#',
  '#:T:t:T:t:T:t#',
  '#pT:t:I:t:T:P#',
  '##############',
];

const LID_EAST = [
  '##############',
  '#t:T:t:T:t:T:#',
  '#t:T:t:T:t:T:#',
  '#P:T:t:I:t:Tp#',
  '##############',
];

const LID_BACK = [
  '##############',
  '#:T:t:T:t:T:t#',
  '#:T:t:I:t:T:t#',
  '#pT:t:T:t:T:P#',
  '##############',
];

/** Front lid: dark teal latch slot kept in the current UV columns. */
const LID_FRONT = [
  '##############',
  '#:T:t:nNn:t:T#',
  '#:T:t:Nnn:t:T#',
  '#pT:t:nNn:t:P#',
  '##############',
];

const BODY_WEST = [
  '##############',
  '#:T:t:T:t:T:t#',
  '#:T:t:T:t:T:t#',
  '#:T:t:T:t:T:t#',
  '#:T:t:T:t:T:t#',
  '#:T:t:I:t:T:t#',
  '#:T:p:T:t:P:t#',
  '#pP:t:P:t:P:p#',
  '#P*pP:*:pP:*P#',
  '##############',
];

const BODY_EAST = [
  '##############',
  '#t:T:t:T:t:T:#',
  '#t:T:t:T:t:T:#',
  '#t:T:t:T:t:T:#',
  '#t:T:t:T:t:T:#',
  '#t:T:t:I:t:T:#',
  '#t:P:t:T:p:T:#',
  '#p:P:t:P:t:Pp#',
  '#P*:pP:*:Pp*P#',
  '##############',
];

const BODY_BACK = [
  '##############',
  '#:T:t:T:t:T:t#',
  '#:T:t:T:t:T:t#',
  '#::t::::t::::#',
  '#....I..I....#',
  '#..p.P..P.p..#',
  '#.pP.pppp.Pp.#',
  '#pP*p.PP.p*Pp#',
  '#P*P..**..P*P#',
  '##############',
];

/**
 * Front body: gold/lime latch is a separate 3D mesh. Keep a dark teal recess
 * in both possible UV slots and a teal oval around the lock; purple only at
 * the lower corners so the «нос» is not recoloured.
 */
const BODY_FRONT = [
  '##############',
  '#:T:t:nNn:t:T#',
  '#:T:C:Nnn:C:T#',
  '#::cC.::.Cc::#',
  '#:.cC....Cc.:#',
  '#:T:C:tCt:C:T#',
  '#:T:t:T:t:T:t#',
  '#pP:t:nNn:t:P#',
  '#P*p:Nnn:.p*P#',
  '##############',
];

const BLOCK_TILE = [
  '################',
  '#P+:........:+P#',
  '#:+..i....i..+:#',
  '#:..ip.**.pi..:#',
  '#T:T:T:T:T:T:T:#',
  '#:T::nGGGn::T:t#',
  '#:T::nGgGn::T:t#',
  '#:T::nGLLn::T:t#',
  '#:T::nGLGn::T:t#',
  '#:T:t::nN::t:T:#',
  '#:T:t:T::T:t:T:#',
  '#pP:t......t:Pp#',
  '#P*p........p*P#',
  '#pP:........:Pp#',
  '#P+:........:+P#',
  '################',
];

function paintBlockIcon() {
  const extra = {
    ...PALETTE,
    G: px(62, 186, 92),
    L: px(168, 230, 78),
    g: px(255, 236, 92),
  };
  const img = createImage(16, 16);
  for (let y = 0; y < 16; y += 1) {
    const row = BLOCK_TILE[y];
    if (row.length !== 16) throw new Error(`block tile row ${y} width ${row.length}`);
    for (let x = 0; x < 16; x += 1) {
      const color = extra[row[x]] ?? PALETTE[row[x]];
      if (!color) throw new Error(`block tile unknown '${row[x]}'`);
      put(img, x, y, color);
    }
  }
  return img;
}

export function paintPortalChestAtlas(latchSource) {
  const logical = createImage(64, 64);
  paintMap(logical, 14, 0, LID_UNDER);
  paintMap(logical, 28, 0, LID_TOP);
  paintMap(logical, 0, 14, LID_WEST);
  paintMap(logical, 14, 14, LID_BACK);
  paintMap(logical, 28, 14, LID_EAST);
  paintMap(logical, 42, 14, LID_FRONT);
  paintMap(logical, 14, 19, BODY_BOTTOM);
  paintMap(logical, 28, 19, BODY_IN);
  paintMap(logical, 0, 33, BODY_WEST);
  paintMap(logical, 14, 33, BODY_BACK);
  paintMap(logical, 28, 33, BODY_EAST);
  paintMap(logical, 42, 33, BODY_FRONT);

  grain(logical, 28, 0, 14, 14, 3);
  grain(logical, 14, 19, 14, 14, 11);
  grain(logical, 0, 33, 14, 10, 51);
  grain(logical, 14, 33, 14, 10, 32);
  grain(logical, 28, 33, 14, 10, 52);
  grain(logical, 42, 33, 14, 10, 31);
  grain(logical, 42, 14, 14, 5, 21);

  const out = scaleNearest(logical, 2);
  blit(latchSource, 0, 0, 12, 10, out, 0, 0);
  return out;
}

function latchEquals(a, b) {
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 12; x += 1) {
      const pa = get(a, x, y);
      const pb = get(b, x, y);
      if (pa[0] !== pb[0] || pa[1] !== pb[1] || pa[2] !== pb[2] || pa[3] !== pb[3]) return false;
    }
  }
  return true;
}

export async function writePortalChestTextures() {
  const current = decodeRgbaPng(await readFile(portalPath));
  if (current.width !== 128 || current.height !== 128) {
    throw new Error(`expected 128×128 portal.png, got ${current.width}×${current.height}`);
  }
  const painted = paintPortalChestAtlas(current);
  if (!latchEquals(current, painted)) {
    throw new Error('latch 12×10 pixels changed — abort');
  }
  await writeFile(portalPath, encodeRgbaPng(painted));
  await writeFile(blockPath, encodeRgbaPng(paintBlockIcon()));
  return { portalPath, blockPath };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { portalPath: outPortal, blockPath: outBlock } = await writePortalChestTextures();
  console.log('wrote', outPortal);
  console.log('wrote', outBlock);
  console.log('latch 12×10 identical to previous');
}
