#!/usr/bin/env node
/**
 * Static import-boundary scan. Not an AST compiler: regex on source files.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
}

function importsOf(source) {
  const found = [];
  const re = /(?:import|export)\s+(?:type\s+)?(?:[^'"\n]+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source))) found.push(m[1]);
  return found;
}

function isThree(spec) {
  return spec === 'three' || spec.startsWith('three/');
}

const simExclude = new Set([
  'src/entities/ThreeEntityHost.ts',
  'src/entities/mobModels.ts',
  'src/entities/voxelVisuals.ts',
  'src/entities/LegacyModel.ts',
  'src/save/IdbWorldStore.ts',
  'src/save/SaveService.ts',
  'src/core/Game.ts',
  'src/core/AudioManager.ts',
  'src/core/Lifecycle.ts',
  'src/core/lifecycleFocus.ts',
  'src/core/devProfiler.ts',
  'src/main.ts',
]);

const simRoots = [
  'src/math',
  'src/gameplay',
  'src/world',
  'src/blocks',
  'src/items',
  'src/combat',
  'src/player',
  'src/redstone',
  'src/inventory',
  'src/survival',
  'src/crafting',
  'src/chat',
  'src/entities',
  'src/save/WorldStore.ts',
  'src/save/snapshot.ts',
  'src/save/types.ts',
  'src/core/constants.ts',
  'src/core/entityInterpolation.ts',
  'src/core/lifecycleTypes.ts',
  'src/core/gameplayModal.ts',
  'src/core/onlineSession.ts',
  'src/input/MoveInput.ts',
  'src/ui/recipeBook.ts',
  'src/ui/containerInteractions.ts',
  'shared',
];

function isSimFile(rel) {
  if (simExclude.has(rel)) return false;
  if (rel.startsWith('src/rendering/') || rel.startsWith('src/dev/') || rel.startsWith('src/net/')) return false;
  if (rel.startsWith('src/ui/') && rel !== 'src/ui/recipeBook.ts' && rel !== 'src/ui/containerInteractions.ts') return false;
  if (rel.startsWith('src/input/') && rel !== 'src/input/MoveInput.ts') return false;
  return simRoots.some((root) => rel === root || rel.startsWith(root.endsWith('.ts') ? root : `${root}/`));
}

const errors = [];

for (const file of walk(join(ROOT, 'src')).concat(walk(join(ROOT, 'shared'))).concat(walk(join(ROOT, 'server')))) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  const source = readFileSync(file, 'utf8');
  const specs = importsOf(source);

  if (isSimFile(rel)) {
    for (const spec of specs) {
      if (isThree(spec)) errors.push(`${rel} (shared sim) imports ${spec}`);
      if (spec.includes('/rendering/') || spec.startsWith('../rendering/') || spec.startsWith('../../src/rendering/')) {
        errors.push(`${rel} (shared sim) imports rendering (${spec})`);
      }
      if (spec.includes('IdbWorldStore') || spec.includes('SaveService')) {
        errors.push(`${rel} (shared sim) imports browser persistence (${spec})`);
      }
      if (spec.includes('ThreeEntityHost') || spec.includes('mobModels') || spec.includes('voxelVisuals') || spec.includes('LegacyModel')) {
        errors.push(`${rel} (shared sim) imports client entity visuals (${spec})`);
      }
      if (spec === 'ws' || spec.includes('node:fs') || spec.includes('fs/promises')) {
        errors.push(`${rel} (shared sim) imports server/fs (${spec})`);
      }
      if (spec.includes('/server/') || spec.startsWith('../../server/') || spec.startsWith('../server/')) {
        errors.push(`${rel} (shared sim) imports server runtime (${spec})`);
      }
      if (spec.includes('PluginManager') || spec.includes('pluginLoader')) {
        errors.push(`${rel} (shared sim) imports plugin runtime (${spec})`);
      }
    }
    if (/\bindexedDB\b/.test(source) || /\blocalStorage\b/.test(source)) {
      errors.push(`${rel} (shared sim) references IndexedDB/localStorage`);
    }
  }

  if (rel.startsWith('server/')) {
    for (const spec of specs) {
      if (isThree(spec)) errors.push(`${rel} (server) imports ${spec}`);
      if (spec.includes('/rendering/') || spec.includes('/src/ui/GameUI') || spec.includes('/src/core/Game')
        || spec.includes('InputManager') || spec.includes('/Lifecycle') || spec.includes('ThreeEntityHost')
        || spec.includes('IdbWorldStore') || spec.includes('SaveService')) {
        errors.push(`${rel} (server) imports client module ${spec}`);
      }
    }
  }
}

if (errors.length) {
  console.error('Import boundary violations:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

console.log('Import boundaries OK (shared sim ↛ three/DOM persistence/rendering; server ↛ three/rendering).');
