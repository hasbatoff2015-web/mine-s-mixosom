import { describe, expect, it } from 'vitest';
import {
  ChatLog,
  TIME_PRESETS,
  chatLineOpacity,
  deathMessage,
  dispatchChatLine,
  findCommand,
  listCommands,
  parseChatLine,
  stepTypedHistoryIndex,
  type CommandContext,
} from '../src/chat';
import { Inventory } from '../src/inventory';
import { ItemId } from '../src/items';
import type { GameMode } from '../src/save/types';
import { shouldOpenPauseOnUnlock, shouldTogglePauseOnEscapeKeydown } from '../src/input/pointerLock';
import { playerGameplayAllowed } from '../src/core/gameplayModal';

function context(initial: Partial<{
  mode: GameMode;
  timeOfDay: number;
  seed: string;
  position: { x: number; y: number; z: number };
  killed: boolean;
  inventory: Inventory;
}> = {}): CommandContext & { killed: boolean; inventory: Inventory } {
  let mode: GameMode = initial.mode ?? 'survival';
  let timeOfDay = initial.timeOfDay ?? 1_000;
  const position = initial.position ?? { x: 10, y: 70, z: 20 };
  const inventory = initial.inventory ?? new Inventory();
  const state = {
    killed: initial.killed ?? false,
    inventory,
  };
  const ctx: CommandContext & { killed: boolean; inventory: Inventory } = {
    playerName: 'Player',
    get mode() { return mode; },
    setMode(next) { mode = next; },
    get timeOfDay() { return timeOfDay; },
    setTime(ticks) { timeOfDay = ticks; },
    seed: initial.seed ?? 'test-seed',
    give(itemId, count) {
      const leftover = inventory.addItem(itemId, count);
      return { given: count - leftover, leftover };
    },
    teleport(x, y, z) {
      position.x = x;
      position.y = y;
      position.z = z;
    },
    playerPosition: () => ({ ...position }),
    clearInventory() {
      let count = 0;
      for (const stack of inventory.slots) if (stack) count += stack.count;
      inventory.clear();
      return count;
    },
    kill() { state.killed = true; },
    get killed() { return state.killed; },
    set killed(value) { state.killed = value; },
    inventory,
  };
  return ctx;
}

describe('chat parse', () => {
  it('treats free text as a local say line and splits commands', () => {
    expect(parseChatLine('  hello there  ')).toEqual({ kind: 'say', text: 'hello there' });
    expect(parseChatLine('/gamemode creative')).toEqual({
      kind: 'command', name: 'gamemode', args: ['creative'],
    });
    expect(parseChatLine('/give minecart 32')).toEqual({
      kind: 'command', name: 'give', args: ['minecart', '32'],
    });
    expect(parseChatLine('   ')).toEqual({ kind: 'empty' });
    expect(parseChatLine('/')).toEqual({ kind: 'empty' });
  });
});

