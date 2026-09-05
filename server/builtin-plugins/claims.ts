import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import {
  CLAIM_FLAGS,
  CLAIM_PRIORITY_DEFAULT,
  clampClaimPriority,
  claimsAt,
  effectiveFlag,
  effectiveFlags,
  flagSetter,
  isTrusted,
  migrateClaimStore,
  ownFlagLines,
  protectionSources,
  sortClaimsByPriority,
  type Claim,
  type ClaimStore,
} from '../services/claims';
import { findClaimByName, parseClaimFlagArgs, parseClaimMemberArgs } from '../services/claimCommands';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'claim',
  title: 'Claims',
  description: 'Protect land with overlapping regions, per-flag priority, and members.',
  commands: [
    { usage: '/claim help', description: 'Show this help' },
    { usage: '/claim pos1', description: 'Set first corner', permission: 'claim.create' },
    { usage: '/claim pos2', description: 'Set second corner', permission: 'claim.create' },
    { usage: '/claim create <name>', description: 'Create a claim from the selection', permission: 'claim.create' },
    { usage: '/claim delete <name>', description: 'Delete your claim', permission: 'claim.use' },
    { usage: '/claim info [name]', description: 'Show claim info and effective flags', permission: 'claim.use' },
    { usage: '/claim list', description: 'List your claims', permission: 'claim.use' },
    { usage: '/claim addmember [name] <player>', description: 'Add a member (current claim or named)', permission: 'claim.use' },
    { usage: '/claim removemember [name] <player>', description: 'Remove a member (current claim or named)', permission: 'claim.use' },
    { usage: '/claim members [name]', description: 'List members of the current or named claim', permission: 'claim.use' },
    { usage: '/claim flag [name] <flag> <true|false>', description: 'Set an explicit flag on the current or named claim', permission: 'claim.use' },
    { usage: '/claim priority <name> <number>', description: 'Set claim priority', permission: 'claim.use' },
    { usage: '/claim admin delete <name>', description: 'Delete any claim', permission: 'claim.admin' },
  ],
};

