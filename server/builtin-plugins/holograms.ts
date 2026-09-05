import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { HologramRecord } from '../services/holograms';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'holograms',
  title: 'Holograms',
  description: 'Named multi-line world text markers. The client renders 3D billboards.',
  commands: [
    { usage: '/holograms help', description: 'Show this help' },
    { usage: '/holograms create <name>', description: 'Create a hologram at your position', permission: 'holograms.create' },
    { usage: '/holograms delete <name>', description: 'Delete a hologram', permission: 'holograms.create' },
    { usage: '/holograms list', description: 'List holograms', permission: 'holograms.create' },
    { usage: '/holograms info <name>', description: 'Show hologram details' },
    { usage: '/holograms move <name>', description: 'Move a hologram to your position', permission: 'holograms.create' },
    { usage: '/holograms movehere <name>', description: 'Alias of move', permission: 'holograms.create' },
    { usage: '/holograms line add <name> <text>', description: 'Append a line', permission: 'holograms.create' },
    { usage: '/holograms line set <name> <line> <text>', description: 'Replace a line (1-based)', permission: 'holograms.create' },
    { usage: '/holograms line remove <name> <line>', description: 'Remove a line', permission: 'holograms.create' },
    { usage: '/holograms range <name> <distance>', description: 'Set view distance', permission: 'holograms.create' },
  ],
};

interface HologramStore {
  holograms: HologramRecord[];
}

export function createHologramsPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'holograms',
    version: '1.1.0',
    apiVersion: 1,
    onEnable(api) {
      const load = (): HologramStore => {
        const raw = api.loadData<HologramStore>('holograms', { holograms: [] });
        return { holograms: Array.isArray(raw.holograms) ? raw.holograms : [] };
      };
      const save = (store: HologramStore) => {
        api.saveData('holograms', store);
        ctx.holograms.replace(store.holograms);
      };
      ctx.holograms.replace(load().holograms);

      const canEdit = (playerId: string, name: string) => (
        api.hasPermission(playerId, 'holograms.create') || api.isOperator(name)
      );

      api.registerCommand({
        name: 'holograms',
        aliases: ['holo', 'hologram'],
        usage: '/holograms help',
        description: 'Manage named holograms',
        execute: (args, sender) => {
          if (isHelpRequest(args) || args.length === 0) return ok(formatPluginHelp(HELP));
          const sub = args[0]!.toLowerCase();
          const store = load();
          if (sub === 'list') {
            const names = store.holograms.map((entry) => entry.name);
            return ok(names.length > 0 ? `Holograms: ${names.join(', ')}` : 'No holograms.');
          }
          if (sub === 'info') {
            const name = args[1]?.toLowerCase();
            if (!name) return usageError('/holograms info <name>');
            const hologram = store.holograms.find((entry) => entry.name === name);
            if (!hologram) return fail(`Hologram '${name}' not found.`);
            return ok([
              `Hologram ${hologram.name}`,
              `World: ${hologram.worldId}`,
              `Position: ${hologram.x.toFixed(1)}, ${hologram.y.toFixed(1)}, ${hologram.z.toFixed(1)}`,
              `Range: ${hologram.range}`,
              `Enabled: ${hologram.enabled ? 'yes' : 'no'}`,
              `Lines (${hologram.lines.length}):`,
              ...hologram.lines.map((line, index) => `  ${index + 1}. ${line}`),
            ]);
          }
          if (!canEdit(sender.playerId, sender.name)) return fail('You do not have permission.');
          const player = api.getPlayer(sender.playerId);
          if (sub === 'create') {
            const name = args[1]?.toLowerCase();
            if (!name) return usageError('/holograms create <name>');
            if (store.holograms.some((entry) => entry.name === name)) return fail(`Hologram '${name}' already exists.`);
            if (!player) return fail('Player not found.');
            const pos = player.position();
            store.holograms.push({
              name,
              worldId: api.getWorld().worldId,
              x: pos.x,
              y: pos.y + 1.8,
              z: pos.z,
              lines: [name],
              range: 48,
              enabled: true,
            });
            save(store);
            return ok(`Created hologram '${name}'.`);
          }
          if (sub === 'delete') {
            const name = args[1]?.toLowerCase();
            if (!name) return usageError('/holograms delete <name>');
            const next = store.holograms.filter((entry) => entry.name !== name);
            if (next.length === store.holograms.length) return fail(`Hologram '${name}' not found.`);
            store.holograms = next;
            save(store);
            return ok(`Deleted hologram '${name}'.`);
          }
          if (sub === 'move' || sub === 'movehere') {
            const name = args[1]?.toLowerCase();
            if (!name) return usageError('/holograms move <name>');
            const hologram = store.holograms.find((entry) => entry.name === name);
            if (!hologram) return fail(`Hologram '${name}' not found.`);
            if (!player) return fail('Player not found.');
            const pos = player.position();
            hologram.x = pos.x;
            hologram.y = pos.y + 1.8;
            hologram.z = pos.z;
            hologram.worldId = api.getWorld().worldId;
            save(store);
            return ok(`Moved hologram '${name}'.`);
          }
          if (sub === 'range') {
            const name = args[1]?.toLowerCase();
            const distance = Number(args[2]);
            if (!name || !Number.isFinite(distance)) {
              return usageError('/holograms range <name> <distance>');
            }
            const hologram = store.holograms.find((entry) => entry.name === name);
            if (!hologram) return fail(`Hologram '${name}' not found.`);
            hologram.range = Math.max(1, Math.min(128, distance));
            save(store);
            return ok(`Set hologram '${name}' range to ${hologram.range}.`);
          }
          if (sub === 'line') {
            const action = args[1]?.toLowerCase();
            const name = args[2]?.toLowerCase();
            const hologram = name ? store.holograms.find((entry) => entry.name === name) : undefined;
            if (!hologram) return fail(name ? `Hologram '${name}' not found.` : 'Usage: /holograms line add|set|remove ...');
            if (action === 'add') {
              const text = args.slice(3).join(' ').trim();
              if (!text) return usageError('/holograms line add <name> <text>');
              hologram.lines.push(text);
              save(store);
              return ok(`Added line ${hologram.lines.length} to '${name}'.`);
            }
            if (action === 'set') {
              const line = Number(args[3]);
              const text = args.slice(4).join(' ').trim();
              if (!Number.isInteger(line) || line < 1 || !text) return usageError('/holograms line set <name> <line> <text>');
              if (line > hologram.lines.length) return fail(`Hologram '${name}' has no line ${line}.`);
              hologram.lines[line - 1] = text;
              save(store);
              return ok(`Set line ${line} on '${name}'.`);
            }
            if (action === 'remove') {
              const line = Number(args[3]);
              if (!Number.isInteger(line) || line < 1) return usageError('/holograms line remove <name> <line>');
              if (line > hologram.lines.length) return fail(`Hologram '${name}' has no line ${line}.`);
              hologram.lines.splice(line - 1, 1);
              save(store);
              return ok(`Removed line ${line} from '${name}'.`);
            }
            return usageError('/holograms line add|set|remove ...');
          }
          return usageError('/holograms help');
        },
      });
    },
    onDisable() {
      ctx.holograms.replace([]);
    },
  };
}
