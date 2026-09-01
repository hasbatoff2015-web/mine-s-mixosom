/**
 * Tiny example plugin for Phase 8.
 * Proves load / enable / command / join event / cleanup.
 * Not a gameplay feature (homes/economy/tpa live elsewhere, later).
 */
export const plugin = {
  name: 'example',
  version: '1.0.0',
  apiVersion: 1,
  onEnable(api: {
    log(message: string): void;
    registerCommand(handler: {
      name: string;
      usage: string;
      description: string;
      execute(args: readonly string[], sender: { name: string }): { ok: boolean; lines: string[] };
    }): void;
    registerEvent(name: 'playerJoin', handler: (event: { name: string }) => void): void;
  }) {
    api.log('example enabled');
    api.registerCommand({
      name: 'hello',
      usage: '/hello',
      description: 'Example plugin ping',
      execute: (_args, sender) => ({ ok: true, lines: [`Hello, ${sender.name}`] }),
    });
    api.registerEvent('playerJoin', (event) => {
      api.log(`join ${event.name}`);
    });
  },
};
