import { access, copyFile, mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { prepareAuthoredItems } from './authored-item-assets.mjs';

const sourceRoot = join(process.cwd(), 'assets', 'minecraft', 'textures');
const outputRoot = join(process.cwd(), 'public', 'textures');

try {
  await access(sourceRoot);
} catch {
  throw new Error(
    'Local source pack is missing at assets/minecraft/textures. ' +
      'The curated public/textures copy remains untouched.',
  );
}

// Never recursively clear the curated runtime pack. Missing required sources
// fail before writes; this scoped option preserves unrelated curated textures.
const authoredItems = await prepareAuthoredItems(sourceRoot);
const itemsOnly = process.argv.includes('--items-cleanup');

const blocks = {
  stone: 'stone.png',
  grass_block_top: 'grass_top.png',
  grass_block_side: 'grass_side.png',
  dirt: 'dirt.png',
  cobblestone: 'cobblestone.png',
  bedrock: 'bedrock.png',
  sand: 'sand.png',
  sandstone: 'sandstone_normal.png',
  gravel: 'gravel.png',
  clay: 'clay.png',
  snow_block: 'snow.png',
  ice: 'ice.png',
  water: 'water_still.png',
  lava: 'lava_still.png',
  oak_log: 'log_oak.png',
  oak_log_top: 'log_oak_top.png',
  oak_leaves: 'leaves_oak.png',
  oak_planks: 'planks_oak.png',
  birch_log: 'log_birch.png',
  birch_log_top: 'log_birch_top.png',
  birch_leaves: 'leaves_birch.png',
  birch_planks: 'planks_birch.png',
  spruce_log: 'log_spruce.png',
  spruce_log_top: 'log_spruce_top.png',
  spruce_leaves: 'leaves_spruce.png',
  spruce_planks: 'planks_spruce.png',
  coal_ore: 'coal_ore.png',
  iron_ore: 'iron_ore.png',
  gold_ore: 'gold_ore.png',
  redstone_ore: 'redstone_ore.png',
  diamond_ore: 'diamond_ore.png',
  glass: 'glass.png',
  bricks: 'brick.png',
  stone_bricks: 'stonebrick.png',
  bookshelf: 'bookshelf.png',
  obsidian: 'obsidian.png',
  crafting_table_top: 'crafting_table_top.png',
  crafting_table_side: 'crafting_table_side.png',
  crafting_table: 'crafting_table_front.png',
  furnace_top: 'furnace_top.png',
  furnace_side: 'furnace_side.png',
  furnace_front: 'furnace_front_off.png',
  furnace_front_on: 'furnace_front_on.png',
  furnace: 'furnace_front_off.png',
  torch: 'torch_on.png',
  ladder: 'ladder.png',
  white_bed: 'wool_colored_white.png',
  cactus: 'cactus_side.png',
  cactus_top: 'cactus_top.png',
  oak_door: 'door_wood_lower.png',
  oak_door_upper: 'door_wood_upper.png',
  redstone_wire: 'redstone_dust_line0.png',
  redstone_torch: 'redstone_torch_on.png',
  lever: 'lever.png',
  stone_button: 'stone.png',
  oak_pressure_plate: 'planks_oak.png',
  stone_pressure_plate: 'stone.png',
  tnt: 'tnt_side.png',
  oak_slab: 'planks_oak.png',
  stone_slab: 'stone.png',
  cobblestone_slab: 'cobblestone.png',
  birch_slab: 'planks_birch.png',
  spruce_slab: 'planks_spruce.png',
  brick_slab: 'brick.png',
  stone_brick_slab: 'stonebrick.png',
  oak_stairs: 'planks_oak.png',
  stone_stairs: 'stone.png',
  cobblestone_stairs: 'cobblestone.png',
  birch_stairs: 'planks_birch.png',
  spruce_stairs: 'planks_spruce.png',
  brick_stairs: 'brick.png',
  stone_brick_stairs: 'stonebrick.png',
  tall_grass: 'tallgrass.png',
  fern: 'fern.png',
  dandelion: 'flower_dandelion.png',
  poppy: 'flower_rose.png',
  oxeye_daisy: 'flower_oxeye_daisy.png',
  dead_bush: 'deadbush.png',
  glowstone: 'glowstone.png',
  diamond_block: 'diamond_block.png',
  farmland: 'farmland_dry.png',
  farmland_moist: 'farmland_wet.png',
  wheat_stage0: 'wheat_stage_0.png', wheat_stage1: 'wheat_stage_1.png',
  wheat_stage2: 'wheat_stage_2.png', wheat_stage3: 'wheat_stage_3.png',
  wheat_stage4: 'wheat_stage_4.png', wheat_stage5: 'wheat_stage_5.png',
  wheat_stage6: 'wheat_stage_6.png', wheat_stage7: 'wheat_stage_7.png',
  carrots_stage0: 'carrots_stage_0.png', carrots_stage1: 'carrots_stage_1.png',
  carrots_stage2: 'carrots_stage_2.png', carrots_stage3: 'carrots_stage_3.png',
  potatoes_stage0: 'potatoes_stage_0.png', potatoes_stage1: 'potatoes_stage_1.png',
  potatoes_stage2: 'potatoes_stage_2.png', potatoes_stage3: 'potatoes_stage_3.png',
  melon_stem: 'melon_stem_disconnected.png', attached_melon_stem: 'melon_stem_connected.png',
  pumpkin_stem: 'pumpkin_stem_disconnected.png', attached_pumpkin_stem: 'pumpkin_stem_connected.png',
  melon: 'melon_side.png', melon_top: 'melon_top.png',
  pumpkin: 'pumpkin_side.png', pumpkin_top: 'pumpkin_top.png',
};

for (const color of ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']) {
  blocks[`${color}_wool`] = `wool_colored_${color}.png`;
}
blocks.light_gray_wool = 'wool_colored_silver.png';

const items = {
  stick: 'stick.png', coal: 'coal.png', charcoal: 'charcoal.png',
  iron_ingot: 'iron_ingot.png', gold_ingot: 'gold_ingot.png', diamond: 'diamond.png',
  redstone_dust: 'redstone_dust.png', flint: 'flint.png', clay_ball: 'clay_ball.png',
  brick: 'brick.png', string: 'string.png', feather: 'feather.png', leather: 'leather.png',
  gunpowder: 'gunpowder.png', book: 'book_normal.png', arrow: 'arrow.png',
  apple: 'apple.png', bread: 'bread.png', beef: 'beef_raw.png', cooked_beef: 'beef_cooked.png',
  porkchop: 'porkchop_raw.png', cooked_porkchop: 'porkchop_cooked.png',
  chicken: 'chicken_raw.png', cooked_chicken: 'chicken_cooked.png', golden_apple: 'apple_golden.png',
  wooden_pickaxe: 'wood_pickaxe.png', wooden_axe: 'wood_axe.png', wooden_shovel: 'wood_shovel.png', wooden_sword: 'wood_sword.png',
  stone_pickaxe: 'stone_pickaxe.png', stone_axe: 'stone_axe.png', stone_shovel: 'stone_shovel.png', stone_sword: 'stone_sword.png',
  iron_pickaxe: 'iron_pickaxe.png', iron_axe: 'iron_axe.png', iron_shovel: 'iron_shovel.png', iron_sword: 'iron_sword.png',
  diamond_pickaxe: 'diamond_pickaxe.png', diamond_axe: 'diamond_axe.png', diamond_shovel: 'diamond_shovel.png', diamond_sword: 'diamond_sword.png',
  wooden_hoe: 'wood_hoe.png', stone_hoe: 'stone_hoe.png', iron_hoe: 'iron_hoe.png',
  golden_hoe: 'gold_hoe.png', diamond_hoe: 'diamond_hoe.png',
  wheat_seeds: 'seeds_wheat.png', wheat: 'wheat.png', carrot: 'carrot.png', potato: 'potato.png',
  baked_potato: 'potato_baked.png', melon_seeds: 'seeds_melon.png', melon_slice: 'melon.png',
  pumpkin_seeds: 'seeds_pumpkin.png', pumpkin_pie: 'pumpkin_pie.png',
  bone: 'bone.png', bone_meal: 'dye_powder_white.png',
  bow: 'bow_standby.png',
  bow_pulling_0: 'bow_pulling_0.png', bow_pulling_1: 'bow_pulling_1.png', bow_pulling_2: 'bow_pulling_2.png',
  leather_helmet: 'leather_helmet.png', leather_chestplate: 'leather_chestplate.png', leather_leggings: 'leather_leggings.png', leather_boots: 'leather_boots.png',
  iron_helmet: 'iron_helmet.png', iron_chestplate: 'iron_chestplate.png', iron_leggings: 'iron_leggings.png', iron_boots: 'iron_boots.png',
  gold_helmet: 'gold_helmet.png', gold_chestplate: 'gold_chestplate.png', gold_leggings: 'gold_leggings.png', gold_boots: 'gold_boots.png',
  diamond_helmet: 'diamond_helmet.png', diamond_chestplate: 'diamond_chestplate.png', diamond_leggings: 'diamond_leggings.png', diamond_boots: 'diamond_boots.png',
};

const entities = {
  cow: join('cow', 'cow.png'),
  pig: join('pig', 'pig.png'),
  chicken: 'chicken.png',
  sheep: join('sheep', 'sheep.png'),
  sheep_fur: join('sheep', 'sheep_fur.png'),
  zombie: join('zombie', 'zombie.png'),
  skeleton: join('skeleton', 'skeleton.png'),
  creeper: join('creeper', 'creeper.png'),
  spider: join('spider', 'spider.png'),
  spider_eyes: 'spider_eyes.png',
  steve: 'steve.png',
  arrow: join('projectiles', 'arrow.png'),
};

const copies = [];
for (const [target, source] of Object.entries(blocks)) copies.push([join('blocks', source), join('block', `${target}.png`)]);
for (const [target, source] of Object.entries(items)) copies.push([join('items', source), join('item', `${target}.png`)]);
for (const [target, source] of Object.entries(entities)) copies.push([join('entity', source), join('entity', `${target}.png`)]);
copies.push([join('entity', 'chest', 'normal.png'), join('entity', 'chest', 'normal.png')]);
copies.push([join('environment', 'sun.png'), join('environment', 'sun.png')]);
copies.push([join('environment', 'moon_phases.png'), join('environment', 'moon.png')]);
copies.push([join('particle', 'particles.png'), join('particle', 'particles.png')]);

const optional = {
  'items/flint_and_steel.png': 'item/flint_and_steel.png',
  'blocks/web.png': 'block/cobweb.png',
  'blocks/rail_normal.png': 'block/rail.png',
  'blocks/fire_layer_0.png': 'block/fire.png',
  'block/glowstone.png': 'block/glowstone.png',
  'blocks/diamond_block.png': 'block/diamond_block.png',
  'block/diamond_block.png': 'block/diamond_block.png',
  'blocks/lantern.png': 'block/lantern.png',
  'block/lantern.png': 'block/lantern.png',
  'blocks/chain.png': 'block/chain.png',
  'block/chain.png': 'block/chain.png',
  'items/lantern.png': 'item/lantern.png',
  'item/lantern.png': 'item/lantern.png',
  'items/chain.png': 'item/chain.png',
  'item/chain.png': 'item/chain.png',
};
for (const [source, target] of Object.entries(optional)) {
  copies.push([source, target]);
}

let imported = 0;
for (const [source, target] of itemsOnly ? [] : copies) {
  const destination = join(outputRoot, target);
  await mkdir(dirname(destination), { recursive: true });
  try {
    await copyFile(join(sourceRoot, source), destination);
    imported += 1;
  } catch (error) {
    console.warn(`Missing optional asset: ${source} -> ${target}`);
  }
}

console.log(`Imported ${imported}/${copies.length} selected runtime assets into public/textures.`);

for (const [target, bytes] of authoredItems) {
  const destination = join(outputRoot, target);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
}
// Exact obsolete runtime asset only; the source pack is never modified.
await unlink(join(outputRoot, 'item', 'shield.png')).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
console.log(`Imported ${authoredItems.length} required authored item textures (including potion compositions).`);

try {
  const { generateMissingTextures } = await import('./generate-missing-textures.mjs');
  const generated = itemsOnly ? 0 : await generateMissingTextures(false);
  if (generated > 0) console.log(`Generated ${generated} fallback gameplay textures.`);
} catch (error) {
  console.warn('Fallback texture generation skipped.', error);
}
