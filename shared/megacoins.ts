/** Compact Мегакоин labels for dense inventory-style rows (not chat copy). */

function oneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(1);
}

/**
 * 0–999 as an integer; then К / М / МЛРД with at most one decimal.
 * `1.0М` collapses to `1М`. Extends past the 999 999 999 wallet cap.
 */
export function formatCompactMegacoins(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  const n = Math.trunc(Math.abs(value));
  if (n < 1000) return `${sign}${n}`;
  if (n < 1_000_000) return `${sign}${oneDecimal(n / 1000)}К`;
  if (n < 1_000_000_000) return `${sign}${oneDecimal(n / 1_000_000)}М`;
  return `${sign}${oneDecimal(n / 1_000_000_000)}МЛРД`;
}
