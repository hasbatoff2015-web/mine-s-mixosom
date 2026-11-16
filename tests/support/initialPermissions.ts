import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Valid empty permission file for a fixture world that was saved without one. */
export async function writeInitialPermissions(worldDir: string): Promise<void> {
  const dir = join(worldDir, 'plugin-data');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'permissions.json'), `${JSON.stringify({
    version: 3,
    ops: [],
    unreviewedOps: [],
    roles: {},
    playerRoles: {},
    playerPermissions: {},
    legacy: { ops: [], playerRoles: {}, playerPermissions: {} },
  }, null, 2)}\n`);
}
