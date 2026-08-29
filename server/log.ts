export type LogLevel = 'info' | 'warn' | 'error';

export function serverLog(message: string, level: LogLevel = 'info'): void {
  const line = `[server] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** Opt-in (`FC_DEBUG_NET=1`). Never call from the 20 TPS hot path. */
export function netDebug(scope: string, message: string): void {
  if (process.env.FC_DEBUG_NET !== '1') return;
  serverLog(`${scope} ${message}`);
}
