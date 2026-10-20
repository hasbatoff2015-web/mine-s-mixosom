/**
 * Build-time player skin catalog.
 *
 * Scans `public/textures/player/skins/*.png` and writes a data-only TypeScript module
 * imported by both the client and the Node server. The browser never reads the directory.
 *
 *   node scripts/generate-player-skins.mjs
 *   node scripts/generate-player-skins.mjs --check
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PlayerSkinCatalogError,
  classifyPlayerSkinModel,
  readPlayerSkinPng,
  scanPlayerSkinAlphaBuffer,
} from './player-skin-png.mjs';

export const QA_PLAYER_SKIN_ID = 'player_uv_test';
export const NPC_PLAYER_SKIN_ID = 'buyer_merchant';
export const DEFAULT_PLAYER_SKIN_ID = 'frontier_explorer';
export const SKIN_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

const DEFAULT_SKINS_DIR = 'public/textures/player/skins';
const DEFAULT_OVERRIDES = 'src/player/appearance/playerSkinModelOverrides.json';
const DEFAULT_OUTPUT = 'src/player/appearance/generatedPlayerSkins.ts';
const DEFAULT_STORE_CATALOG = 'src/player/appearance/skinStoreCatalog.ts';

const GENERATED_LINE = /^  \{ id: '([a-zA-Z0-9_-]+)', texturePath: '(player\/skins\/[a-zA-Z0-9_-]+)', defaultModel: '(classic|slim)'(?:, outerLayerAlpha: 'translucent')? \},$/;

/**
 * @param {string} source
 */
export function parseGeneratedPlayerSkinModule(source) {
  const start = source.indexOf('Object.freeze([');
  const end = source.indexOf(']);');
  if (start < 0 || end < start) {
    throw new Error('Generated player skin catalog is missing Object.freeze([ ... ]).');
  }
  const body = source.slice(start, end);
  /** @type {{ id: string, texturePath: string, defaultModel: 'classic' | 'slim', outerLayerAlpha?: 'translucent' }[]} */
  const descriptors = [];
  for (const line of body.split('\n')) {
    if (!line.startsWith('  {')) continue;
    const match = GENERATED_LINE.exec(line);
    if (!match) throw new Error(`Generated player skin catalog has an unexpected row: ${line}`);
    /** @type {{ id: string, texturePath: string, defaultModel: 'classic' | 'slim', outerLayerAlpha?: 'translucent' }} */
    const descriptor = {
      id: match[1],
      texturePath: match[2],
      defaultModel: /** @type {'classic' | 'slim'} */ (match[3]),
    };
    if (line.includes("outerLayerAlpha: 'translucent'")) descriptor.outerLayerAlpha = 'translucent';
    descriptors.push(descriptor);
  }
  if (descriptors.length === 0) throw new Error('Generated player skin catalog is empty.');
  return descriptors;
}

/**
 * @param {string} raw
 * @param {string} label
 * @returns {{ models: Record<string, 'classic' | 'slim'>, outerLayerAlpha: Record<string, 'binary' | 'translucent'> }}
 */
export function parsePlayerSkinModelOverrides(raw, label = 'playerSkinModelOverrides.json') {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid JSON';
    throw new PlayerSkinCatalogError(label, `Model overrides are not valid JSON (${reason}).`, 'Fix the JSON syntax.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.models || typeof parsed.models !== 'object' || Array.isArray(parsed.models)) {
    throw new PlayerSkinCatalogError(
      label,
      'Model overrides must be an object with a "models" map.',
      'Use { "models": { "skin_id": "classic" } }.',
    );
  }
  /** @type {Record<string, 'classic' | 'slim'>} */
  const models = {};
  for (const [id, model] of Object.entries(parsed.models)) {
    if (!SKIN_ID_PATTERN.test(id)) {
      throw new PlayerSkinCatalogError(
        label,
        `Override id "${id}" is not a safe skin id.`,
        'Use 1–64 characters from A–Z, a–z, 0–9, underscore, and hyphen.',
      );
    }
    if (model !== 'classic' && model !== 'slim') {
      throw new PlayerSkinCatalogError(
        label,
        `Override for "${id}" must be "classic" or "slim".`,
        'Replace the value and regenerate the catalog.',
      );
    }
    models[id] = model;
  }
  /** @type {Record<string, 'binary' | 'translucent'>} */
  const outerLayerAlpha = {};
  if (parsed.outerLayerAlpha !== undefined) {
    if (!parsed.outerLayerAlpha || typeof parsed.outerLayerAlpha !== 'object' || Array.isArray(parsed.outerLayerAlpha)) {
      throw new PlayerSkinCatalogError(
        label,
        'outerLayerAlpha overrides must be a map of skin id to "binary" or "translucent".',
        'Remove the field or fix the map.',
      );
    }
    for (const [id, value] of Object.entries(parsed.outerLayerAlpha)) {
      if (!SKIN_ID_PATTERN.test(id)) {
        throw new PlayerSkinCatalogError(
          label,
          `Outer-alpha override id "${id}" is not a safe skin id.`,
          'Use the same id as the PNG file name.',
        );
      }
      if (value !== 'binary' && value !== 'translucent') {
        throw new PlayerSkinCatalogError(
          label,
          `Outer-alpha override for "${id}" must be "binary" or "translucent".`,
          'Replace the value and regenerate the catalog.',
        );
      }
      outerLayerAlpha[id] = value;
    }
  }
  return { models, outerLayerAlpha };
}

