function queryFlag(name: string, search: string): boolean {
  if (!search) return false;
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const value = params.get(name);
  return value === '1' || value === 'true';
}

/** DEV: `?quietWorld=1` caps streaming to 1 chunk for load isolation. Production ignores. */
export function isQuietWorldQueryEnabled(
  search = typeof location === 'undefined' ? '' : location.search,
): boolean {
  return queryFlag('quietWorld', search) || queryFlag('quietworld', search);
}

export function quietWorldRenderDistance(current: number, search?: string): number {
  if (!isQuietWorldQueryEnabled(search)) return current;
  return Math.min(1, Math.max(1, current));
}
