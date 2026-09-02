import { spawn } from 'node:child_process';

const env = { ...process.env, FORCE_COLOR: '1' };
const children = [
  spawn('npx', ['vite-node', 'server/index.ts'], { stdio: 'inherit', env, shell: true }),
  spawn('npx', ['vite'], { stdio: 'inherit', env, shell: true }),
];

const stop = (): void => {
  for (const child of children) child.kill('SIGTERM');
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

for (const child of children) {
  child.on('exit', (code) => {
    if (code && code !== 0) stop();
  });
}
