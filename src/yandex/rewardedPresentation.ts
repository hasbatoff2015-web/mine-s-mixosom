import type { LifecycleState } from '../core/lifecycleTypes';

/**
 * What to do with the existing lifecycle when a rewarded video opens.
 * Menu and pause stay where they are. Only an active world moves to AD.
 */
export function planRewardedPresentationBegin(lifecycle: LifecycleState): { readonly enterAd: boolean } {
  return { enterAd: lifecycle === 'PLAYING' };
}

export interface RewardedPresentationEndPlan {
  readonly nextLifecycle?: LifecycleState;
  readonly retargetBackgroundTo?: LifecycleState;
  /** Resume the world only when the ad interrupted PLAYING and the tab is visible. */
  readonly enterPlaying: boolean;
}

export function planRewardedPresentationEnd(input: {
  readonly lifecycle: LifecycleState;
  readonly before: LifecycleState;
  readonly documentHidden: boolean;
  readonly hasSession: boolean;
}): RewardedPresentationEndPlan {
  const restore: LifecycleState = input.before === 'AD' || input.before === 'BACKGROUND'
    ? 'MENU'
    : input.before;
  const landing: LifecycleState = restore === 'PLAYING' && !input.hasSession ? 'MENU' : restore;
  if (input.documentHidden) {
    if (input.lifecycle === 'BACKGROUND') {
      return { retargetBackgroundTo: landing, enterPlaying: false };
    }
    if (input.lifecycle === 'AD' || input.lifecycle === 'PLAYING') {
      return { nextLifecycle: 'BACKGROUND', retargetBackgroundTo: landing, enterPlaying: false };
    }
    return { enterPlaying: false };
  }
  if (input.lifecycle === 'BACKGROUND' || input.lifecycle === 'AD') {
    if (landing === 'PLAYING') return { enterPlaying: true };
    return { nextLifecycle: landing, enterPlaying: false };
  }
  return { enterPlaying: false };
}

/** Platform resume must not start the world while our rewarded video is still open. */
export function shouldIgnorePlatformResume(rewardedHold: boolean): boolean {
  return rewardedHold;
}

/**
 * Manual recovery is a player action after the ad callbacks stalled.
 * A hidden tab or a platform pause that has not resumed cannot finish the ad.
 */
export function canFinishRewardedRecovery(input: {
  readonly documentHidden: boolean;
  readonly platformPause: boolean;
}): boolean {
  return !input.documentHidden && !input.platformPause;
}
