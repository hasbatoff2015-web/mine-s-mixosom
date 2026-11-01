import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const fonts = [
  ['public/fonts/inter/inter-cyrillic-400-700.woff2', 'inter-cyrillic-400-700.woff2'],
  ['public/fonts/inter/inter-latin-400-700.woff2', 'inter-latin-400-700.woff2'],
  ['public/fonts/press-start-2p/press-start-2p-cyrillic-400.woff2', 'press-start-2p-cyrillic-400.woff2'],
  ['public/fonts/press-start-2p/press-start-2p-latin-400.woff2', 'press-start-2p-latin-400.woff2'],
];

await mkdir('dist/admin/fonts', { recursive: true });
await mkdir('dist/admin/icons', { recursive: true });
for (const [from, name] of fonts) {
  await copyFile(from, join('dist/admin/fonts', name));
}
await copyFile('public/ui/menu/icon_spawn.png', 'dist/admin/icons/icon_spawn.png');
