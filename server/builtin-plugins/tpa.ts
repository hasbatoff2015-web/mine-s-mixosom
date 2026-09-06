import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'tpa',
  title: 'TPA',
  description: 'Ask another player to teleport to them, or bring them here.',
  commands: [
    { usage: '/tpa help', description: 'Show this help' },
    { usage: '/tpa <player>', description: 'Request to teleport to a player', permission: 'tpa.use' },
    { usage: '/tpahere <player>', description: 'Request a player to teleport to you', permission: 'tpa.use' },
    { usage: '/tpaccept', description: 'Accept a teleport request', permission: 'tpa.accept' },
    { usage: '/tpdeny', description: 'Deny a teleport request', permission: 'tpa.accept' },
    { usage: '/tpa config', description: 'Show TPA settings', permission: 'server.admin' },
    { usage: '/tpa config set <key> <value>', description: 'Change a TPA setting', permission: 'server.admin' },
  ],
};

interface TpaRequest {
  readonly fromId: string;
  readonly fromName: string;
  readonly toId: string;
  readonly kind: 'tpa' | 'tpahere';
  readonly expiresAt: number;
}

const SCHEMA = {
  timeoutSeconds: { type: 'number' as const, description: 'Request timeout' },
  cooldownSeconds: { type: 'number' as const, description: 'Cooldown between requests' },
  warmupSeconds: { type: 'number' as const, description: 'Warmup before teleport' },
  cancelOnMove: { type: 'boolean' as const, description: 'Cancel teleport if the player moves' },
  cancelOnDamage: { type: 'boolean' as const, description: 'Cancel teleport on damage' },
};

export function createTpaPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'tpa',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      const config = api.loadConfig({
        timeoutSeconds: 60,
        cooldownSeconds: 10,
        warmupSeconds: 0,
        cancelOnMove: true,
        cancelOnDamage: true,
      });
      const incoming = new Map<string, TpaRequest>();
      const lastRequestAt = new Map<string, number>();

      const clearFor = (playerId: string) => {
        incoming.delete(playerId);
        for (const [target, request] of incoming) {
          if (request.fromId === playerId) incoming.delete(target);
        }
        lastRequestAt.delete(playerId);
      };

      api.registerEvent('playerQuit', (event) => clearFor(event.playerId));

      const requestTeleport = (args: readonly string[], sender: { playerId: string; name: string }, kind: 'tpa' | 'tpahere') => {
        if (!api.hasPermission(sender.playerId, 'tpa.use')) return fail('You do not have permission.');
        const name = args[0];
        if (!name) return usageError(kind === 'tpa' ? '/tpa <player>' : '/tpahere <player>');
        const target = api.getPlayer(name);
        if (!target) return fail(`Player '${name}' is not online.`);
        if (target.id === sender.playerId) return fail('You cannot teleport to yourself.');
        const now = Date.now();
        const cooldown = Number(api.getConfig('cooldownSeconds', config.cooldownSeconds)) * 1000;
        const last = lastRequestAt.get(sender.playerId) ?? 0;
        if (now - last < cooldown) {
          return fail(`Please wait ${((cooldown - (now - last)) / 1000).toFixed(1)}s before sending another request.`);
        }
        const timeout = Number(api.getConfig('timeoutSeconds', config.timeoutSeconds)) * 1000;
        incoming.set(target.id, {
          fromId: sender.playerId,
          fromName: sender.name,
          toId: target.id,
          kind,
          expiresAt: now + timeout,
        });
        lastRequestAt.set(sender.playerId, now);
        const here = kind === 'tpahere';
        target.sendMessage(
          here
            ? `${sender.name} asked you to teleport to them. /tpaccept or /tpdeny`
            : `${sender.name} asked to teleport to you. /tpaccept or /tpdeny`,
        );
        api.scheduleOnce(timeout, () => {
          const current = incoming.get(target.id);
          if (current && current.fromId === sender.playerId && current.expiresAt <= Date.now() + 50) {
            incoming.delete(target.id);
            api.getPlayer(sender.playerId)?.sendMessage('Your teleport request expired.');
            api.getPlayer(target.id)?.sendMessage('Teleport request expired.');
          }
        });
        return ok(here ? `Asked ${target.name} to teleport to you.` : `Asked ${target.name} to accept a teleport.`);
      };

      api.registerCommand({
        name: 'tpa',
        usage: '/tpa <player>',
        description: 'Request to teleport to a player',
        permission: 'tpa.use',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (args[0]?.toLowerCase() === 'config') {
            if (!api.hasPermission(sender.playerId, 'server.admin') && !api.isOperator(sender.name)) {
              return fail('You do not have permission.');
            }
            if (!args[1]) {
              return ok(Object.entries(api.loadConfig(config)).map(([key, value]) => `${key}=${value}`));
            }
            if (args[1].toLowerCase() === 'set') {
              if (!args[2] || args[3] === undefined) return usageError('/tpa config set <key> <value>');
              const result = ctx.config.setFromString('tpa', args[2], args.slice(3).join(' '), SCHEMA);
              return result.ok ? ok(`Set ${args[2]}=${String(result.value)}`) : fail(result.error);
            }
            return usageError('/tpa config set <key> <value>');
          }
          return requestTeleport(args, sender, 'tpa');
        },
      });
      api.registerCommand({
        name: 'tpahere',
        usage: '/tpahere <player>',
        description: 'Request a player to teleport to you',
        permission: 'tpa.use',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          return requestTeleport(args, sender, 'tpahere');
        },
      });
      api.registerCommand({
        name: 'tpaccept',
        usage: '/tpaccept',
        description: 'Accept a teleport request',
        permission: 'tpa.accept',
        execute: (_args, sender) => {
          const request = incoming.get(sender.playerId);
          if (!request || request.expiresAt < Date.now()) {
            incoming.delete(sender.playerId);
            return fail('You have no teleport request.');
          }
          incoming.delete(sender.playerId);
          const from = api.getPlayer(request.fromId);
          const to = api.getPlayer(request.toId);
          if (!from || !to) return fail('That player is no longer online.');
          const traveller = request.kind === 'tpa' ? from : to;
          const destination = request.kind === 'tpa' ? to : from;
          const pos = destination.position();
          const result = api.teleport(traveller.id, pos.x, pos.y, pos.z, 'tpa', {
            warmupMs: Number(api.getConfig('warmupSeconds', config.warmupSeconds)) * 1000,
            cooldownMs: 0,
            cancelOnMove: Boolean(api.getConfig('cancelOnMove', config.cancelOnMove)),
            cancelOnDamage: Boolean(api.getConfig('cancelOnDamage', config.cancelOnDamage)),
          });
          if (!result.ok) return fail(result.error ?? 'Teleport failed.');
          from.sendMessage(`${to.name} accepted the teleport request.`);
          return ok('Teleport request accepted.');
        },
      });
      api.registerCommand({
        name: 'tpdeny',
        usage: '/tpdeny',
        description: 'Deny a teleport request',
        permission: 'tpa.accept',
        execute: (_args, sender) => {
          const request = incoming.get(sender.playerId);
          if (!request) return fail('You have no teleport request.');
          incoming.delete(sender.playerId);
          api.getPlayer(request.fromId)?.sendMessage(`${sender.name} denied the teleport request.`);
          return ok('Teleport request denied.');
        },
      });
    },
  };
}
