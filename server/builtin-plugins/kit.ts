import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import { isKnownItemId } from '../../src/items';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import {
  KIT_MAX_ITEM_COUNT,
  KIT_NAME_MAX,
  KIT_START_NAME,
  KitService,
  deliverKit,
  parseKitName,
  type KitDefinition,
} from '../services/kit';

const HELP = {
  name: 'kit',
  title: 'Наборы',
  description: 'Стартовый набор и наборы по разрешению kit.claim.<имя>.',
  commands: [
    { usage: '/kit help', description: 'Показать справку' },
    { usage: '/kit start', description: 'Забрать стартовый набор, если первый вход его не выдал' },
    { usage: '/kit claim <name>', description: 'Получить набор по разрешению kit.claim.<имя>' },
    { usage: '/kit create <name>', description: 'Создать пустой набор', permission: 'kit.admin' },
    { usage: '/kit info <name>', description: 'Состав набора', permission: 'kit.admin' },
    { usage: '/kit delete <name>', description: 'Удалить набор', permission: 'kit.admin' },
    { usage: '/kit edit <name> add <item> <count>', description: 'Добавить предметы', permission: 'kit.admin' },
    { usage: '/kit edit <name> remove <item>', description: 'Убрать предмет из набора', permission: 'kit.admin' },
    { usage: '/kit edit <name> clear', description: 'Очистить набор', permission: 'kit.admin' },
    { usage: '/kit give <player> <name>', description: 'Выдать набор игроку', permission: 'kit.admin' },
  ],
};

function formatKit(kit: KitDefinition): string[] {
  if (kit.items.length === 0) return [`Набор '${kit.name}' пуст.`];
  return [
    `Набор '${kit.name}':`,
    ...kit.items.map((item) => `${item.itemId} × ${item.count}`),
  ];
}

function invalidName(): string {
  return `Некорректное имя набора. Используйте 1–${KIT_NAME_MAX} символов: a-z, 0-9, _.`;
}

