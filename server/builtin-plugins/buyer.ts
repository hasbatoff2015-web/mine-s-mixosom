import type { Plugin } from '../PluginManager';
import { fail, isConsoleSender, ok } from '../commands';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import { tryGetItemDefinition } from '../../src/items';
import { formatMegacoins } from '../services/economy';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'buyer',
  title: 'Скупщики',
  description: 'Статичные NPC, которые покупают один предмет за Мегакоины.',
  commands: [
    { usage: '/buyer create <name>', description: 'Создать скупщика в вашей позиции', permission: 'buyer.create' },
    { usage: '/buyer move <name>', description: 'Переместить скупщика в вашу позицию', permission: 'buyer.move' },
    { usage: '/buyer delete <name>', description: 'Удалить скупщика', permission: 'buyer.delete' },
    { usage: '/buyer list', description: 'Список скупщиков', permission: 'buyer.list' },
  ],
};

function itemLabel(itemId: string | undefined, price: number | undefined): string {
  if (!itemId || price === undefined) return 'не настроен';
  const name = tryGetItemDefinition(itemId)?.name ?? itemId;
  return `${name} — ${formatMegacoins(price)} / шт.`;
}

export function createBuyerPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'buyer',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      ctx.buyer.load();
      ctx.buyer.ensureHolograms();
      ctx.broadcastBuyers();

      api.registerCommand({
        name: 'buyer',
        aliases: ['buyers', 'скупщик'],
        usage: '/buyer <create|move|delete|list> [name]',
        description: 'Управление скупщиками',
        permission: 'buyer.use',
        execute: (args, sender) => {
          if (isHelpRequest(args) || args.length === 0) return ok(formatPluginHelp(HELP));
          const sub = args[0]?.toLowerCase();
          const need = (node: string): boolean => api.hasPermission(sender.playerId, node) || api.isOperator(sender.playerId);
          if (sub === 'list') {
            if (!need('buyer.list')) return fail('You do not have permission.');
            const buyers = ctx.buyer.list();
            if (buyers.length === 0) return ok('Скупщики: нет.');
            return ok([
              'Скупщики:',
              ...buyers.map((buyer, index) => (
                `${index + 1}. ${buyer.name} — ${itemLabel(buyer.itemId, buyer.pricePerItem)}`
              )),
            ]);
          }
          if (isConsoleSender(sender)) return fail('Консоль не может управлять скупщиками.');
          const player = api.getPlayer(sender.playerId);
          if (!player) return fail('Player not found.');
          const name = args.slice(1).join(' ').trim();
          if (sub === 'create') {
            if (!need('buyer.create')) return fail('You do not have permission.');
            if (!name) return usageError('/buyer create <name>');
            const pos = player.position();
            const look = player.snapshot();
            const result = ctx.buyer.create({
              name,
              worldId: ctx.worldId(),
              x: pos.x,
              y: pos.y,
              z: pos.z,
              yaw: look.yaw,
              pitch: look.pitch,
            });
            if (!result.ok || !result.buyer) return fail(result.error ?? 'Не удалось создать скупщика.');
            ctx.broadcastBuyers();
            ctx.openBuyerAdmin(sender.playerId, result.buyer.id);
            return ok(`Создан скупщик «${result.buyer.name}».`);
          }
          if (sub === 'move') {
            if (!need('buyer.move')) return fail('You do not have permission.');
            if (!name) return usageError('/buyer move <name>');
            const pos = player.position();
            const look = player.snapshot();
            const result = ctx.buyer.move(name, {
              worldId: ctx.worldId(),
              x: pos.x,
              y: pos.y,
              z: pos.z,
              yaw: look.yaw,
              pitch: look.pitch,
            });
            if (!result.ok || !result.buyer) return fail(result.error ?? 'Не удалось переместить скупщика.');
            ctx.broadcastBuyers();
            return ok(`Скупщик «${result.buyer.name}» перемещён.`);
          }
          if (sub === 'delete') {
            if (!need('buyer.delete')) return fail('You do not have permission.');
            if (!name) return usageError('/buyer delete <name>');
            const result = ctx.buyer.delete(name);
            if (!result.ok) return fail(result.error ?? 'Не удалось удалить скупщика.');
            ctx.broadcastBuyers();
            return ok(`Скупщик «${name}» удалён.`);
          }
          return usageError('/buyer <create|move|delete|list> [name]');
        },
      });
    },
    onDisable() {
      ctx.buyer.persist();
    },
  };
}

