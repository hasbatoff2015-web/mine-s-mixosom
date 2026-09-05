import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import { volumeContains, type SelectionVolume } from '../services/selection';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

export const CLAIM_FLAGS = [
  'pvp',
  'mob-spawn',
  'mob-damage',
  'block-break',
  'block-place',
  'explosions',
  'fire-spread',
  'player-damage',
  'item-drop',
  'item-pickup',
] as const;

export type ClaimFlag = (typeof CLAIM_FLAGS)[number];

export type ClaimFlags = Record<ClaimFlag, boolean>;

export interface Claim {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly worldId: string;
  readonly volume: SelectionVolume;
  members: string[];
  flags: ClaimFlags;
}

interface ClaimStore {
  claims: Claim[];
}

const DEFAULT_FLAGS: ClaimFlags = {
  pvp: false,
  'mob-spawn': false,
  'mob-damage': false,
  'block-break': false,
  'block-place': false,
  explosions: false,
  'fire-spread': false,
  'player-damage': true,
  'item-drop': false,
  'item-pickup': false,
};

const HELP = {
  name: 'claim',
  title: 'Claims',
  description: 'Protect land with members and configurable flags.',
  commands: [
    { usage: '/claim help', description: 'Show this help' },
    { usage: '/claim pos1', description: 'Set first corner', permission: 'claim.create' },
    { usage: '/claim pos2', description: 'Set second corner', permission: 'claim.create' },
    { usage: '/claim create <name>', description: 'Create a claim from the selection', permission: 'claim.create' },
    { usage: '/claim delete <name>', description: 'Delete your claim', permission: 'claim.use' },
    { usage: '/claim info [name]', description: 'Show claim info', permission: 'claim.use' },
    { usage: '/claim list', description: 'List your claims', permission: 'claim.use' },
    { usage: '/claim addmember <player>', description: 'Add a member to the claim you are in', permission: 'claim.use' },
    { usage: '/claim removemember <player>', description: 'Remove a member', permission: 'claim.use' },
    { usage: '/claim members', description: 'List members', permission: 'claim.use' },
    { usage: '/claim flag <flag> <true|false>', description: 'Set a claim flag', permission: 'claim.use' },
    { usage: '/claim admin delete <name>', description: 'Delete any claim', permission: 'claim.admin' },
  ],
};

function flagOf(raw: string): ClaimFlag | undefined {
  return CLAIM_FLAGS.find((flag) => flag === raw.toLowerCase());
}

function atPos(store: ClaimStore, worldId: string, x: number, y: number, z: number): Claim | undefined {
  return store.claims.find((claim) => claim.worldId === worldId && volumeContains(claim.volume, x, y, z));
}

function isTrusted(claim: Claim, playerKey: string): boolean {
  const key = playerKey.toLowerCase();
  return claim.owner === key || claim.members.includes(key);
}

