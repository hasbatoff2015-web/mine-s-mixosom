import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IGNORE_SIMULATION_EVENTS, SIMULATION_EVENT_KINDS } from '../src/gameplay/simulationEvents';
import { toServerEventName } from '../server/pluginEventAdapter';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function walk(rel: string): string[] {
  const full = join(ROOT, rel);
  const out: string[] = [];
  for (const name of readdirSync(full)) {
    const path = join(full, name);
    const relPath = join(rel, name);
    if (statSync(path).isDirectory()) out.push(...walk(relPath));
    else if (name.endsWith('.ts')) out.push(relPath);
  }
  return out;
}

describe('Phase 8 plugin boundaries', () => {
  it('plugin runtime does not import Three, DOM, or the client renderer', () => {
    const files = [
      'server/PluginManager.ts',
      'server/pluginLoader.ts',
      'server/pluginEventAdapter.ts',
      'server/plugin-examples/hello.ts',
      'server/events.ts',
      'server/commands.ts',
      'server/console.ts',
      'src/gameplay/simulationEvents.ts',
      ...walk('server/services'),
      ...walk('server/builtin-plugins'),
    ];
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/from ['"]three['"]/);
      expect(source, file).not.toMatch(/\bdocument\b/);
      expect(source, file).not.toMatch(/\bindexedDB\b/);
      expect(source, file).not.toMatch(/src\/rendering\//);
      expect(source, file).not.toMatch(/src\/core\/Game/);
    }
  });

  it('stock server/plugins does not ship plugin modules', () => {
    const files = readdirSync(join(ROOT, 'server/plugins'));
    expect(files.filter((name) => /\.(mjs|js|ts)$/i.test(name))).toEqual([]);
  });

  it('singleplayer Game never loads PluginManager', () => {
    const game = read('src/core/Game.ts');
    expect(game).not.toMatch(/PluginManager/);
    expect(game).not.toMatch(/PLUGIN_API_VERSION/);
    expect(game).not.toMatch(/server\/plugins/);
  });

  it('shared simulation event catalog does not import the server', () => {
    const source = read('src/gameplay/simulationEvents.ts');
    expect(source).not.toMatch(/from ['"].*PluginManager/);
    expect(source).not.toMatch(/from ['"].*server\//);
    expect(IGNORE_SIMULATION_EVENTS.emitPre('block-break', {})).toBe(true);
    expect(SIMULATION_EVENT_KINDS).toContain('block-break');
    expect(toServerEventName('block-break')).toBe('blockBreak');
    expect(toServerEventName('block-broken')).toBe('blockBroken');
  });
});
