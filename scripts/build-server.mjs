/**
 * Bundle the authoritative server for plain Node.
 * Dev still uses vite-node via `npm run dev:server`.
 * Disk plugins stay a runtime import(); they are not inlined.
 */
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const outfile = 'dist/server/index.mjs';

await build({
  entryPoints: ['server/index.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  plugins: [
    {
      name: 'reject-client-runtime',
      setup(result) {
        result.onResolve({ filter: /^(three|three\/.*|vite|vite\/.*)$/ }, (args) => {
          return {
            errors: [{
              text: `Server bundle must not import ${args.path} (from ${args.importer})`,
            }],
          };
        });
      },
    },
  ],
});

const source = await readFile(outfile, 'utf8');
if (!source.includes('import(')) {
  throw new Error('Production bundle dropped runtime import(). Disk plugins must stay dynamic.');
}
if (source.includes('example enabled') || source.includes("name: 'example'")) {
  throw new Error('server/plugin-examples/hello.ts was inlined. Disk plugin loading must stay external.');
}
if (/\bfrom\s+["']three["']/.test(source) || /require\(\s*["']three["']\s*\)/.test(source)) {
  throw new Error('Production bundle references three.');
}

console.log(`[build:server] ${outfile}`);
console.log('[build:server] npm packages, including ws, stay external and resolve from node_modules.');
console.log('[build:server] builtin plugins are inside the bundle. Disk plugin import() is unchanged.');
console.log('[build:server] FC_EXAMPLE_PLUGIN looks beside dist/server/index.mjs via import.meta.url.');
console.log('[build:server] server/plugin-examples is not copied there. Example plugins stay a later task.');
