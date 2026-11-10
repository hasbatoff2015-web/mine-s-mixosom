import { afterEach, describe, expect, it } from 'vitest';
import { ECONOMY_MAX_BALANCE } from '../../server/services/economy';
import {
  DAILY_REWARD_MAX_DAYS,
  amountForStreakDay,
  nextStreakDay,
  parseDailyRewardSeries,
  readStreakDay,
} from '../../server/economy/dailyReward';
import { isMoscowDateKey, moscowDateKey, previousMoscowDateKey } from '../../server/economy/moscowCalendar';

describe('Moscow calendar', () => {
  const previousTz = process.env.TZ;

  afterEach(() => {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  it('uses Europe/Moscow at midnight instead of the UTC date', () => {
    process.env.TZ = 'Pacific/Kiritimati';
    const before = new Date('2026-11-09T20:59:59.999Z');
    const midnight = new Date('2026-11-09T21:00:00.000Z');
    expect(before.toISOString().slice(0, 10)).toBe('2026-11-09');
    expect(midnight.toISOString().slice(0, 10)).toBe('2026-11-09');
    expect(moscowDateKey(before)).toBe('2026-11-09');
    expect(moscowDateKey(midnight)).toBe('2026-11-10');
    expect(previousMoscowDateKey(moscowDateKey(midnight))).toBe('2026-11-09');
  });

  it('crosses a month, a year, and both February shapes', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(moscowDateKey(new Date('2026-03-31T20:59:59.000Z'))).toBe('2026-03-31');
    expect(moscowDateKey(new Date('2026-03-31T21:00:00.000Z'))).toBe('2026-04-01');
    expect(previousMoscowDateKey('2026-04-01')).toBe('2026-03-31');

    expect(moscowDateKey(new Date('2025-12-31T20:59:59.000Z'))).toBe('2025-12-31');
    expect(moscowDateKey(new Date('2025-12-31T21:00:00.000Z'))).toBe('2026-01-01');
    expect(previousMoscowDateKey('2026-01-01')).toBe('2025-12-31');

    expect(moscowDateKey(new Date('2026-02-28T21:00:00.000Z'))).toBe('2026-03-01');
    expect(previousMoscowDateKey('2026-03-01')).toBe('2026-02-28');
    expect(isMoscowDateKey('2026-02-29')).toBe(false);

    expect(moscowDateKey(new Date('2024-02-28T21:00:00.000Z'))).toBe('2024-02-29');
    expect(moscowDateKey(new Date('2024-02-29T21:00:00.000Z'))).toBe('2024-03-01');
    expect(previousMoscowDateKey('2024-03-01')).toBe('2024-02-29');
    expect(previousMoscowDateKey('2024-02-29')).toBe('2024-02-28');
  });

  it('rejects dates that are not a real civil day', () => {
    expect(isMoscowDateKey('2026-02-31')).toBe(false);
    expect(isMoscowDateKey('2026-13-01')).toBe(false);
    expect(isMoscowDateKey('2026-00-10')).toBe(false);
    expect(isMoscowDateKey('10.11.2026')).toBe(false);
    expect(() => previousMoscowDateKey('2026-02-31')).toThrow(/invalid moscow date/);
    expect(() => moscowDateKey(new Date(Number.NaN))).toThrow(/invalid instant/);
  });
});

describe('daily reward series', () => {
  it('accepts an empty array and a list of safe positive integers', () => {
    expect(parseDailyRewardSeries('[]')).toEqual({ ok: true, series: [] });
    expect(parseDailyRewardSeries('[50, 75, 100]')).toEqual({ ok: true, series: [50, 75, 100] });
    expect(parseDailyRewardSeries(`[${ECONOMY_MAX_BALANCE}]`)).toEqual({ ok: true, series: [ECONOMY_MAX_BALANCE] });
  });

  it('does not repair fractions, gaps in the JSON, or values past the balance cap', () => {
    for (const raw of ['', '50', '{"day":1}', '[0]', '[-5]', '[1.5]', '["50"]', '[true]', `[${ECONOMY_MAX_BALANCE + 1}]`, 'not-json']) {
      expect(parseDailyRewardSeries(raw).ok).toBe(false);
    }
    const tooLong = JSON.stringify(Array.from({ length: DAILY_REWARD_MAX_DAYS + 1 }, () => 1));
    expect(parseDailyRewardSeries(tooLong).ok).toBe(false);
    expect(parseDailyRewardSeries([50] as unknown).ok).toBe(false);
  });

  it('advances a trustworthy streak and restarts when metadata is damaged', () => {
    expect(nextStreakDay(null, '2026-11-09')).toEqual({ streakDay: 1, restarted: false });
    expect(nextStreakDay({ metadata: { claimDate: '2026-11-09', streakDay: 3 } }, '2026-11-09')).toEqual({
      streakDay: 4,
      restarted: false,
    });
    expect(nextStreakDay({ metadata: {} }, '2026-11-09')).toEqual({ streakDay: 1, restarted: true });
    expect(nextStreakDay({ metadata: { claimDate: '2026-11-08', streakDay: 3 } }, '2026-11-09')).toEqual({
      streakDay: 1,
      restarted: true,
    });
    expect(readStreakDay({ claimDate: '2026-11-10', streakDay: 3 }, '2026-11-10')).toBe(3);
    expect(readStreakDay({ claimDate: '2026-11-10' }, '2026-11-10')).toBeNull();
  });

  it('keeps paying the last configured level after the series ends', () => {
    expect(amountForStreakDay([50, 75], 1)).toBe(50);
    expect(amountForStreakDay([50, 75], 2)).toBe(75);
    expect(amountForStreakDay([50, 75], 9)).toBe(75);
  });
});
