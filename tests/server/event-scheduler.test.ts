import { describe, expect, it } from 'vitest';
import {
  clockParts,
  dayKey,
  eventTimeline,
  formatDailyTime,
  minutesRemaining,
  nextDailyOccurrence,
  parseDailyTime,
  timezonePolicy,
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

  it('maps the local-time flag to a timezone policy that can grow later', () => {
    expect(timezonePolicy(true)).toBe('server-local');
    expect(timezonePolicy(false)).toBe('utc');
  });

  it('computes the next daily occurrence without going backwards', () => {
    const now = Date.UTC(2026, 8, 19, 18, 0, 0);
    const next = nextDailyOccurrence(now, { hour: 20, minute: 0 }, 'utc');
    expect(dayKey(next, 'utc')).toBe('2026-09-19');
    expect(clockParts(next, 'utc')).toMatchObject({ hour: 20, minute: 0 });
    const after = Date.UTC(2026, 8, 19, 20, 0, 1);
    const tomorrow = nextDailyOccurrence(after, { hour: 20, minute: 0 }, 'utc');
    expect(dayKey(tomorrow, 'utc')).toBe('2026-09-20');
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
