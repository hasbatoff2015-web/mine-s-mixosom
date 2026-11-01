import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';

const MAX_ASSET_BYTES = 1_500_000;

const FONTS = new Set([
  'inter-cyrillic-400-700.woff2',
  'inter-latin-400-700.woff2',
  'press-start-2p-cyrillic-400.woff2',
  'press-start-2p-latin-400.woff2',
]);

const ICONS = new Set([
  'icon_spawn.png',
]);

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  woff2: 'font/woff2',
  png: 'image/png',
};

export interface AdminAsset {
  readonly body: Buffer;
  readonly type: string;
}

/**
 * Built admin files only. The public gameplay listener does not use this.
 * Names are an allowlist so a request cannot walk out of the bundle.
 */
export function readAdminAsset(root: string, pathname: string): AdminAsset | null {
  const relative = assetRelative(pathname);
  if (!relative) return null;
  const full = normalize(join(root, relative));
  const rootNorm = normalize(root);
  if (full !== rootNorm && !full.startsWith(`${rootNorm}/`)) return null;
  if (!existsSync(full)) return null;
  const info = statSync(full);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_ASSET_BYTES) return null;
  const ext = relative.includes('.') ? relative.slice(relative.lastIndexOf('.') + 1) : '';
  const type = TYPES[ext];
  if (!type) return null;
  return { body: readFileSync(full), type };
}

export function adminAssetIndex(root: string): string {
  return join(root, 'index.html');
}

export function resolveAdminAssetsRoot(moduleUrl: string): string {
  const fromCwd = join(process.cwd(), 'dist/admin');
  const bundled = join(moduleDir(moduleUrl), '../admin');
  if (existsSync(join(fromCwd, 'index.html'))) return fromCwd;
  if (existsSync(join(bundled, 'index.html'))) return bundled;
  return fromCwd;
}

function moduleDir(moduleUrl: string): string {
  const path = moduleUrl.startsWith('file:') ? new URL(moduleUrl).pathname : moduleUrl;
  return path.slice(0, path.lastIndexOf('/'));
}

function assetRelative(pathname: string): string | null {
  if (pathname === '/admin' || pathname === '/admin/' || pathname === '/admin/index.html') return 'index.html';
  if (!pathname.startsWith('/admin/')) return null;
  const rest = pathname.slice('/admin/'.length);
  if (rest.includes('..') || rest.includes('\\') || rest.includes('%')) return null;
  if (rest.startsWith('assets/')) {
    const name = rest.slice('assets/'.length);
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(name)) return null;
    if (!name.endsWith('.js') && !name.endsWith('.css')) return null;
    if (name.endsWith('.map')) return null;
    return `assets/${name}`;
  }
  if (rest.startsWith('fonts/')) {
    const name = rest.slice('fonts/'.length);
    if (!FONTS.has(name)) return null;
    return `fonts/${name}`;
  }
  if (rest.startsWith('icons/')) {
    const name = rest.slice('icons/'.length);
    if (!ICONS.has(name)) return null;
    return `icons/${name}`;
  }
  return null;
}
