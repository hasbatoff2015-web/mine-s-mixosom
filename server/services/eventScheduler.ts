export type TimeZonePolicy = 'server-local' | 'utc';

export interface DailyClockParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export interface ParsedDailyTime {
  readonly hour: number;
  readonly minute: number;
}

export interface EventScheduleOffsets {
  readonly warningMinutes: number;
  readonly unlockDelayMinutes: number;
  readonly durationMinutes: number;
}

export interface EventTimeline {
  readonly spawnAt: number;
  readonly warningAt: number;
  readonly unlockAt: number;
  readonly cleanupAt: number;
}

const MINUTES = 60_000;

export function parseDailyTime(raw: string | undefined): ParsedDailyTime | undefined {
  if (!raw) return undefined;
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return { hour, minute };
}

export function formatDailyTime(time: ParsedDailyTime): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

export function clockParts(atMs: number, policy: TimeZonePolicy): DailyClockParts {
  const date = new Date(atMs);
  if (policy === 'utc') {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth(),
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    };
  }
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

export function dayKey(atMs: number, policy: TimeZonePolicy): string {
  const parts = clockParts(atMs, policy);
  const month = String(parts.month + 1).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

export function zonedDateMs(
  parts: Pick<DailyClockParts, 'year' | 'month' | 'day' | 'hour' | 'minute'>,
  policy: TimeZonePolicy,
): number {
  if (policy === 'utc') {
    return Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, 0, 0);
  }
  return new Date(parts.year, parts.month, parts.day, parts.hour, parts.minute, 0, 0).getTime();
}

export function nextDailyOccurrence(
  nowMs: number,
  time: ParsedDailyTime,
  policy: TimeZonePolicy,
): number {
  const parts = clockParts(nowMs, policy);
  const today = zonedDateMs({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: time.hour,
    minute: time.minute,
  }, policy);
  if (today > nowMs) return today;
  const tomorrowBase = zonedDateMs({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 12,
    minute: 0,
  }, policy) + 24 * 60 * MINUTES;
  const tomorrowParts = clockParts(tomorrowBase, policy);
  return zonedDateMs({
    year: tomorrowParts.year,
    month: tomorrowParts.month,
    day: tomorrowParts.day,
    hour: time.hour,
    minute: time.minute,
  }, policy);
}

export function eventTimeline(spawnAt: number, offsets: EventScheduleOffsets): EventTimeline {
  const warning = Math.max(0, offsets.warningMinutes) * MINUTES;
  const unlock = Math.max(0, offsets.unlockDelayMinutes) * MINUTES;
  const duration = Math.max(offsets.unlockDelayMinutes, offsets.durationMinutes) * MINUTES;
  return {
    spawnAt,
    warningAt: spawnAt - warning,
    unlockAt: spawnAt + unlock,
    cleanupAt: spawnAt + duration,
  };
}

export function minutesRemaining(untilMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((untilMs - nowMs) / MINUTES));
}

export function secondsRemaining(untilMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
}

export function timezonePolicy(useServerLocalTime: boolean): TimeZonePolicy {
  return useServerLocalTime ? 'server-local' : 'utc';
}