export function createClaimsPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'claims',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      const load = (): ClaimStore => api.loadData<ClaimStore>('claims', { claims: [] });
      const save = (store: ClaimStore) => api.saveData('claims', store);
      const keyOf = (sender: { playerId: string; name: string }) => sender.name.toLowerCase();
      const standing = (playerId: string) => {
        const player = api.getPlayer(playerId);
        if (!player) return undefined;
        const pos = player.position();
        return atPos(load(), api.getWorld().worldId, Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
      };

      const bypass = (playerId: string, name: string) => (
        api.hasPermission(playerId, 'claim.admin') || api.isOperator(name)
      );

      api.registerEvent('blockBreak', (event) => {
        const claim = atPos(load(), api.getWorld().worldId, event.x, event.y, event.z);
        if (!claim || claim.flags['block-break']) return;
        const player = api.getPlayer(event.playerId);
        if (!player) return;
        if (bypass(player.id, player.name) || isTrusted(claim, player.name)) return;
        event.cancel();
        player.sendMessage('This land is claimed.');
      });
      api.registerEvent('blockPlace', (event) => {
        const claim = atPos(load(), api.getWorld().worldId, event.x, event.y, event.z);
        if (!claim || claim.flags['block-place']) return;
        const player = api.getPlayer(event.playerId);
        if (!player) return;
        if (bypass(player.id, player.name) || isTrusted(claim, player.name)) return;
        event.cancel();
        player.sendMessage('This land is claimed.');
      });
      api.registerEvent('playerDamage', (event) => {
        const player = api.getPlayer(event.playerId);
        if (!player) return;
        const pos = player.position();
        const claim = atPos(load(), api.getWorld().worldId, Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
        if (!claim) return;
        if (!claim.flags['player-damage']) {
          event.cancel();
          return;
        }
        if (!claim.flags.pvp && event.attackerId) event.cancel();
        const mobCause = event.cause === 'melee' || event.cause === 'arrow' || event.cause === 'projectile';
        if (!claim.flags['mob-damage'] && !event.attackerId && mobCause) event.cancel();
      });
      api.registerEvent('explosion', (event) => {
        const claim = atPos(load(), api.getWorld().worldId, Math.floor(event.x), Math.floor(event.y), Math.floor(event.z));
        if (claim && !claim.flags.explosions) event.cancel();
      });
      api.registerEvent('itemDrop', (event) => {
        if (!event.playerId) return;
        const claim = atPos(load(), api.getWorld().worldId, Math.floor(event.x), Math.floor(event.y), Math.floor(event.z));
        if (!claim || claim.flags['item-drop']) return;
        const player = api.getPlayer(event.playerId);
        if (!player) return;
        if (bypass(player.id, player.name) || isTrusted(claim, player.name)) return;
        event.cancel();
      });
      api.registerEvent('itemPickup', (event) => {
        const player = api.getPlayer(event.playerId);
        if (!player) return;
        const pos = player.position();
        const claim = atPos(load(), api.getWorld().worldId, Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
        if (!claim || claim.flags['item-pickup']) return;
        if (bypass(player.id, player.name) || isTrusted(claim, player.name)) return;
        event.cancel();
      });

      api.registerCommand({
        name: 'claim',
        usage: '/claim help',
        description: 'Protect land',
        execute: (args, sender) => {
          if (isHelpRequest(args) || args.length === 0) return ok(formatPluginHelp(HELP));
          const sub = args[0]!.toLowerCase();
          const ownerKey = keyOf(sender);
          if (sub === 'pos1' || sub === 'pos2') {
            const player = api.getPlayer(sender.playerId);
            if (!player) return fail('Player not found.');
            const pos = player.position();
            ctx.selection.set(sender.playerId, sub === 'pos1' ? 1 : 2, {
              x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z),
            });
            return ok(`Claim ${sub} set.`);
          }
          if (sub === 'create') {
            if (!api.hasPermission(sender.playerId, 'claim.create') && !api.isOperator(sender.name)) {
              return fail('You do not have permission.');
            }
            const name = args[1]?.toLowerCase();
            if (!name) return usageError('/claim create <name>');
            const volume = ctx.selection.volume(sender.playerId);
            if (!volume) return fail('Set /claim pos1 and pos2 first.');
            const store = load();
            if (store.claims.some((claim) => claim.owner === ownerKey && claim.name === name)) {
              return fail(`You already have a claim named '${name}'.`);
            }
            store.claims.push({
              id: `${ownerKey}:${name}:${Date.now()}`,
              name,
              owner: ownerKey,
              worldId: api.getWorld().worldId,
              volume,
              members: [],
              flags: { ...DEFAULT_FLAGS },
            });
            save(store);
            return ok(`Claim '${name}' created.`);
          }
          if (sub === 'delete') {
            const name = args[1]?.toLowerCase();
            if (!name) return usageError('/claim delete <name>');
            const store = load();
            const index = store.claims.findIndex((claim) => claim.name === name && (
              claim.owner === ownerKey || bypass(sender.playerId, sender.name)
            ));
            if (index < 0) return fail(`Claim '${name}' not found.`);
            store.claims.splice(index, 1);
            save(store);
            return ok(`Deleted claim '${name}'.`);
          }
          if (sub === 'list') {
            const mine = load().claims.filter((claim) => claim.owner === ownerKey || claim.members.includes(ownerKey));
            return ok(mine.length > 0 ? `Claims: ${mine.map((claim) => claim.name).join(', ')}` : 'You have no claims.');
          }
          if (sub === 'info') {
            const named = args[1]?.toLowerCase();
            const claim = named
              ? load().claims.find((entry) => entry.name === named)
              : standing(sender.playerId);
            if (!claim) return fail(named ? `Claim '${named}' not found.` : 'You are not standing in a claim.');
            return ok([
              `Claim ${claim.name} (${claim.id})`,
              `Owner: ${claim.owner}`,
              `Members: ${claim.members.join(', ') || '(none)'}`,
              `Flags: ${CLAIM_FLAGS.map((flag) => `${flag}=${claim.flags[flag]}`).join(', ')}`,
              `Volume: ${claim.volume.minX},${claim.volume.minY},${claim.volume.minZ} → ${claim.volume.maxX},${claim.volume.maxY},${claim.volume.maxZ}`,
            ]);
          }
          if (sub === 'addmember' || sub === 'removemember' || sub === 'members' || sub === 'flag') {
            const claim = standing(sender.playerId);
            if (!claim) return fail('You are not standing in a claim.');
            if (claim.owner !== ownerKey && !bypass(sender.playerId, sender.name)) {
              return fail('Only the claim owner can do that.');
            }
            const store = load();
            const live = store.claims.find((entry) => entry.id === claim.id);
            if (!live) return fail('Claim not found.');
            if (sub === 'members') return ok(`Members: ${live.members.join(', ') || '(none)'}`);
            if (sub === 'addmember') {
              const name = args[1]?.toLowerCase();
              if (!name) return usageError('/claim addmember <player>');
              if (!live.members.includes(name)) live.members.push(name);
              save(store);
              return ok(`Added ${name} to claim '${live.name}'.`);
            }
            if (sub === 'removemember') {
              const name = args[1]?.toLowerCase();
              if (!name) return usageError('/claim removemember <player>');
              live.members = live.members.filter((member) => member !== name);
              save(store);
              return ok(`Removed ${name} from claim '${live.name}'.`);
            }
            const flag = args[1] ? flagOf(args[1]) : undefined;
            const raw = args[2]?.toLowerCase();
            if (!flag || (raw !== 'true' && raw !== 'false' && raw !== 'on' && raw !== 'off')) {
              return usageError(`/claim flag <${CLAIM_FLAGS.join('|')}> <true|false>`);
            }
            live.flags[flag] = raw === 'true' || raw === 'on';
            save(store);
            return ok(`Set ${flag}=${live.flags[flag]} on claim '${live.name}'.`);
          }
          if (sub === 'admin') {
            if (!bypass(sender.playerId, sender.name)) return fail('You do not have permission.');
            if (args[1]?.toLowerCase() === 'delete') {
              const name = args[2]?.toLowerCase();
              if (!name) return usageError('/claim admin delete <name>');
              const store = load();
              const next = store.claims.filter((claim) => claim.name !== name);
              if (next.length === store.claims.length) return fail(`Claim '${name}' not found.`);
              store.claims = next;
              save(store);
              return ok(`Admin deleted claim '${name}'.`);
            }
            return usageError('/claim admin delete <name>');
          }
          return usageError('/claim help');
        },
      });
    },
  };
}
