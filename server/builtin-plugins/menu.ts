import type { Plugin } from '../PluginManager';
import { fail, isConsoleSender, ok } from '../commands';
import { formatPluginHelp, isHelpRequest } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'menu',
  title: 'Меню',
  description: 'Главное игровое меню.',
  commands: [
    { usage: '/menu', description: 'Открыть главное меню', permission: 'spawn.use' },
  ],
};

export function createMenuPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'menu',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      api.registerCommand({
        name: 'menu',
        aliases: ['меню'],
        usage: '/menu',
        description: 'Главное меню',
        permission: 'spawn.use',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (isConsoleSender(sender)) return fail('Консоль не может открыть меню.');
          ctx.openGameMenu(sender.playerId, 'root');
          return ok('Открыто главное меню.');
        },
      });
    },
  };
}
