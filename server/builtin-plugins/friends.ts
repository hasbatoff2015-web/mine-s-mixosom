import type { Plugin } from '../PluginManager';
import { fail, isConsoleSender, ok } from '../commands';
import { formatPluginHelp, isHelpRequest } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'friends',
  title: 'Друзья',
  description: 'Список друзей, заявки и телепортация.',
  commands: [
    { usage: '/friends', description: 'Открыть меню друзей', permission: 'friends.use' },
  ],
};

export function createFriendsPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'friends',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      ctx.friends.load();
      api.loadConfig({ maxFriends: 50 });
      api.registerCommand({
        name: 'friends',
        aliases: ['friend', 'f'],
        usage: '/friends',
        description: 'Друзья',
        permission: 'friends.use',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (isConsoleSender(sender)) return fail('Консоль не может открыть друзей.');
          ctx.openGameMenu(sender.playerId, 'friends');
          return ok('Открыто меню друзей.');
        },
      });
    },
    onDisable() {
      ctx.friends.persist();
    },
  };
}
