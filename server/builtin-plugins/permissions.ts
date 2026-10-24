import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'permissions',
  title: 'Permissions',
  description: 'Roles, permission nodes, and operators.',
  commands: [
    { usage: '/permissions help', description: 'Show this help' },
    { usage: '/permissions info [player]', description: 'Show roles and permissions', permission: 'player' },
    { usage: '/permissions roles', description: 'List roles', permission: 'server.admin' },
    { usage: '/permissions grant <player> <node>', description: 'Grant a permission node', permission: 'server.admin' },
    { usage: '/permissions revoke <player> <node>', description: 'Revoke a permission node', permission: 'server.admin' },
    { usage: '/permissions role create <name>', description: 'Create a role', permission: 'server.admin' },
    { usage: '/permissions role delete <name>', description: 'Delete a role', permission: 'server.admin' },
    { usage: '/permissions role info <name>', description: 'Show role permissions', permission: 'server.admin' },
    { usage: '/permissions role addperm <role> <node>', description: 'Add a node to a role', permission: 'server.admin' },
    { usage: '/permissions role removeperm <role> <node>', description: 'Remove a node from a role', permission: 'server.admin' },
    { usage: '/permissions role assign <player> <role>', description: 'Assign a role', permission: 'server.admin' },
    { usage: '/permissions role unassign <player> <role>', description: 'Unassign a role', permission: 'server.admin' },
    { usage: '/op <player>', description: 'Grant operator (all permissions)', permission: 'operator' },
    { usage: '/deop <player>', description: 'Revoke operator', permission: 'operator' },
  ],
};

