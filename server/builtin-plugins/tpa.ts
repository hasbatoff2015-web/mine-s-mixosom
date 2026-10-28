import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import { playerText } from '../../shared/playerText';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'tpa',
  title: 'TPA',
  description: 'Немедленная телепортация оператора к игроку.',
  commands: [
    { usage: '/tpa <player>', description: 'Телепортироваться к игроку', permission: 'operator' },
    { usage: '/tpahere <player>', description: 'Телепортировать игрока к себе', permission: 'operator' },
  ],
};

export function createTpaPlugin(_ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'tpa',
    version: '2.0.0',
    apiVersion: 1,
    onEnable(api) {
      const operator = (sender: { playerId: string }) => api.isOperator(sender.playerId);

      api.registerCommand({
        name: 'tpa',
        usage: '/tpa <player>',
        description: 'Телепортироваться к игроку',
        permission: 'operator',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (!operator(sender)) return fail(playerText.noPermission);
          const name = args[0];
          if (!name) return usageError('/tpa <player>');
          const target = api.getPlayer(name);
          if (!target) return fail(playerText.playerOffline(name));
          if (target.id === sender.playerId) return fail(playerText.tpaSelf);
          const there = target.position();
          const moved = api.teleport(
            sender.playerId,
            there.x,
            there.y,
            there.z,
            'tpa',
            { warmupMs: 0 },
          );
          if (!moved.ok) return fail(moved.error ?? 'Телепортация не выполнена.');
          return ok(playerText.tpaDone(target.name));
        },
      });

      api.registerCommand({
        name: 'tpahere',
        usage: '/tpahere <player>',
        description: 'Телепортировать игрока к себе',
        permission: 'operator',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (!operator(sender)) return fail(playerText.noPermission);
          const name = args[0];
          if (!name) return usageError('/tpahere <player>');
          const target = api.getPlayer(name);
          if (!target) return fail(playerText.playerOffline(name));
          if (target.id === sender.playerId) return fail(playerText.tpaSelf);
          const self = api.getPlayer(sender.playerId);
          if (!self) return fail(playerText.playerNotFound);
          const here = self.position();
          const moved = api.teleport(
            target.id,
            here.x,
            here.y,
            here.z,
            'tpa',
            { warmupMs: 0 },
          );
          if (!moved.ok) return fail(moved.error ?? 'Телепортация не выполнена.');
          target.sendMessage(playerText.movedByOperator);
          return ok(playerText.tpahereDone(target.name));
        },
      });

      api.registerCommand({
        name: 'tpaccept',
        usage: '/tpaccept',
        description: 'Больше не используется',
        permission: 'player',
        execute: () => fail(playerText.commandRetired),
      });
      api.registerCommand({
        name: 'tpdeny',
        usage: '/tpdeny',
        description: 'Больше не используется',
        permission: 'player',
        execute: () => fail(playerText.commandRetired),
      });
    },
  };
}
