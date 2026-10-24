import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { readPlayerSkinContentHashes } from '../scripts/player-skin-content-hashes.mjs';
import {
  NPC_PLAYER_SKIN_ID,
  QA_PLAYER_SKIN_ID,
  buildPlayerSkinCatalog,
  generatePlayerSkinCatalog,
  parseGeneratedPlayerSkinModule,
} from '../scripts/generate-player-skins.mjs';
import {
  classifyPlayerSkinModel,
  decodePlayerSkinPng,
  playerSkinLayerMasks,
  scanPlayerSkinAlphaBuffer,
} from '../scripts/player-skin-png.mjs';
import {
  BUILTIN_MINECRAFT_SKINS,
  NPC_PLAYER_SKIN_ID as BUILTIN_NPC_ID,
  PRODUCTION_PLAYER_SKINS,
  QA_PLAYER_SKIN_ID as BUILTIN_QA_ID,
  skinDescriptor,
} from '../src/player/appearance/builtinSkins';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/player/appearance/PlayerAppearance';
import overridesDocument from '../src/player/appearance/playerSkinModelOverrides.json';

/** Models shipped before autodiscovery. The generator must not change these. */
const HISTORICAL_MODELS = {
  '00f6338deb336a6e': 'slim',
  '0edde60fa266fac7': 'slim',
  '0f15ad5e5c148f40': 'slim',
  '134f7844391b9382': 'slim',
  '1ea0cee32dd870ba': 'slim',
  '24f3321d8a6ec3cf': 'slim',
  '2cd5c775d21141bd': 'classic',
  '2e8c98dab33b766f': 'slim',
  '3095ca131afb5705': 'slim',
  '333971ad9949346f': 'classic',
  frontier_explorer: 'classic',
  '37e10d3fc9798c98': 'classic',
  '48458b73d1075c60': 'classic',
  '4c7afbcaeb250f76': 'slim',
  '55264c2ebdb9ed9d': 'slim',
  '554ec16161f085c0': 'slim',
  '5620ef1df645276e': 'classic',
  '5bc8ad7edfb7ee86': 'slim',
  '6119ea42953f535e': 'slim',
  '7c6103b44dc95a65': 'classic',
  '7d729ce6664b4fdc': 'slim',
  '803d711fa90035a7': 'slim',
  '8bb9550c824ce10e': 'slim',
  '8bc8f731d8e5ca7c': 'classic',
  '8cd9d4ce5d4d8abf': 'classic',
  '960e4805666e1591': 'classic',
  '96680c9dd86bcabc': 'slim',
  '985483b761dcaceb': 'classic',
  ae1fddb72664eaf2: 'classic',
  b1ebc7b52d0c7f61: 'slim',
  b5db0069a126bbf3: 'slim',
  bc3e8672b6d7c821: 'slim',
  bc7db647674d1f01: 'slim',
  c026b7f8552098de: 'slim',
  c6ffa466e0aa2e48: 'classic',
  c7e629b4f28c56a5: 'slim',
  d5f7c69c89edd405: 'classic',
  dce095dc5bddc925: 'classic',
  dcf537aec75f761d: 'slim',
  dee6149d4583a54b: 'classic',
  e126128225dccc51: 'classic',
  e203f6b2fd4c30dc: 'classic',
  e3eb6f99ea1c3fe1: 'slim',
  e936712cae837a84: 'classic',
  f47ebc2553e02251: 'slim',
};

/** PNGs that were on disk but absent from the old static catalog. */
const REMOVED_PLAYER_SKIN_ID = '10126ef69e2cdfdf';

const DISCOVERED_MODELS = {
  '14fcedd090af47a4': 'slim',
  '1e8fa3ce56f39d6c': 'slim',
  '211085684a03470a': 'slim',
  '2ad6187a00bc4712': 'slim',
  '2b72a352b69d2d22': 'slim',
  '3171abd1dedfa703': 'slim',
  '5a90d9efb3029994': 'classic',
  '65462827594073e4': 'classic',
  '6fdcd3bc5850aeed': 'classic',
  '7e91017ffce8dc04': 'classic',
  '8735c781375740c0': 'slim',
  '9f612d6b63970655': 'classic',
  b834368ba96d6574: 'slim',
  d3f7b2f0b6d834b9: 'classic',
  dcbbff5cb0c44e79: 'slim',
  de887af6e5cd16c4: 'slim',
  ded78bc20ae6f892: 'slim',
  ef110ed6514bcf80: 'slim',
  f7b4ab3f68df5fca: 'slim',
};

