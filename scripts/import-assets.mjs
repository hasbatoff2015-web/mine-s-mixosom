import { access, copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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

// `public/textures` is generated exclusively by this whitelist importer. Clear
// old generated names so renamed/removed mappings cannot leak into production.
await rm(outputRoot, { recursive: true, force: true });

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
  chest: 'planks_oak.png',
  furnace_top: 'furnace_top.png',
  furnace_side: 'furnace_side.png',
  furnace_front: 'furnace_front_off.png',
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
  tnt: 'tnt_side.png',
  oak_slab: 'planks_oak.png',
  stone_slab: 'stone.png',
  cobblestone_slab: 'cobblestone.png',
  oak_stairs: 'planks_oak.png',
  stone_stairs: 'stone.png',
  cobblestone_stairs: 'cobblestone.png',
  tall_grass: 'tallgrass.png',
  fern: 'fern.png',
  dandelion: 'flower_dandelion.png',
  poppy: 'flower_rose.png',
  oxeye_daisy: 'flower_oxeye_daisy.png',
  dead_bush: 'deadbush.png',
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
copies.push([join('entity', 'shield_base_nopattern.png'), join('item', 'shield.png')]);
copies.push([join('environment', 'sun.png'), join('environment', 'sun.png')]);
copies.push([join('environment', 'moon_phases.png'), join('environment', 'moon.png')]);
copies.push([join('particle', 'particles.png'), join('particle', 'particles.png')]);

let imported = 0;
for (const [source, target] of copies) {
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