export function createKitPlugin(): Plugin {
  let loadStore: () => unknown = () => undefined;
  let saveStore: (store: unknown) => void = () => undefined;
  const service = new KitService(
    () => loadStore(),
    (store) => saveStore(store),
  );

  return {
    name: 'kit',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      loadStore = () => api.loadData('store', { kits: [], receivedStart: [], pendingStart: [] });
      saveStore = (store) => api.saveData('store', store);
      service.load();

      const isAdmin = (playerId: string, name: string): boolean => (
        api.isOperator(name)
        || api.hasPermission(playerId, 'kit.admin')
        || api.hasPermission(playerId, 'server.admin')
      );

      const giveNamed = (playerId: string, kitName: string) => {
        const player = api.getPlayer(playerId);
        if (!player) return fail('Игрок не найден.');
        const kit = service.get(kitName);
        if (!kit) return fail(`Набор '${kitName}' не найден.`);
        deliverKit(player, kit);
        return ok(kit.items.length > 0 ? `Выдан набор '${kitName}'.` : `Набор '${kitName}' пуст.`);
      };

      api.registerEvent('playerJoin', (event) => {
        if (!service.shouldAutoGrantStart(event.firstJoin, event.playerId)) return;
        const kit = service.get(KIT_START_NAME);
        const result = service.grantStart(event.playerId, () => {
          const player = api.getPlayer(event.playerId);
          if (!player) return false;
          return deliverKit(player, kit);
        });
        if (result === 'granted' && kit && kit.items.length > 0) {
          api.getPlayer(event.playerId)?.sendMessage('Выдан стартовый набор.');
        }
      });

      api.registerCommand({
        name: 'kit',
        usage: '/kit help',
        description: 'Наборы предметов',
        permission: 'player',
        execute: (args, sender) => {
          if (isHelpRequest(args) || args.length === 0) return ok(formatPluginHelp(HELP));
          const sub = args[0]!.toLowerCase();
          const admin = isAdmin(sender.playerId, sender.name);

          if (sub === 'start') {
            if (service.hasReceivedStart(sender.playerId)) return fail('Стартовый набор уже получен.');
            if (!service.isPendingStart(sender.playerId)) {
              return fail('Стартовый набор выдаётся только при первом входе.');
            }
            const result = service.grantStart(sender.playerId, () => {
              const player = api.getPlayer(sender.playerId);
              if (!player) return false;
              return deliverKit(player, service.get(KIT_START_NAME));
            });
            if (result === 'granted') return ok('Выдан стартовый набор.');
            if (result === 'already') return fail('Стартовый набор уже получен.');
            if (result === 'busy') return fail('Стартовый набор уже выдаётся.');
            return fail('Не удалось выдать стартовый набор.');
          }

          if (sub === 'claim') {
            const name = parseKitName(args[1]);
            if (!args[1]) return usageError('/kit claim <name>');
            if (!name) return fail(invalidName());
            if (name === KIT_START_NAME) return fail('Стартовый набор выдаётся только при первом входе.');
            if (!admin && !api.hasPermission(sender.playerId, `kit.claim.${name}`)) {
              return fail('You do not have permission.');
            }
            return giveNamed(sender.playerId, name);
          }

          if (!admin) return fail('You do not have permission.');

          if (sub === 'create') {
            const name = parseKitName(args[1]);
            if (!args[1]) return usageError('/kit create <name>');
            if (!name) return fail(invalidName());
            const created = service.create(name);
            return created.ok ? ok(`Набор '${name}' создан.`) : fail(created.error);
          }

          if (sub === 'info') {
            const name = parseKitName(args[1]);
            if (!args[1]) return usageError('/kit info <name>');
            if (!name) return fail(invalidName());
            const kit = service.get(name) ?? (name === KIT_START_NAME ? { name, items: [] } : undefined);
            if (!kit) return fail(`Набор '${name}' не найден.`);
            return ok(formatKit(kit));
          }

          if (sub === 'delete') {
            const name = parseKitName(args[1]);
            if (!args[1]) return usageError('/kit delete <name>');
            if (!name) return fail(invalidName());
            const removed = service.remove(name);
            return removed.ok ? ok(`Набор '${name}' удалён.`) : fail(removed.error);
          }

          if (sub === 'edit') {
            const name = parseKitName(args[1]);
            const action = args[2]?.toLowerCase();
            if (!args[1] || !action) return usageError('/kit edit <name> add <item> <count>');
            if (!name) return fail(invalidName());
            if (action === 'clear') {
              const cleared = service.clear(name);
              return cleared.ok ? ok(`Набор '${name}' очищен.`) : fail(cleared.error);
            }
            if (action === 'remove') {
              if (!args[3]) return usageError('/kit edit <name> remove <item>');
              const removed = service.removeItem(name, args[3].toLowerCase());
              return removed.ok ? ok(formatKit(removed.kit)) : fail(removed.error);
            }
            if (action === 'add') {
              if (!args[3] || args[4] === undefined) return usageError('/kit edit <name> add <item> <count>');
              const itemId = args[3].toLowerCase();
              if (!isKnownItemId(itemId)) return fail(`Неизвестный предмет '${itemId}'.`);
              const count = Number(args[4]);
              if (!Number.isInteger(count) || count < 1 || count > KIT_MAX_ITEM_COUNT) {
                return fail(`Количество должно быть целым от 1 до ${KIT_MAX_ITEM_COUNT}.`);
              }
              const added = service.addItem(name, itemId, count);
              return added.ok ? ok(formatKit(added.kit)) : fail(added.error);
            }
            return usageError('/kit edit <name> add <item> <count>');
          }

          if (sub === 'give') {
            if (!args[1] || !args[2]) return usageError('/kit give <player> <name>');
            const name = parseKitName(args[2]);
            if (!name) return fail(invalidName());
            const target = api.getPlayer(args[1]);
            if (!target) return fail('Игрок не найден.');
            if (name === KIT_START_NAME) {
              const granted = service.grantStart(target.id, () => deliverKit(target, service.get(KIT_START_NAME)));
              if (granted === 'busy') return fail('Стартовый набор уже выдаётся.');
              if (granted === 'failed') return fail('Не удалось выдать стартовый набор.');
              if (granted === 'already') deliverKit(target, service.get(KIT_START_NAME));
              return ok(`Набор 'start' выдан игроку ${target.name}.`);
            }
            const given = giveNamed(target.id, name);
            return given.ok ? ok(`Набор '${name}' выдан игроку ${target.name}.`) : given;
          }

          return fail(`Неизвестная команда '/kit ${sub}'. /kit help`);
        },
      });
    },
  };
}
