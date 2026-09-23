import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireWorldDirectoryLock, WORLD_LOCK_FILE } from '../../server/worldLock';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fc-lock-'));
  dirs.push(dir);
  return dir;
}

function holdProcess(): Promise<{ pid: number; stop: () => Promise<void> }> {
  const child: ChildProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => {
      const pid = child.pid;
      if (!pid) {
        reject(new Error('missing pid'));
        return;
      }
      resolve({
        pid,
        stop: () => new Promise((done) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            done();
            return;
          }
          child.once('exit', () => done());
          child.kill('SIGKILL');
        }),
      });
    });
  });
}

describe('world directory lock', () => {
  it('replaces a dead pid and refuses a live one', async () => {
    const dir = await tempDir();
    const lockPath = join(dir, WORLD_LOCK_FILE);
    const held = await holdProcess();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
    const writeLock = (pid: number) => writeFile(lockPath, `${JSON.stringify({
      pid,
      mode: 'anarchy',
      worldId: 'anarchy',
      port: 2567,
    })}\n`);
    try {
      await writeLock(held.pid);
      await expect(acquireWorldDirectoryLock(dir, { mode: 'survival', worldId: 'anarchy', port: 2568 }))
        .rejects.toThrow(new RegExp(`pid ${held.pid}`));
      expect(JSON.parse(await readFile(lockPath, 'utf8')).pid).toBe(held.pid);

      await held.stop();
      const replaced = await acquireWorldDirectoryLock(dir, { mode: 'peaceful', worldId: 'anarchy', port: 2569 });
      expect(logs.some((line) => line.includes(`world lock stale pid=${held.pid}`))).toBe(true);
      expect(logs.some((line) => line.includes('world lock acquired') && line.includes(`pid=${process.pid}`))).toBe(true);
      const owned = JSON.parse(await readFile(lockPath, 'utf8')) as { pid: number; mode: string };
      expect(owned.pid).toBe(process.pid);
      expect(owned.mode).toBe('peaceful');
      await replaced.release();
      expect(logs.some((line) => line.includes('world lock released'))).toBe(true);
      await expect(readFile(lockPath, 'utf8')).rejects.toThrow();
    } finally {
      spy.mockRestore();
      await held.stop();
    }
  });
});
