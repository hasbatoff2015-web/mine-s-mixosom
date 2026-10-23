import type { Plugin } from '../PluginManager';
import { fail, ok } from '../commands';
import {
  ANNOUNCE_TEXT_MAX,
  DONATION_RANK_DURATION_MS,
  NICK_COLOR_IDS,
  announcementLine,
  formatDurationMs,
  isNickColorId,
  parseDonationRank,
  parseRankTestDuration,
        sanitizeAnnouncementText,
} from '../../shared/donationRanks';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

const HELP = {
  name: 'donate',
  title: 'Донат-привилегии',
  description: 'Временные ранги VIP, PREMIUM, BOSS и TITAN. Срок по умолчанию — 30 дней.',
  commands: [
    { usage: '/donate', description: 'Свой ранг, лимиты и кулдауны' },
    { usage: '/donate info [player]', description: 'Ранг игрока', permission: 'donate.admin' },
    { usage: '/donate grant <player> <vip|premium|boss|titan> [days]', description: 'Выдать ранг на срок', permission: 'donate.admin' },
    { usage: '/donate extend <player> [days]', description: 'Продлить действующий ранг', permission: 'donate.admin' },
    { usage: '/donate revoke <player>', description: 'Снять ранг', permission: 'donate.admin' },
    { usage: '/ec', description: 'Открыть портальный сундук', permission: 'enderchest.use' },
    { usage: '/an <текст>', description: 'Объявление в общий чат', permission: 'announce.use' },
    { usage: '/invsee <player>', description: 'Посмотреть инвентарь', permission: 'invsee.use' },
    { usage: '/invseeop <player>', description: 'Изменить инвентарь', permission: 'operator' },
    { usage: '/nickcolor [color]', description: 'Цвет ника (PREMIUM и выше)' },
  ],
};

function daysToMs(raw: string | undefined): { ok: true; ms: number } | { ok: false; error: string } {
  if (raw === undefined || raw === '') return { ok: true, ms: DONATION_RANK_DURATION_MS };
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    return { ok: false, error: 'Срок указывается целым числом дней от 1 до 3650. По умолчанию 30.' };
  }
  return { ok: true, ms: days * 24 * 60 * 60 * 1000 };
}

