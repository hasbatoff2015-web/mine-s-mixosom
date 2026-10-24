interface YandexGameplayApi {
  start(): void;
  stop(): void;
}

export interface YandexRewardedVideoCallbacks {
  onOpen?: () => void;
  onRewarded?: () => void;
  onClose?: (wasShown: boolean) => void;
  onError?: (error: unknown) => void;
}

interface YandexRewardedVideoOptions {
  callbacks?: YandexRewardedVideoCallbacks;
}

interface YandexAdvertising {
  showRewardedVideo?(options: YandexRewardedVideoOptions): void;
}

interface YandexSdk {
  environment?: { i18n?: { lang?: string } };
  features?: {
    LoadingAPI?: { ready(): Promise<void> | void };
    GameplayAPI?: YandexGameplayApi;
  };
  adv?: YandexAdvertising;
  on?(event: 'game_api_pause' | 'game_api_resume', callback: () => void): void;
  off?(event: 'game_api_pause' | 'game_api_resume', callback: () => void): void;
}

export type YandexSdkLoader = () => Promise<YandexSdk | undefined>;

declare global {
  interface Window {
    YaGames?: { init(): Promise<YandexSdk> };
  }
}

export class YandexGamesService {
  private sdk?: YandexSdk;
  private readySent = false;
  private playing = false;
  private pauseCallback?: () => void;
  private resumeCallback?: () => void;

  async initialize(
    onPause: () => void,
    onResume: () => void,
    loadSdk: YandexSdkLoader = defaultSdkLoader,
  ): Promise<void> {
    try {
      const sdk = await loadSdk();
      if (!sdk) return;
      this.sdk = sdk;
      this.pauseCallback = onPause;
      this.resumeCallback = onResume;
      this.sdk.on?.('game_api_pause', onPause);
      this.sdk.on?.('game_api_resume', onResume);
    } catch (error) {
      console.warn('Yandex Games SDK unavailable; continuing in local mode.', error);
    }
  }

  async loadingReady(): Promise<void> {
    if (this.readySent) return;
    this.readySent = true;
    try {
      await this.sdk?.features?.LoadingAPI?.ready();
    } catch (error) {
      console.warn('LoadingAPI.ready() failed.', error);
    }
  }

  gameplayStart(): void {
    if (this.playing) return;
    this.playing = true;
    this.sdk?.features?.GameplayAPI?.start();
  }

  gameplayStop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.sdk?.features?.GameplayAPI?.stop();
  }

  /** True only when the already initialized SDK exposes rewarded video. */
  rewardedVideoAvailable(): boolean {
    return typeof this.sdk?.adv?.showRewardedVideo === 'function';
  }

  /**
   * Shows one rewarded video on the existing SDK instance.
   * Does not call `YaGames.init()` and does not call fullscreen ads.
   * A missing API reports `onError` instead of throwing or granting a reward.
   */
  showRewardedVideo(callbacks: YandexRewardedVideoCallbacks): void {
    const show = this.sdk?.adv?.showRewardedVideo;
    if (!show) {
      callbacks.onError?.(new Error('rewarded_unavailable'));
      return;
    }
    try {
      show.call(this.sdk?.adv, {
        callbacks: {
          onOpen: () => callbacks.onOpen?.(),
          onRewarded: () => callbacks.onRewarded?.(),
          onClose: (wasShown) => callbacks.onClose?.(wasShown === true),
          onError: (error) => callbacks.onError?.(error),
        },
      });
    } catch (error) {
      callbacks.onError?.(error);
    }
  }

  language(): 'ru' | 'en' {
    const lang = this.sdk?.environment?.i18n?.lang ?? navigator.language;
    return lang.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  }

  dispose(): void {
    if (this.pauseCallback) this.sdk?.off?.('game_api_pause', this.pauseCallback);
    if (this.resumeCallback) this.sdk?.off?.('game_api_resume', this.resumeCallback);
  }
}

function defaultSdkLoader(): Promise<YandexSdk | undefined> {
  if (!window.YaGames) return Promise.resolve(undefined);
  return window.YaGames.init();
}

export {};
