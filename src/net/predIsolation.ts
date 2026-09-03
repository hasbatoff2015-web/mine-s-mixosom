/**
 * DEV-only Online prediction isolation flags.
 *
 * `predNoNet` = skip local movement send AND skip applying local `player_state`.
 * The two halves can be enabled independently:
 *   ?predNoState=1  still send, still predict, do not apply/reconcile local player_state
 *   ?predNoSend=1   do not send movement input, still receive/apply snapshots
 *
 * Production builds ignore every flag (including predNoNet).
 */

export type PredIsolationMode = 'normal' | 'noState' | 'noSend' | 'noNet';

export interface PredIsolationFlags {
  readonly noSend: boolean;
  readonly noState: boolean;
  readonly mode: PredIsolationMode;
}

function queryFlag(name: string, search: string): boolean {
  if (!search) return false;
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const value = params.get(name);
  return value === '1' || value === 'true';
}

export function isDevRuntime(): boolean {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV === false) return false;
  } catch {
    /* Node tests without import.meta.env treat isolation as available. */
  }
  return true;
}

function locationSearch(): string {
  return typeof location === 'undefined' ? '' : location.search;
}

export function resolvePredIsolation(
  search = locationSearch(),
  options?: { readonly dev?: boolean },
): PredIsolationFlags {
  if (!(options?.dev ?? isDevRuntime())) {
    return { noSend: false, noState: false, mode: 'normal' };
  }
  const noNet = queryFlag('predNoNet', search) || queryFlag('prednonet', search);
  const noState = noNet || queryFlag('predNoState', search) || queryFlag('prednostate', search);
  const noSend = noNet || queryFlag('predNoSend', search) || queryFlag('prednosend', search);
  const mode: PredIsolationMode = noSend && noState
    ? 'noNet'
    : noState
      ? 'noState'
      : noSend
        ? 'noSend'
        : 'normal';
  return { noSend, noState, mode };
}

export function isPredNoNetQueryEnabled(
  search = locationSearch(),
  options?: { readonly dev?: boolean },
): boolean {
  return resolvePredIsolation(search, options).mode === 'noNet';
}

export function isPredNoStateQueryEnabled(
  search = locationSearch(),
  options?: { readonly dev?: boolean },
): boolean {
  return resolvePredIsolation(search, options).noState;
}

export function isPredNoSendQueryEnabled(
  search = locationSearch(),
  options?: { readonly dev?: boolean },
): boolean {
  return resolvePredIsolation(search, options).noSend;
}

export function formatPredIsolationMode(mode: PredIsolationMode): string {
  switch (mode) {
    case 'noNet':
      return 'online/noNet';
    case 'noState':
      return 'online/noState';
    case 'noSend':
      return 'online/noSend';
    default:
      return 'online/normal';
  }
}
