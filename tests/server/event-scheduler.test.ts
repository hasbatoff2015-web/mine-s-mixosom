import { describe, expect, it } from 'vitest';
import {
  clockParts,
  dayKey,
  decideDailySpawn,
  eventTimeline,
  formatDailyTime,
  minutesRemaining,
  MOSCOW_TIME_ZONE,
  nextDailyOccurrence,
  normalizeTimeZone,
  parseDailyTime,
  timezonePolicy,
  zonedDateMs,
} from '../../server/services/eventScheduler';

describe('event scheduler', () => {
  it('parses HH:MM and rejects invalid times', () => {
    expect(parseDailyTime('20:00')).toEqual({ hour: 20, minute: 0 });
    expect(parseDailyTime('7:05')).toEqual({ hour: 7, minute: 5 });
    expect(formatDailyTime({ hour: 7, minute: 5 })).toBe('07:05');
    expect(parseDailyTime('24:00')).toBeUndefined();
    expect(parseDailyTime('20:60')).toBeUndefined();
    expect(parseDailyTime('night')).toBeUndefined();
  });

  it('rejects an invalid IANA zone by falling back to Europe/Moscow', () => {
    expect(normalizeTimeZone('Not/AZone')).toBe(MOSCOW_TIME_ZONE);
    expect(normalizeTimeZone('utc')).toBe('UTC');
    expect(normalizeTimeZone('UTC')).toBe('UTC');
    expect(normalizeTimeZone('Europe/Moscow')).toBe(MOSCOW_TIME_ZONE);
    expect(timezonePolicy(true)).toBe(MOSCOW_TIME_ZONE);
    expect(timezonePolicy(false)).toBe('UTC');
  });

  it('treats 20:00 Europe/Moscow as 17:00 UTC', () => {
    const utc = Date.UTC(2026, 8, 19, 17, 0, 0);
    expect(clockParts(utc, MOSCOW_TIME_ZONE)).toMatchObject({
      year: 2026, month: 8, day: 19, hour: 20, minute: 0,
    });
    expect(zonedDateMs({ year: 2026, month: 8, day: 19, hour: 20, minute: 0 }, MOSCOW_TIME_ZONE)).toBe(utc);
    expect(dayKey(utc, MOSCOW_TIME_ZONE)).toBe('2026-09-19');
  });

  it('computes the next daily occurrence without going backwards', () => {
    const now = Date.UTC(2026, 8, 19, 18, 0, 0);
    const next = nextDailyOccurrence(now, { hour: 20, minute: 0 }, 'UTC');
    expect(dayKey(next, 'UTC')).toBe('2026-09-19');
    expect(clockParts(next, 'UTC')).toMatchObject({ hour: 20, minute: 0 });
    const after = Date.UTC(2026, 8, 19, 20, 0, 1);
    const tomorrow = nextDailyOccurrence(after, { hour: 20, minute: 0 }, 'UTC');
    expect(dayKey(tomorrow, 'UTC')).toBe('2026-09-20');
  });

  it('catches up inside the event window and misses after cleanup time', () => {
    const time = { hour: 20, minute: 0 };
    const catchup = decideDailySpawn(Date.UTC(2026, 8, 19, 20, 2, 0), time, 'UTC', 120);
    expect(catchup.kind).toBe('catchup');
    expect(catchup.spawnAt).toBe(Date.UTC(2026, 8, 19, 20, 0, 0));

    const missed = decideDailySpawn(Date.UTC(2026, 8, 19, 22, 1, 0), time, 'UTC', 120);
    expect(missed.kind).toBe('miss');
    expect(dayKey(missed.spawnAt, 'UTC')).toBe('2026-09-20');

    const already = decideDailySpawn(Date.UTC(2026, 8, 19, 20, 2, 0), time, 'UTC', 120, '2026-09-19');
    expect(already.kind).toBe('miss');

    const moscowCatchup = decideDailySpawn(
      Date.UTC(2026, 8, 19, 17, 2, 0),
      { hour: 20, minute: 0 },
      MOSCOW_TIME_ZONE,
      120,
    );
    expect(moscowCatchup.kind).toBe('catchup');
    expect(moscowCatchup.spawnAt).toBe(Date.UTC(2026, 8, 19, 17, 0, 0));

    const moscowMiss = decideDailySpawn(
      Date.UTC(2026, 8, 19, 19, 1, 0),
      { hour: 20, minute: 0 },
      MOSCOW_TIME_ZONE,
      120,
    );
    expect(moscowMiss.kind).toBe('miss');
    expect(dayKey(moscowMiss.spawnAt, MOSCOW_TIME_ZONE)).toBe('2026-09-20');
  });

  it('builds warning / unlock / cleanup timestamps from spawn', () => {
    const spawnAt = Date.UTC(2026, 8, 19, 20, 0, 0);
    const timeline = eventTimeline(spawnAt, {
      warningMinutes: 15,
      unlockDelayMinutes: 5,
      durationMinutes: 120,
    });
    expect(timeline.warningAt).toBe(spawnAt - 15 * 60_000);
    expect(timeline.unlockAt).toBe(spawnAt + 5 * 60_000);
    expect(timeline.cleanupAt).toBe(spawnAt + 120 * 60_000);
    expect(minutesRemaining(timeline.unlockAt, spawnAt)).toBe(5);
  });
});
