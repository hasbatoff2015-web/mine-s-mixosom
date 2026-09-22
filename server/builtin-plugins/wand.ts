import { ItemId } from '../../src/items';
import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import {
  cuboidSizeOf,
  formatBlockPos,
  formatCuboidSize,
} from '../services/selection';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

export const WAND_ITEM = ItemId.WoodenAxe;

const HELP = {
  name: 'wand',
  title: 'Wand',
  description: 'Общий инструмент выделения: два клика задают углы кубоида.',
  commands: [
    { usage: '/wand', description: 'Выдать wand и включить режим выделения', permission: 'wand.use' },
    { usage: '/wand clear', description: 'Очистить выделение', permission: 'wand.use' },
    { usage: '/wand help', description: 'Показать справку' },
  ],
};

export function createWandPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'wand',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      const canUse = (playerId: string, name: string) => (
        api.hasPermission(playerId, 'wand.use') || api.isOperator(name)
      );

      const holdingWand = (playerId: string): boolean => {
        const player = api.getPlayer(playerId);
        if (!player) return false;
        return player.snapshot().presentation?.heldItemId === WAND_ITEM;
      };

      const applyClick = (playerId: string, x: number, y: number, z: number): boolean => {
        const player = api.getPlayer(playerId);
        if (!player || !canUse(playerId, player.name)) return false;
        if (!ctx.selection.isWandActive(playerId) || !holdingWand(playerId)) return false;
        const result = ctx.selection.click(playerId, { x, y, z });
        if (result.slot === 1) {
          player.sendMessage(`Точка 1: ${formatBlockPos({ x, y, z })}`);
          return true;
        }
        player.sendMessage(`Точка 2: ${formatBlockPos({ x, y, z })}`);
        if (result.volume) {
          const size = cuboidSizeOf(result.volume);
          player.sendMessage(`Выделение: ${formatCuboidSize(size)} (${size.blocks} блоков)`);
        }
        return true;
      };

      api.registerEvent('playerInteract', (event) => {
        if (applyClick(event.playerId, event.x, event.y, event.z)) event.cancel();
      });
      api.registerEvent('blockBreak', (event) => {
        if (applyClick(event.playerId, event.x, event.y, event.z)) event.cancel();
      });
      api.registerEvent('playerQuit', (event) => {
        ctx.selection.forget(event.playerId);
      });

      api.registerCommand({
        name: 'wand',
        usage: '/wand [clear]',
        description: 'Общий инструмент выделения',
        permission: 'wand.use',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          const player = api.getPlayer(sender.playerId);
          if (!player) return fail('Игрок не найден.');
          const sub = args[0]?.toLowerCase();
          if (!sub) {
            ctx.selection.activateWand(sender.playerId);
            player.give(WAND_ITEM, 1);
            return ok([
              'Выдан wand (деревянный топор). Режим выделения включён.',
              'Первый клик — точка 1, второй клик — точка 2, следующий цикл начинается снова с точки 1.',
            ]);
          }
          if (sub === 'clear') {
            ctx.selection.clear(sender.playerId);
            return ok('Выделение очищено.');
          }
          return usageError('/wand [clear]');
        },
      });
    },
  };
}
