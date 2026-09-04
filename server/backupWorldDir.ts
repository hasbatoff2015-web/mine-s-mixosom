import { cp, mkdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Copy an existing filesystem world directory before a destructive import.
 * Destination stays next to the world dir (still under dataDir, gitignored).
 */
export async function backupWorldDirectory(worldDir: string, now = new Date()): Promise<string> {
  const info = await stat(worldDir);
  if (!info.isDirectory()) {
    throw new Error(`Cannot backup ${worldDir}: not a directory`);
  }
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const dest = join(dirname(worldDir), `${basename(worldDir)}.backup-${stamp}`);
  await mkdir(dirname(dest), { recursive: true });
  await cp(worldDir, dest, { recursive: true });
  return dest;
}
