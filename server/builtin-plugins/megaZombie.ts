import { fail, ok } from '../commands';
import type { Plugin } from '../PluginManager';
import type { BuiltinPluginContext } from './context';

export function createMegaZombiePlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'mega-zombie',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      const boss = ctx.megaZombie;
      boss.enable();
      const allowed = (playerId: string, name: string, operator: boolean): boolean => (
        operator
        || api.hasPermission(playerId, 'mega_zombie.admin')
        || api.hasPermission(name, 'mega_zombie.admin')
        || api.hasPermission(playerId, 'server.admin')
        || api.hasPermission(name, 'server.admin')
        || api.isOperator(name)
        || api.isOperator(playerId)
      );
      api.registerCommand({
        name: 'boss',
        usage: '/boss <setspawn|setpos1|setpos2|info|spawn>',
        description: 'Настроить и вызвать Мега-зомби',
        execute: (args, sender) => {
          if (!allowed(sender.playerId, sender.name, sender.operator === true)) {
            return fail('Недостаточно прав.');
          }
          const sub = args[0]?.toLowerCase();
          if (sub === 'info') return ok(boss.infoLines());
          if (sub === 'spawn') {
            const result = boss.manualSpawn();
            return result.ok ? ok(result.message) : fail(result.message);
          }
          if (sub === 'setspawn' || sub === 'setpos1' || sub === 'setpos2') {
            const player = api.getPlayer(sender.playerId);
            if (!player) return fail('Только для игрока.');
            const pos = player.position();
            const point = { x: pos.x, y: pos.y, z: pos.z };
            const result = sub === 'setspawn'
              ? boss.setSpawn(point)
              : boss.setPos(sub === 'setpos1' ? 'pos1' : 'pos2', point);
            return result.ok ? ok(result.message) : fail(result.message);
          }
          return fail('Использование: /boss setspawn | setpos1 | setpos2 | info | spawn');
        },
      });
    },
    onDisable() {
      ctx.megaZombie.disable();
    },
  };
}
