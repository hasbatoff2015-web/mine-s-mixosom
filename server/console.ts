import readline from 'node:readline';
import type { AnarchyServer } from './AnarchyServer';
import type { CommandResult } from './commands';

export function formatConsoleResult(echo: string, result: CommandResult): string {
  const lines = result.lines.length > 0 ? result.lines : (result.ok ? [] : ['Unknown command.']);
  return [`> ${echo}`, ...lines].join('\n') + (lines.length > 0 || echo ? '\n' : '');
}

/**
 * Read stdin lines and dispatch them through CommandRegistry as ConsoleCommandSender.
 * Server process only — never call from the client bundle.
 */
export function attachServerConsole(
  server: AnarchyServer,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): () => void {
  const rl = readline.createInterface({ input, terminal: false });
  output.write('Frontier Cubes console ready. Type commands (op, plugins, permissions, ...).\n');
  const onLine = (line: string): void => {
    try {
      const text = line.trim();
      if (!text) return;
      const result = server.dispatchConsole(text);
      output.write(formatConsoleResult(text, result));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.write(`Command failed: ${message}\n`);
    }
  };
  rl.on('line', onLine);
  return () => {
    rl.off('line', onLine);
    rl.close();
  };
}
