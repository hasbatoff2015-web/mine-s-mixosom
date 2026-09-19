import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import { cuboidSizeOf, formatCuboidSize } from '../services/selection';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import { DEFAULT_WORLD_EVENTS_CONFIG, type WorldEventsConfig } from '../services/worldEvents';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'world-events',
  title: 'World Events',
  description: 'Ежедневные timed-ивенты. Первый тип — ивентовый сундук с мини-локацией.',
  commands: [
    { usage: '/events help', description: 'Показать справку' },
    { usage: '/events status', description: 'Статус текущего и следующего ивента' },
    { usage: '/events force spawn', description: 'Заспавнить ивент сейчас', permission: 'events.manage' },
    { usage: '/events force cleanup', description: 'Убрать ивент и восстановить мир', permission: 'events.manage' },
    { usage: '/events template save <name>', description: 'Сохранить выделение wand как шаблон', permission: 'events.manage' },
    { usage: '/events template info <name>', description: 'Информация о шаблоне', permission: 'events.manage' },
    { usage: '/events template list', description: 'Список шаблонов', permission: 'events.manage' },
    { usage: '/events template delete <name>', description: 'Удалить шаблон', permission: 'events.manage' },
    { usage: '/events reload', description: 'Перечитать конфиг', permission: 'events.manage' },
  ],
};

function toConfig(raw: Record<string, string | number | boolean>): WorldEventsConfig {
  return {
    enabled: Boolean(raw.enabled ?? DEFAULT_WORLD_EVENTS_CONFIG.enabled),
    dailyTime: String(raw.dailyTime ?? DEFAULT_WORLD_EVENTS_CONFIG.dailyTime),
    useServerLocalTime: Boolean(raw.useServerLocalTime ?? DEFAULT_WORLD_EVENTS_CONFIG.useServerLocalTime),
    warningMinutes: Number(raw.warningMinutes ?? DEFAULT_WORLD_EVENTS_CONFIG.warningMinutes),
    unlockDelayMinutes: Number(raw.unlockDelayMinutes ?? DEFAULT_WORLD_EVENTS_CONFIG.unlockDelayMinutes),
    durationMinutes: Number(raw.durationMinutes ?? DEFAULT_WORLD_EVENTS_CONFIG.durationMinutes),
    spawnMinDistance: Number(raw.spawnMinDistance ?? DEFAULT_WORLD_EVENTS_CONFIG.spawnMinDistance),
    spawnMaxDistance: Number(raw.spawnMaxDistance ?? DEFAULT_WORLD_EVENTS_CONFIG.spawnMaxDistance),
    worldBorder: Number(raw.worldBorder ?? DEFAULT_WORLD_EVENTS_CONFIG.worldBorder),
    templateName: String(raw.templateName ?? DEFAULT_WORLD_EVENTS_CONFIG.templateName),
    announceCoordinates: Boolean(raw.announceCoordinates ?? DEFAULT_WORLD_EVENTS_CONFIG.announceCoordinates),
    playerAvoidRadius: Number(raw.playerAvoidRadius ?? DEFAULT_WORLD_EVENTS_CONFIG.playerAvoidRadius),
    homeAvoidRadius: Number(raw.homeAvoidRadius ?? DEFAULT_WORLD_EVENTS_CONFIG.homeAvoidRadius),
    maxSearchAttempts: Number(raw.maxSearchAttempts ?? DEFAULT_WORLD_EVENTS_CONFIG.maxSearchAttempts),
    attemptsPerTick: Number(raw.attemptsPerTick ?? DEFAULT_WORLD_EVENTS_CONFIG.attemptsPerTick),
  };
}