/**
 * @param {readonly { id: string, texturePath: string, defaultModel: string, outerLayerAlpha?: string }[]} descriptors
 */
export function renderPlayerSkinModule(descriptors) {
  const rows = descriptors.map((skin) => {
    const alpha = skin.outerLayerAlpha === 'translucent' ? ", outerLayerAlpha: 'translucent'" : '';
    return `  { id: '${skin.id}', texturePath: '${skin.texturePath}', defaultModel: '${skin.defaultModel}'${alpha} },`;
  });
  return `// Generated by scripts/generate-player-skins.mjs. Do not edit by hand.
// Regenerate with \`npm run skins:generate\`. Check with \`npm run skins:check\`.
export const GENERATED_MINECRAFT_SKINS: readonly {
  readonly id: string;
  readonly texturePath: string;
  readonly defaultModel: 'classic' | 'slim';
  readonly outerLayerAlpha?: 'translucent';
}[] = Object.freeze([
${rows.join('\n')}
]);
`;
}

/**
 * @param {{
 *   skinsDir: string,
 *   overrides?: Record<string, 'classic' | 'slim'>,
 *   alphaOverrides?: Record<string, 'binary' | 'translucent'>,
 *   npcIds?: readonly string[],
 *   requiredIds?: readonly string[],
 *   reservedIds?: readonly string[],
 * }} options
 */