export function createDonatePlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'donate',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      const admin = (playerId: string, name: string): boolean => (
        api.isOperator(name)
        || api.isOperator(playerId)
        || api.hasPermission(playerId, 'donate.admin')
        || api.hasPermission(playerId, 'server.admin')
      );

      const describe = (playerId: string, name: string): string[] => {
        const operator = api.isOperator(name) || api.isOperator(playerId);
        const homes = ctx.homes.list(name).length;
        const status = ctx.donation.status(playerId, { operator, homes });
        const until = status.expiresAt
          ? ` до ${new Date(status.expiresAt).toISOString()} (ещё ${formatDurationMs(status.remainingMs)})`
          : '';
        const lines = [
          `Ранг: ${status.rank}${until}`,
          `Дома: ${status.limits.homes.current ?? '—'}/${status.limits.homes.max}`,
          `Приваты: ${status.limits.claims.max}`,
          `Аукцион: ${status.limits.auction.max} активных лотов`,
          `Команды: ${status.commands.filter((command) => command.available).map((command) => command.usage).join(', ') || 'нет'}`,
        ];
        for (const command of status.commands) {
          if (command.available && command.cooldownRemainingMs > 0) {
            lines.push(`${command.usage}: через ${formatDurationMs(command.cooldownRemainingMs)}`);
          }
        }
        for (const kit of status.kits) {
          if (!kit.available && kit.cooldownRemainingMs > 0) {
            lines.push(`/kit ${kit.name}: через ${formatDurationMs(kit.cooldownRemainingMs)}`);
          }
        }
        if (status.nick.canColor) {
          lines.push(`Цвет ника: ${status.nick.color ?? 'обычный'}. Доступны: ${status.nick.choices.join(', ')}`);
        }
        return lines;
      };

      api.registerCommand({
        name: 'donate',
        aliases: ['rank'],
        usage: '/donate',
        description: 'Донат-привилегии',
        permission: 'player',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          const sub = args[0]?.toLowerCase();
          if (!sub) return ok(describe(sender.playerId, sender.name));
          if (sub === 'info' && !args[1]) return ok(describe(sender.playerId, sender.name));
          if (!admin(sender.playerId, sender.name)) return fail('Недостаточно прав для выполнения этой команды.');
          if (sub === 'info') {
            const target = args[1]!;
            return ok(describe(target, target));
          }
          if (sub === 'grant') {
            const rank = parseDonationRank(args[2]);
            if (!args[1] || !rank) return usageError('/donate grant <player> <vip|premium|boss|titan> [days]');
            const duration = daysToMs(args[3]);
            if (!duration.ok) return fail(duration.error);
            const result = ctx.donation.grant(args[1], rank, { durationMs: duration.ms, source: sender.name });
            if (!result.ok) return fail(result.error ?? 'Не удалось выдать ранг.');
            return ok(`Ранг ${rank} выдан игроку ${args[1]} до ${new Date(result.expiresAt ?? 0).toISOString()}.`);
          }
          if (sub === 'extend') {
            if (!args[1]) return usageError('/donate extend <player> [days]');
            const duration = daysToMs(args[2]);
            if (!duration.ok) return fail(duration.error);
            const result = ctx.donation.extend(args[1], { durationMs: duration.ms, source: sender.name });
            if (!result.ok) return fail(result.error ?? 'Не удалось продлить ранг.');
            return ok(`Ранг ${result.rank} продлён до ${new Date(result.expiresAt ?? 0).toISOString()}. Оставшийся срок сохраняется, пока ранг действует.`);
          }
          if (sub === 'revoke') {
            if (!args[1]) return usageError('/donate revoke <player>');
            const result = ctx.donation.revoke(args[1], { source: sender.name });
            return result.ok ? ok(`Ранг игрока ${args[1]} снят.`) : fail(result.error ?? 'Не удалось снять ранг.');
          }
          return usageError('/donate help');
        },
      });

      api.registerCommand({
        name: 'ranktest',
        usage: '/ranktest status <player>',
        description: 'DEV: временный тестовый ранг',
        permission: 'operator',
        execute: (args, sender) => {
          if (!ctx.rankTestEnabled) return fail('Команда /ranktest доступна только на DEV.');
          const operator = api.isOperator(sender.name) || api.isOperator(sender.playerId);
          if (!operator) return fail('Недостаточно прав для выполнения этой команды.');
          const action = args[0]?.toLowerCase();
          if (action === 'status') {
            if (!args[1]) return usageError('/ranktest status <player>');
            return ok(describe(args[1], args[1]));
          }
          if (action === 'clear') {
            if (!args[1]) return usageError('/ranktest clear <player>');
            const result = ctx.donation.revoke(args[1], { source: 'ranktest' });
            return result.ok ? ok(`Тестовый ранг игрока ${args[1]} снят.`) : fail(result.error ?? 'Не удалось снять ранг.');
          }
          if (action === 'set') {
            const rank = parseDonationRank(args[2]);
            const duration = parseRankTestDuration(args[3]);
            if (!args[1] || !rank || !args[3]) return usageError('/ranktest set <player> <vip|premium|boss|titan> <duration>');
            if (!duration.ok) return fail(duration.error);
            const result = ctx.donation.grant(args[1], rank, { durationMs: duration.ms, source: 'ranktest' });
            if (!result.ok) return fail(result.error ?? 'Не удалось выдать ранг.');
            return ok(`Тестовый ранг ${rank} выдан игроку ${args[1]} на ${formatDurationMs(duration.ms)}.`);
          }
          return usageError('/ranktest <set|clear|status> ...');
        },
      });

      api.registerCommand({
        name: 'ec',
        aliases: ['enderchest'],
        usage: '/ec',
        description: 'Открыть свой портальный сундук',
        permission: 'enderchest.use',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          const opened = ctx.openPortalChest(sender.playerId);
          return opened.ok ? ok('Портальный сундук открыт.') : fail(opened.error ?? 'Не удалось открыть сундук.');
        },
      });

      api.registerCommand({
        name: 'an',
        aliases: ['announce'],
        usage: '/an <текст>',
        description: 'Объявление в общий чат',
        permission: 'announce.use',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          const text = sanitizeAnnouncementText(args.join(' '));
          if (!text) return fail(`Введите текст объявления до ${ANNOUNCE_TEXT_MAX} символов.`);
          const operator = api.isOperator(sender.name) || api.isOperator(sender.playerId);
          const style = ctx.donation.nameStyle(sender.playerId, operator);
          const displayName = style?.prefix ? `${style.prefix} ${sender.name}` : sender.name;
          const line = announcementLine(displayName, text);
          if (operator) {
            ctx.broadcastAnnouncement(line);
            return ok('Объявление отправлено.');
          }
          const sent = ctx.donation.consumeIf(sender.playerId, 'announce', 1, () => {
            ctx.broadcastAnnouncement(line);
            return true;
          });
          if (!sent.ok) {
            if (sent.remainingMs) return fail(`Объявление будет доступно через ${formatDurationMs(sent.remainingMs)}.`);
            return fail(sent.error);
          }
          return ok('Объявление отправлено.');
        },
      });

      api.registerCommand({
        name: 'invsee',
        usage: '/invsee <player>',
        description: 'Посмотреть инвентарь игрока',
        permission: 'invsee.use',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          const target = args[0];
          if (!target) return usageError('/invsee <player>');
          const operator = api.isOperator(sender.name) || api.isOperator(sender.playerId);
          const open = (): { ok: boolean; error?: string } => ctx.openPlayerInventory(sender.playerId, target, 'readonly');
          if (operator) {
            const opened = open();
            return opened.ok ? ok(`Инвентарь ${target} открыт только для просмотра.`) : fail(opened.error ?? 'Не удалось открыть инвентарь.');
          }
          let failure = 'Не удалось открыть инвентарь.';
          const used = ctx.donation.consumeIf(sender.playerId, 'invsee', 1, () => {
            const opened = open();
            if (!opened.ok) failure = opened.error ?? failure;
            return opened.ok;
          });
          if (!used.ok) {
            if (used.remainingMs) return fail(`Просмотр инвентаря будет доступен через ${formatDurationMs(used.remainingMs)}.`);
            if (used.error === 'Не удалось выполнить команду.') return fail(failure);
            return fail(used.error);
          }
          return ok(`Инвентарь ${target} открыт только для просмотра.`);
        },
      });

      api.registerCommand({
        name: 'invseeop',
        usage: '/invseeop <player>',
        description: 'Изменить инвентарь игрока',
        permission: 'operator',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          const target = args[0];
          if (!target) return usageError('/invseeop <player>');
          if (!api.isOperator(sender.name) && !api.isOperator(sender.playerId)) return fail('Недостаточно прав для выполнения этой команды.');
          const opened = ctx.openPlayerInventory(sender.playerId, target, 'edit');
          return opened.ok ? ok(`Инвентарь ${target} открыт для изменения.`) : fail(opened.error ?? 'Не удалось открыть инвентарь.');
        },
      });

      api.registerCommand({
        name: 'nickcolor',
        aliases: ['nickcolour'],
        usage: '/nickcolor [color]',
        description: 'Цвет ника',
        permission: 'player',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          const operator = api.isOperator(sender.name) || api.isOperator(sender.playerId);
          if (!operator && !api.hasPermission(sender.playerId, 'nick.color')) {
            return fail('Цвет ника доступен с привилегии PREMIUM.');
          }
          const choice = args[0]?.trim().toLowerCase();
          if (!choice) {
            const current = ctx.donation.nickColor(sender.playerId) ?? 'обычный';
            return ok(`Текущий цвет: ${current}. Доступны: ${NICK_COLOR_IDS.join(', ')}. Сброс: /nickcolor reset`);
          }
          if (choice === 'reset' || choice === 'clear') {
            const result = ctx.donation.setNickColor(sender.playerId, 'reset');
            return result.ok ? ok('Цвет ника сброшен.') : fail(result.error ?? 'Не удалось сохранить цвет.');
          }
          if (!isNickColorId(choice)) return fail(`Неизвестный цвет. Доступны: ${NICK_COLOR_IDS.join(', ')}.`);
          const result = ctx.donation.setNickColor(sender.playerId, choice);
          return result.ok ? ok(`Цвет ника: ${choice}.`) : fail(result.error ?? 'Не удалось сохранить цвет.');
        },
      });
    },
  };
}