export function createWorldEventsPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'world-events',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      const manager = ctx.worldEvents;
      const loaded = api.loadConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG });
      manager.setConfig(toConfig(loaded));
      manager.load();
      manager.enabled = true;

      const canManage = (playerId: string, name: string) => (
        api.hasPermission(playerId, 'events.manage') || api.isOperator(name)
      );

      api.registerEvent('blockBreak', (event) => {
        if (manager.isProtected(event.x, event.y, event.z)) event.cancel();
      });
      api.registerEvent('blockPlace', (event) => {
        if (manager.isProtected(event.x, event.y, event.z)) event.cancel();
      });
      api.registerEvent('explosion', (event) => {
        if (manager.isProtected(Math.floor(event.x), Math.floor(event.y), Math.floor(event.z))) event.cancel();
      });
      api.registerEvent('playerInteract', (event) => {
        if (!manager.isLockedChest(event.x, event.y, event.z)) return;
        event.cancel();
        const player = api.getPlayer(event.playerId);
        const remain = Math.max(1, Math.ceil(manager.unlockRemainingMs() / 60_000));
        player?.sendMessage(`Ивентовый сундук ещё закрыт. Откроется через ${remain} мин.`);
      });

      api.registerCommand({
        name: 'events',
        aliases: ['event'],
        usage: '/events help',
        description: 'Управление мировыми ивентами',
        execute: (args, sender) => {
          if (isHelpRequest(args) || args.length === 0) return ok(formatPluginHelp(HELP));
          const sub = args[0]!.toLowerCase();
          if (sub === 'status') return ok(manager.statusLines());

          if (!canManage(sender.playerId, sender.name)) return fail('You do not have permission.');

          if (sub === 'reload') {
            const next = toConfig(api.loadConfig({ ...DEFAULT_WORLD_EVENTS_CONFIG }));
            manager.setConfig(next);
            return ok('Конфиг world-events перечитан.');
          }

          if (sub === 'force') {
            const action = args[1]?.toLowerCase();
            if (action === 'spawn') {
              const result = manager.forceSpawn();
              if (!result.ok) return fail(result.error);
              const chest = result.event.chest;
              return ok(chest
                ? `Ивент заспавнен: ${chest.x} ${chest.y} ${chest.z}`
                : 'Поиск места для ивента запущен.');
            }
            if (action === 'cleanup') {
              const result = manager.forceCleanup();
              return result.ok ? ok('Ивент очищен, мир восстановлен.') : fail(result.error);
            }
            return usageError('/events force spawn|cleanup');
          }

          if (sub === 'template') {
            const action = args[1]?.toLowerCase();
            if (action === 'list') {
              const templates = manager.listTemplates();
              if (templates.length === 0) return ok('Шаблонов нет.');
              return ok(templates.map((template) => (
                `${template.name} | ${template.width}×${template.height}×${template.depth} | блоков ${template.blocks.length}`
              )));
            }
            if (action === 'info') {
              const name = args[2];
              if (!name) return usageError('/events template info <name>');
              const template = manager.getTemplate(name);
              if (!template) return fail(`Шаблон '${name}' не найден.`);
              return ok([
                `Шаблон: ${template.name}`,
                `Размер: ${template.width} × ${template.height} × ${template.depth}`,
                `Якорь сундука: ${template.anchor.dx} ${template.anchor.dy} ${template.anchor.dz}`,
                `Блоков: ${template.blocks.length}`,
              ]);
            }
            if (action === 'save') {
              const name = args[2];
              if (!name) return usageError('/events template save <name>');
              const volume = ctx.selection.volume(sender.playerId);
              if (!volume) return fail('Сначала выделите зону: /wand, затем два клика по блокам.');
              const result = manager.saveTemplate(name, volume);
              if (!result.ok) return fail(result.error);
              const size = cuboidSizeOf(volume);
              return ok([
                `Шаблон '${result.template.name}' сохранён.`,
                `Размер: ${formatCuboidSize(size)}`,
                `Якорь: сундук в выделении.`,
              ]);
            }
            if (action === 'delete') {
              const name = args[2];
              if (!name) return usageError('/events template delete <name>');
              const result = manager.deleteTemplate(name);
              return result.ok ? ok(`Шаблон '${name}' удалён.`) : fail(result.error);
            }
            return usageError('/events template list|info|save|delete');
          }

          return usageError('/events help');
        },
      });
    },
    onDisable() {
      ctx.worldEvents.enabled = false;
    },
  };
}
