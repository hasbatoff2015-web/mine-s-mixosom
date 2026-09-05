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
  /** True when PermissionService (or FC_OPERATORS) treats the sender as OP. */
  readonly operator?: boolean;
}

/**
 * `'player'` — anyone online.
 * `'operator'` — OP / FC_OPERATORS (legacy).
 * Any other string is a permission node (`home.use`, `server.*`, …).
 */
export type CommandPermission = 'player' | 'operator' | (string & {});

export type PermissionCheck = (sender: CommandSender, permission: CommandPermission) => boolean;

export interface CommandHandler {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly usage: string;
  readonly description: string;
  readonly permission?: CommandPermission;
  execute(args: readonly string[], sender: CommandSender): CommandResult;
}

export class CommandRegistry {
  private readonly byName = new Map<string, CommandHandler>();
  private permissionCheck: PermissionCheck | undefined;

  setPermissionCheck(check: PermissionCheck | undefined): void {
    this.permissionCheck = check;
  }

  register(handler: CommandHandler): () => void {
    const names = [handler.name, ...(handler.aliases ?? [])];
    for (const name of names) {
      const key = name.trim().toLowerCase();
      if (!key || this.byName.has(key)) {
        throw new Error(`Command already registered: ${key || handler.name}`);
      }
    }
    for (const name of names) {
      this.byName.set(name.trim().toLowerCase(), handler);
    }
    return () => {
      this.unregister(handler.name);
    };
  }

  unregister(name: string): boolean {
    const handler = this.find(name);
    if (!handler) return false;
    const names = [handler.name, ...(handler.aliases ?? [])];
    for (const entry of names) {
      const key = entry.trim().toLowerCase();
      if (this.byName.get(key) === handler) this.byName.delete(key);
    }
    return true;
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
    const permission = handler.permission ?? 'player';
    if (permission !== 'player') {
      const allowed = this.permissionCheck
        ? this.permissionCheck(sender, permission)
        : permission === 'operator' && sender.operator === true;
      if (!allowed) {
        return {
          parsed,
          result: { ok: false, lines: ['You do not have permission.'] },
        };
      }
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
