import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  canFinishRewardedRecovery,
  planRewardedPresentationBegin,
  planRewardedPresentationEnd,
  shouldIgnorePlatformResume,
} from '../src/yandex/rewardedPresentation';
import {
  YandexGamesService,
  type YandexRewardedVideoCallbacks,
} from '../src/yandex/YandexGamesService';

class ManualSdk {
  gameplayStarts = 0;
  gameplayStops = 0;
  inits = 0;
  rewarded: YandexRewardedVideoCallbacks[] = [];
  pause?: () => void;
  resume?: () => void;

  async init(): Promise<ManualSdk['sdk']> {
    this.inits += 1;
    return this.sdk;
  }

  readonly sdk = {
    features: {
      GameplayAPI: {
        start: () => { this.gameplayStarts += 1; },
        stop: () => { this.gameplayStops += 1; },
      },
      LoadingAPI: { ready: () => undefined },
    },
    adv: {
      showRewardedVideo: (options: { callbacks?: YandexRewardedVideoCallbacks }) => {
        if (options.callbacks) this.rewarded.push(options.callbacks);
      },
    },
    on: (event: 'game_api_pause' | 'game_api_resume', callback: () => void) => {
      if (event === 'game_api_pause') this.pause = callback;
      else this.resume = callback;
    },
    off: () => undefined,
  };
}

describe('Yandex rewarded video adapter', () => {
  it('reports ads unavailable when YaGames is missing and does not throw', async () => {
    const service = new YandexGamesService();
    await service.initialize(() => undefined, () => undefined, async () => undefined);
    expect(service.rewardedVideoAvailable()).toBe(false);
    const error = vi.fn();
    expect(() => service.showRewardedVideo({ onError: error })).not.toThrow();
    expect(error).toHaveBeenCalledOnce();
    expect(readService()).toContain('if (!window.YaGames) return Promise.resolve(undefined)');
  });

  it('reuses the initialized SDK and forwards rewarded callbacks without a second init', async () => {
    const manual = new ManualSdk();
    const service = new YandexGamesService();
    await service.initialize(() => undefined, () => undefined, () => manual.init());
    expect(service.rewardedVideoAvailable()).toBe(true);
    service.gameplayStart();
    service.showRewardedVideo({
      onOpen: () => undefined,
      onRewarded: () => undefined,
      onClose: () => undefined,
      onError: () => undefined,
    });
    expect(manual.inits).toBe(1);
    expect(manual.gameplayStarts).toBe(1);
    expect(manual.rewarded).toHaveLength(1);
    const callbacks = manual.rewarded[0];
    callbacks?.onOpen?.();
    callbacks?.onRewarded?.();
    callbacks?.onClose?.(true);
    expect(manual.gameplayStops).toBe(0);
    service.showRewardedVideo({});
    expect(manual.inits).toBe(1);
    expect(manual.rewarded).toHaveLength(2);
  });

  it('turns a synchronous SDK throw into onError', async () => {
    const service = new YandexGamesService();
    await service.initialize(() => undefined, () => undefined, async () => ({
      adv: {
        showRewardedVideo() {
          throw new Error('blocked');
        },
      },
    }));
    const error = vi.fn();
    service.showRewardedVideo({ onError: error, onRewarded: () => undefined });
    expect(error).toHaveBeenCalledOnce();
  });

  it('does not call fullscreen ads from the rewarded adapter', () => {
    const source = readService();
    expect(source).toContain('showRewardedVideo');
    expect(source).not.toContain('showFullscreenAdv');
  });
});

describe('rewarded presentation hold', () => {
  it('moves only an active world into the ad state', () => {
    expect(planRewardedPresentationBegin('PLAYING')).toEqual({ enterAd: true });
    for (const state of ['MENU', 'PAUSED', 'LOADING', 'BACKGROUND', 'AD'] as const) {
      expect(planRewardedPresentationBegin(state).enterAd).toBe(false);
    }
  });

  it('returns to the menu without starting the world', () => {
    expect(planRewardedPresentationEnd({
      lifecycle: 'MENU',
      before: 'MENU',
      documentHidden: false,
      hasSession: true,
    })).toEqual({ enterPlaying: false });
    expect(planRewardedPresentationEnd({
      lifecycle: 'PAUSED',
      before: 'PAUSED',
      documentHidden: false,
      hasSession: true,
    })).toEqual({ enterPlaying: false });
  });

  it('resumes play only after an ad that interrupted a visible session', () => {
    expect(planRewardedPresentationEnd({
      lifecycle: 'AD',
      before: 'PLAYING',
      documentHidden: false,
      hasSession: true,
    })).toEqual({ enterPlaying: true });
    expect(planRewardedPresentationEnd({
      lifecycle: 'AD',
      before: 'PLAYING',
      documentHidden: true,
      hasSession: true,
    })).toEqual({ nextLifecycle: 'BACKGROUND', retargetBackgroundTo: 'PLAYING', enterPlaying: false });
    expect(planRewardedPresentationEnd({
      lifecycle: 'BACKGROUND',
      before: 'MENU',
      documentHidden: true,
      hasSession: false,
    })).toEqual({ retargetBackgroundTo: 'MENU', enterPlaying: false });
  });

  it('ignores platform resume while the rewarded video is open', () => {
    expect(shouldIgnorePlatformResume(true)).toBe(true);
    expect(shouldIgnorePlatformResume(false)).toBe(false);
  });

  it('allows manual recovery only when the page is visible and the platform pause is clear', () => {
    expect(canFinishRewardedRecovery({ documentHidden: false, platformPause: false })).toBe(true);
    expect(canFinishRewardedRecovery({ documentHidden: true, platformPause: false })).toBe(false);
    expect(canFinishRewardedRecovery({ documentHidden: false, platformPause: true })).toBe(false);
  });
});

function readService(): string {
  return readFileSync('src/yandex/YandexGamesService.ts', 'utf8');
}
