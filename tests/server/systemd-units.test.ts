import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadServerConfig, worldDirectory } from '../../server/config';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const DEPLOY = join(ROOT, 'deploy/systemd');

const SERVERS = [
  {
    unit: 'frontier-cubes-anarchy.service',
    envFile: 'anarchy.env',
    mode: 'anarchy',
    port: 2567,
    worldDir: '/var/lib/frontier-cubes/worlds/anarchy',
  },
  {
    unit: 'frontier-cubes-survival.service',
    envFile: 'survival.env',
    mode: 'survival',
    port: 2568,
    worldDir: '/var/lib/frontier-cubes/worlds/survival',
  },
  {
    unit: 'frontier-cubes-peaceful.service',
    envFile: 'peaceful.env',
    mode: 'peaceful',
    port: 2569,
    worldDir: '/var/lib/frontier-cubes/worlds/peaceful',
  },
] as const;

function readDeploy(name: string): string {
  return readFileSync(join(DEPLOY, name), 'utf8');
}

function parseEnv(source: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

function directive(unit: string, key: string): string {
  const match = unit.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!match?.[1]) throw new Error(`missing ${key}`);
  return match[1];
}

describe('systemd production units', () => {
  it('runs three node bundles with isolated worlds outside the release', () => {
    const directories: string[] = [];
    for (const server of SERVERS) {
      const unit = readDeploy(server.unit);
      const env = parseEnv(readDeploy(server.envFile));
      const config = loadServerConfig(env, '/opt/frontier-cubes/current');
      const directory = worldDirectory(config);
      directories.push(directory);

      expect(directive(unit, 'User')).toBe('frontier-cubes');
      expect(directive(unit, 'Group')).toBe('frontier-cubes');
      expect(unit).not.toMatch(/^User=root$/m);
      expect(directive(unit, 'ExecStart')).toBe('/usr/bin/node /opt/frontier-cubes/current/dist/server/index.mjs');
      expect(directive(unit, 'WorkingDirectory')).toBe('/opt/frontier-cubes/current');
      expect(directive(unit, 'EnvironmentFile')).toBe(`/etc/frontier-cubes/${server.envFile}`);
      expect(directive(unit, 'Restart')).toBe('on-failure');
      expect(directive(unit, 'RestartSec')).toBe('5');
      expect(directive(unit, 'KillSignal')).toBe('SIGTERM');
      expect(directive(unit, 'TimeoutStopSec')).toBe('30');
      expect(directive(unit, 'NoNewPrivileges')).toBe('true');
      expect(directive(unit, 'PrivateTmp')).toBe('true');
      expect(directive(unit, 'StandardOutput')).toBe('journal');
      expect(directive(unit, 'StandardError')).toBe('journal');
      expect(unit).not.toContain('vite-node');
      expect(unit).not.toContain('dev:server');
      expect(unit).not.toContain('npm ');
      expect(env.HOST).toBe('0.0.0.0');
      expect(env.PORT).toBe(String(server.port));
      expect(env.SERVER_MODE).toBe(server.mode);
      expect(env.WORLD).toBe(server.mode);
      expect(env.WORLD_PATH).toBe('/var/lib/frontier-cubes/worlds');
      expect(config.serverMode).toBe(server.mode);
      expect(config.port).toBe(server.port);
      expect(config.host).toBe('0.0.0.0');
      expect(directory).toBe(server.worldDir);
      expect(directory.startsWith('/opt/frontier-cubes')).toBe(false);
      expect(readDeploy(server.envFile)).not.toContain('vite-node');
      expect(readDeploy(server.envFile)).not.toContain('dev:server');
    }
    expect(new Set(directories).size).toBe(SERVERS.length);
  });
});
