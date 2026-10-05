import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import type { BuiltinPluginContext } from './context';
import { DUEL_ARENA_UNCONFIGURED } from '../../shared/duels';

function formatPose(label: string, pose: {
  worldId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
} | undefined): string {
  if (!pose) return `${label}: не задана`;
  return `${label}: ${pose.worldId} ${pose.x.toFixed(2)} ${pose.y.toFixed(2)} ${pose.z.toFixed(2)} yaw ${pose.yaw.toFixed(1)} pitch ${pose.pitch.toFixed(1)}`;
}

export function createDuelsPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'duels',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      const duels = ctx.duels;
      const admin = (playerId: string, name: string): boolean => (
        api.hasPermission(playerId, 'duels.admin')
        || api.hasPermission(playerId, 'server.admin')
        || api.isOperator(name)
        || api.isOperator(playerId)
      );

      api.registerEvent('playerJoin', (event) => {
        duels.noteIdentity(event.playerId, event.name);
      });

      api.registerEvent('playerQuit', (event) => {
        duels.onPlayerQuit(event.playerId);
      });

      api.registerEvent('playerDamage', (event) => {
        if (duels.shouldCancelPlayerDamage(event.playerId, event.attackerId)) event.cancel();
      });

      api.registerEvent('itemPickup', (event) => {
        if (!duels.allowsPickup(event.playerId, event.entityId)) event.cancel();
      });

      api.scheduleRepeating(100, () => {
        duels.tick();
      });

      api.registerCommand({
        name: 'duel',
        usage: '/duel [setspawn <1|2>|info]',
        description: 'Открыть дуэли или настроить арену',
        execute: (args, sender) => {
          const sub = args[0]?.toLowerCase();
          if (sub === 'setspawn') {
            if (!admin(sender.playerId, sender.name)) return fail('Недостаточно прав.');
            const index = args[1] === '1' ? 1 : args[1] === '2' ? 2 : 0;
            if (!index) return fail('Использование: /duel setspawn 1|2');
            const player = api.getPlayer(sender.playerId);
            if (!player) return fail('Игрок недоступен.');
            const pos = player.position();
            const result = duels.setSpawn(index, {
              worldId: ctx.worldId(),
              x: pos.x,
              y: pos.y,
              z: pos.z,
              yaw: pos.yaw ?? 0,
              pitch: pos.pitch ?? 0,
            });
            return result.ok ? ok(result.message ?? 'Точка сохранена.') : fail(result.message ?? 'Не удалось сохранить точку.');
          }
          if (sub === 'info') {
            if (!admin(sender.playerId, sender.name)) return fail('Недостаточно прав.');
            const info = duels.arenaInfo();
            const state = !info.configured
              ? DUEL_ARENA_UNCONFIGURED
              : info.busy
                ? `Арена занята (${info.phase}).`
                : 'Арена свободна.';
            return ok([
              state,
              formatPose('Точка 1', info.spawn1),
              formatPose('Точка 2', info.spawn2),
            ]);
          }
          if (sub) return fail('Использование: /duel, /duel setspawn 1|2, /duel info');
          if (!sender.playerId) return fail('Только для игрока.');
          ctx.openGameMenu(sender.playerId, 'duels');
          return ok('Меню дуэлей открыто.');
        },
      });
    },
    onDisable() {
      ctx.duels.shutdown();
    },
  };
}
