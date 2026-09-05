import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import {
  CONSOLE_SENDER_ID,
  createConsoleCommandSender,
  normalizeConsoleCommand,
} from '../../server/commands';
import { attachServerConsole, formatConsoleResult } from '../../server/console';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import type { AnarchyServer } from '../../server/AnarchyServer';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-nickname-console-'));
}

function testConfig(dataDir: string) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'anarchy',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8',
      CHUNK_VIEW_RADIUS: '1',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '60000',
    }, process.cwd()),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    persistIntervalMs: 60_000,
    pluginDir: join(dataDir, 'no-plugins'),
    loadExamplePlugin: false,
    loadBuiltinPlugins: true,
    operators: [] as string[],
  };
}

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function resultLines(sink: MemorySink): string[] {
  const lines: string[] = [];
  for (const payload of sink.payloads) {
    const record = payload as { type?: string; lines?: string[]; text?: string };
    if (record.type === 'command_result' && record.lines) lines.push(...record.lines);
    if (record.type === 'chat' && record.text) lines.push(record.text);
  }
  return lines;
}

describe('display nickname join and server console', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(): Promise<WorldInstance> {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function join(world: WorldInstance, name?: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  it('uses a valid join nick without replacing playerId', async () => {
    const world = await boot();
    const joined = join(world, 'Misha');
    expect(joined.player.name).toBe('Misha');
    expect(joined.player.id).not.toBe('Misha');
    expect(joined.player.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('keeps the Player-XXXX fallback when no nick is set', async () => {
    const world = await boot();
    const joined = join(world);
    expect(joined.player.name).toMatch(/^Player-[0-9a-f]{4}$/i);
    expect(joined.player.id).not.toBe(joined.player.name);
    expect(joined.player.id.slice(0, 4).toLowerCase()).toBe(joined.player.name.slice('Player-'.length).toLowerCase());
  });

  it('does not let a player without permissions run /op', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    ada.sink.payloads.length = 0;
    world.handleChat(ada.player, '/op Misha');
    expect(resultLines(ada.sink).some((line) => line.includes('You do not have permission.'))).toBe(true);
    expect(world.permissions.isOperator('Misha')).toBe(false);
  });

  it('lets the console run /op and /plugins with a full permission bypass', async () => {
    const world = await boot();
    const consoleSender = createConsoleCommandSender();
    expect(consoleSender.kind).toBe('console');
    expect(consoleSender.playerId).toBe(CONSOLE_SENDER_ID);
    expect(consoleSender.hasPermission?.('operator')).toBe(true);
    expect(consoleSender.hasPermission?.('plugins.manage')).toBe(true);
    expect(consoleSender.hasPermission?.('anything.at.all')).toBe(true);
    expect(normalizeConsoleCommand('op Misha')).toBe('/op Misha');
    expect(normalizeConsoleCommand('/op Misha')).toBe('/op Misha');

    const op = world.dispatchConsole('op Misha');
    expect(op.ok).toBe(true);
    expect(op.lines.some((line) => line.includes('Made Misha a server operator.'))).toBe(true);
    expect(world.permissions.isOperator('Misha')).toBe(true);

    const plugins = world.dispatchConsole('plugins list');
    expect(plugins.ok).toBe(true);
    expect(plugins.lines.some((line) => line.toLowerCase().includes('permissions'))).toBe(true);

    const unknown = world.dispatchConsole('unknowncommand');
    expect(unknown.ok).toBe(false);
    expect(unknown.lines.some((line) => line.includes("Unknown command 'unknowncommand'"))).toBe(true);
  });

  it('reads stdin lines through CommandRegistry as the console sender', async () => {
    const world = await boot();
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', (chunk) => { chunks.push(String(chunk)); });
    const fake = { dispatchConsole: (raw: string) => world.dispatchConsole(raw) };
    const detach = attachServerConsole(fake as AnarchyServer, input, output);
    input.write('op Misha\n');
    input.write('unknowncommand\n');
    await new Promise((resolve) => setTimeout(resolve, 50));
    detach();
    const text = chunks.join('');
    expect(text).toContain('> op Misha');
    expect(text).toContain('Made Misha a server operator.');
    expect(text).toContain('> unknowncommand');
    expect(text).toContain("Unknown command 'unknowncommand'");
    expect(formatConsoleResult('plugins', { ok: true, lines: ['Plugins:'] })).toContain('> plugins');
  });
});
