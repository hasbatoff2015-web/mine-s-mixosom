/**
 * Tiny example plugin for Phase 8.
 * Proves load / enable / command / join event / cleanup.
 * Not a gameplay feature (homes/economy/tpa live elsewhere, later).
 */
import type { Plugin } from '../../../server/PluginManager';

export const plugin: Plugin = {
  name: 'example',
  version: '1.0.0',
  apiVersion: 1,
  onEnable(api) {
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
