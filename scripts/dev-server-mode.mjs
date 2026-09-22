/**
 * Starts one server process for a local mode.
 * Ports and world ids match LOCAL_SERVER_PRESETS in shared/config.ts.
 * Works under Windows PowerShell and Unix shells because env is set in Node.
 */
import { spawn } from 'node:child_process';

const PRESETS = {
  anarchy: { SERVER_MODE: 'anarchy', PORT: '2567', WORLD: 'anarchy' },
  survival: { SERVER_MODE: 'survival', PORT: '2568', WORLD: 'survival' },
  peaceful: { SERVER_MODE: 'peaceful', PORT: '2569', WORLD: 'peaceful' },
};

const mode = process.argv[2];
const preset = PRESETS[mode];
if (!preset) {
  console.error('Usage: node scripts/dev-server-mode.mjs <anarchy|survival|peaceful>');
  process.exit(1);
}

const child = spawn('npx', ['vite-node', 'server/index.ts'], {
  stdio: 'inherit',
  env: { ...process.env, ...preset },
  shell: true,
});

const stop = () => {
  child.kill('SIGTERM');
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