export function createPermissionsPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'permissions',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      api.registerCommand({
        name: 'permissions',
        aliases: ['perms', 'perm'],
        usage: '/permissions help',
        description: 'Permission and role administration',
        execute: (args, sender) => {
          if (isHelpRequest(args) || args.length === 0) return ok(formatPluginHelp(HELP));
          const sub = args[0]!.toLowerCase();
          if (sub === 'info') {
            const target = args[1] ? ctx.resolvePermissionSubject(args[1]) : { ok: true as const, playerId: sender.playerId, name: sender.name };
            if (!target.ok) return fail(target.error);
            if (!target.playerId || target.playerId === 'console') return fail('Unknown player.');
            const info = ctx.permissions.playerInfo(target.playerId);
            const legacy = ctx.permissions.legacyInfo(target.name);
            return ok([
              `Player: ${target.name}`,
              `Id: ${target.playerId}`,
              `OP: ${info.operator ? 'yes' : 'no'}`,
              `Roles: ${info.roles.join(', ')}`,
              `Permissions: ${info.permissions.join(', ') || '(none)'}`,
              ...(legacy ? ['Legacy nickname entry: inactive'] : []),
            ]);
          }
const admin = api.hasPermission(sender.playerId, 'server.admin') || api.isOperator(sender.playerId);
          if (!admin) return fail('Недостаточно прав для выполнения этой команды.');
          if (sub === 'roles') return ok(`Roles: ${ctx.permissions.listRoles().join(', ')}`);
          if (sub === 'grant') {
            if (!args[1] || !args[2]) return usageError('/permissions grant <player> <node>');
            const target = ctx.resolvePermissionSubject(args[1]);
            if (!target.ok) return fail(target.error);
            if (!ctx.permissions.grant(target.playerId, args[2])) return fail('Player id is required.');
            return ok(`Granted ${args[2]} to ${target.name}.`);
          }
          if (sub === 'revoke') {
            if (!args[1] || !args[2]) return usageError('/permissions revoke <player> <node>');
            const target = ctx.resolvePermissionSubject(args[1]);
            if (!target.ok) return fail(target.error);
            return ctx.permissions.revoke(target.playerId, args[2])
              ? ok(`Revoked ${args[2]} from ${target.name}.`)
              : fail(`${target.name} does not have '${args[2]}'.`);
          }
          if (sub === 'role') {
            const action = args[1]?.toLowerCase();
            if (action === 'create') {
              if (!args[2]) return usageError('/permissions role create <name>');
              const result = ctx.permissions.createRole(args[2]);
              return result.ok ? ok(`Created role ${args[2]}.`) : fail(result.error ?? 'Failed.');
            }
            if (action === 'delete') {
              if (!args[2]) return usageError('/permissions role delete <name>');
              const result = ctx.permissions.deleteRole(args[2]);
              return result.ok ? ok(`Deleted role ${args[2]}.`) : fail(result.error ?? 'Failed.');
            }
            if (action === 'info') {
              if (!args[2]) return usageError('/permissions role info <name>');
              if (!ctx.permissions.listRoles().includes(args[2].toLowerCase())) {
                return fail(`Role '${args[2]}' not found.`);
              }
              const nodes = ctx.permissions.rolePermissions(args[2]);
              return ok([`Role ${args[2]}`, `Permissions: ${nodes.join(', ') || '(none)'}`]);
            }
            if (action === 'addperm') {
              if (!args[2] || !args[3]) return usageError('/permissions role addperm <role> <node>');
              const result = ctx.permissions.addRolePermission(args[2], args[3]);
              return result.ok ? ok(`Added ${args[3]} to ${args[2]}.`) : fail(result.error ?? 'Failed.');
            }
            if (action === 'removeperm') {
              if (!args[2] || !args[3]) return usageError('/permissions role removeperm <role> <node>');
              const result = ctx.permissions.removeRolePermission(args[2], args[3]);
              return result.ok ? ok(`Removed ${args[3]} from ${args[2]}.`) : fail(result.error ?? 'Failed.');
            }
            if (action === 'assign') {
              if (!args[2] || !args[3]) return usageError('/permissions role assign <player> <role>');
              const target = ctx.resolvePermissionSubject(args[2]);
              if (!target.ok) return fail(target.error);
              const result = ctx.permissions.assignRole(target.playerId, args[3]);
              return result.ok ? ok(`Assigned ${args[3]} to ${target.name}.`) : fail(result.error ?? 'Failed.');
            }
            if (action === 'unassign') {
              if (!args[2] || !args[3]) return usageError('/permissions role unassign <player> <role>');
              const target = ctx.resolvePermissionSubject(args[2]);
              if (!target.ok) return fail(target.error);
              return ctx.permissions.unassignRole(target.playerId, args[3])
                ? ok(`Removed role ${args[3]} from ${target.name}.`)
                : fail(`${target.name} does not have role '${args[3]}'.`);
            }
            return usageError('/permissions role <create|delete|info|addperm|removeperm|assign|unassign> ...');
          }
          if (sub === 'migrate') {
            if (!args[1] || !args[2]) return usageError('/permissions migrate <legacy-name> <playerId>');
            const playerId = args[2];
            const confirmed = ctx.resolvePermissionSubject(playerId);
            if (!confirmed.ok || confirmed.playerId !== playerId.trim().toLowerCase()) {
              return fail('Player id is required.');
            }
            const result = ctx.permissions.migrateLegacy(args[1], confirmed.playerId);
            return result.ok
              ? ok(`Migrated legacy entry '${args[1]}' to ${confirmed.playerId}.`)
              : fail(result.error ?? 'Failed.');
          }
          return usageError('/permissions help');
        },
      });
      api.registerCommand({
        name: 'op',
        usage: '/op <player>',
        description: 'Grant operator (all permissions)',
        permission: 'operator',
        execute: (args) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (!args[0]) return usageError('/op <player>');
          const target = ctx.resolvePermissionSubject(args[0]);
          if (!target.ok) return fail(target.error);
          const added = ctx.permissions.op(target.playerId);
          return ok(added
            ? `Made ${target.name} a server operator.`
            : `${target.name} is already an operator.`);
        },
      });
      api.registerCommand({
        name: 'deop',
        usage: '/deop <player>',
        description: 'Revoke operator',
        permission: 'operator',
        execute: (args) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (!args[0]) return usageError('/deop <player>');
          const target = ctx.resolvePermissionSubject(args[0]);
          if (!target.ok) return fail(target.error);
          const result = ctx.permissions.deop(target.playerId);
          return result.ok ? ok(`Removed operator from ${target.name}.`) : fail(result.error ?? 'Failed.');
        },
      });
    },
  };
}
