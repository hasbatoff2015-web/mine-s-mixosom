import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import {
  AUTOMINE_WAND_ITEM,
  cuboidSize,
  formatAutoMineCompositionLines,
  mineVolume,
  parseAutoMineName,
  secondsUntil,
  volumeFromSelection,
  type AutoMineManager,
  type AutoMineRecord,
} from '../services/autoMine';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'automine',
  title: 'Авто-шахта',
  description: 'Кубоидные зоны со случайной генерацией блоков и периодическим reset.',
  commands: [
    { usage: '/automine help', description: 'Показать справку' },
    { usage: '/automine wand', description: 'Выдать инструмент выделения', permission: 'automine.manage' },
    { usage: '/automine create <name>', description: 'Создать авто-шахту по выделению', permission: 'automine.manage' },
    { usage: '/automine delete <name>', description: 'Удалить авто-шахту и восстановить блоки', permission: 'automine.manage' },
    { usage: '/automine list', description: 'Список авто-шахт', permission: 'automine.manage' },
    { usage: '/automine info <name>', description: 'Информация об авто-шахте', permission: 'automine.manage' },
    { usage: '/automine reset <name>', description: 'Запустить reset сейчас', permission: 'automine.manage' },
    { usage: '/automine setinterval <name> <seconds>', description: 'Интервал reset в секундах', permission: 'automine.manage' },
    { usage: '/automine setteleport <name>', description: 'Точка эвакуации — текущая позиция', permission: 'automine.manage' },
  ],
};

function sizeLabel(mine: AutoMineRecord): string {
  const size = cuboidSize(mineVolume(mine));
  return `${size.width} × ${size.height} × ${size.depth}`;
}

function infoLines(manager: AutoMineManager, mine: AutoMineRecord, now: number): string[] {
  const size = cuboidSize(mineVolume(mine));
  const until = secondsUntil(mine.nextResetAt, now);
  const teleport = mine.teleport;
  return [
    `Авто-шахта: ${mine.name}`,
    `Мир: ${mine.worldId}`,
    `Размер: ${sizeLabel(mine)}`,
    `Блоков: ${size.blocks}`,
    `Интервал: ${mine.intervalSeconds === null ? 'не задан' : `${mine.intervalSeconds} сек`}`,
    `Следующий reset: ${until === null ? 'не задан' : `${until} сек`}`,
    teleport
      ? `Телепорт: ${teleport.x.toFixed(2)} ${teleport.y.toFixed(2)} ${teleport.z.toFixed(2)}`
      : 'Телепорт: не задан',
    `Статус: ${manager.statusOf(mine.name)}`,
    'Состав:',
    ...formatAutoMineCompositionLines(),
  ];
}

function createdLines(mine: AutoMineRecord): string[] {
  const size = cuboidSize(mineVolume(mine));
  return [
    'Авто-шахта создана.',
    `Название: ${mine.name}`,
    `Размер: ${size.width} × ${size.height} × ${size.depth}`,
    `Блоков: ${size.blocks}`,
    'Интервал: не задан',
    'Телепорт: не задан',
    'Состав:',
    ...formatAutoMineCompositionLines(),
  ];
}

