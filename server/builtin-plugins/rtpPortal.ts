import { BlockId } from '../../src/blocks';
import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import { volumeContains, type SelectionVolume } from '../services/selection';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'rtpportal',
  title: 'RTP Portal',
  description: 'Water volumes that trigger random teleport. Select two corners, then create.',
  commands: [
    { usage: '/rtpportal help', description: 'Show this help' },
    { usage: '/rtpportal pos1', description: 'Set first corner at your position', permission: 'rtpportal.create' },
    { usage: '/rtpportal pos2', description: 'Set second corner at your position', permission: 'rtpportal.create' },
    { usage: '/rtpportal create <name>', description: 'Create a portal from the selection', permission: 'rtpportal.create' },
    { usage: '/rtpportal remove <name>', description: 'Remove a portal', permission: 'rtpportal.create' },
    { usage: '/rtpportal list', description: 'List portals', permission: 'rtpportal.use' },
    { usage: '/rtpportal info <name>', description: 'Show portal details', permission: 'rtpportal.use' },
  ],
};

interface RtpPortal {
  readonly name: string;
  readonly worldId: string;
  readonly volume: SelectionVolume;
  enabled: boolean;
  cooldownSeconds: number;
}

interface PortalStore {
  portals: RtpPortal[];
}

function feetBlock(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
}

export function createRtpPortalPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'rtpportal',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      const load = (): PortalStore => api.loadData<PortalStore>('portals', { portals: [] });
      const save = (store: PortalStore) => api.saveData('portals', store);
      const inside = new Set<string>();
      const cooldownUntil = new Map<string, number>();

      api.registerEvent('playerMove', (event) => {
        const player = api.getPlayer(event.playerId);
        if (!player) return;
        const feet = feetBlock(event.x, event.y, event.z);
        const water = api.getWorld().getBlock(feet.x, feet.y, feet.z) === BlockId.Water
          || api.getWorld().getBlock(feet.x, feet.y + 1, feet.z) === BlockId.Water;
        const portals = load().portals.filter((portal) => (
          portal.enabled && portal.worldId === api.getWorld().worldId && volumeContains(portal.volume, feet.x, feet.y, feet.z)
        ));
        const hit = water ? portals[0] : undefined;
        const key = event.playerId;
        if (!hit) {
          inside.delete(key);
          return;
        }
        if (inside.has(key)) return;
        inside.add(key);
        const until = cooldownUntil.get(`${key}:${hit.name}`) ?? 0;
        if (Date.now() < until) {
          player.sendMessage('This RTP portal is on cooldown.');
          return;
        }
        const started = ctx.rtpSessions.enqueue(event.playerId, {
          minX: Number(ctx.config.get('rtp', 'minX', -10_000)),
          maxX: Number(ctx.config.get('rtp', 'maxX', 10_000)),
          minZ: Number(ctx.config.get('rtp', 'minZ', -10_000)),
          maxZ: Number(ctx.config.get('rtp', 'maxZ', 10_000)),
          attemptsPerTick: Number(ctx.config.get('rtp', 'attemptsPerTick', 2)),
          maxAttempts: Number(ctx.config.get('rtp', 'maxAttempts', 24)),
          maxChunkGenerates: Number(ctx.config.get('rtp', 'maxChunkGenerates', 1)),
        }, { reason: 'portal', warmupMs: 0, cooldownMs: 0 });
        if (!started.ok) {
          player.sendMessage(started.error ?? 'RTP portal failed.');
          return;
        }
        cooldownUntil.set(`${key}:${hit.name}`, Date.now() + hit.cooldownSeconds * 1000);
        player.sendMessage(`Entered RTP portal '${hit.name}'. Searching...`);
      });

      api.registerEvent('playerQuit', (event) => {
        inside.delete(event.playerId);
      });

      const posOf = (playerId: string) => {
        const player = api.getPlayer(playerId);
        if (!player) return undefined;
        const pos = player.position();
        return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
      };

      api.registerCommand({
        name: 'rtpportal',
        usage: '/rtpportal help',
        description: 'Configure water RTP portals',
        execute: (args, sender) => {
          if (isHelpRequest(args) || args.length === 0) return ok(formatPluginHelp(HELP));
          const sub = args[0]!.toLowerCase();
          if (sub === 'pos1' || sub === 'pos2') {
            if (!api.hasPermission(sender.playerId, 'rtpportal.create') && !api.isOperator(sender.name)) {
              return fail('You do not have permission.');
            }
            const pos = posOf(sender.playerId);
            if (!pos) return fail('Player not found.');
            ctx.selection.set(sender.playerId, sub === 'pos1' ? 1 : 2, pos);
            return ok(`Portal ${sub} set to ${pos.x}, ${pos.y}, ${pos.z}.`);
          }
          if (sub === 'create') {
            if (!api.hasPermission(sender.playerId, 'rtpportal.create') && !api.isOperator(sender.name)) {
              return fail('You do not have permission.');
            }
            const name = args[1]?.toLowerCase();
            if (!name) return usageError('/rtpportal create <name>');
            const volume = ctx.selection.volume(sender.playerId);
            if (!volume) return fail('Set /rtpportal pos1 and pos2 first.');
            const store = load();
            if (store.portals.some((portal) => portal.name === name)) return fail(`Portal '${name}' already exists.`);
            store.portals.push({
              name,
              worldId: api.getWorld().worldId,
              volume,
              enabled: true,
              cooldownSeconds: 10,
            });
            save(store);
            return ok(`Created RTP portal '${name}'.`);
          }
          if (sub === 'remove') {
            if (!api.hasPermission(sender.playerId, 'rtpportal.create') && !api.isOperator(sender.name)) {
              return fail('You do not have permission.');
            }
            const name = args[1]?.toLowerCase();
            if (!name) return usageError('/rtpportal remove <name>');
            const store = load();
            const next = store.portals.filter((portal) => portal.name !== name);
            if (next.length === store.portals.length) return fail(`Portal '${name}' not found.`);
            store.portals = next;
            save(store);
            return ok(`Removed RTP portal '${name}'.`);
          }
          if (sub === 'list') {
            const names = load().portals.map((portal) => portal.name);
            return ok(names.length > 0 ? `Portals: ${names.join(', ')}` : 'No RTP portals.');
          }
          if (sub === 'info') {
            const name = args[1]?.toLowerCase();
            if (!name) return usageError('/rtpportal info <name>');
            const portal = load().portals.find((entry) => entry.name === name);
            if (!portal) return fail(`Portal '${name}' not found.`);
            const { volume } = portal;
            return ok([
              `Portal ${portal.name}`,
              `World: ${portal.worldId}`,
              `Enabled: ${portal.enabled ? 'yes' : 'no'}`,
              `Cooldown: ${portal.cooldownSeconds}s`,
              `Volume: ${volume.minX},${volume.minY},${volume.minZ} → ${volume.maxX},${volume.maxY},${volume.maxZ}`,
            ]);
          }
          return usageError('/rtpportal help');
        },
      });
    },
  };
}
