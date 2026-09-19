/** DEV calibrator path: `http://localhost:4173/moveitems`. */
export function isMoveItemsCalibratorPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const leaf = normalized.slice(normalized.lastIndexOf('/') + 1);
  return leaf === 'moveitems';
}
