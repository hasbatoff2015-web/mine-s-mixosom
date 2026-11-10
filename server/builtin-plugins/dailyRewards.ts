import type { Plugin, ServerAPI } from '../PluginManager';
import { fail, isConsoleSender, ok, type CommandResult, type CommandSender } from '../commands';
import type { CurrencyPort } from '../economy/currencyPort';
import {
  DAILY_REWARD_MAX_DAYS,
  DAILY_REWARD_SOURCE_TYPE,
  parseDailyRewardSeries,
} from '../economy/dailyReward';
import { MOSCOW_TIME_ZONE, moscowDateKey } from '../economy/moscowCalendar';
import { ECONOMY_MAX_BALANCE, formatMegacoins } from '../services/economy';
import { formatPluginHelp, isHelpRequest, usageError } from '../services/pluginHelp';
import type { BuiltinPluginContext } from './context';

const SWEEP_MS = 10_000;
const MAX_IN_FLIGHT = 4;
const BACKOFF_MS = [30_000, 60_000, 120_000, 300_000] as const;
const PROBE_SOURCE_ID = 'probe:1970-01-01';

const HELP = {
  name: 'dailyreward',
  title: 'Ежедневные награды',
  description: 'Одна награда за календарный день Москвы. Суммы задаются отдельно для этого режима.',
  commands: [
    { usage: '/dailyreward status', description: 'Состояние, backend и серия' },
    { usage: '/dailyreward series', description: 'Показать уровни серии' },
    { usage: '/dailyreward enable', description: 'Включить выплаты', permission: 'dailyreward.manage' },
    { usage: '/dailyreward disable', description: 'Выключить будущие выплаты', permission: 'dailyreward.manage' },
    { usage: '/dailyreward set <день> <сумма>', description: 'Изменить или добавить уровень', permission: 'dailyreward.manage' },
    { usage: '/dailyreward help', description: 'Показать справку' },
  ],
};

export interface DailyRewardsPluginOptions {
  /** Clock for the Moscow date and retry backoff. Defaults to the real clock. */
  readonly now?: () => Date;
  readonly sweepMs?: number;
}

interface FailureState {
  attempts: number;
  nextAt: number;
}

interface ClaimJob {
  readonly playerId: string;
  readonly name: string;
  readonly dateKey: string;
}

interface PendingNotice {
  readonly playerId: string;
  readonly dateKey: string;
  readonly amount: number;
  readonly streakDay: number;
}

type LevelChange =
  | { ok: true; series: number[]; replacedDamage: boolean }
  | { ok: false; error: string };

function claimKey(playerId: string, dateKey: string): string {
  return `${playerId}:${dateKey}`;
}

function rewardMessage(amount: number): string {
  return `🎁 Награда за ежедневный вход: +${formatMegacoins(amount)}.`;
}

function postgresClaim(economy: CurrencyPort): NonNullable<CurrencyPort['claimDailyReward']> | undefined {
  if (economy.backend !== 'postgres') return undefined;
  return economy.claimDailyReward;
}

function withLevel(current: readonly number[] | null, day: number, amount: number): LevelChange {
  if (!Number.isSafeInteger(day) || day < 1 || day > DAILY_REWARD_MAX_DAYS) {
    return { ok: false, error: `День серии — целое число от 1 до ${DAILY_REWARD_MAX_DAYS}.` };
  }
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > ECONOMY_MAX_BALANCE) {
    return { ok: false, error: 'Сумма — целое число от 1 до максимального баланса.' };
  }
  if (current === null) {
    if (day !== 1) {
      return { ok: false, error: 'Серия повреждена. Сначала задайте день 1: /dailyreward set 1 <сумма>.' };
    }
    return { ok: true, series: [amount], replacedDamage: true };
  }
  if (day === current.length + 1) return { ok: true, series: [...current, amount], replacedDamage: false };
  if (day > current.length) {
    return { ok: false, error: `Нельзя пропускать дни. Следующий день серии: ${current.length + 1}.` };
  }
  const series = [...current];
  series[day - 1] = amount;
  return { ok: true, series, replacedDamage: false };
}

