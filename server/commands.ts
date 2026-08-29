import type { GameMode } from '../shared/protocol';
import { parseChatLine } from '../src/chat/parse';

export interface CommandResult {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

export interface CommandSender {
  readonly playerId: string;
  readonly name: string;
  readonly gamemode: GameMode;
}

export interface CommandHandler {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly usage: string;
  readonly description: string;
  execute(args: readonly string[], sender: CommandSender): CommandResult;
}

export class CommandRegistry {
  private readonly byName = new Map<string, CommandHandler>();

  register(handler: CommandHandler): void {
    const names = [handler.name, ...(handler.aliases ?? [])];
    for (const name of names) {
      const key = name.trim().toLowerCase();
      if (!key || this.byName.has(key)) {
        throw new Error(`Command already registered: ${key || handler.name}`);
      }
      this.byName.set(key, handler);
    }
  }

  find(name: string): CommandHandler | undefined {
    return this.byName.get(name.trim().toLowerCase());
  }

  list(): CommandHandler[] {
    const seen = new Set<CommandHandler>();
    const list: CommandHandler[] = [];
    for (const handler of this.byName.values()) {
      if (seen.has(handler)) continue;
      seen.add(handler);
      list.push(handler);
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  dispatch(raw: string, sender: CommandSender): {
    readonly parsed: ReturnType<typeof parseChatLine>;
    readonly result?: CommandResult;
  } {
    const parsed = parseChatLine(raw);
    if (parsed.kind !== 'command') return { parsed };
    const handler = this.find(parsed.name);
    if (!handler) {
      return {
        parsed,
        result: { ok: false, lines: [`Unknown command '${parsed.name}'. Type /help for a list.`] },
      };
    }
    return { parsed, result: handler.execute(parsed.args, sender) };
  }
}

export function ok(lines: string | readonly string[]): CommandResult {
  return { ok: true, lines: typeof lines === 'string' ? [lines] : lines };
}

export function fail(lines: string | readonly string[]): CommandResult {
  return { ok: false, lines: typeof lines === 'string' ? [lines] : lines };
}
