import type { Plugin } from '../PluginManager';

/**
 * Canonical Phase 8 example. Not loaded by default.
 *
 * Local QA:
 *   cp server/plugin-examples/hello.ts server/plugins/hello.ts
 *   # restart npm run dev:server
 * or:
 *   FC_EXAMPLE_PLUGIN=1 npm run dev:server
 *
 * This is not homes/economy/tpa. It only proves lifecycle + /hello + join log.
 */
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
