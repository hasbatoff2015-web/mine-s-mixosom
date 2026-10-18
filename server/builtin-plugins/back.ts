import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import { RANK_LIMITS, formatDurationMs } from '../../shared/donationRanks';
import { formatPluginHelp, isHelpRequest } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'back',
  title: 'Back',
  description: 'Return to the previous teleport or death location.',
  commands: [
    { usage: '/back', description: 'Teleport to your previous location', permission: 'back.use' },
    { usage: '/back help', description: 'Show this help' },
  ],
};

export function createBackPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'back',
    version: '1.1.0',
    apiVersion: 1,
    onEnable(api) {
      api.registerCommand({
        name: 'back',
        usage: '/back',
        description: 'Teleport to your previous location',
        permission: 'back.use',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          const operator = api.isOperator(sender.name) || api.isOperator(sender.playerId);
          const allowed = operator || api.hasPermission(sender.playerId, 'back.death');
          if (!allowed) return fail('Эта функция доступна с привилегии BOSS.');
          const death = ctx.history.peekDeath(sender.playerId);
          const last = ctx.history.peek(sender.playerId);
          const deathIsLatest = Boolean(
            death
            && death.worldId === ctx.worldId()
            && (!last || last.reason === 'death' || last.at <= death.at),
          );
          const target = deathIsLatest && death ? death : last;
          if (!target) return fail('Точка смерти не сохранена.');
          if (death && death.worldId !== ctx.worldId() && !last) {
            return fail('Точка смерти сохранена в другом мире.');
          }
          const cap = operator ? null : RANK_LIMITS[ctx.donation.effectiveRank(sender.playerId)].deathBackPerDay;
          const go = (): { ok: boolean; error?: string } => api.teleport(sender.playerId, target.x, target.y, target.z, 'back', { warmupMs: 0 });
          if (target.reason === 'death' && cap !== null) {
            let failure = 'Teleport failed.';
            const used = ctx.donation.consumeIf(sender.playerId, 'deathBack', cap, () => {
              const moved = go();
              if (!moved.ok) failure = moved.error ?? failure;
              return moved.ok;
            });
            if (!used.ok) {
              if (used.remainingMs) return fail(`Возврат к смерти будет доступен через ${formatDurationMs(used.remainingMs)}.`);
              if (used.error === 'Не удалось выполнить команду.') return fail(failure);
              return fail(used.error);
            }
            return ok(`Returned to your previous ${target.reason} location.`);
          }
          const result = go();
          return result.ok
            ? ok(`Returned to your previous ${target.reason} location.`)
            : fail(result.error ?? 'Teleport failed.');
        },
      });
    },
  };
}
