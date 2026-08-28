#!/usr/bin/env node
/**
 * Copies frontier_spawn2.schem into public/maps/ without modifying the source.
 * Tries argv, FRONTIER_SPAWN_SCHEM, and a few local/Windows paths.
 */
import { copyFile, mkdir, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const dest = join(process.cwd(), 'public', 'maps', 'frontier_spawn2.schem');
const candidates = [
  process.argv[2],
  process.env.FRONTIER_SPAWN_SCHEM,
  join(process.cwd(), 'frontier_spawn2.schem'),
  join(process.cwd(), 'spawn_map', 'frontier_spawn2.schem'),
  'C:\\Users\\миша\\Desktop\\GAMES\\mine123\\spawn_map\\frontier_spawn2.schem',
].filter((value): value is string => Boolean(value));

let source;
for (const candidate of candidates) {
  const resolved = resolve(candidate);
  try {
    await access(resolved);
    source = resolved;
    break;
  } catch {
    // try next
  }
}

if (!source) {
  console.error('frontier_spawn2.schem not found. Pass the path:\n  node scripts/copy-frontier-spawn.mjs <path-to-frontier_spawn2.schem>');
  process.exit(1);
}

await mkdir(dirname(dest), { recursive: true });
await copyFile(source, dest);
console.log(`Copied ${source} → ${dest} (source left unchanged)`);
