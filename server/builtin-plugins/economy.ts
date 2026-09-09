import type { Plugin } from '../PluginManager';
import { fail, isConsoleSender, ok, type CommandResult } from '../commands';
import {
  ECONOMY_BALT0P_DEFAULT_LIMIT,
  ECONOMY_COMMAND_HISTORY_LIMIT,
  ECONOMY_INITIAL_BALANCE,
  ECONOMY_MAX_BALANCE,
  ECONOMY_PVP_KILL_COOLDOWN_MS,
  formatMegacoinAmount,
  formatMegacoins,
  formatTransactionLine,
} from '../services/economy';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext, PlayerIdentity } from './context';

const HELP = {
  name: 'economy',
  title: 'Экономика',
  description: 'Мегакоины: баланс, переводы, добыча и награды за убийства.',
  commands: [
    { usage: '/balance [player]', description: 'Показать баланс', permission: 'economy.balance' },
    { usage: '/bal [player]', description: 'Алиас /balance', permission: 'economy.balance' },
    { usage: '/pay <player> <amount>', description: 'Перевести Мегакоины', permission: 'economy.pay' },
    { usage: '/baltop', description: 'Топ балансов', permission: 'economy.baltop' },
    { usage: '/transactions', description: 'Последние транзакции', permission: 'economy.transactions' },
    { usage: '/eco give <player> <amount>', description: 'Выдать Мегакоины', permission: 'economy.admin' },
    { usage: '/eco take <player> <amount>', description: 'Снять Мегакоины', permission: 'economy.admin' },
    { usage: '/eco set <player> <amount>', description: 'Установить баланс', permission: 'economy.admin' },
    { usage: '/eco reset <player>', description: 'Сбросить баланс до стартового', permission: 'economy.admin' },
    { usage: '/eco balance <player>', description: 'Баланс игрока (admin)', permission: 'economy.admin' },
    { usage: '/eco transactions <player>', description: 'История игрока (admin)', permission: 'economy.admin' },
  ],
};

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function parseNonNegativeInt(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isIdentity(value: PlayerIdentity | CommandResult): value is PlayerIdentity {
  return 'id' in value && 'connected' in value;
}

export function createEconomyPlugin(ctx: BuiltinPluginContext): Plugin {
  return {
    name: 'economy',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(api) {
      const economy = ctx.economy;
      economy.load();
      api.loadConfig({
        pvpKillCooldownSeconds: ECONOMY_PVP_KILL_COOLDOWN_MS / 1000,
        initialBalance: ECONOMY_INITIAL_BALANCE,
        maxBalance: ECONOMY_MAX_BALANCE,
      });

      const lookup = (idOrName: string) => ctx.lookupPlayer(idOrName);
      const requireTarget = (raw: string | undefined, usage: string): PlayerIdentity | CommandResult => {
        if (!raw) return usageError(usage);
        const found = lookup(raw);
        if (!found) return fail(`Игрок '${raw}' не найден.`);
        economy.rememberName(found.id, found.name);
        return found;
      };

      api.registerEvent('playerJoin', (event) => {
        economy.rememberName(event.playerId, event.name);
      });

      api.registerEvent('blockPlaced', (event) => {
        economy.markPlacedBlock(event.x, event.y, event.z);
      });

      api.registerEvent('blockBroken', (event) => {
        const placed = economy.isPlacedBlock(event.x, event.y, event.z);
        economy.clearPlacedBlock(event.x, event.y, event.z);
        if (!event.playerId) return;
        economy.rewardBlockBreak(event.playerId, event.blockId, { placed, source: 'player' });
      });

      api.registerEvent('entityDeath', (event) => {
        if (event.mobKind) {
          if (event.playerId) economy.rewardMobKill(event.playerId, event.mobKind, event.entityId);
          return;
        }
        const victim = lookup(event.entityId) ?? (event.playerId ? lookup(event.playerId) : undefined);
        const killerId = event.attackerId;
        if (!victim || !killerId || killerId === victim.id) return;
        if (!lookup(killerId)) return;
        const before = economy.getBalance(victim.id);
        const result = economy.rewardPlayerKill(killerId, victim.id, event.entityId);
        if (!result.ok || !result.amount) return;
        api.getPlayer(killerId)?.sendMessage(
          `Вы получили ${formatMegacoins(result.amount)} за убийство ${economy.displayName(victim.id)}.`,
        );
        api.getPlayer(victim.id)?.sendMessage(
          `Вы потеряли ${formatMegacoins(result.amount)} (10% от ${formatMegacoins(before)}).`,
        );
      });

      api.scheduleRepeating(2000, () => economy.persistPlaced());

      api.registerCommand({
        name: 'balance',
        aliases: ['bal', 'money'],
        usage: '/balance [player]',
        description: 'Показать баланс Мегакоинов',
        permission: 'economy.balance',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (args.length === 0) {
            if (isConsoleSender(sender)) return usageError('/balance <player>');
            economy.rememberName(sender.playerId, sender.name);
            return ok(`Баланс: ${formatMegacoins(economy.getBalance(sender.playerId))}`);
          }
          const target = lookup(args[0]!);
          if (!target) return fail(`Игрок '${args[0]}' не найден.`);
          economy.rememberName(target.id, target.name);
          return ok(`Баланс ${target.name}: ${formatMegacoins(economy.getBalance(target.id))}`);
        },
      });

      api.registerCommand({
        name: 'pay',
        usage: '/pay <player> <amount>',
        description: 'Перевести Мегакоины другому игроку',
        permission: 'economy.pay',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (isConsoleSender(sender)) return fail('Консоль не может использовать /pay. Используйте /eco give.');
          const name = args[0];
          const amount = parsePositiveInt(args[1]);
          if (!name || amount === undefined) {
            return usageError('/pay <player> <amount>', 'Сумма должна быть целым положительным числом.');
          }
          const target = lookup(name);
          if (!target) return fail(`Игрок '${name}' не найден.`);
          if (target.id === sender.playerId) return fail('Нельзя перевести Мегакоины самому себе.');
          economy.rememberName(sender.playerId, sender.name);
          economy.rememberName(target.id, target.name);
          const result = economy.transfer(sender.playerId, target.id, amount, 'PLAYER_TRANSFER');
          if (!result.ok) return fail(result.error ?? 'Перевод не выполнен.');
          api.getPlayer(target.id)?.sendMessage(
            `${target.name} получил ${formatMegacoins(amount)} от ${sender.name}.`,
          );
          return ok(`Вы перевели ${target.name} ${formatMegacoins(amount)}.`);
        },
      });

      api.registerCommand({
        name: 'baltop',
        aliases: ['moneytop', 'balancetop'],
        usage: '/baltop',
        description: 'Игроки с наибольшим балансом',
        permission: 'economy.baltop',
        execute: (args) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          const top = economy.getTopBalances(ECONOMY_BALT0P_DEFAULT_LIMIT);
          if (top.length === 0) return ok('Пока никто не имеет Мегакоинов.');
          return ok([
            'Топ балансов:',
            ...top.map((entry, index) => `${index + 1}. ${entry.name} — ${formatMegacoinAmount(entry.balance)}`),
          ]);
        },
      });

      api.registerCommand({
        name: 'transactions',
        aliases: ['tx'],
        usage: '/transactions',
        description: 'Последние операции с Мегакоинами',
        permission: 'economy.transactions',
        execute: (args, sender) => {
          if (isHelpRequest(args)) return ok(formatPluginHelp(HELP));
          if (isConsoleSender(sender)) return usageError('/eco transactions <player>');
          const rows = economy.getTransactionHistory(sender.playerId, ECONOMY_COMMAND_HISTORY_LIMIT);
          if (rows.length === 0) return ok('Транзакций пока нет.');
          return ok([
            'Последние транзакции:',
            ...rows.map((tx) => formatTransactionLine(tx, (id) => economy.displayName(id))),
          ]);
        },
      });

      api.registerCommand({
        name: 'eco',
        aliases: ['economy'],
        usage: '/eco help',
        description: 'Администрирование экономики',
        permission: 'economy.admin',
        execute: (args) => {
          if (isHelpRequest(args) || args.length === 0) return ok(formatPluginHelp(HELP));
          const sub = args[0]!.toLowerCase();
          if (sub === 'give' || sub === 'take' || sub === 'set') {
            const target = requireTarget(args[1], `/eco ${sub} <player> <amount>`);
            if (!isIdentity(target)) return target;
            const amount = sub === 'set' ? parseNonNegativeInt(args[2]) : parsePositiveInt(args[2]);
            if (amount === undefined) {
              return usageError(
                `/eco ${sub} <player> <amount>`,
                sub === 'set'
                  ? 'Сумма должна быть целым неотрицательным числом.'
                  : 'Сумма должна быть целым положительным числом.',
              );
            }
            const result = sub === 'give'
              ? economy.deposit(target.id, amount, 'ADMIN_GIVE')
              : sub === 'take'
                ? economy.withdraw(target.id, amount, 'ADMIN_TAKE')
                : economy.setBalance(target.id, amount, 'ADMIN_SET');
            if (!result.ok) return fail(result.error ?? 'Операция не выполнена.');
            const formatted = formatMegacoins(amount);
            if (sub === 'set') {
              api.getPlayer(target.id)?.sendMessage(`Ваш баланс установлен: ${formatMegacoins(result.balance ?? amount)}.`);
              return ok(`Баланс ${target.name} установлен: ${formatMegacoins(result.balance ?? amount)}.`);
            }
            api.getPlayer(target.id)?.sendMessage(
              sub === 'give'
                ? `Вам выдано ${formatted}.`
                : `С вашего баланса снято ${formatted}.`,
            );
            const verb = sub === 'give' ? 'Выдано' : 'Снято';
            return ok(`${verb} ${target.name} ${formatted}. Новый баланс: ${formatMegacoins(result.balance ?? 0)}.`);
          }
          if (sub === 'reset') {
            const target = requireTarget(args[1], '/eco reset <player>');
            if (!isIdentity(target)) return target;
            const result = economy.resetBalance(target.id, 'ADMIN_RESET');
            if (!result.ok) return fail(result.error ?? 'Сброс не выполнен.');
            api.getPlayer(target.id)?.sendMessage(`Ваш баланс сброшен: ${formatMegacoins(ECONOMY_INITIAL_BALANCE)}.`);
            return ok(`Баланс ${target.name} сброшен: ${formatMegacoins(ECONOMY_INITIAL_BALANCE)}.`);
          }
          if (sub === 'balance') {
            const target = requireTarget(args[1], '/eco balance <player>');
            if (!isIdentity(target)) return target;
            return ok(`Баланс ${target.name}: ${formatMegacoins(economy.getBalance(target.id))}`);
          }
          if (sub === 'transactions') {
            const target = requireTarget(args[1], '/eco transactions <player>');
            if (!isIdentity(target)) return target;
            const rows = economy.getTransactionHistory(target.id, ECONOMY_COMMAND_HISTORY_LIMIT);
            if (rows.length === 0) return ok(`У ${target.name} нет транзакций.`);
            return ok([
              `История ${target.name}:`,
              ...rows.map((tx) => formatTransactionLine(tx, (id) => economy.displayName(id))),
            ]);
          }
          return usageError('/eco help');
        },
      });
    },
    onDisable() {
      ctx.economy.persist();
    },
  };
}
