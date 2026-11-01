import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import { formatDurationMs, kitAccessRule } from '../../shared/donationRanks';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';
import {
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
  description: 'Наборы копируются из инвентаря. Стартовый набор выдаётся один раз.',
  commands: [
    { usage: '/kit help', description: 'Показать справку' },
    { usage: '/kit start', description: 'Получить стартовый набор один раз' },
    { usage: '/kit <название>', description: 'Получить созданный набор' },
    { usage: '/kit create <название>', description: 'Создать набор из текущего инвентаря', permission: 'kit.admin' },
    { usage: '/kit delete <название>', description: 'Удалить набор', permission: 'kit.admin' },
    { usage: '/kit give <игрок> <название>', description: 'Выдать набор игроку', permission: 'kit.admin' },
  ],
};

function formatKit(kit: KitDefinition): string {
  if (kit.items.length === 0) return 'инвентарь был пуст';
  return kit.items.map((item) => `${item.itemId} × ${item.count}`).join(', ');
}

function invalidName(): string {
  return `Некорректное имя набора. Используйте 1–${KIT_NAME_MAX} символов: a-z, 0-9, _.`;
}

export function createKitPlugin(ctx: BuiltinPluginContext): Plugin {
  let loadStore: () => unknown = () => undefined;
  let saveStore: (store: unknown) => void = () => undefined;
  const service = new KitService(
    () => loadStore(),
    (store) => saveStore(store),
  );

  return {
    name: 'kit',
    version: '1.1.0',
    apiVersion: 1,
    onEnable(api) {
      loadStore = () => api.loadData('store', { kits: [], receivedStart: [], pendingStart: [] });
      saveStore = (store) => api.saveData('store', store);
      service.load();

      const isAdmin = (playerId: string, _name: string): boolean => (
        api.isOperator(playerId)
        || api.hasPermission(playerId, 'kit.admin')
        || api.hasPermission(playerId, 'server.admin')
      );

      const giveNamed = (playerId: string, kitName: string, bypassCooldown = false) => {
        const player = api.getPlayer(playerId);
        if (!player) return fail('Игрок не найден.');
        const kit = service.get(kitName);
        if (!kit) return fail(`Набор '${kitName}' не найден.`);
        const rule = kitAccessRule(kitName);
        const operator = api.isOperator(playerId);
        if (!bypassCooldown && rule && rule.permission !== 'player' && !operator && !api.hasPermission(playerId, rule.permission)) {
          return fail('Недостаточно прав для выполнения этой команды.');
        }
        const deliver = (): boolean => {
          const live = api.getPlayer(playerId);
          if (!live) return false;
          return deliverKit(live, service.get(kitName));
        };
        if (rule?.periodMs && !bypassCooldown && !operator) {
          const result = ctx.donation.consumeIf(playerId, `kit:${kitName}`, 1, deliver);
          if (!result.ok) {
            if (result.remainingMs) return fail(`Набор '${kitName}' будет доступен через ${formatDurationMs(result.remainingMs)}.`);
            return fail(result.error);
          }
          return ok(kit.items.length > 0 ? `Выдан набор '${kitName}'.` : `Набор '${kitName}' пуст.`);
        }
        if (!deliver()) return fail('Не удалось выдать набор.');
        return ok(kit.items.length > 0 ? `Выдан набор '${kitName}'.` : `Набор '${kitName}' пуст.`);
      };

      api.registerEvent('playerJoin', (event) => {
        const kit = service.get(KIT_START_NAME);
        if (!kit || kit.items.length === 0) return;
        if (!service.shouldAutoGrantStart(event.firstJoin, event.playerId)) return;
        const result = service.grantStart(event.playerId, () => {
          const player = api.getPlayer(event.playerId);
          if (!player) return false;
          return deliverKit(player, kit);
        });
        if (result === 'granted') api.getPlayer(event.playerId)?.sendMessage('Выдан стартовый набор.');
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
            const kit = service.get(KIT_START_NAME);
            if (!kit || kit.items.length === 0) return fail('Стартовый набор не создан.');
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

          if (sub === 'create') {
            if (!admin) return fail('Недостаточно прав для выполнения этой команды.');
            const name = parseKitName(args[1]);
            if (!args[1]) return usageError('/kit create <название>');
            if (!name) return fail(invalidName());
            const player = api.getPlayer(sender.playerId);
            if (!player) return fail('Игрок не найден.');
            const created = service.createFromStacks(name, player.contents());
            if (!created.ok) return fail(created.error);
            return ok(created.kit.items.length > 0
              ? `Набор '${name}' создан: ${formatKit(created.kit)}.`
              : `Набор '${name}' создан. Инвентарь пуст.`);
          }

          if (sub === 'delete') {
            if (!admin) return fail('Недостаточно прав для выполнения этой команды.');
            const name = parseKitName(args[1]);
            if (!args[1]) return usageError('/kit delete <название>');
            if (!name) return fail(invalidName());
            const removed = service.remove(name);
            return removed.ok ? ok(`Набор '${name}' удалён.`) : fail(removed.error);
          }

          if (sub === 'give') {
            if (!admin) return fail('Недостаточно прав для выполнения этой команды.');
            if (!args[1] || !args[2]) return usageError('/kit give <игрок> <название>');
            const name = parseKitName(args[2]);
            if (!name) return fail(invalidName());
            const target = api.getPlayer(args[1]);
            if (!target) return fail('Игрок не найден.');
            if (name === KIT_START_NAME) {
              const kit = service.get(KIT_START_NAME);
              if (!kit) return fail('Стартовый набор не создан.');
              const granted = service.grantStart(target.id, () => deliverKit(target, kit));
              if (granted === 'busy') return fail('Стартовый набор уже выдаётся.');
              if (granted === 'failed') return fail('Не удалось выдать стартовый набор.');
              if (granted === 'already') deliverKit(target, kit);
              return ok(`Набор 'start' выдан игроку ${target.name}.`);
            }
            const given = giveNamed(target.id, name, true);
            return given.ok ? ok(`Набор '${name}' выдан игроку ${target.name}.`) : given;
          }

          const name = parseKitName(sub);
          if (!name) return fail(invalidName());
          if (name === KIT_START_NAME) return fail('Стартовый набор выдаётся командой /kit start.');
          return giveNamed(sender.playerId, name);
        },
      });
    },
  };
}
