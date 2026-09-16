import type { Plugin } from '../PluginManager';
import { fail, isConsoleSender, ok } from '../commands';
import { formatPluginHelp, isHelpRequest } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'trade',
  title: 'Обмен',
  description: 'Обмен предметами и Мегакоинами между игроками.',
  commands: [
    { usage: '/trade', description: 'Открыть обмен', permission: 'trade.use' },
  ],
};

export function createTradePlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'trade',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      api.registerCommand({
        name: 'trade',
        aliases: ['обмен'],
        usage: '/trade',
        description: 'Обмен',
        permission: 'trade.use',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (isConsoleSender(sender)) return fail('Консоль не может открыть обмен.');
          ctx.openGameMenu(sender.playerId, 'trade');
          return ok('Открыто меню обмена.');
        },
      });
    },
  };
}
