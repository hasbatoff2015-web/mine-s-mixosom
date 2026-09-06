import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'spawn',
  title: 'Spawn',
  description: 'Teleport to the authoritative world spawn.',
  commands: [
    { usage: '/spawn', description: 'Teleport to spawn', permission: 'spawn.use' },
    { usage: '/spawn help', description: 'Show this help' },
    { usage: '/setspawn', description: 'Set world spawn to your position', permission: 'spawn.set' },
    { usage: '/spawn config set <key> <value>', description: 'Change spawn settings', permission: 'server.admin' },
  ],
};

const SCHEMA = {
  cooldownSeconds: { type: 'number' as const, description: 'Cooldown between uses' },
  warmupSeconds: { type: 'number' as const, description: 'Warmup before teleport' },
  cancelOnMove: { type: 'boolean' as const, description: 'Cancel if you move' },
  cancelOnDamage: { type: 'boolean' as const, description: 'Cancel on damage' },
};

export function createSpawnPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'spawn',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      const config = api.loadConfig({
        cooldownSeconds: 5,
        warmupSeconds: 0,
        cancelOnMove: true,
        cancelOnDamage: true,
      });
      api.registerCommand({
        name: 'spawn',
        usage: '/spawn',
        description: 'Teleport to the server spawn',
        permission: 'spawn.use',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (args[0]?.toLowerCase() === 'config') {
            if (!api.hasPermission(sender.playerId, 'server.admin') && !api.isOperator(sender.name)) {
              return fail('You do not have permission.');
            }
            if (args[1]?.toLowerCase() === 'set') {
              if (!args[2] || args[3] === undefined) return usageError('/spawn config set <key> <value>');
              const result = ctx.config.setFromString('spawn', args[2], args.slice(3).join(' '), SCHEMA);
              return result.ok ? ok(`Set ${args[2]}=${String(result.value)}`) : fail(result.error);
            }
            return ok(Object.entries(api.loadConfig(config)).map(([key, value]) => `${key}=${value}`));
          }
          const spawn = api.getWorld().spawn();
          const result = api.teleport(sender.playerId, spawn[0], spawn[1], spawn[2], 'spawn', {
            warmupMs: Number(api.getConfig('warmupSeconds', config.warmupSeconds)) * 1000,
            cooldownMs: Number(api.getConfig('cooldownSeconds', config.cooldownSeconds)) * 1000,
            cancelOnMove: Boolean(api.getConfig('cancelOnMove', config.cancelOnMove)),
            cancelOnDamage: Boolean(api.getConfig('cancelOnDamage', config.cancelOnDamage)),
          });
          return result.ok ? ok('Teleporting to spawn.') : fail(result.error ?? 'Teleport failed.');
        },
      });
      api.registerCommand({
        name: 'setspawn',
        usage: '/setspawn',
        description: 'Set world spawn to your position',
        permission: 'spawn.set',
        execute: (_args, sender) => {
          const player = api.getPlayer(sender.playerId);
          if (!player) return fail('Player not found.');
          const pos = player.position();
          if (!api.getWorld().setSpawn(pos.x, pos.y, pos.z)) return fail('Could not set spawn.');
          ctx.markDirty();
          return ok(`Spawn set to ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}.`);
        },
      });
    },
  };
}