export function createAutoMinePlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'automine',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      const manager = ctx.autoMine;
      manager.load();
      manager.enabled = true;

      const canManage = (playerId: string, name: string) => (
        api.hasPermission(playerId, 'automine.manage') || api.isOperator(name)
      );

      const holdingWand = (playerId: string): boolean => {
        const player = api.getPlayer(playerId);
        if (!player) return false;
        const held = player.snapshot().presentation?.heldItemId;
        return held === AUTOMINE_WAND_ITEM;
      };

      const applyWandClick = (playerId: string, x: number, y: number, z: number): boolean => {
        const player = api.getPlayer(playerId);
        if (!player || !canManage(playerId, player.name) || !holdingWand(playerId)) return false;
        const result = manager.setSelectionPoint(playerId, { x, y, z });
        if (result.slot === 1) {
          player.sendMessage(`Первая точка авто-шахты установлена: ${x} ${y} ${z}`);
          return true;
        }
        const size = result.volume ? cuboidSize(result.volume) : undefined;
        player.sendMessage(`Вторая точка авто-шахты установлена: ${x} ${y} ${z}`);
        if (size) player.sendMessage(`Размер: ${size.width} × ${size.height} × ${size.depth}`);
        return true;
      };

      api.registerEvent('playerInteract', (event) => {
        if (applyWandClick(event.playerId, event.x, event.y, event.z)) event.cancel();
      });
      api.registerEvent('blockBreak', (event) => {
        if (applyWandClick(event.playerId, event.x, event.y, event.z)) event.cancel();
      });

      api.registerCommand({
        name: 'automine',
        aliases: ['am'],
        usage: '/automine help',
        description: 'Управление авто-шахтами',
        permission: 'automine.manage',
        execute: (args, sender) => {
          if (isHelpRequest(args) || args.length === 0) return ok(formatPluginHelp(HELP));
          const sub = args[0]!.toLowerCase();
          const player = api.getPlayer(sender.playerId);

          if (sub === 'wand') {
            if (!player) return fail('Игрок не найден.');
            player.give(AUTOMINE_WAND_ITEM, 1);
            return ok('Выдан инструмент выделения авто-шахты. Кликните по двум углам зоны.');
          }

          if (sub === 'create') {
            const name = parseAutoMineName(args[1]);
            if (!args[1]) return usageError('/automine create <name>');
            if (!name) return fail(`Некорректное имя авто-шахты. Используйте 1–24 символов: a-z, 0-9, _.`);
            const volume = volumeFromSelection(manager.selectionOf(sender.playerId));
            if (!volume) return fail('Сначала выделите зону: /automine wand, затем два клика по блокам.');
            const result = manager.create(name, volume, api.getWorld().worldId);
            if (!result.ok) return fail(result.error);
            return ok(createdLines(result.mine));
          }

          if (sub === 'delete') {
            const name = args[1]?.toLowerCase();
            if (!name) return usageError('/automine delete <name>');
            const result = manager.delete(name);
            if (!result.ok) return fail(result.error);
            return ok(result.restoring
              ? `Авто-шахта '${name}' удаляется, исходные блоки восстанавливаются.`
              : `Авто-шахта '${name}' удалена.`);
          }

          if (sub === 'list') {
            const mines = manager.list();
            if (mines.length === 0) return ok('Авто-шахт нет.');
            return ok(mines.map((mine) => {
              const until = secondsUntil(mine.nextResetAt, Date.now());
              const interval = mine.intervalSeconds === null ? 'не задан' : `${mine.intervalSeconds}с`;
              const reset = until === null ? '—' : `${until}с`;
              return `${mine.name} | ${mine.worldId} | ${sizeLabel(mine)} | ${interval} | ${manager.statusOf(mine.name)} | reset ${reset}`;
            }));
          }

          if (sub === 'info') {
            const name = args[1]?.toLowerCase();
            if (!name) return usageError('/automine info <name>');
            const mine = manager.get(name);
            if (!mine) return fail(`Авто-шахта '${name}' не найдена.`);
            return ok(infoLines(manager, mine, Date.now()));
          }

          if (sub === 'reset') {
            const name = args[1]?.toLowerCase();
            if (!name) return usageError('/automine reset <name>');
            const result = manager.requestReset(name, { manual: true });
            if (!result.ok) return fail(result.error);
            return ok(`Reset авто-шахты '${name}' запущен.`);
          }

          if (sub === 'setinterval') {
            const name = args[1]?.toLowerCase();
            const seconds = Number(args[2]);
            if (!name || args[2] === undefined) return usageError('/automine setinterval <name> <seconds>');
            const result = manager.setIntervalSeconds(name, seconds);
            if (!result.ok) return fail(result.error);
            return ok(`Интервал авто-шахты ${result.mine.name} установлен: ${result.mine.intervalSeconds} сек.`);
          }

          if (sub === 'setteleport') {
            const name = args[1]?.toLowerCase();
            if (!name) return usageError('/automine setteleport <name>');
            if (!player) return fail('Игрок не найден.');
            const pos = player.position();
            const look = player.snapshot();
            const result = manager.setTeleport(name, {
              worldId: api.getWorld().worldId,
              x: pos.x,
              y: pos.y,
              z: pos.z,
              yaw: look.yaw,
              pitch: look.pitch,
            });
            if (!result.ok) return fail(result.error);
            return ok(
              `Точка телепорта авто-шахты ${result.mine.name} установлена: `
              + `${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)}.`,
            );
          }

          return usageError('/automine help');
        },
      });
    },
    onDisable() {
      ctx.autoMine.stop();
    },
  };
}
