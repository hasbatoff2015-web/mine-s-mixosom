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
          const last = api.lastTeleport(sender.playerId);
          if (!last) return fail('No previous location.');
          const operator = api.isOperator(sender.name) || api.isOperator(sender.playerId);
          const cap = operator ? null : RANK_LIMITS[ctx.donation.effectiveRank(sender.playerId)].deathBackPerDay;
          const go = (): { ok: boolean; error?: string } => api.teleport(sender.playerId, last.x, last.y, last.z, 'back', { warmupMs: 0 });
          if (last.reason === 'death' && cap !== null) {
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
            return ok(`Returned to your previous ${last.reason} location.`);
          }
          const result = go();
          return result.ok
            ? ok(`Returned to your previous ${last.reason} location.`)
            : fail(result.error ?? 'Teleport failed.');
        },
      });
    },
  };
}