describe('command registry', () => {
  it('lists the first-pass commands without a giant if/else dispatcher', () => {
    const names = listCommands().map((command) => command.name);
    expect(names).toEqual(['help', 'gamemode', 'time', 'give', 'tp', 'seed', 'clear', 'kill']);
    expect(findCommand('gm')?.name).toBe('gamemode');
    expect(findCommand('teleport')?.name).toBe('tp');
    expect(findCommand('nope')).toBeUndefined();
  });

  it('switches gamemode via names, letters and 0/1', () => {
    const ctx = context({ mode: 'survival' });
    for (const token of ['creative', 'c', '1']) {
      ctx.setMode('survival');
      const result = dispatchChatLine(`/gamemode ${token}`, ctx);
      expect(result.result?.ok).toBe(true);
      expect(ctx.mode).toBe('creative');
    }
    for (const token of ['survival', 's', '0']) {
      ctx.setMode('creative');
      expect(dispatchChatLine(`/gamemode ${token}`, ctx).result?.ok).toBe(true);
      expect(ctx.mode).toBe('survival');
    }
    expect(dispatchChatLine('/gamemode spectator', ctx).result?.ok).toBe(false);
  });

  it('sets day, noon, night and midnight', () => {
    const ctx = context();
    expect(dispatchChatLine('/time day', ctx).result?.ok).toBe(true);
    expect(ctx.timeOfDay).toBe(TIME_PRESETS.day);
    expect(dispatchChatLine('/time noon', ctx).result?.ok).toBe(true);
    expect(ctx.timeOfDay).toBe(TIME_PRESETS.noon);
    expect(dispatchChatLine('/time night', ctx).result?.ok).toBe(true);
    expect(ctx.timeOfDay).toBe(TIME_PRESETS.night);
    expect(dispatchChatLine('/time midnight', ctx).result?.ok).toBe(true);
    expect(ctx.timeOfDay).toBe(TIME_PRESETS.midnight);
    expect(dispatchChatLine('/time tea', ctx).result?.ok).toBe(false);
  });

  it('gives known items and reports unknown ids', () => {
    const ctx = context();
    expect(dispatchChatLine('/give shield 1', ctx).result?.ok).toBe(false);
    expect(ctx.inventory.slots.every((stack) => stack === null)).toBe(true);
    const given = dispatchChatLine('/give minecart 8', ctx);
    expect(given.result?.ok).toBe(true);
    expect(ctx.inventory.count(ItemId.Minecart)).toBe(8);
    expect(dispatchChatLine('/give rail', ctx).result?.ok).toBe(true);
    expect(ctx.inventory.count('rail')).toBe(1);
    const missing = dispatchChatLine('/give not_an_item 2', ctx);
    expect(missing.result?.ok).toBe(false);
    expect(missing.result?.lines[0]).toMatch(/Unknown item/);
  });

  it('teleports, prints the seed, clears inventory and kills', () => {
    const ctx = context({ seed: 'frontier', position: { x: 0, y: 64, z: 0 } });
    ctx.inventory.addItem('dirt', 12);
    expect(dispatchChatLine('/tp 100 70 200', ctx).result?.ok).toBe(true);
    expect(ctx.playerPosition()).toEqual({ x: 100, y: 70, z: 200 });
    expect(dispatchChatLine('/seed', ctx).result?.lines[0]).toBe('Seed: frontier');
    expect(dispatchChatLine('/clear', ctx).result?.ok).toBe(true);
    expect(ctx.inventory.count('dirt')).toBe(0);
    expect(dispatchChatLine('/kill', ctx).result?.ok).toBe(true);
    expect(ctx.killed).toBe(true);
    expect(dispatchChatLine('/help', ctx).result?.lines.length).toBe(listCommands().length);
    expect(dispatchChatLine('/nope', ctx).result?.ok).toBe(false);
  });
});

describe('death messages', () => {
  it('uses a single source-to-text path', () => {
    expect(deathMessage('lava')).toBe('Player tried to swim in lava');
    expect(deathMessage('explosion')).toBe('Player was blown up by TNT');
    expect(deathMessage('generic')).toBe('Player died');
    expect(deathMessage('fall', 'Alex')).toBe('Alex fell from a high place');
  });
});

describe('chat log fade and history', () => {
  it('keeps recent lines, fades later, and records typed history', () => {
    const log = new ChatLog();
    log.push('system', 'hello', 0);
    log.push('player', 'hi', 1_000);
    expect(chatLineOpacity(0)).toBe(1);
    expect(chatLineOpacity(8_000)).toBe(1);
    expect(chatLineOpacity(9_000)).toBeCloseTo(0.5, 5);
    expect(chatLineOpacity(10_000)).toBe(0);
    expect(log.visible(1_000, false)).toHaveLength(2);
    expect(log.visible(12_000, false)).toHaveLength(0);
    expect(log.visible(12_000, true)).toHaveLength(2);
    log.rememberInput('/seed');
    log.rememberInput('/seed');
    log.rememberInput('/time day');
    expect(log.history).toEqual(['/seed', '/time day']);
    expect(stepTypedHistoryIndex(-1, 1, 2)).toEqual({ kind: 'unchanged' });
    expect(stepTypedHistoryIndex(-1, -1, 2)).toEqual({ kind: 'index', index: 1 });
    expect(stepTypedHistoryIndex(1, -1, 2)).toEqual({ kind: 'index', index: 0 });
    expect(stepTypedHistoryIndex(1, 1, 2)).toEqual({ kind: 'draft' });
  });
});

describe('chat overlay input rules', () => {
  it('blocks gameplay and pause-on-unlock while chat is open, like inventory', () => {
    expect(playerGameplayAllowed('PLAYING', true)).toBe(false);
    expect(playerGameplayAllowed('PLAYING', false)).toBe(true);
    expect(shouldOpenPauseOnUnlock('escape', true, true)).toBe(false);
    expect(shouldOpenPauseOnUnlock('escape', true, false)).toBe(true);
    expect(shouldTogglePauseOnEscapeKeydown(true, false, false)).toBe(false);
    expect(shouldTogglePauseOnEscapeKeydown(false, false, false)).toBe(true);
    expect(shouldTogglePauseOnEscapeKeydown(false, true, false)).toBe(false);
  });
});
