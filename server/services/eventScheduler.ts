export const MOSCOW_TIME_ZONE = 'Europe/Moscow';

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

export type DailySpawnDecision =
  | { readonly kind: 'future'; readonly spawnAt: number }
  | { readonly kind: 'catchup'; readonly spawnAt: number }
  | { readonly kind: 'miss'; readonly spawnAt: number };

const MINUTES = 60_000;

const PARTS_FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: MOSCOW_TIME_ZONE,
  calendar: 'gregory',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};

const ZONE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const existing = ZONE_FORMATTERS.get(timeZone);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat('en-US', { ...PARTS_FORMAT, timeZone });
  ZONE_FORMATTERS.set(timeZone, formatter);
  return formatter;
}

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

export function normalizeTimeZone(raw: string | undefined): string {
  const value = (raw ?? MOSCOW_TIME_ZONE).trim();
  if (!value) return MOSCOW_TIME_ZONE;
  if (value === 'utc' || value === 'UTC') return 'UTC';
  try {
    formatterFor(value);
    return value;
  } catch {
    return MOSCOW_TIME_ZONE;
  }
}

export function clockParts(atMs: number, timeZone: string): DailyClockParts {
  const zone = normalizeTimeZone(timeZone);
  if (zone === 'UTC') {
    const date = new Date(atMs);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth(),
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    };
  }
  const formatter = formatterFor(zone);
  const named: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatter.formatToParts(new Date(atMs))) {
    named[part.type] = part.value;
  }
  return {
    year: Number(named.year),
    month: Number(named.month) - 1,
    day: Number(named.day),
    hour: Number(named.hour),
    minute: Number(named.minute),
    second: Number(named.second),
  };
}

export function dayKey(atMs: number, timeZone: string): string {
  const parts = clockParts(atMs, timeZone);
  const month = String(parts.month + 1).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

function offsetMsAt(atMs: number, timeZone: string): number {
  const parts = clockParts(atMs, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second, 0);
  return asUtc - atMs;
}

export function zonedDateMs(
  parts: Pick<DailyClockParts, 'year' | 'month' | 'day' | 'hour' | 'minute'>,
  timeZone: string,
): number {
  const zone = normalizeTimeZone(timeZone);
  const utcGuess = Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, 0, 0);
  if (zone === 'UTC') return utcGuess;
  let instant = utcGuess;
  for (let i = 0; i < 4; i += 1) {
    instant = utcGuess - offsetMsAt(instant, zone);
  }
  return instant;
}

export function nextDailyOccurrence(
  nowMs: number,
  time: ParsedDailyTime,
  timeZone: string,
): number {
  const parts = clockParts(nowMs, timeZone);
  const today = zonedDateMs({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: time.hour,
    minute: time.minute,
  }, timeZone);
  if (today > nowMs) return today;
  const tomorrowBase = zonedDateMs({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 12,
    minute: 0,
  }, timeZone) + 24 * 60 * MINUTES;
  const tomorrowParts = clockParts(tomorrowBase, timeZone);
  return zonedDateMs({
    year: tomorrowParts.year,
    month: tomorrowParts.month,
    day: tomorrowParts.day,
    hour: time.hour,
    minute: time.minute,
  }, timeZone);
}

export function decideDailySpawn(
  nowMs: number,
  time: ParsedDailyTime,
  timeZone: string,
  durationMinutes: number,
  lastSpawnDayKey?: string,
): DailySpawnDecision {
  const todayKey = dayKey(nowMs, timeZone);
  const parts = clockParts(nowMs, timeZone);
  const todaySpawn = zonedDateMs({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: time.hour,
    minute: time.minute,
  }, timeZone);
  if (lastSpawnDayKey === todayKey) {
    return { kind: 'miss', spawnAt: nextDailyOccurrence(nowMs, time, timeZone) };
  }
  if (todaySpawn > nowMs) return { kind: 'future', spawnAt: todaySpawn };
  const windowEnd = todaySpawn + Math.max(0, durationMinutes) * MINUTES;
  if (nowMs < windowEnd) return { kind: 'catchup', spawnAt: todaySpawn };
  return { kind: 'miss', spawnAt: nextDailyOccurrence(nowMs, time, timeZone) };
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
  return Math.max(0, nowMs >= untilMs ? 0 : Math.ceil((untilMs - nowMs) / 1000));
}

/** Old boolean configs: local meant Moscow wall time, not the OS zone. */
export function timezonePolicy(useServerLocalTime: boolean): string {
  return useServerLocalTime ? MOSCOW_TIME_ZONE : 'UTC';
}
