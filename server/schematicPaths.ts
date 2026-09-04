import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { PersistenceError } from '../src/save/PersistenceError';

export const FRONTIER_SPAWN_SCHEM_NAME = 'frontier_spawn2.schem';

/** Owner-local spawn map. Not in git. Cloud VMs typically cannot read this drive. */
export const OWNER_FRONTIER_SPAWN_SCHEM =
  'C:\\Users\\миша\\Desktop\\GAMES\\mine123\\spawn_map\\frontier_spawn2.schem';

export function isSchematicFilename(file: string): boolean {
  return /\.(schem|schematic)$/i.test(file);
}

export function schematicSearchCandidates(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    env.FRONTIER_SPAWN_SCHEM,
    join(cwd, 'public', 'maps', FRONTIER_SPAWN_SCHEM_NAME),
    join(cwd, FRONTIER_SPAWN_SCHEM_NAME),
    join(cwd, 'spawn_map', FRONTIER_SPAWN_SCHEM_NAME),
    OWNER_FRONTIER_SPAWN_SCHEM,
    '/mnt/c/Users/миша/Desktop/GAMES/mine123/spawn_map/frontier_spawn2.schem',
  ].filter((value): value is string => Boolean(value));
}

export async function resolveExistingPath(
  explicit: string | undefined,
  fallbacks: readonly string[] = [],
): Promise<{ path: string; tried: string[] }> {
  const tried: string[] = [];
  const candidates = explicit ? [explicit, ...fallbacks.filter((value) => value !== explicit)] : [...fallbacks];
  for (const candidate of candidates) {
    tried.push(candidate);
    try {
      await access(candidate);
      return { path: candidate, tried };
    } catch {
      // try next
    }
  }
  throw new PersistenceError(
    `File not found. Looked at:\n${tried.map((entry) => `  ${entry}`).join('\n')}`,
    'missing',
  );
}
