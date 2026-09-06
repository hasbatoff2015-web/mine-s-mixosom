import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import { clampRtpBounds, type RtpSearchOptions } from '../services/rtp';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'rtp',
  title: 'RTP',
  description: 'Teleport to a random safe location in a 20,000 × 20,000 region.',
  commands: [
    { usage: '/rtp', description: 'Random teleport', permission: 'rtp.use' },
    { usage: '/rtp help', description: 'Show this help' },
    { usage: '/rtp config set <key> <value>', description: 'Change RTP settings', permission: 'server.admin' },
  ],
};

const SCHEMA = {
  minX: { type: 'number' as const, description: 'Minimum X' },
  maxX: { type: 'number' as const, description: 'Maximum X' },
  minZ: { type: 'number' as const, description: 'Minimum Z' },
  maxZ: { type: 'number' as const, description: 'Maximum Z' },
  cooldownSeconds: { type: 'number' as const, description: 'Cooldown between uses' },
  warmupSeconds: { type: 'number' as const, description: 'Warmup before teleport' },
  attemptsPerTick: { type: 'number' as const, description: 'Search attempts per scheduler tick' },
  maxAttempts: { type: 'number' as const, description: 'Give up after this many attempts' },
  maxChunkGenerates: { type: 'number' as const, description: 'New chunks generated per search tick' },
  cancelOnMove: { type: 'boolean' as const, description: 'Cancel if you move' },
  cancelOnDamage: { type: 'boolean' as const, description: 'Cancel on damage' },
};

export function rtpOptionsFromConfig(get: (key: string, fallback: number) => number): RtpSearchOptions {
  const bounds = clampRtpBounds({
    minX: get('minX', -10_000),
    maxX: get('maxX', 10_000),
    minZ: get('minZ', -10_000),
    maxZ: get('maxZ', 10_000),
  });
  return {
    ...bounds,
    attemptsPerTick: Math.max(1, get('attemptsPerTick', 2)),
    maxAttempts: Math.max(1, get('maxAttempts', 24)),
    maxChunkGenerates: Math.max(0, get('maxChunkGenerates', 1)),
  };
}

export function createRtpPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'rtp',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      const config = api.loadConfig({
        minX: -10_000,
        maxX: 10_000,
        minZ: -10_000,
        maxZ: 10_000,
        cooldownSeconds: 15,
        warmupSeconds: 0,
        attemptsPerTick: 2,
        maxAttempts: 24,
        maxChunkGenerates: 1,
        cancelOnMove: true,
        cancelOnDamage: true,
      });

      api.registerEvent('playerQuit', (event) => ctx.rtpSessions.cancel(event.playerId));

      api.registerCommand({
        name: 'rtp',
        usage: '/rtp',
        description: 'Teleport to a random safe location',
        permission: 'rtp.use',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (args[0]?.toLowerCase() === 'config') {
            if (!api.hasPermission(sender.playerId, 'server.admin') && !api.isOperator(sender.name)) {
              return fail('You do not have permission.');
            }
            if (args[1]?.toLowerCase() === 'set') {
              if (!args[2] || args[3] === undefined) return usageError('/rtp config set <key> <value>');
              const result = ctx.config.setFromString('rtp', args[2], args.slice(3).join(' '), SCHEMA);
              return result.ok ? ok(`Set ${args[2]}=${String(result.value)}`) : fail(result.error);
            }
            return ok(Object.entries(api.loadConfig(config)).map(([key, value]) => `${key}=${value}`));
          }
          const started = ctx.rtpSessions.enqueue(sender.playerId, rtpOptionsFromConfig((key, fallback) => (
            Number(api.getConfig(key, fallback))
          )), {
            reason: 'rtp',
            warmupMs: Number(api.getConfig('warmupSeconds', config.warmupSeconds)) * 1000,
            cooldownMs: Number(api.getConfig('cooldownSeconds', config.cooldownSeconds)) * 1000,
            cancelOnMove: Boolean(api.getConfig('cancelOnMove', config.cancelOnMove)),
            cancelOnDamage: Boolean(api.getConfig('cancelOnDamage', config.cancelOnDamage)),
          });
          return started.ok ? ok('Searching for a safe location...') : fail(started.error ?? 'RTP failed.');
        },
      });
    },
  };
}
