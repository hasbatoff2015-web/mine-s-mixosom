import { ECONOMY_MAX_BALANCE } from '../services/economy';
import { EconomyValidationError } from './errors';

export const DAILY_REWARD_SOURCE_TYPE = 'DAILY_REWARD';
export const DAILY_REWARD_REASON = 'DAILY_REWARD';
export const DAILY_REWARD_MAX_DAYS = 30;

const SERIES_ARRAY = 'Серия должна быть JSON-массивом целых чисел.';
const SERIES_ENTRY = 'Каждый день серии — целое число от 1 до максимального баланса.';

export function dailyRewardSourceId(playerId: string, claimDate: string): string {
  return `${playerId}:${claimDate}`;
}

/**
 * Accepts only a JSON array of safe positive integers.
 * An empty array is valid and cannot be enabled. Corrupt text is not rewritten.
 */
export function parseDailyRewardSeries(
  raw: unknown,
  maxBalance = ECONOMY_MAX_BALANCE,
): { ok: true; series: number[] } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: SERIES_ARRAY };
  const text = raw.trim();
  if (!text.startsWith('[')) return { ok: false, error: SERIES_ARRAY };
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: 'Серия повреждена и не читается.' };
  }
  if (!Array.isArray(value)) return { ok: false, error: SERIES_ARRAY };
  if (value.length > DAILY_REWARD_MAX_DAYS) {
    return { ok: false, error: `В серии не больше ${DAILY_REWARD_MAX_DAYS} дней.` };
  }
  const series: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 1 || entry > maxBalance) {
      return { ok: false, error: SERIES_ENTRY };
    }
    series.push(entry);
  }
  return { ok: true, series };
}

/** Service-side check. A bad series throws before a transaction starts. */
export function requireDailyRewardSeries(series: readonly number[], maxBalance = ECONOMY_MAX_BALANCE): number[] {
  let encoded: string;
  try {
    encoded = JSON.stringify([...series]);
  } catch {
    throw new EconomyValidationError('daily reward series is invalid');
  }
  const parsed = parseDailyRewardSeries(encoded, maxBalance);
  if (!parsed.ok || parsed.series.length === 0 || parsed.series.length !== series.length) {
    throw new EconomyValidationError('daily reward series is invalid');
  }
  for (let index = 0; index < series.length; index += 1) {
    if (parsed.series[index] !== series[index]) throw new EconomyValidationError('daily reward series is invalid');
  }
  return parsed.series;
}

export function readStreakDay(
  metadata: Readonly<Record<string, unknown>>,
  claimDate: string,
): number | null {
  if (metadata.claimDate !== claimDate) return null;
  const day = metadata.streakDay;
  if (typeof day !== 'number' || !Number.isSafeInteger(day) || day < 1) return null;
  return day;
}

/**
 * Missing or damaged metadata for a real previous payout restarts at day 1.
 * No previous payout is also day 1, without the damage flag.
 */
export function nextStreakDay(
  previous: { readonly metadata: Readonly<Record<string, unknown>> } | null,
  previousDate: string,
): { readonly streakDay: number; readonly restarted: boolean } {
  if (!previous) return { streakDay: 1, restarted: false };
  const stored = readStreakDay(previous.metadata, previousDate);
  if (stored === null) return { streakDay: 1, restarted: true };
  const next = stored + 1;
  if (!Number.isSafeInteger(next)) return { streakDay: 1, restarted: true };
  return { streakDay: next, restarted: false };
}

/** Days past the last configured level keep that level's amount. */
export function amountForStreakDay(series: readonly number[], streakDay: number): number {
  if (series.length === 0 || !Number.isSafeInteger(streakDay) || streakDay < 1) {
    throw new EconomyValidationError('daily reward series is invalid');
  }
  const index = Math.min(streakDay, series.length) - 1;
  const amount = series[index];
  if (amount === undefined) throw new EconomyValidationError('daily reward series is invalid');
  return amount;
}

export type DailyRewardPortResult =
  | {
    readonly ok: true;
    readonly outcome: 'claimed' | 'already_claimed';
    readonly amount: number | null;
    readonly streakDay: number | null;
    readonly claimDate: string;
    readonly balance: number;
  }
  | {
    readonly ok: false;
    readonly reason: 'balance_limit' | 'unavailable' | 'rejected';
  };
