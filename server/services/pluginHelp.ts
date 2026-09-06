import { fail, ok, type CommandResult } from '../commands';

export interface PluginHelpCommand {
  readonly usage: string;
  readonly description: string;
  readonly permission?: string;
}

export interface PluginHelpMeta {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly commands: readonly PluginHelpCommand[];
}

export function isHelpRequest(args: readonly string[]): boolean {
  const key = args[0]?.trim().toLowerCase();
  return key === 'help' || key === '?' || key === '--help';
}

export function formatPluginHelp(meta: PluginHelpMeta): string[] {
  const lines = [
    `${meta.title} — ${meta.description}`,
    'Commands:',
  ];
  for (const command of meta.commands) {
    const permission = command.permission && command.permission !== 'player'
      ? `  perm: ${command.permission}`
      : '';
    lines.push(`  ${command.usage} — ${command.description}${permission}`);
  }
  return lines;
}

export function pluginHelp(meta: PluginHelpMeta): CommandResult {
  return ok(formatPluginHelp(meta));
}

export function usageError(usage: string, detail?: string): CommandResult {
  return fail(detail ? [detail, `Usage: ${usage}`] : `Usage: ${usage}`);
}
