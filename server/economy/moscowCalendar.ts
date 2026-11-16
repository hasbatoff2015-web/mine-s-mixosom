/** Civil calendar for daily rewards. Moscow is fixed at UTC+3; the host zone is not used. */
export const MOSCOW_TIME_ZONE = 'Europe/Moscow';

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: MOSCOW_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` in Europe/Moscow. This is not `toISOString().slice(0, 10)`. */
export function moscowDateKey(instant: Date): string {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new Error('invalid instant');
  }
  const parts = formatter.formatToParts(instant);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('moscow date parts missing');
  const key = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  if (!isMoscowDateKey(key)) throw new Error('moscow date parts invalid');
  return key;
}

export function isMoscowDateKey(value: string): boolean {
  const match = DATE_KEY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

/** Previous civil day. Month, year, and 29 February are calendar arithmetic, not the host zone. */
export function previousMoscowDateKey(dateKey: string): string {
  if (!isMoscowDateKey(dateKey)) throw new Error('invalid moscow date');
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() - 1);
  const previousYear = String(utc.getUTCFullYear()).padStart(4, '0');
  const previousMonth = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const previousDay = String(utc.getUTCDate()).padStart(2, '0');
  return `${previousYear}-${previousMonth}-${previousDay}`;
}
