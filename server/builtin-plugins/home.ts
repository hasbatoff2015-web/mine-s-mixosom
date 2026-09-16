import type { Plugin, ServerAPI } from '../PluginManager';
import { fail, ok } from '../commands';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';
import { HOME_LIMIT_ERROR, HOME_MISSING_ERROR, validateHomeName } from '../../shared/homes';

const HELP = {
  name: 'home',
  title: 'Home',
  description: 'Set and teleport to personal homes.',
  commands: [
    { usage: '/home help', description: 'Show this help' },
    { usage: '/sethome [name]', description: 'Set a home at your position', permission: 'home.sethome' },
    { usage: '/home [name]', description: 'Teleport to a home', permission: 'home.use' },
    { usage: '/homes', description: 'List your homes', permission: 'home.use' },
    { usage: '/delhome <name>', description: 'Delete a home', permission: 'home.sethome' },
    { usage: '/home config set <key> <value>', description: 'Change home settings', permission: 'server.admin' },
  ],
};

const SCHEMA = {
  cooldownSeconds: { type: 'number' as const, description: 'Cooldown between teleports' },
  warmupSeconds: { type: 'number' as const, description: 'Warmup before teleport' },
  maxHomesDefault: { type: 'number' as const, description: 'Homes for default players' },
  maxHomesVip: { type: 'number' as const, description: 'Homes for home.multiple' },
  maxHomesPremium: { type: 'number' as const, description: 'Homes for home.limit.premium' },
  cancelOnMove: { type: 'boolean' as const, description: 'Cancel if you move' },
  cancelOnDamage: { type: 'boolean' as const, description: 'Cancel on damage' },
};

export function maxHomesFor(api: ServerAPI, playerId: string): number {
  const def = Number(api.getConfig('maxHomesDefault', 4));
  const vip = Number(api.getConfig('maxHomesVip', 4));
  const premium = Number(api.getConfig('maxHomesPremium', 5));
  if (api.isOperator(playerId) || api.hasPermission(playerId, 'home.*')) {
    return Math.max(premium, vip, def);
  }
  let max = def;
  if (api.hasPermission(playerId, 'home.multiple')) max = Math.max(max, vip);
  if (api.hasPermission(playerId, 'home.limit.premium')) max = Math.max(max, premium);
  return max;
}

export function createHomePlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'home',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      ctx.homes.load();
      const config = api.loadConfig({
        cooldownSeconds: 5,
        warmupSeconds: 0,
        maxHomesDefault: 4,
        maxHomesVip: 4,
        maxHomesPremium: 5,
        cancelOnMove: true,
        cancelOnDamage: true,
      });

      api.registerCommand({
        name: 'home',
        usage: '/home [name]',
        description: 'Teleport to a home',
        permission: 'home.use',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (args[0]?.toLowerCase() === 'config') {
            if (!api.hasPermission(sender.playerId, 'server.admin') && !api.isOperator(sender.name)) {
              return fail('You do not have permission.');
            }
            if (args[1]?.toLowerCase() === 'set') {
              if (!args[2] || args[3] === undefined) return usageError('/home config set <key> <value>');
              const result = ctx.config.setFromString('home', args[2], args.slice(3).join(' '), SCHEMA);
              return result.ok ? ok(`Set ${args[2]}=${String(result.value)}`) : fail(result.error);
            }
            return ok(Object.entries(api.loadConfig(config)).map(([key, value]) => `${key}=${String(value)}`));
          }
          const name = args[0] ?? 'home';
          const dest = ctx.homes.get(sender.name, name);
          if (!dest) return fail(`Home '${name}' not found.`);
          const result = ctx.teleports.schedule(sender.playerId, {
            x: dest.x,
            y: dest.y,
            z: dest.z,
            yaw: dest.yaw,
            pitch: dest.pitch,
          }, 'home', {
            warmupMs: Number(api.getConfig('warmupSeconds', config.warmupSeconds)) * 1000,
            cooldownMs: Number(api.getConfig('cooldownSeconds', config.cooldownSeconds)) * 1000,
            cancelOnMove: Boolean(api.getConfig('cancelOnMove', config.cancelOnMove)),
            cancelOnDamage: Boolean(api.getConfig('cancelOnDamage', config.cancelOnDamage)),
          });
          return result.ok ? ok(`Teleporting to home '${dest.name}'.`) : fail(result.error ?? 'Teleport failed.');
        },
      });
      api.registerCommand({
        name: 'sethome',
        usage: '/sethome [name]',
        description: 'Set a home at your position',
        permission: 'home.sethome',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          const player = api.getPlayer(sender.playerId);
          if (!player) return fail('Player not found.');
          const parsed = validateHomeName(args[0] ?? 'home');
          if (!parsed.ok) return fail(parsed.error);
          const pos = player.position();
          const result = ctx.homes.set(sender.name, parsed.name, {
            worldId: api.getWorld().worldId,
            x: pos.x,
            y: pos.y,
            z: pos.z,
            yaw: pos.yaw,
            pitch: pos.pitch,
          }, maxHomesFor(api, sender.playerId));
          if (!result.ok) {
            if (result.error?.startsWith('Можно сохранить')) {
              const max = maxHomesFor(api, sender.playerId);
              return fail(`You can only set ${max} home(s).`);
            }
            return fail(result.error ?? HOME_LIMIT_ERROR(maxHomesFor(api, sender.playerId)));
          }
          return ok(`Home '${result.home?.name}' set.`);
        },
      });
      api.registerCommand({
        name: 'homes',
        usage: '/homes',
        description: 'List your homes',
        permission: 'home.use',
        execute: (_args, sender) => {
          const homes = ctx.homes.list(sender.name);
          if (homes.length === 0) return ok('You have no homes. Use /sethome.');
          return ok(`Homes: ${homes.map((home) => home.name).join(', ')}`);
        },
      });
      api.registerCommand({
        name: 'delhome',
        usage: '/delhome <name>',
        description: 'Delete a home',
        permission: 'home.sethome',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          const name = args[0];
          if (!name) return usageError('/delhome <name>');
          const result = ctx.homes.remove(sender.name, name);
          if (!result.ok) return fail(result.error === HOME_MISSING_ERROR ? `Home '${name}' not found.` : (result.error ?? HOME_MISSING_ERROR));
          return ok(`Deleted home '${name}'.`);
        },
      });
    },
  };
}