const DISCOVERED_TRANSLUCENT = [
  '1e8fa3ce56f39d6c',
  '6fdcd3bc5850aeed',
  'b834368ba96d6574',
];

const dirs = [];

function tempSkins() {
  const dir = mkdtempSync(join(tmpdir(), 'fc-skins-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData) >>> 0, 0);
  return Buffer.concat([length, typeAndData, checksum]);
}

function encodePng(width, height, rgba, colorType = 6) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const channels = colorType === 2 ? 3 : 4;
  const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * channels + 1);
    raw[row] = 0;
    if (channels === 4) {
      rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
    } else {
      for (let x = 0; x < width; x += 1) {
        const source = (y * width + x) * 4;
        const target = row + 1 + x * 3;
        raw[target] = rgba[source];
        raw[target + 1] = rgba[source + 1];
        raw[target + 2] = rgba[source + 2];
      }
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function blankRgba(alpha = 0) {
  const rgba = Buffer.alloc(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i += 1) {
    rgba[i * 4] = 40;
    rgba[i * 4 + 1] = 80;
    rgba[i * 4 + 2] = 120;
    rgba[i * 4 + 3] = alpha;
  }
  return rgba;
}

function paintMask(rgba, pixels, alpha) {
  for (const index of pixels) {
    rgba[index * 4 + 3] = alpha;
  }
}

function armMask(model) {
  const masks = playerSkinLayerMasks(model);
  const arms = new Set();
  for (const index of masks.base) {
    const x = index % 64;
    const y = Math.floor(index / 64);
    const right = x >= 40 && x < 56 && y >= 16 && y < 32;
    const left = x >= 32 && x < 48 && y >= 48 && y < 64;
    if (right || left) arms.add(index);
  }
  return arms;
}

function classicPng() {
  const rgba = blankRgba(0);
  paintMask(rgba, armMask('classic'), 255);
  return encodePng(64, 64, rgba);
}

function slimPng() {
  const rgba = blankRgba(0);
  paintMask(rgba, armMask('slim'), 255);
  return encodePng(64, 64, rgba);
}

function ambiguousPng() {
  return encodePng(64, 64, blankRgba(0));
}

function catalogFrom(dir, overrides = {}, extra = {}) {
  return buildPlayerSkinCatalog({
    skinsDir: dir,
    overrides,
    npcIds: extra.npcIds ?? [],
    requiredIds: extra.requiredIds ?? [],
    reservedIds: extra.reservedIds ?? [QA_PLAYER_SKIN_ID],
    alphaOverrides: extra.alphaOverrides ?? {},
  });
}

function publicSkinIds() {
  return readdirSync('public/textures/player/skins')
    .filter((name) => name.endsWith('.png'))
    .map((name) => name.slice(0, -'.png'.length))
    .sort();
}

describe('player skin catalog generator', () => {
  it('discovers a newly added PNG without editing builtinSkins.ts', () => {
    const dir = tempSkins();
    writeFileSync(join(dir, 'kept_classic.png'), classicPng());
    writeFileSync(join(dir, 'kept_slim.png'), slimPng());
    const first = catalogFrom(dir);
    expect(first.descriptors.map((skin) => skin.id)).toEqual(['kept_classic', 'kept_slim']);
    writeFileSync(join(dir, 'added_skin.png'), classicPng());
    const second = catalogFrom(dir);
    expect(second.descriptors.map((skin) => skin.id)).toEqual(['added_skin', 'kept_classic', 'kept_slim']);
    expect(second.descriptors.find((skin) => skin.id === 'kept_slim')?.defaultModel).toBe('slim');
    const builtin = readFileSync('src/player/appearance/builtinSkins.ts', 'utf8');
    expect(builtin).toContain('GENERATED_MINECRAFT_SKINS');
    expect(builtin).not.toContain('kept_classic');
    expect(builtin).not.toContain('added_skin');
  });

  it('drops a removed PNG and still excludes the NPC from the player list', () => {
    const dir = tempSkins();
    writeFileSync(join(dir, 'staying.png'), classicPng());
    writeFileSync(join(dir, 'leaving.png'), slimPng());
    writeFileSync(join(dir, 'buyer_merchant.png'), classicPng());
    const before = catalogFrom(dir, { buyer_merchant: 'classic' }, { npcIds: ['buyer_merchant'] });
    expect(before.descriptors.map((skin) => skin.id)).toEqual(['buyer_merchant', 'leaving', 'staying']);
    rmSync(join(dir, 'leaving.png'));
    const after = catalogFrom(dir, { buyer_merchant: 'classic' }, { npcIds: ['buyer_merchant'] });
    expect(after.descriptors.map((skin) => skin.id)).toEqual(['buyer_merchant', 'staying']);
    expect(after.descriptors.find((skin) => skin.id === 'buyer_merchant')?.role).toBe('npc');
    expect(after.descriptors.filter((skin) => skin.role === 'player').map((skin) => skin.id)).toEqual(['staying']);
  });

  it('renders the same module for the same files, including order', () => {
    const dir = tempSkins();
    writeFileSync(join(dir, 'b_skin.png'), slimPng());
    writeFileSync(join(dir, 'a_skin.png'), classicPng());
    const first = catalogFrom(dir);
    const second = catalogFrom(dir);
    expect(second.descriptors).toEqual(first.descriptors);
    expect(first.descriptors.map((skin) => skin.id)).toEqual(['a_skin', 'b_skin']);
    const out = join(dir, 'generatedPlayerSkins.ts');
    const once = generatePlayerSkinCatalog({
      skinsDir: dir,
      outFile: out,
      overrides: {},
      npcIds: [],
      requiredIds: [],
    });
    const twice = generatePlayerSkinCatalog({
      skinsDir: dir,
      outFile: out,
      overrides: {},
      npcIds: [],
      requiredIds: [],
    });
    expect(once.changed).toBe(true);
    expect(twice.changed).toBe(false);
    expect(parseGeneratedPlayerSkinModule(readFileSync(out, 'utf8')).map((skin) => skin.id)).toEqual(['a_skin', 'b_skin']);
  });

  it('rejects invalid PNG bytes, dimensions, color type, CRC, and unsafe ids', () => {
    const dir = tempSkins();
    writeFileSync(join(dir, 'notes.txt'), 'not a skin');
    expect(() => catalogFrom(dir)).not.toThrow();

    writeFileSync(join(dir, 'bad_signature.png'), Buffer.from('not a png file!!!!'));
    expect(() => catalogFrom(dir)).toThrow(/bad_signature\.png/);
    expect(() => catalogFrom(dir)).toThrow(/not a PNG/);
    rmSync(join(dir, 'bad_signature.png'));

    writeFileSync(join(dir, 'legacy.png'), encodePng(64, 32, Buffer.alloc(64 * 32 * 4, 255)));
    expect(() => catalogFrom(dir)).toThrow(/legacy\.png/);
    expect(() => catalogFrom(dir)).toThrow(/64×32|64×64/);
    rmSync(join(dir, 'legacy.png'));

    writeFileSync(join(dir, 'rgb_only.png'), encodePng(64, 64, blankRgba(255), 2));
    expect(() => catalogFrom(dir)).toThrow(/rgb_only\.png/);
    expect(() => catalogFrom(dir)).toThrow(/color type 2/);
    rmSync(join(dir, 'rgb_only.png'));

    const broken = classicPng();
    broken[29] ^= 0xff;
    writeFileSync(join(dir, 'bad_crc.png'), broken);
    expect(() => catalogFrom(dir)).toThrow(/bad_crc\.png/);
    expect(() => catalogFrom(dir)).toThrow(/CRC/);
    rmSync(join(dir, 'bad_crc.png'));

    writeFileSync(join(dir, 'bad name.png'), classicPng());
    expect(() => catalogFrom(dir)).toThrow(/bad name\.png/);
    expect(() => catalogFrom(dir)).toThrow(/safe skin id/);
    rmSync(join(dir, 'bad name.png'));

    writeFileSync(join(dir, 'player_uv_test.png'), classicPng());
    expect(() => catalogFrom(dir)).toThrow(/player_uv_test\.png/);
    expect(() => catalogFrom(dir)).toThrow(/reserved/);
    rmSync(join(dir, 'player_uv_test.png'));

    writeFileSync(join(dir, 'Hidden.PNG'), classicPng());
    expect(() => catalogFrom(dir)).toThrow(/Hidden\.PNG/);
    expect(() => catalogFrom(dir)).toThrow(/lowercase/);
    rmSync(join(dir, 'Hidden.PNG'));

    mkdirSync(join(dir, 'nested'), { recursive: true });
    writeFileSync(join(dir, 'nested', 'hidden.png'), classicPng());
    const visible = catalogFrom(dir);
    expect(visible.descriptors.map((skin) => skin.id)).not.toContain('hidden');
    expect(visible.descriptors.map((skin) => skin.id)).not.toContain('nested/hidden');
  });

  it('keeps historical models, classifies clear new arms, and honors an override', () => {
    const real = buildPlayerSkinCatalog({
      skinsDir: 'public/textures/player/skins',
      overrides: overridesDocument.models,
      alphaOverrides: overridesDocument.outerLayerAlpha,
      npcIds: [NPC_PLAYER_SKIN_ID],
      requiredIds: ['frontier_explorer', NPC_PLAYER_SKIN_ID],
    });
    for (const [id, model] of Object.entries(HISTORICAL_MODELS)) {
      const skin = real.descriptors.find((entry) => entry.id === id);
      expect(skin?.defaultModel, id).toBe(model);
      expect(skin?.modelSource, id).toBe('override');
      expect(skin?.classifiedModel, id).toBe(model);
      const decoded = decodePlayerSkinPng(readFileSync(`public/textures/player/skins/${id}.png`), `${id}.png`);
      expect(classifyPlayerSkinModel(decoded.alpha).model, id).toBe(model);
      expect(classifyPlayerSkinModel(decoded.alpha).confidence, id).toBe('high');
    }
    for (const [id, model] of Object.entries(DISCOVERED_MODELS)) {
      const skin = real.descriptors.find((entry) => entry.id === id);
      expect(overridesDocument.models[id], id).toBeUndefined();
      expect(skin?.modelSource, id).toBe('classified');
      expect(skin?.confidence, id).toBe('high');
      expect(skin?.defaultModel, id).toBe(model);
      expect(skin?.role, id).toBe('player');
    }
    expect(real.warnings).toEqual([]);

    const dir = tempSkins();
    writeFileSync(join(dir, 'clear_classic.png'), classicPng());
    writeFileSync(join(dir, 'clear_slim.png'), slimPng());
    writeFileSync(join(dir, 'unclear.png'), ambiguousPng());
    const synthetic = catalogFrom(dir, { unclear: 'slim' });
    expect(synthetic.descriptors.find((skin) => skin.id === 'clear_classic')).toMatchObject({
      defaultModel: 'classic',
      modelSource: 'classified',
      confidence: 'high',
    });
    expect(synthetic.descriptors.find((skin) => skin.id === 'clear_slim')).toMatchObject({
      defaultModel: 'slim',
      modelSource: 'classified',
      confidence: 'high',
    });
    expect(synthetic.descriptors.find((skin) => skin.id === 'unclear')).toMatchObject({
      defaultModel: 'slim',
      modelSource: 'override',
      confidence: 'ambiguous',
    });
    const withoutOverride = catalogFrom(dir);
    expect(withoutOverride.descriptors.find((skin) => skin.id === 'unclear')).toMatchObject({
      defaultModel: 'classic',
      modelSource: 'fallback',
    });
    expect(withoutOverride.warnings.join('\n')).toMatch(/unclear\.png/);
    expect(withoutOverride.descriptors.map((skin) => skin.id)).toContain('unclear');
  });

  it('marks only real outer-layer intermediate alpha as translucent', () => {
    const dir = tempSkins();
    const opaque = blankRgba(255);
    writeFileSync(join(dir, 'opaque.png'), encodePng(64, 64, opaque));
    const binary = blankRgba(255);
    const outer = playerSkinLayerMasks('classic').outer;
    const [outerPixel] = outer;
    binary[outerPixel * 4 + 3] = 0;
    writeFileSync(join(dir, 'binary_alpha.png'), encodePng(64, 64, binary));
    const translucent = blankRgba(255);
    translucent[outerPixel * 4 + 3] = 128;
    writeFileSync(join(dir, 'outer_fade.png'), encodePng(64, 64, translucent));
    const unused = blankRgba(255);
    let unusedPixel = 0;
    const base = playerSkinLayerMasks('classic').base;
    while (base.has(unusedPixel) || outer.has(unusedPixel)) unusedPixel += 1;
    unused[unusedPixel * 4 + 3] = 128;
    writeFileSync(join(dir, 'unused_fade.png'), encodePng(64, 64, unused));
    const built = catalogFrom(dir);
    const alphaOf = (id) => built.descriptors.find((skin) => skin.id === id)?.outerLayerAlpha ?? 'binary';
    expect(alphaOf('opaque')).toBe('binary');
    expect(alphaOf('binary_alpha')).toBe('binary');
    expect(alphaOf('outer_fade')).toBe('translucent');
    expect(alphaOf('unused_fade')).toBe('binary');
    const alphaFrom = (rgba) => {
      const alpha = new Uint8Array(64 * 64);
      for (let index = 0; index < alpha.length; index += 1) alpha[index] = rgba[index * 4 + 3];
      return alpha;
    };
    const scanned = scanPlayerSkinAlphaBuffer(alphaFrom(translucent), 'classic');
    expect(scanned.outerIntermediatePixels).toBeGreaterThan(0);
    const unusedScan = scanPlayerSkinAlphaBuffer(alphaFrom(unused), 'classic');
    expect(unusedScan.outerIntermediatePixels).toBe(0);
    expect(unusedScan.unusedIntermediatePixels).toBeGreaterThan(0);
  });

  it('fails --check when a PNG is added and passes again after regeneration', () => {
    const dir = tempSkins();
    const out = join(dir, 'generatedPlayerSkins.ts');
    writeFileSync(join(dir, 'one.png'), classicPng());
    const options = {
      skinsDir: dir,
      outFile: out,
      overrides: {},
      npcIds: [],
      requiredIds: [],
    };
    generatePlayerSkinCatalog(options);
    expect(() => generatePlayerSkinCatalog({ ...options, check: true })).not.toThrow();
    writeFileSync(join(dir, 'two.png'), slimPng());
    expect(() => generatePlayerSkinCatalog({ ...options, check: true })).toThrow(/stale/);
    generatePlayerSkinCatalog(options);
    expect(() => generatePlayerSkinCatalog({ ...options, check: true })).not.toThrow();
    rmSync(join(dir, 'two.png'));
    expect(() => generatePlayerSkinCatalog({ ...options, check: true })).toThrow(/stale/);
  });

  it('gives a new PNG a content hash and changes that hash when the bytes change', () => {
    const dir = tempSkins();
    writeFileSync(join(dir, 'stable.png'), classicPng());
    writeFileSync(join(dir, 'fresh.png'), slimPng());
    const first = readPlayerSkinContentHashes(dir);
    expect(first['player/skins/fresh']).toBe(createHash('sha256').update(slimPng()).digest('hex').slice(0, 16));
    expect(first['player/skins/stable']).toBe(createHash('sha256').update(classicPng()).digest('hex').slice(0, 16));
    const different = blankRgba(255);
    different[0] = 9;
    writeFileSync(join(dir, 'fresh.png'), encodePng(64, 64, different));
    const second = readPlayerSkinContentHashes(dir);
    expect(second['player/skins/fresh']).not.toBe(first['player/skins/fresh']);
    expect(second['player/skins/stable']).toBe(first['player/skins/stable']);
  });
});

describe('shipped player skin catalog', () => {
  it('registers every skins-folder PNG once and keeps QA and NPC out of the selector', () => {
    const files = publicSkinIds();
    const playerFiles = files.filter((id) => id !== 'buyer_merchant');
    expect(new Set(files).size).toBe(files.length);
    expect(PRODUCTION_PLAYER_SKINS.map((skin) => skin.id)).toEqual(playerFiles);
    expect(BUILTIN_MINECRAFT_SKINS.map((skin) => skin.id).filter((id) => id !== QA_PLAYER_SKIN_ID).sort())
      .toEqual([...files].sort());
    expect(BUILTIN_MINECRAFT_SKINS).toHaveLength(files.length + 1);
    expect(PRODUCTION_PLAYER_SKINS).toHaveLength(playerFiles.length);
    expect(playerFiles).toHaveLength(Object.keys(HISTORICAL_MODELS).length + Object.keys(DISCOVERED_MODELS).length);
    for (const skin of PRODUCTION_PLAYER_SKINS) {
      expect(skin.texturePath).toBe(`player/skins/${skin.id}`);
      expect(skin.texturePath).not.toMatch(/\\|\.png$/);
    }
    expect(skinDescriptor(BUILTIN_QA_ID)).toMatchObject({
      id: 'player_uv_test',
      texturePath: 'entity/player_uv_test',
      defaultModel: 'classic',
    });
    expect(skinDescriptor(BUILTIN_NPC_ID)).toMatchObject({
      id: 'buyer_merchant',
      texturePath: 'player/skins/buyer_merchant',
      defaultModel: 'classic',
    });
    expect(skinDescriptor(BUILTIN_NPC_ID)?.outerLayerAlpha).toBeUndefined();
    expect(PRODUCTION_PLAYER_SKINS.some((skin) => skin.id === 'buyer_merchant' || skin.id === 'player_uv_test')).toBe(false);
    expect(files).not.toContain(REMOVED_PLAYER_SKIN_ID);
    expect(PRODUCTION_PLAYER_SKINS.some((skin) => skin.id === REMOVED_PLAYER_SKIN_ID)).toBe(false);
    expect(BUILTIN_MINECRAFT_SKINS.some((skin) => skin.id === REMOVED_PLAYER_SKIN_ID)).toBe(false);
    expect(skinDescriptor(REMOVED_PLAYER_SKIN_ID)).toBeUndefined();
    expect(DEFAULT_PLAYER_APPEARANCE.skinId).toBe('frontier_explorer');
    expect(DEFAULT_PLAYER_APPEARANCE.model).toBe('classic');
    expect(PRODUCTION_PLAYER_SKINS[0]?.id).not.toBe(DEFAULT_PLAYER_APPEARANCE.skinId);
    const generated = parseGeneratedPlayerSkinModule(readFileSync('src/player/appearance/generatedPlayerSkins.ts', 'utf8'));
    expect(generated.map((skin) => skin.id)).not.toContain(QA_PLAYER_SKIN_ID);
    expect(() => generatePlayerSkinCatalog({ check: true })).not.toThrow();
  });

  it('classifies the discovered skins and keeps the historical translucent set', () => {
    for (const id of DISCOVERED_TRANSLUCENT) {
      expect(skinDescriptor(id)?.outerLayerAlpha, id).toBe('translucent');
    }
    for (const id of Object.keys(DISCOVERED_MODELS)) {
      if (!DISCOVERED_TRANSLUCENT.includes(id)) {
        expect(skinDescriptor(id)?.outerLayerAlpha, id).toBeUndefined();
      }
    }
    for (const id of ['00f6338deb336a6e', '0f15ad5e5c148f40', '55264c2ebdb9ed9d', '5bc8ad7edfb7ee86']) {
      expect(skinDescriptor(id)?.outerLayerAlpha, id).toBe('translucent');
    }
    const buyer = decodePlayerSkinPng(readFileSync('public/textures/player/skins/buyer_merchant.png'), 'buyer_merchant.png');
    expect(scanPlayerSkinAlphaBuffer(buyer.alpha, 'classic').outerIntermediatePixels).toBe(1);
    expect(skinDescriptor('buyer_merchant')?.outerLayerAlpha).toBeUndefined();
  });
});