export function createDailyRewardsPlugin(
  ctx: BuiltinPluginContext,
  options: DailyRewardsPluginOptions = {},
): Plugin {
  const clock = options.now ?? (() => new Date());
  const sweepMs = options.sweepMs ?? SWEEP_MS;
  let api: ServerAPI | undefined;
  let alive = false;
  let lifecycle = 0;
  let openDate = '';
  const completed = new Set<string>();
  const failures = new Map<string, FailureState>();
  const waiting: ClaimJob[] = [];
  const waitingKeys = new Set<string>();
  const running = new Map<string, object>();
  const pendingNotices = new Map<string, PendingNotice>();
  const deliveredNotices = new Set<string>();
  const damageNotes = new Set<string>();

  const dropWaiting = (): void => {
    waiting.length = 0;
    waitingKeys.clear();
  };

  const enabledFlag = (): boolean => api?.getConfig<boolean>('enabled', false) === true;

  const seriesState = ():
    | { state: 'ready'; series: number[] }
    | { state: 'empty' }
    | { state: 'corrupt' } => {
    const raw = api?.getConfig('seriesJson', '[]');
    if (typeof raw !== 'string') return { state: 'corrupt' };
    const parsed = parseDailyRewardSeries(raw);
    if (!parsed.ok) return { state: 'corrupt' };
    if (parsed.series.length === 0) return { state: 'empty' };
    return { state: 'ready', series: parsed.series };
  };

  const currentSeries = (): readonly number[] | null => {
    const series = seriesState();
    if (series.state === 'corrupt') return null;
    if (series.state === 'empty') return [];
    return series.series;
  };

  const payableSeries = (): readonly number[] | undefined => {
    if (!enabledFlag() || !postgresClaim(ctx.economy)) return undefined;
    const series = seriesState();
    return series.state === 'ready' ? series.series : undefined;
  };

  const prune = (today: string): void => {
    const suffix = `:${today}`;
    for (const key of [...completed]) if (!key.endsWith(suffix)) completed.delete(key);
    for (const key of [...failures.keys()]) if (!key.endsWith(suffix)) failures.delete(key);
    for (const key of [...damageNotes]) if (!key.endsWith(suffix)) damageNotes.delete(key);
    for (const key of [...deliveredNotices]) if (!key.endsWith(suffix)) deliveredNotices.delete(key);
    for (const [key, notice] of [...pendingNotices]) {
      if (notice.dateKey !== today) pendingNotices.delete(key);
    }
    for (let index = waiting.length - 1; index >= 0; index -= 1) {
      const job = waiting[index];
      if (!job || job.dateKey === today) continue;
      waitingKeys.delete(claimKey(job.playerId, job.dateKey));
      waiting.splice(index, 1);
    }
  };

  const noteDate = (today: string): void => {
    if (today === openDate) return;
    openDate = today;
    prune(today);
  };

  const backoffReady = (key: string): boolean => {
    const failure = failures.get(key);
    return !failure || clock().getTime() >= failure.nextAt;
  };

  const rememberFailure = (key: string, reason: string): void => {
    const attempts = (failures.get(key)?.attempts ?? 0) + 1;
    const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? 300_000;
    failures.set(key, { attempts, nextAt: clock().getTime() + delay });
    if (attempts === 1 || attempts % 10 === 0) api?.log(`ежедневная награда отложена (${reason})`);
  };

  const flushNotices = (playerId?: string): void => {
    if (!alive || !api) return;
    const today = moscowDateKey(clock());
    for (const [key, notice] of [...pendingNotices]) {
      if (notice.dateKey !== today) {
        pendingNotices.delete(key);
        continue;
      }
      if (playerId && notice.playerId !== playerId) continue;
      if (deliveredNotices.has(key)) {
        pendingNotices.delete(key);
        continue;
      }
      const player = api.getPlayer(notice.playerId);
      if (!player?.connected) continue;
      player.sendMessage(rewardMessage(notice.amount));
      deliveredNotices.add(key);
      pendingNotices.delete(key);
    }
  };

  const rememberNotice = (
    playerId: string,
    dateKey: string,
    amount: number,
    streakDay: number,
    allowSend: boolean,
  ): void => {
    const key = claimKey(playerId, dateKey);
    if (deliveredNotices.has(key)) return;
    if (allowSend && alive && api) {
      const player = api.getPlayer(playerId);
      if (player?.connected) {
        player.sendMessage(rewardMessage(amount));
        deliveredNotices.add(key);
        pendingNotices.delete(key);
        return;
      }
    }
    pendingNotices.set(key, { playerId, dateKey, amount, streakDay });
  };

  const pump = (): void => {
    if (!alive) {
      dropWaiting();
      return;
    }
    while (running.size < MAX_IN_FLIGHT && waiting.length > 0) {
      const job = waiting.shift();
      if (!job) break;
      const key = claimKey(job.playerId, job.dateKey);
      waitingKeys.delete(key);
      if (completed.has(key) || running.has(key) || !backoffReady(key)) continue;
      if (!payableSeries()) {
        dropWaiting();
        return;
      }
      launch(job);
    }
  };

  const launch = (job: ClaimJob): void => {
    const key = claimKey(job.playerId, job.dateKey);
    const token = {};
    const epoch = lifecycle;
    running.set(key, token);
    const work = (async () => {
      let called = false;
      try {
        await Promise.resolve();
        if (!alive) return;
        const series = payableSeries();
        const port = postgresClaim(ctx.economy);
        if (!series || !port) return;
        called = true;
        const result = await port.call(ctx.economy, {
          playerId: job.playerId,
          displayName: job.name,
          claimDate: job.dateKey,
          series,
        });
        if (!result.ok) {
          rememberFailure(key, result.reason);
          return;
        }
        failures.delete(key);
        completed.add(key);
        if (result.outcome === 'claimed' && result.amount !== null && result.streakDay !== null) {
          const sameLife = alive && epoch === lifecycle;
          rememberNotice(job.playerId, job.dateKey, result.amount, result.streakDay, sameLife);
          if (alive && !sameLife) flushNotices(job.playerId);
          return;
        }
        if ((result.amount === null || result.streakDay === null) && !damageNotes.has(key)) {
          damageNotes.add(key);
          api?.log('ежедневная награда уже есть, но её metadata повреждены');
        }
        if (alive && epoch === lifecycle) flushNotices(job.playerId);
      } catch (error) {
        if (called && !completed.has(key)) rememberFailure(key, 'unavailable');
        api?.log(`ежедневная награда не выполнена (${error instanceof Error ? error.name : 'Error'})`);
      } finally {
        if (running.get(key) === token) running.delete(key);
        pump();
      }
    })();
    ctx.economy.track?.(work);
  };

  const enqueue = (playerId: string, name: string, dateKey: string): void => {
    if (!alive || !payableSeries()) return;
    const key = claimKey(playerId, dateKey);
    if (completed.has(key) || waitingKeys.has(key) || running.has(key) || !backoffReady(key)) return;
    waiting.push({ playerId, name, dateKey });
    waitingKeys.add(key);
    pump();
  };

  const sweep = (): void => {
    if (!alive || !api) return;
    const today = moscowDateKey(clock());
    noteDate(today);
    flushNotices();
    if (!payableSeries()) {
      dropWaiting();
      return;
    }
    for (const player of api.getPlayers()) {
      if (!player.connected) continue;
      enqueue(player.id, player.name, today);
    }
  };

  const canManage = (sender: CommandSender): boolean => {
    if (isConsoleSender(sender)) return true;
    return api?.isOperator(sender.playerId) === true || api?.hasPermission(sender.playerId, 'dailyreward.manage') === true;
  };

  const statusLines = (): string[] => {
    const backend = ctx.economy.backend ?? 'legacy_json';
    const postgres = postgresClaim(ctx.economy) !== undefined;
    const series = seriesState();
    const flag = enabledFlag();
    let readiness = 'готова';
    if (!postgres) readiness = 'недоступно: нужен backend PostgreSQL';
    else if (series.state === 'corrupt') readiness = 'не готова: серия повреждена, выплаты остановлены';
    else if (series.state === 'empty') readiness = 'не готова: серия пуста';
    else if (!flag) readiness = 'выключена';
    const seriesText = series.state === 'ready'
      ? series.series.join(', ')
      : series.state === 'empty' ? 'пусто' : 'повреждена';
    return [
      `Ежедневные награды: ${flag ? 'флаг включён' : 'флаг выключен'}`,
      `Backend: ${backend}`,
      `Режим: ${ctx.serverMode}`,
      `Часовой пояс: ${MOSCOW_TIME_ZONE}`,
      `Серия: ${seriesText}`,
      `Готовность: ${readiness}`,
    ];
  };

  return {
    name: 'daily-rewards',
    version: '1.0.0',
    apiVersion: 1,
    onEnable(next) {
      api = next;
      lifecycle += 1;
      alive = true;
      next.loadConfig({
        enabled: false,
        seriesJson: '[]',
      });
      next.registerEvent('playerJoin', (event) => {
        if (!alive) return;
        const today = moscowDateKey(clock());
        noteDate(today);
        flushNotices(event.playerId);
        enqueue(event.playerId, event.name, today);
      });
      next.scheduleOnce(0, () => sweep());
      next.scheduleRepeating(sweepMs, () => sweep());
      next.registerCommand({
        name: 'dailyreward',
        usage: '/dailyreward help',
        description: 'Ежедневные награды за вход',
        permission: 'player',
        execute: (args, sender) => {
          if (isHelpRequest(args) || args.length === 0) return ok(formatPluginHelp(HELP));
          const sub = args[0]!.toLowerCase();
          if (sub === 'status') return ok(statusLines());
          if (sub === 'series') {
            const series = seriesState();
            if (series.state === 'corrupt') return ok('Серия повреждена и не используется.');
            if (series.state === 'empty') return ok('Серия пуста.');
            return ok(series.series.map((amount, index) => `День ${index + 1}: ${formatMegacoins(amount)}`));
          }
          if (sub === 'enable' || sub === 'disable' || sub === 'set') {
            if (!canManage(sender)) return fail('Недостаточно прав для выполнения этой команды.');
          }
          if (sub === 'disable') {
            next.setConfig('enabled', false);
            dropWaiting();
            return ok('Ежедневные награды выключены. Уже выданные награды сохраняются.');
          }
          if (sub === 'set') {
            if (args.length !== 3) return usageError('/dailyreward set <день> <сумма>');
            const dayRaw = args[1] ?? '';
            const amountRaw = args[2] ?? '';
            if (!/^\d+$/.test(dayRaw) || !/^\d+$/.test(amountRaw)) {
              return usageError('/dailyreward set <день> <сумма>', 'День и сумма должны быть целыми числами.');
            }
            const changed = withLevel(currentSeries(), Number(dayRaw), Number(amountRaw));
            if (!changed.ok) return fail(changed.error);
            const encoded = JSON.stringify(changed.series);
            const checked = parseDailyRewardSeries(encoded);
            if (!checked.ok) return fail(checked.error);
            next.setConfig('seriesJson', encoded);
            const savedAmount = changed.series[Number(dayRaw) - 1];
            if (savedAmount === undefined) return fail('Серия не сохранена.');
            const prefix = changed.replacedDamage ? 'Повреждённая серия заменена. ' : '';
            return ok(`${prefix}День ${Number(dayRaw)}: ${formatMegacoins(savedAmount)}.`);
          }
          if (sub === 'enable') return enableRewards(next);
          return usageError('/dailyreward help');
        },
      });
    },
    onDisable() {
      alive = false;
      lifecycle += 1;
      dropWaiting();
    },
  };

  async function enableRewards(commandApi: ServerAPI): Promise<CommandResult> {
    const series = seriesState();
    if (series.state === 'corrupt') return fail('Серия повреждена. Выплаты не включаются.');
    if (series.state !== 'ready') return fail('Серия пуста. Добавьте хотя бы один день: /dailyreward set 1 <сумма>.');
    if (!postgresClaim(ctx.economy)) {
      return fail('Ежедневные награды доступны только при backend PostgreSQL. JSON не используется.');
    }
    try {
      if (!ctx.economy.hasEconomicSource) return fail('Экономика временно недоступна.');
      await ctx.economy.hasEconomicSource(DAILY_REWARD_SOURCE_TYPE, PROBE_SOURCE_ID);
    } catch {
      return fail('Экономика временно недоступна.');
    }
    commandApi.setConfig('enabled', true);
    sweep();
    return ok('Ежедневные награды включены.');
  }
}
