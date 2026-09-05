import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import { formatPluginHelp, isHelpRequest } from '../services/pluginHelp';

const HELP = {
  name: 'back',
  title: 'Back',
  description: 'Return to the previous teleport or death location.',
  commands: [
    { usage: '/back', description: 'Teleport to your previous location', permission: 'back.use' },
    { usage: '/back help', description: 'Show this help' },
  ],
};

export function createBackPlugin(): Plugin {
  return {
    name: 'back',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      api.registerCommand({
        name: 'back',
        usage: '/back',
        description: 'Teleport to your previous location',
        permission: 'back.use',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          const last = api.consumeLastTeleport(sender.playerId);
          if (!last) return fail('No previous location.');
          const result = api.teleport(sender.playerId, last.x, last.y, last.z, 'back', { warmupMs: 0 });
          return result.ok
            ? ok(`Returned to your previous ${last.reason} location.`)
            : fail(result.error ?? 'Teleport failed.');
        },
      });
    },
  };
}
