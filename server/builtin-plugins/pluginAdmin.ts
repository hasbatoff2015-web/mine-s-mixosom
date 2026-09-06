import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'plugins',
  title: 'Plugins',
  description: 'List, inspect, enable, disable, and reload server plugins.',
  commands: [
    { usage: '/plugins help', description: 'Show this help' },
    { usage: '/plugins list', description: 'List loaded plugins', permission: 'plugins.manage' },
    { usage: '/plugins info <plugin>', description: 'Show plugin status', permission: 'plugins.manage' },
    { usage: '/plugins enable <plugin>', description: 'Enable a disabled plugin', permission: 'plugins.manage' },
    { usage: '/plugins disable <plugin>', description: 'Disable a plugin', permission: 'plugins.manage' },
    { usage: '/plugins reload <plugin>', description: 'Reload plugin lifecycle', permission: 'plugins.manage' },
  ],
};

export function createPluginAdminPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'plugin-admin',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      const tell = (playerId: string, text: string) => {
        api.getPlayer(playerId)?.sendMessage(text);
      };
      api.registerCommand({
        name: 'plugins',
        aliases: ['pl'],
        usage: '/plugins [list|info|enable|disable|reload]',
        description: 'Administer server plugins',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (!api.hasPermission(sender.playerId, 'plugins.manage') && !api.isOperator(sender.name)) {
            return fail('You do not have permission.');
          }
          const sub = (args[0] ?? 'list').toLowerCase();
          if (sub === 'list') {
            const lines = ctx.plugins.recordsView().map((record) => (
              `${record.plugin.name} v${record.plugin.version ?? '?'} [${record.phase}]`
            ));
            return ok(lines.length > 0 ? ['Plugins:', ...lines] : ['No plugins loaded.']);
          }
          const target = args[1];
          if (sub === 'info') {
            if (!target) return usageError('/plugins info <plugin>');
            const record = ctx.plugins.find(target);
            if (!record) return fail(`Plugin '${target}' not found.`);
            return ok([
              `Plugin: ${record.plugin.name}`,
              `Version: ${record.plugin.version ?? 'unknown'}`,
              `API: ${record.plugin.apiVersion ?? 'current'}`,
              `Phase: ${record.phase}`,
              `Source: ${record.source ?? 'builtin'}`,
              record.error ? `Error: ${record.error}` : 'Error: none',
            ]);
          }
          if (sub === 'enable') {
            if (!target) return usageError('/plugins enable <plugin>');
            if (target.toLowerCase() === 'plugin-admin') return fail('Cannot change plugin-admin while it is handling commands.');
            void ctx.plugins.enable(target).then((enabled) => {
              tell(sender.playerId, enabled ? `Enabled ${target}.` : `Could not enable '${target}'.`);
            });
            return ok(`Enabling ${target}...`);
          }
          if (sub === 'disable') {
            if (!target) return usageError('/plugins disable <plugin>');
            if (target.toLowerCase() === 'plugin-admin') return fail('Cannot disable plugin-admin from itself.');
            void ctx.plugins.disable(target).then(() => {
              tell(sender.playerId, `Disabled ${target}.`);
            });
            return ok(`Disabling ${target}...`);
          }
          if (sub === 'reload') {
            if (!target) return usageError('/plugins reload <plugin>');
            if (target.toLowerCase() === 'plugin-admin') return fail('Cannot reload plugin-admin from itself.');
            void ctx.plugins.reload(target).then((result) => {
              tell(sender.playerId, result.message);
            });
            return ok(`Reloading ${target}...`);
          }
          return usageError('/plugins help');
        },
      });
    },
  };
}