export function createClaimsPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'claims',
    version: '1.1.0',
    apiVersion: 1,
    onEnable(api) {
      const load = (): ClaimStore => migrateClaimStore(api.loadData<unknown>('claims', { claims: [] }));
      const save = (store: ClaimStore) => api.saveData('claims', store);
      const keyOf = (sender: { playerId: string; name: string }) => sender.name.toLowerCase();
      const worldId = () => api.getWorld().worldId;
      const overlapping = (x: number, y: number, z: number) => claimsAt(load().claims, worldId(), x, y, z);
      const standingAll = (playerId: string) => {
        const player = api.getPlayer(playerId);
        if (!player) return [];
        const pos = player.position();
        return overlapping(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
      };
      const topAt = (playerId: string) => sortClaimsByPriority(standingAll(playerId))[0];
      const bypass = (playerId: string, name: string) => (
        api.hasPermission(playerId, 'claim.admin') || api.isOperator(name)
      );
      const canEdit = (claim: Claim, sender: { playerId: string; name: string }) => (
        claim.owner === keyOf(sender) || bypass(sender.playerId, sender.name)
      );
      const editableAtFeet = (sender: { playerId: string; name: string }) => (
        sortClaimsByPriority(standingAll(sender.playerId)).find((claim) => canEdit(claim, sender))
      );
      const allowFlag = (
        claims: readonly Claim[],
        flag: 'block-break' | 'block-place' | 'item-drop' | 'item-pickup',
        playerId: string,
        playerName: string,
      ): boolean => {
        if (effectiveFlag(claims, flag)) return true;
        if (bypass(playerId, playerName)) return true;
        const setter = flagSetter(claims, flag);
        if (setter) return isTrusted(setter, playerName);
        return claims.some((claim) => isTrusted(claim, playerName));
      };

      const denyBuild = (
        event: { cancel(): void },
        claims: readonly Claim[],
        flag: 'block-break' | 'block-place',
        player: { id: string; name: string; sendMessage(text: string): void },
      ): boolean => {
        if (allowFlag(claims, flag, player.id, player.name)) return false;
        event.cancel();
        player.sendMessage('This land is claimed.');
        ctx.claimBoundaries.showAll(player.id, protectionSources(claims, flag, player.name));
        return true;
      };

      api.registerEvent('blockBreak', (event) => {
        const claims = overlapping(event.x, event.y, event.z);
        if (claims.length === 0) return;
        const player = api.getPlayer(event.playerId);
        if (!player) return;
        denyBuild(event, claims, 'block-break', player);
      });
      api.registerEvent('blockPlace', (event) => {
        const claims = overlapping(event.x, event.y, event.z);
        if (claims.length === 0) return;
        const player = api.getPlayer(event.playerId);
        if (!player) return;
        denyBuild(event, claims, 'block-place', player);
      });
      api.registerEvent('playerDamage', (event) => {
        const player = api.getPlayer(event.playerId);
        if (!player) return;
        const pos = player.position();
        const claims = overlapping(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
        if (claims.length === 0) return;
        if (!effectiveFlag(claims, 'player-damage')) {
          event.cancel();
          return;
        }
        if (!effectiveFlag(claims, 'pvp') && event.attackerId) event.cancel();
        const mobCause = event.cause === 'melee' || event.cause === 'arrow' || event.cause === 'projectile';
        if (!effectiveFlag(claims, 'mob-damage') && !event.attackerId && mobCause) event.cancel();
      });
      api.registerEvent('explosion', (event) => {
        const claims = overlapping(Math.floor(event.x), Math.floor(event.y), Math.floor(event.z));
        if (claims.length > 0 && !effectiveFlag(claims, 'explosions')) event.cancel();
      });
      api.registerEvent('itemDrop', (event) => {
        if (!event.playerId) return;
        const claims = overlapping(Math.floor(event.x), Math.floor(event.y), Math.floor(event.z));
        if (claims.length === 0) return;
        const player = api.getPlayer(event.playerId);
        if (!player) return;
        if (allowFlag(claims, 'item-drop', player.id, player.name)) return;
        event.cancel();
      });
      api.registerEvent('itemPickup', (event) => {
        const player = api.getPlayer(event.playerId);
        if (!player) return;
        const pos = player.position();
        const claims = overlapping(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
        if (claims.length === 0) return;
        if (allowFlag(claims, 'item-pickup', player.id, player.name)) return;
        event.cancel();
      });
      api.registerEvent('mobSpawn', (event) => {
        const claims = overlapping(Math.floor(event.x), Math.floor(event.y), Math.floor(event.z));
        if (claims.length > 0 && !effectiveFlag(claims, 'mob-spawn')) event.cancel();
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
              worldId: worldId(),
              volume,
              members: [],
              priority: CLAIM_PRIORITY_DEFAULT,
              flags: {},
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
            const here = standingAll(sender.playerId);
            const claim = named
              ? findClaimByName(load().claims, named, ownerKey)
              : sortClaimsByPriority(here)[0];
            if (!claim) return fail(named ? `Claim '${named}' not found.` : 'You are not standing in a claim.');
            const player = api.getPlayer(sender.playerId);
            const pos = player?.position();
            const atPoint = pos
              ? overlapping(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))
              : [claim];
            const own = ownFlagLines(claim);
            const effective = effectiveFlags(atPoint);
            return ok([
              `Claim: ${claim.name}`,
              `Owner: ${claim.owner}`,
              `Priority: ${claim.priority}`,
              `Members: ${claim.members.join(', ') || '(none)'}`,
              `Volume: ${claim.volume.minX},${claim.volume.minY},${claim.volume.minZ} → ${claim.volume.maxX},${claim.volume.maxY},${claim.volume.maxZ}`,
              here.length > 1 ? `Overlapping: ${sortClaimsByPriority(here).map((entry) => entry.name).join(', ')}` : '',
              'Own flags:',
              ...(own.length > 0 ? own : ['(none)']),
              'Effective flags:',
              ...CLAIM_FLAGS.map((flag) => `${flag}: ${effective[flag]}`),
            ].filter((line) => line.length > 0));
          }
          if (sub === 'priority') {
            const name = args[1]?.toLowerCase();
            const raw = args[2];
            if (!name || raw === undefined) return usageError('/claim priority <name> <number>');
            const value = Number(raw);
            if (!Number.isFinite(value)) return usageError('/claim priority <name> <number>');
            const store = load();
            const live = findClaimByName(store.claims, name, ownerKey);
            if (!live) return fail(`Claim '${name}' not found.`);
            if (!canEdit(live, sender)) return fail('You do not have permission.');
            live.priority = clampClaimPriority(value);
            save(store);
            return ok(`Set priority of '${live.name}' to ${live.priority}.`);
          }
          if (sub === 'addmember' || sub === 'removemember' || sub === 'members' || sub === 'flag') {
            const resolveEditable = (claimName: string | undefined):
              { readonly ok: true; readonly store: ClaimStore; readonly live: Claim }
              | { readonly ok: false; readonly error: ReturnType<typeof fail> } => {
              const store = load();
              if (claimName) {
                const live = findClaimByName(store.claims, claimName, ownerKey);
                if (!live) return { ok: false, error: fail(`Claim '${claimName}' not found.`) };
                if (!canEdit(live, sender)) return { ok: false, error: fail('You do not have permission.') };
                return { ok: true, store, live };
              }
              const claim = editableAtFeet(sender) ?? topAt(sender.playerId);
              if (!claim) return { ok: false, error: fail('You are not standing in a claim.') };
              if (!canEdit(claim, sender)) return { ok: false, error: fail('Only the claim owner can do that.') };
              const live = store.claims.find((entry) => entry.id === claim.id);
              if (!live) return { ok: false, error: fail('Claim not found.') };
              return { ok: true, store, live };
            };
            if (sub === 'members') {
              const resolved = resolveEditable(args[1]?.toLowerCase());
              if (!resolved.ok) return resolved.error;
              return ok(`Members: ${resolved.live.members.join(', ') || '(none)'}`);
            }
            if (sub === 'addmember' || sub === 'removemember') {
              const parsed = parseClaimMemberArgs(args.slice(1));
              if (!parsed.ok) {
                return usageError(sub === 'addmember'
                  ? '/claim addmember [name] <player>'
                  : '/claim removemember [name] <player>');
              }
              const resolved = resolveEditable(parsed.claimName);
              if (!resolved.ok) return resolved.error;
              if (sub === 'addmember') {
                if (!resolved.live.members.includes(parsed.player)) resolved.live.members.push(parsed.player);
                save(resolved.store);
                return ok(`Added ${parsed.player} to claim '${resolved.live.name}'.`);
              }
              resolved.live.members = resolved.live.members.filter((member) => member !== parsed.player);
              save(resolved.store);
              return ok(`Removed ${parsed.player} from claim '${resolved.live.name}'.`);
            }
            const parsed = parseClaimFlagArgs(args.slice(1));
            if (!parsed.ok) {
              return usageError(`/claim flag [name] <${CLAIM_FLAGS.join('|')}> <true|false>`);
            }
            const resolved = resolveEditable(parsed.claimName);
            if (!resolved.ok) return resolved.error;
            resolved.live.flags[parsed.flag] = parsed.value;
            save(resolved.store);
            return ok(`Set ${parsed.flag}=${parsed.value} on claim '${resolved.live.name}'.`);
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
