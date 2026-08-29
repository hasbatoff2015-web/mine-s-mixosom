export type LogLevel = 'info' | 'warn' | 'error';

export function serverLog(message: string, level: LogLevel = 'info'): void {
  const line = `[server] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
