import { readdir, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

const root = new URL('../dist/', import.meta.url);
const rootPath = decodeURIComponent(root.pathname).replace(/^\/(?:([A-Za-z]:))/, '$1');
const files = [];

async function walk(directory) {
  for (const name of await readdir(directory)) {
    const full = join(directory, name);
    const info = await stat(full);
    if (info.isDirectory()) await walk(full);
    else files.push({ path: relative(rootPath, full), bytes: info.size });
  }
}

try {
  await walk(rootPath);
} catch {
  console.error('dist/ не найден. Сначала выполните npm run build.');
  process.exit(1);
}

const total = files.reduce((sum, file) => sum + file.bytes, 0);
const invalid = files.filter((file) => /[\s\u0400-\u04ff]/u.test(file.path));
const hasIndex = files.some((file) => file.path === 'index.html');
const megabytes = total / 1024 / 1024;

console.log(`Production build: ${megabytes.toFixed(2)} MiB (${files.length} files)`);
console.log('Largest files:');
for (const file of [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 12)) {
  console.log(`  ${(file.bytes / 1024).toFixed(1).padStart(8)} KiB  ${file.path.split(sep).join('/')}`);
}

if (!hasIndex) {
  console.error('ERROR: index.html отсутствует в корне dist/.');
  process.exitCode = 1;
}
if (invalid.length) {
  console.error('ERROR: пути с пробелами или кириллицей:', invalid.map((file) => file.path));
  process.exitCode = 1;
}
if (megabytes > 100) {
  console.error('ERROR: build превышает лимит Яндекс Игр 100 MiB.');
  process.exitCode = 1;
} else if (megabytes > 90) {
  console.warn('WARNING: build находится в предупреждающей зоне >90 MiB.');
}

if (process.argv.includes('--archive')) {
  const unwanted = files.filter((file) => ['.psd', '.ts', '.map'].includes(extname(file.path).toLowerCase()));
  if (unwanted.length) {
    console.error('ERROR: production содержит source/debug-файлы:', unwanted.map((file) => file.path));
    process.exitCode = 1;
  }
}
