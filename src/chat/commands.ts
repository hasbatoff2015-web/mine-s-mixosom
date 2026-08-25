import { isKnownItemId, tryGetItemDefinition } from '../items';
import type { GameMode } from '../save/types';
import { parseChatLine } from './parse';

export interface CommandResult {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

export interface CommandDefinition {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly usage: string;
  readonly description: string;
  execute(args: readonly string[], ctx: CommandContext): CommandResult;
}

export interface CommandContext {
  readonly playerName: string;
  readonly mode: GameMode;
  setMode(mode: GameMode): void;
  readonly timeOfDay: number;
  setTime(ticks: number): void;
  readonly seed: string;
  give(itemId: string, count: number): { given: number; leftover: number };
  teleport(x: number, y: number, z: number): void;
  playerPosition(): { x: number; y: number; z: number };
  clearInventory(): number;
  kill(): void;
}

export const TIME_PRESETS = Object.freeze({
  day: 1_000,
  noon: 6_000,
  night: 13_000,
  midnight: 18_000,
});

const GAMEMODE_ALIASES: Readonly<Record<string, GameMode>> = Object.freeze({
  survival: 'survival',
  s: 'survival',
  '0': 'survival',
  creative: 'creative',
  c: 'creative',
  '1': 'creative',
});

function ok(lines: string | readonly string[]): CommandResult {
  return { ok: true, lines: typeof lines === 'string' ? [lines] : lines };
}

function fail(lines: string | readonly string[]): CommandResult {
  return { ok: false, lines: typeof lines === 'string' ? [lines] : lines };
}

function parseCount(raw: string | undefined, fallback = 1): number | undefined {
  if (raw === undefined || raw === '') return fallback;
  if (!/^-?\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 2304) return undefined;
  return value;
}

function parseCoord(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function resolveItemId(raw: string): string | undefined {
  const id = raw.trim().toLowerCase().replace(/^minecraft:/, '');
  if (!id) return undefined;
  if (isKnownItemId(id)) return id;
  return undefined;
}

const helpCommand: CommandDefinition = {
  name: 'help',
  usage: '/help [command]',
  description: 'List commands or show usage for one command',
  execute(args) {
    if (args[0]) {
      const command = findCommand(args[0]);
      if (!command) return fail(`Unknown command '${args[0]}'.`);
      return ok(`${command.usage} — ${command.description}`);
    }
    return ok(listCommands().map((command) => `${command.usage} — ${command.description}`));
  },
};

const gamemodeCommand: CommandDefinition = {
  name: 'gamemode',
  aliases: ['gm'],
  usage: '/gamemode <survival|creative>',
  description: 'Set survival or creative mode',
  execute(args, ctx) {
    const key = args[0]?.toLowerCase();
    const mode = key ? GAMEMODE_ALIASES[key] : undefined;
    if (!mode) return fail('Usage: /gamemode <survival|creative|s|c|0|1>');
    ctx.setMode(mode);
    return ok(`Set game mode to ${mode}`);
  },
};

const timeCommand: CommandDefinition = {
  name: 'time',
  usage: '/time <day|noon|night|midnight>',
  description: 'Set the time of day',
  execute(args, ctx) {
    const key = args[0]?.toLowerCase() as keyof typeof TIME_PRESETS | undefined;
    if (!key || TIME_PRESETS[key] === undefined) {
      return fail('Usage: /time <day|noon|night|midnight>');
    }
    ctx.setTime(TIME_PRESETS[key]);
    return ok(`Set time to ${key} (${TIME_PRESETS[key]})`);
  },
};

const giveCommand: CommandDefinition = {
  name: 'give',
  usage: '/give <item> [count]',
  description: 'Give an item to yourself',
  execute(args, ctx) {
    if (!args[0]) return fail('Usage: /give <item> [count]');
    const itemId = resolveItemId(args[0]);
    if (!itemId) return fail(`Unknown item '${args[0]}'.`);
    const count = parseCount(args[1], 1);
    if (count === undefined) return fail('Count must be an integer from 1 to 2304.');
    const result = ctx.give(itemId, count);
    const name = tryGetItemDefinition(itemId)?.name ?? itemId;
    if (result.given <= 0 && result.leftover <= 0) return fail(`Could not give ${name}: inventory is full.`);
    if (result.leftover > 0) {
      return ok(`Gave ${result.given} ${name} (${result.leftover} dropped, inventory full)`);
    }
    return ok(`Gave ${result.given} ${name}`);
  },
};

const tpCommand: CommandDefinition = {
  name: 'tp',
  aliases: ['teleport'],
  usage: '/tp <x> <y> <z>',
  description: 'Teleport to coordinates',
  execute(args, ctx) {
    const x = parseCoord(args[0]);
    const y = parseCoord(args[1]);
    const z = parseCoord(args[2]);
    if (x === undefined || y === undefined || z === undefined) return fail('Usage: /tp <x> <y> <z>');
    ctx.teleport(x, y, z);
    const position = ctx.playerPosition();
    return ok(`Teleported to ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`);
  },
};

const seedCommand: CommandDefinition = {
  name: 'seed',
  usage: '/seed',
  description: 'Show the world seed',
  execute(_args, ctx) {
    return ok(`Seed: ${ctx.seed}`);
  },
};

const clearCommand: CommandDefinition = {
  name: 'clear',
  usage: '/clear',
  description: 'Clear your inventory',
  execute(_args, ctx) {
    const removed = ctx.clearInventory();
    return ok(removed > 0 ? `Cleared ${removed} item(s) from inventory` : 'Inventory is already empty');
  },
};

const killCommand: CommandDefinition = {
  name: 'kill',
  usage: '/kill',
  description: 'Kill yourself',
  execute(_args, ctx) {
    ctx.kill();
    return { ok: true, lines: [] };
  },
};

const COMMANDS: readonly CommandDefinition[] = Object.freeze([
  helpCommand,
  gamemodeCommand,
  timeCommand,
  giveCommand,
  tpCommand,
  seedCommand,
  clearCommand,
  killCommand,
]);

const COMMAND_BY_NAME = new Map<string, CommandDefinition>();
for (const command of COMMANDS) {
  COMMAND_BY_NAME.set(command.name, command);
  for (const alias of command.aliases ?? []) COMMAND_BY_NAME.set(alias, command);
}

export function listCommands(): readonly CommandDefinition[] {
  return COMMANDS;
}

export function findCommand(name: string): CommandDefinition | undefined {
  return COMMAND_BY_NAME.get(name.trim().toLowerCase());
}

export function dispatchChatLine(raw: string, ctx: CommandContext): {
  readonly parsed: ReturnType<typeof parseChatLine>;
  readonly result?: CommandResult;
} {
  const parsed = parseChatLine(raw);
  if (parsed.kind !== 'command') return { parsed };
  const command = findCommand(parsed.name);
  if (!command) {
    return { parsed, result: fail(`Unknown command '${parsed.name}'. Type /help for a list.`) };
  }
  return { parsed, result: command.execute(parsed.args, ctx) };
}
