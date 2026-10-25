import type { Plugin } from '../PluginManager';
import { fail, isConsoleSender, ok } from '../commands';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import { tryGetItemDefinition } from '../../src/items';
import type { BuyerRole } from '../../shared/buyers';
import { formatMegacoins } from '../services/economy';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'buyer',
  title: 'Торговцы',
  description: 'Статичные NPC: скупщики платят Мегакоины за предмет, продавцы выдают предмет за Мегакоины.',
  commands: [
    { usage: '/buyer create <name>', description: 'Создать скупщика в вашей позиции', permission: 'buyer.create' },
    { usage: '/buyer create seller <name>', description: 'Создать продавца в вашей позиции', permission: 'buyer.create' },
    { usage: '/buyer move <name>', description: 'Переместить торговца в вашу позицию', permission: 'buyer.move' },
    { usage: '/buyer delete <name>', description: 'Удалить торговца', permission: 'buyer.delete' },
    { usage: '/buyer list', description: 'Список торговцев', permission: 'buyer.list' },
  ],
};

function itemLabel(itemId: string | undefined, price: number | undefined): string {
  if (!itemId || price === undefined) return 'не настроен';
  const name = tryGetItemDefinition(itemId)?.name ?? itemId;
  return `${name} — ${formatMegacoins(price)} / шт.`;
}

function describeTrader(buyer: {
  role: BuyerRole;
  itemId?: string;
  pricePerItem?: number;
}): string {
  const role = buyer.role === 'seller' ? 'продавец' : 'скупщик';
  return `${role} — ${itemLabel(buyer.itemId, buyer.pricePerItem)}`;
}

function traderNoun(role: BuyerRole): string {
  return role === 'seller' ? 'Продавец' : 'Скупщик';
}

function createRequest(args: readonly string[]): { role: BuyerRole; name: string } | undefined {
  const rest = args.slice(1);
  if (rest.length === 0) return undefined;
  const head = rest[0]?.toLowerCase() ?? '';
  const mode = head === 'seller' || head === 'продавец'
    ? 'seller'
    : head === 'buyer' || head === 'скупщик'
      ? 'buyer'
      : undefined;
  if (mode && rest.length >= 2) {
    const name = rest.slice(1).join(' ').trim();
    if (!name) return undefined;
    return { role: mode, name };
  }
  const name = rest.join(' ').trim();
  if (!name) return undefined;
  return { role: 'buyer', name };
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
        aliases: ['buyers', 'скупщик', 'продавец'],
        usage: '/buyer <create|move|delete|list> [seller] [name]',
        description: 'Управление скупщиками и продавцами',
        permission: 'buyer.use',
        execute: (args, sender) => {
          if (isHelpRequest(args) || args.length === 0) return ok(formatPluginHelp(HELP));
          const sub = args[0]?.toLowerCase();
          const need = (node: string): boolean => api.hasPermission(sender.playerId, node) || api.isOperator(sender.playerId);
          if (sub === 'list') {
            if (!need('buyer.list')) return fail('Недостаточно прав для выполнения этой команды.');
            const buyers = ctx.buyer.list();
            if (buyers.length === 0) return ok('Торговцы: нет.');
            return ok([
              'Торговцы:',
              ...buyers.map((buyer, index) => (
                `${index + 1}. ${buyer.name} — ${describeTrader(buyer)}`
              )),
            ]);
          }
          if (isConsoleSender(sender)) return fail('Консоль не может управлять скупщиками.');
          const player = api.getPlayer(sender.playerId);
          if (!player) return fail('Player not found.');
          const name = args.slice(1).join(' ').trim();
          if (sub === 'create') {
            if (!need('buyer.create')) return fail('Недостаточно прав для выполнения этой команды.');
            const request = createRequest(args);
            if (!request) return usageError('/buyer create [seller] <name>');
            const pos = player.position();
            const look = player.snapshot();
            const result = ctx.buyer.create({
              name: request.name,
              role: request.role,
              worldId: ctx.worldId(),
              x: pos.x,
              y: pos.y,
              z: pos.z,
              yaw: look.yaw,
              pitch: look.pitch,
            });
            if (!result.ok || !result.buyer) return fail(result.error ?? 'Не удалось создать торговца.');
            ctx.broadcastBuyers();
            ctx.openBuyerAdmin(sender.playerId, result.buyer.id);
            const noun = request.role === 'seller' ? 'продавец' : 'скупщик';
            return ok(`Создан ${noun} «${result.buyer.name}».`);
          }
          if (sub === 'move') {
            if (!need('buyer.move')) return fail('Недостаточно прав для выполнения этой команды.');
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
            if (!result.ok || !result.buyer) return fail(result.error ?? 'Не удалось переместить торговца.');
            ctx.broadcastBuyers();
            return ok(`${traderNoun(result.buyer.role)} «${result.buyer.name}» перемещён.`);
          }
          if (sub === 'delete') {
            if (!need('buyer.delete')) return fail('Недостаточно прав для выполнения этой команды.');
            if (!name) return usageError('/buyer delete <name>');
            const existing = ctx.buyer.findByName(name);
            const result = ctx.buyer.delete(name);
            if (!result.ok || !result.buyer) return fail(result.error ?? 'Не удалось удалить торговца.');
            ctx.broadcastBuyers();
            return ok(`${traderNoun(existing?.role ?? result.buyer.role)} «${name}» удалён.`);
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

