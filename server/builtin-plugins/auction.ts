import type { Plugin } from '../PluginManager';
import { fail, isConsoleSender, ok } from '../commands';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'auction',
  title: 'Аукцион',
  description: 'Аукцион Мегакоинов: просмотр, продажа и возврат лотов.',
  commands: [
    { usage: '/ah', description: 'Открыть аукцион', permission: 'auction.use' },
    { usage: '/ah sell', description: 'Выставить предмет', permission: 'auction.sell' },
    { usage: '/ah list', description: 'Мои лоты и возврат', permission: 'auction.list' },
  ],
};

export function createAuctionPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'auction',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      ctx.auction.load();
      api.loadConfig({
        durationDays: 2,
        maxActive: 30,
        minPrice: 10,
        maxPrice: 100_000_000,
      });
      api.scheduleRepeating(1000, () => ctx.auction.expireDue());

      api.registerCommand({
        name: 'ah',
        aliases: ['auction', 'auctionhouse'],
        usage: '/ah [sell|list]',
        description: 'Аукцион',
        permission: 'auction.use',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (isConsoleSender(sender)) return fail('Консоль не может открыть аукцион.');
          const sub = args[0]?.toLowerCase();
          if (!sub) {
            ctx.openAuction(sender.playerId, 'browse');
            return ok('Открыт аукцион.');
          }
          if (sub === 'sell') {
            if (!api.hasPermission(sender.playerId, 'auction.sell') && !api.isOperator(sender.playerId)) {
              return fail('You do not have permission.');
            }
            ctx.openAuction(sender.playerId, 'sell');
            return ok('Открыта продажа на аукционе.');
          }
          if (sub === 'list') {
            if (!api.hasPermission(sender.playerId, 'auction.list') && !api.isOperator(sender.playerId)) {
              return fail('You do not have permission.');
            }
            ctx.openAuction(sender.playerId, 'list');
            return ok('Открыт список ваших лотов.');
          }
          return usageError('/ah [sell|list]');
        },
      });
    },
    onDisable() {
      ctx.auction.persist();
    },
  };
}
