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
            const target = args[1] ?? sender.name;
            const info = ctx.permissions.playerInfo(target);
            return ok([
              `Player: ${info.key}`,
              `OP: ${info.operator ? 'yes' : 'no'}`,
              `Roles: ${info.roles.join(', ')}`,
              `Permissions: ${info.permissions.join(', ') || '(none)'}`,
            ]);
          }
          const admin = api.hasPermission(sender.playerId, 'server.admin') || api.isOperator(sender.name);
          if (!admin) return fail('You do not have permission.');
          if (sub === 'roles') return ok(`Roles: ${ctx.permissions.listRoles().join(', ')}`);
          if (sub === 'grant') {
            if (!args[1] || !args[2]) return usageError('/permissions grant <player> <node>');
            ctx.permissions.grant(args[1], args[2]);
            return ok(`Granted ${args[2]} to ${args[1]}.`);
          }
          if (sub === 'revoke') {
            if (!args[1] || !args[2]) return usageError('/permissions revoke <player> <node>');
            return ctx.permissions.revoke(args[1], args[2])
              ? ok(`Revoked ${args[2]} from ${args[1]}.`)
              : fail(`${args[1]} does not have '${args[2]}'.`);
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
              const result = ctx.permissions.assignRole(args[2], args[3]);
              return result.ok ? ok(`Assigned ${args[3]} to ${args[2]}.`) : fail(result.error ?? 'Failed.');
            }
            if (action === 'unassign') {
              if (!args[2] || !args[3]) return usageError('/permissions role unassign <player> <role>');
              return ctx.permissions.unassignRole(args[2], args[3])
                ? ok(`Removed role ${args[3]} from ${args[2]}.`)
                : fail(`${args[2]} does not have role '${args[3]}'.`);
            }
            return usageError('/permissions role <create|delete|info|addperm|removeperm|assign|unassign> ...');
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
          const added = ctx.permissions.op(args[0]);
          return ok(added ? `Made ${args[0]} a server operator.` : `${args[0]} is already an operator.`);
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
          const result = ctx.permissions.deop(args[0]);
          return result.ok ? ok(`Removed operator from ${args[0]}.`) : fail(result.error ?? 'Failed.');
        },
      });
    },
  };
}
