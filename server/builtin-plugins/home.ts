import type { Plugin, ServerAPI } from '../PluginManager';
import { fail, ok } from '../commands';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

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

interface HomeLocation {
  readonly name: string;
  readonly worldId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface HomeStore {
  players: Record<string, HomeLocation[]>;
}

const SCHEMA = {
  cooldownSeconds: { type: 'number' as const, description: 'Cooldown between teleports' },
  warmupSeconds: { type: 'number' as const, description: 'Warmup before teleport' },
  maxHomesDefault: { type: 'number' as const, description: 'Homes for default players' },
  maxHomesVip: { type: 'number' as const, description: 'Homes for home.multiple' },
  maxHomesPremium: { type: 'number' as const, description: 'Homes for home.limit.premium' },
  cancelOnMove: { type: 'boolean' as const, description: 'Cancel if you move' },
  cancelOnDamage: { type: 'boolean' as const, description: 'Cancel on damage' },
};

function maxHomesFor(api: ServerAPI, playerId: string): number {
  const def = Number(api.getConfig('maxHomesDefault', 1));
  const vip = Number(api.getConfig('maxHomesVip', 3));
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
      const config = api.loadConfig({
        cooldownSeconds: 5,
        warmupSeconds: 0,
        maxHomesDefault: 1,
        maxHomesVip: 3,
        maxHomesPremium: 5,
        cancelOnMove: true,
        cancelOnDamage: true,
      });
      const load = (): HomeStore => api.loadData<HomeStore>('homes', { players: {} });
      const save = (store: HomeStore) => api.saveData('homes', store);
      const listFor = (playerKey: string): HomeLocation[] => load().players[playerKey] ?? [];

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
            return ok(Object.entries(api.loadConfig(config)).map(([key, value]) => `${key}=${value}`));
          }
          const homes = listFor(sender.name.toLowerCase());
          const name = (args[0] ?? 'home').toLowerCase();
          const dest = homes.find((home) => home.name === name);
          if (!dest) return fail(`Home '${name}' not found.`);
          const result = api.teleport(sender.playerId, dest.x, dest.y, dest.z, 'home', {
            warmupMs: Number(api.getConfig('warmupSeconds', config.warmupSeconds)) * 1000,
            cooldownMs: Number(api.getConfig('cooldownSeconds', config.cooldownSeconds)) * 1000,
            cancelOnMove: Boolean(api.getConfig('cancelOnMove', config.cancelOnMove)),
            cancelOnDamage: Boolean(api.getConfig('cancelOnDamage', config.cancelOnDamage)),
          });
          return result.ok ? ok(`Teleporting to home '${name}'.`) : fail(result.error ?? 'Teleport failed.');
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
          const name = (args[0] ?? 'home').toLowerCase();
          if (!/^[a-z0-9_]{1,16}$/.test(name)) return fail('Home name must be 1-16 letters, numbers, or underscores.');
          const store = load();
          const owner = sender.name.toLowerCase();
          const homes = [...(store.players[owner] ?? [])];
          const existing = homes.findIndex((home) => home.name === name);
          const max = maxHomesFor(api, sender.playerId);
          if (existing < 0 && homes.length >= max) {
            return fail(`You can only set ${max} home(s).`);
          }
          const pos = player.position();
          const next: HomeLocation = { name, worldId: api.getWorld().worldId, x: pos.x, y: pos.y, z: pos.z };
          if (existing >= 0) homes[existing] = next;
          else homes.push(next);
          store.players[owner] = homes;
          save(store);
          return ok(`Home '${name}' set.`);
        },
      });
      api.registerCommand({
        name: 'homes',
        usage: '/homes',
        description: 'List your homes',
        permission: 'home.use',
        execute: (_args, sender) => {
          const homes = listFor(sender.name.toLowerCase());
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
          const name = args[0]?.toLowerCase();
          if (!name) return usageError('/delhome <name>');
          const store = load();
          const owner = sender.name.toLowerCase();
          const homes = [...(store.players[owner] ?? [])];
          const next = homes.filter((home) => home.name !== name);
          if (next.length === homes.length) return fail(`Home '${name}' not found.`);
          store.players[owner] = next;
          save(store);
          return ok(`Deleted home '${name}'.`);
        },
      });
    },
  };
}
