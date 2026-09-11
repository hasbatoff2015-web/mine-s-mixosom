import type { Plugin } from '../PluginManager';
import { fail, isConsoleSender, ok } from '../commands';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { ClanView } from '../services/clan';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'clan',
  title: 'Кланы',
  description: 'Кланы Мегакоинов: рейтинг, приглашения и заявки.',
  commands: [
    { usage: '/clans', description: 'Рейтинг кланов', permission: 'clan.list' },
    { usage: '/clan create', description: 'Создать клан за 10 000 Мегакоинов', permission: 'clan.create' },
    { usage: '/clan delete', description: 'Удалить свой клан', permission: 'clan.delete' },
    { usage: '/clan add', description: 'Пригласить онлайн-игрока', permission: 'clan.add' },
    { usage: '/clan accept', description: 'Принять приглашение', permission: 'clan.accept' },
    { usage: '/clan leave', description: 'Покинуть клан', permission: 'clan.leave' },
    { usage: '/clan makeleader', description: 'Передать лидерство', permission: 'clan.makeleader' },
    { usage: '/clan kick <ник>', description: 'Исключить участника', permission: 'clan.kick' },
  ],
};

export function createClanPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'clan',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      ctx.clan.load();
      api.loadConfig({
        createCost: 10_000,
        maxMembers: 20,
        inviteHours: 24,
        requestHours: 24,
      });

      api.registerCommand({
        name: 'clans',
        usage: '/clans',
        description: 'Рейтинг кланов',
        permission: 'clan.list',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (isConsoleSender(sender)) return fail('Консоль не может открыть кланы.');
          if (args.length > 0) return usageError('/clans');
          ctx.openClan(sender.playerId, 'ranking');
          return ok('Открыт рейтинг кланов.');
        },
      });

      api.registerCommand({
        name: 'clan',
        usage: '/clan <create|delete|add|accept|leave|makeleader|kick>',
        description: 'Управление кланом',
        permission: 'clan.use',
        execute: (args, sender) => {
          if (isHelpRequest(args) || args.length === 0) return ok(formatPluginHelp(HELP));
          if (isConsoleSender(sender)) return fail('Консоль не может управлять кланом.');
          const sub = args[0]?.toLowerCase();
          const need = (node: string): boolean => api.hasPermission(sender.playerId, node) || api.isOperator(sender.playerId);
          const open = (view: ClanView, extra?: string): ReturnType<typeof ok> | ReturnType<typeof fail> => {
            const result = ctx.openClan(sender.playerId, view, extra);
            if (result && !result.ok) return fail(result.error ?? 'Не удалось открыть меню клана.');
            return ok('Открыто меню клана.');
          };
          if (sub === 'create') {
            if (!need('clan.create')) return fail('You do not have permission.');
            return open('create');
          }
          if (sub === 'delete') {
            if (!need('clan.delete')) return fail('You do not have permission.');
            return open('delete');
          }
          if (sub === 'add') {
            if (!need('clan.add')) return fail('You do not have permission.');
            return open('add');
          }
          if (sub === 'accept') {
            if (!need('clan.accept')) return fail('You do not have permission.');
            return open('accept');
          }
          if (sub === 'leave') {
            if (!need('clan.leave')) return fail('You do not have permission.');
            return open('leave');
          }
          if (sub === 'makeleader') {
            if (!need('clan.makeleader')) return fail('You do not have permission.');
            return open('makeleader');
          }
          if (sub === 'kick') {
            if (!need('clan.kick')) return fail('You do not have permission.');
            const nick = args.slice(1).join(' ').trim();
            if (!nick) return usageError('/clan kick <ник>');
            const target = ctx.lookupPlayer(nick);
            if (!target) return fail(`Игрок '${nick}' не найден.`);
            return open('kick', target.id);
          }
          return usageError('/clan <create|delete|add|accept|leave|makeleader|kick>');
        },
      });
    },
    onDisable() {
      ctx.clan.persist();
    },
  };
}
