/**
 * DEV-only Online prediction isolation flags.
 *
 * `predNoNet` = skip local movement send AND skip applying local `player_state`.
 * Independent halves:
 *   ?predNoState=1         send + predict; do not apply local player_state
 *   ?predNoSend=1          do not send movement input; still receive/apply
 *   ?predStateObserve=1    receive + parse + inspect; mutate nothing
 *
 * Category skips (still receive; disable one apply path):
 *   ?predSkipReconcile=1 ?predSkipSurvival=1 ?predSkipRiding=1
 *   ?predSkipGamemode=1 ?predSkipRespawn=1
 *   ?predSkipLook=1 ?predSkipRender=1
 *
 * Production builds ignore every flag.
 */

export type PredIsolationMode = 'normal' | 'noState' | 'noSend' | 'noNet' | 'observe';

export interface PredIsolationFlags {
  readonly noSend: boolean;
  readonly noState: boolean;
  readonly observe: boolean;
  readonly skipReconcile: boolean;
  readonly skipSurvival: boolean;
  readonly skipRiding: boolean;
  readonly skipGamemode: boolean;
  readonly skipRespawn: boolean;
  readonly skipLook: boolean;
  readonly skipRender: boolean;
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

const OFF: PredIsolationFlags = {
  noSend: false,
  noState: false,
  observe: false,
  skipReconcile: false,
  skipSurvival: false,
  skipRiding: false,
  skipGamemode: false,
  skipRespawn: false,
  skipLook: false,
  skipRender: false,
  mode: 'normal',
};

export function resolvePredIsolation(
  search = locationSearch(),
  options?: { readonly dev?: boolean },
): PredIsolationFlags {
  if (!(options?.dev ?? isDevRuntime())) return { ...OFF };
  const noNet = queryFlag('predNoNet', search) || queryFlag('prednonet', search);
  const observe = queryFlag('predStateObserve', search) || queryFlag('predstateobserve', search);
  const noState = noNet || observe || queryFlag('predNoState', search) || queryFlag('prednostate', search);
  const noSend = noNet || queryFlag('predNoSend', search) || queryFlag('prednosend', search);
  const mode: PredIsolationMode = observe
    ? 'observe'
    : noSend && noState
      ? 'noNet'
      : noState
        ? 'noState'
        : noSend
          ? 'noSend'
          : 'normal';
  return {
    noSend,
    noState,
    observe,
    skipReconcile: queryFlag('predSkipReconcile', search) || queryFlag('predskipreconcile', search),
    skipSurvival: queryFlag('predSkipSurvival', search) || queryFlag('predskipsurvival', search),
    skipRiding: queryFlag('predSkipRiding', search) || queryFlag('predskipriding', search),
    skipGamemode: queryFlag('predSkipGamemode', search) || queryFlag('predskipgamemode', search),
    skipRespawn: queryFlag('predSkipRespawn', search) || queryFlag('predskiprespawn', search),
    skipLook: queryFlag('predSkipLook', search) || queryFlag('predskiplook', search),
    skipRender: queryFlag('predSkipRender', search) || queryFlag('predskiprender', search),
    mode,
  };
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
    case 'observe':
      return 'online/observe';
    default:
      return 'online/normal';
  }
}
