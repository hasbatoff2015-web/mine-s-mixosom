import { pathToFileURL } from 'node:url';
import { readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Plugin } from './PluginManager';
import { serverLog } from './log';

const PLUGIN_FILE = /\.(mjs|js|ts)$/i;

function isPluginFile(name: string): boolean {
  if (name.startsWith('_') || name.startsWith('.')) return false;
  if (name === 'index.ts' || name === 'index.js' || name === 'index.mjs') return false;
  return PLUGIN_FILE.test(name);
}

function isInsideRoot(file: string, root: string): boolean {
  const prefix = root.endsWith('/') || root.endsWith('\\') ? root : `${root}/`;
  const alt = root.endsWith('/') || root.endsWith('\\') ? root : `${root}\\`;
  return file === root || file.startsWith(prefix) || file.startsWith(alt);
}

export interface DiscoveredPlugin {
  readonly plugin: Plugin;
  readonly source: string;
}

export interface DiscoverError {
  readonly error: string;
  readonly source: string;
}

function asPlugin(value: unknown, source: string): Plugin | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.plugin === 'object' && record.plugin) {
    return asPlugin(record.plugin, source);
  }
  if (typeof record.default === 'function') {
    try {
      return asPlugin((record.default as () => unknown)(), source);
    } catch (error) {
      throw new Error(`plugin factory threw in ${source}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (typeof record.default === 'object' && record.default) {
    return asPlugin(record.default, source);
  }
  if (typeof record.name === 'string' && record.name.trim()) {
    return value as Plugin;
  }
  return undefined;
}

/**
 * Load trusted modules from `dir`. Missing directory is not an error.
 * One bad file does not prevent other files from loading.
 * Paths outside `dir` are refused.
 */
export async function discoverPluginModules(dir: string): Promise<{
  readonly loaded: DiscoveredPlugin[];
  readonly errors: DiscoverError[];
}> {
  const loaded: DiscoveredPlugin[] = [];
  const errors: DiscoverError[] = [];
  let root: string;
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) {
      errors.push({ source: dir, error: 'plugin path is not a directory' });
      return { loaded, errors };
    }
    root = await realpath(dir);
  } catch {
    serverLog(`plugins: directory missing (${dir}); starting without disk plugins`);
    return { loaded, errors };
  }

  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    errors.push({ source: root, error: error instanceof Error ? error.message : String(error) });
    return { loaded, errors };
  }

  for (const name of names.sort()) {
    if (!isPluginFile(name)) continue;
    const abs = resolve(join(root, name));
    let file: string;
    try {
      file = await realpath(abs);
    } catch (error) {
      errors.push({ source: abs, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!isInsideRoot(file, root)) {
      errors.push({ source: abs, error: 'refusing to load plugin outside plugin directory' });
      continue;
    }
    try {
      const mod: unknown = await import(pathToFileURL(file).href);
      const plugin = asPlugin(mod, file);
      if (!plugin) {
        errors.push({ source: file, error: 'module did not export a Plugin (name + optional onLoad/onEnable/onDisable)' });
        continue;
      }
      loaded.push({ plugin, source: file });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      serverLog(`plugins: failed to load ${file}: ${message}`, 'error');
      errors.push({ source: file, error: message });
    }
  }
  return { loaded, errors };
}