export function buildPlayerSkinCatalog(options) {
  const overrides = options.overrides ?? {};
  const alphaOverrides = options.alphaOverrides ?? {};
  const npcIds = new Set(options.npcIds ?? []);
  const requiredIds = new Set(options.requiredIds ?? []);
  const reservedIds = new Set(options.reservedIds ?? [QA_PLAYER_SKIN_ID]);
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const names = [];
  for (const name of readdirSync(options.skinsDir)) {
    if (/\.png$/i.test(name) && !name.endsWith('.png')) {
      errors.push(new PlayerSkinCatalogError(
        name,
        'The PNG extension must be lowercase ".png".',
        'Rename the file so the catalog can see it.',
      ).message);
      continue;
    }
    if (name.endsWith('.png')) names.push(name);
  }
  names.sort();
  /**
   * @type {{
   *   id: string,
   *   fileName: string,
   *   texturePath: string,
   *   defaultModel: 'classic' | 'slim',
   *   outerLayerAlpha?: 'translucent',
   *   role: 'player' | 'npc',
   *   modelSource: 'override' | 'classified' | 'fallback',
   *   confidence: 'high' | 'ambiguous',
   *   classifiedModel: 'classic' | 'slim',
   *   alphaSource: 'scan' | 'override',
   *   scannedOuterAlpha: 'binary' | 'translucent',
   * }[]}
   */
  const discovered = [];
  const seenIds = new Set();
  /** @type {Map<string, string>} */
  const seenLower = new Map();

  for (const fileName of names) {
    const id = fileName.slice(0, -'.png'.length);
    if (!SKIN_ID_PATTERN.test(id)) {
      errors.push(new PlayerSkinCatalogError(
        fileName,
        `File name "${fileName}" is not a safe skin id.`,
        'Rename it to 1–64 characters from A–Z, a–z, 0–9, underscore, and hyphen, then keep the .png extension.',
      ).message);
      continue;
    }
    if (reservedIds.has(id)) {
      errors.push(new PlayerSkinCatalogError(
        fileName,
        `Id "${id}" is reserved and cannot be registered from this folder.`,
        'Rename the PNG. player_uv_test stays a DEV sheet outside the player skin directory.',
      ).message);
      continue;
    }
    const lower = id.toLowerCase();
    const previous = seenLower.get(lower);
    if (previous) {
      errors.push(new PlayerSkinCatalogError(
        fileName,
        `Id "${id}" collides with "${previous}" when compared case-insensitively.`,
        'Keep a single PNG per skin id.',
      ).message);
      continue;
    }
    seenLower.set(lower, id);
    seenIds.add(id);
    let decoded;
    try {
      decoded = readPlayerSkinPng(resolve(options.skinsDir, fileName));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    const classification = classifyPlayerSkinModel(decoded.alpha);
    const override = overrides[id];
    const defaultModel = override ?? classification.model;
    /** @type {'override' | 'classified' | 'fallback'} */
    let modelSource = 'classified';
    if (override) modelSource = 'override';
    else if (classification.confidence === 'ambiguous') modelSource = 'fallback';
    const alpha = scanPlayerSkinAlphaBuffer(decoded.alpha, defaultModel);
    const scannedOuterAlpha = alpha.outerIntermediatePixels > 0 ? 'translucent' : 'binary';
    const alphaOverride = alphaOverrides[id];
    /** @type {{ id: string, fileName: string, texturePath: string, defaultModel: 'classic' | 'slim', outerLayerAlpha?: 'translucent', role: 'player' | 'npc', modelSource: 'override' | 'classified' | 'fallback', confidence: 'high' | 'ambiguous', classifiedModel: 'classic' | 'slim', alphaSource: 'scan' | 'override', scannedOuterAlpha: 'binary' | 'translucent' }} */
    const descriptor = {
      id,
      fileName,
      texturePath: `player/skins/${id}`,
      defaultModel,
      role: npcIds.has(id) ? 'npc' : 'player',
      modelSource,
      confidence: classification.confidence,
      classifiedModel: classification.model,
      alphaSource: alphaOverride ? 'override' : 'scan',
      scannedOuterAlpha,
    };
    const resolvedAlpha = alphaOverride ?? scannedOuterAlpha;
    if (resolvedAlpha === 'translucent') descriptor.outerLayerAlpha = 'translucent';
    discovered.push(descriptor);
  }

  for (const id of Object.keys(overrides).sort()) {
    if (!seenIds.has(id)) {
      errors.push(new PlayerSkinCatalogError(
        `${id}.png`,
        `Model override "${id}" does not match a PNG in the skin directory.`,
        'Remove the override or add the PNG.',
      ).message);
    }
  }
  for (const id of Object.keys(alphaOverrides).sort()) {
    if (!seenIds.has(id)) {
      errors.push(new PlayerSkinCatalogError(
        `${id}.png`,
        `Outer-alpha override "${id}" does not match a PNG in the skin directory.`,
        'Remove the override or add the PNG.',
      ).message);
    }
  }
  for (const id of [...requiredIds].sort()) {
    if (!seenIds.has(id)) {
      errors.push(new PlayerSkinCatalogError(
        `${id}.png`,
        `Required skin "${id}" is missing from the skin directory.`,
        'Restore the PNG. The default player skin and the buyer NPC cannot be dropped silently.',
      ).message);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Player skin catalog failed.\n${errors.map((line) => `- ${line}`).join('\n')}`);
  }

  discovered.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (new Set(discovered.map((skin) => skin.texturePath)).size !== discovered.length) {
    throw new Error('Player skin catalog produced duplicate texture paths.');
  }
  /** @type {string[]} */
  const warnings = [];
  for (const skin of discovered) {
    if (skin.modelSource === 'fallback') {
      warnings.push(
        `${skin.fileName}: Classic/Slim is ambiguous, so the catalog uses classic. Add "${skin.id}" to playerSkinModelOverrides.json to lock classic or slim.`,
      );
    } else if (skin.modelSource === 'override' && skin.confidence === 'high' && skin.defaultModel !== skin.classifiedModel) {
      warnings.push(
        `${skin.fileName}: override model "${skin.defaultModel}" disagrees with the classified model "${skin.classifiedModel}". The override is kept.`,
      );
    }
  }
  return { descriptors: discovered, warnings };
}

/**
 * @param {{
 *   projectRoot?: string,
 *   skinsDir?: string,
 *   overridesPath?: string,
 *   outFile?: string,
 *   check?: boolean,
 *   npcIds?: readonly string[],
 *   requiredIds?: readonly string[],
 *   reservedIds?: readonly string[],
 *   overrides?: Record<string, 'classic' | 'slim'>,
 *   alphaOverrides?: Record<string, 'binary' | 'translucent'>,
 * }} [options]
 */
export function generatePlayerSkinCatalog(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const skinsDir = resolve(projectRoot, options.skinsDir ?? DEFAULT_SKINS_DIR);
  const outFile = resolve(projectRoot, options.outFile ?? DEFAULT_OUTPUT);
  const parsedOverrides = options.overrides
    ? { models: options.overrides, outerLayerAlpha: options.alphaOverrides ?? {} }
    : parsePlayerSkinModelOverrides(
      readFileSync(resolve(projectRoot, options.overridesPath ?? DEFAULT_OVERRIDES), 'utf8'),
      options.overridesPath ?? DEFAULT_OVERRIDES,
    );
  const built = buildPlayerSkinCatalog({
    skinsDir,
    overrides: parsedOverrides.models,
    alphaOverrides: parsedOverrides.outerLayerAlpha,
    npcIds: options.npcIds ?? [NPC_PLAYER_SKIN_ID],
    requiredIds: options.requiredIds ?? [DEFAULT_PLAYER_SKIN_ID, NPC_PLAYER_SKIN_ID],
    reservedIds: options.reservedIds ?? [QA_PLAYER_SKIN_ID],
  });
  const rendered = renderPlayerSkinModule(built.descriptors);
  let previous = '';
  try {
    previous = readFileSync(outFile, 'utf8');
  } catch {
    previous = '';
  }
  const changed = previous !== rendered;
  if (options.check) {
    if (changed) {
      throw new Error(
        `Generated player skin catalog is stale: ${outFile}\nRun npm run skins:generate and commit src/player/appearance/generatedPlayerSkins.ts with the PNG files.`,
      );
    }
  } else if (changed) {
    mkdirSync(dirname(outFile), { recursive: true });
    const temporary = `${outFile}.tmp`;
    writeFileSync(temporary, rendered);
    renameSync(temporary, outFile);
  }
  return {
    changed,
    warnings: built.warnings,
    descriptors: built.descriptors,
    outFile,
  };
}

const RARITY_GROUP_NAMES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'];

/**
 * Read the rarity id lists from skinStoreCatalog.ts.
 * NPC and DEV sheets are not part of these lists.
 * @param {string} source
 */
export function readSkinRarityAssignments(source) {
  /** @type {Record<string, string[]>} */
  const groups = {};
  for (const rarity of RARITY_GROUP_NAMES) {
    const match = source.match(new RegExp(`const ${rarity}_SKIN_IDS = \\[([\\s\\S]*?)\\] as const;`));
    if (!match) throw new Error(`Skin rarity group ${rarity} is missing from skinStoreCatalog.ts.`);
    const ids = [...match[1].matchAll(/'([A-Za-z0-9_-]+)'/g)].map((found) => found[1]);
    if (ids.length === 0) throw new Error(`Skin rarity group ${rarity} is empty.`);
    groups[rarity.toLowerCase()] = ids;
  }
  return groups;
}

/**
 * A gameplay PNG with no rarity entry fails the build.
 * It is not treated as a free common skin.
 * @param {readonly string[]} playerIds
 * @param {Record<string, readonly string[]>} groups
 */
export function assertPlayerSkinsHaveRarity(playerIds, groups) {
  /** @type {Map<string, string>} */
  const assigned = new Map();
  for (const [rarity, ids] of Object.entries(groups)) {
    for (const id of ids) {
      if (assigned.has(id)) throw new Error(`Skin ${id} is listed in more than one rarity.`);
      assigned.set(id, rarity);
    }
  }
  for (const id of playerIds) {
    if (!assigned.has(id)) throw new Error(`Skin ${id} has no rarity metadata.`);
  }
  for (const id of assigned.keys()) {
    if (!playerIds.includes(id)) {
      throw new Error(`Skin ${id} has rarity metadata but is not a production player skin.`);
    }
  }
}

/**
 * @param {string} [catalogPath]
 * @param {readonly { id: string, role: 'player' | 'npc' }[]} [descriptors]
 */
export function assertGeneratedSkinsHaveRarity(catalogPath = DEFAULT_STORE_CATALOG, descriptors = []) {
  const groups = readSkinRarityAssignments(readFileSync(resolve(catalogPath), 'utf8'));
  const playerIds = descriptors.filter((skin) => skin.role === 'player').map((skin) => skin.id);
  assertPlayerSkinsHaveRarity(playerIds, groups);
  return groups;
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryUrl) {
  const check = process.argv.includes('--check');
  try {
    const result = generatePlayerSkinCatalog({ check });
    const players = result.descriptors.filter((skin) => skin.role === 'player').length;
    const npcs = result.descriptors.filter((skin) => skin.role === 'npc').length;
    const ambiguous = result.descriptors.filter((skin) => skin.modelSource === 'fallback').length;
    console.log(`[player-skins] ${result.descriptors.length} PNG, ${players} player, ${npcs} npc, ${ambiguous} ambiguous model`);
    for (const warning of result.warnings) console.warn(`[player-skins] ${warning}`);
    const groups = assertGeneratedSkinsHaveRarity(
      resolve(process.cwd(), DEFAULT_STORE_CATALOG),
      result.descriptors,
    );
    const covered = Object.values(groups).reduce((sum, ids) => sum + ids.length, 0);
    console.log(`[player-skins] rarity metadata covers ${covered} player skins`);
    console.log(check
      ? '[player-skins] generated catalog matches the PNG directory'
      : `[player-skins] ${result.changed ? 'updated' : 'unchanged'} ${result.outFile}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
