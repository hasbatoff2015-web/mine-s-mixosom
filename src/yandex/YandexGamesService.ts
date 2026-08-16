interface YandexGameplayApi {
  start(): void;
  stop(): void;
}

interface YandexSdk {
  environment?: { i18n?: { lang?: string } };
  features?: {
    LoadingAPI?: { ready(): Promise<void> | void };
    GameplayAPI?: YandexGameplayApi;
  };
  on?(event: 'game_api_pause' | 'game_api_resume', callback: () => void): void;
  off?(event: 'game_api_pause' | 'game_api_resume', callback: () => void): void;
}

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

  async initialize(onPause: () => void, onResume: () => void): Promise<void> {
    if (!window.YaGames) return;
    try {
      this.sdk = await window.YaGames.init();
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

  language(): 'ru' | 'en' {
    const lang = this.sdk?.environment?.i18n?.lang ?? navigator.language;
    return lang.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  }

  dispose(): void {
    if (this.pauseCallback) this.sdk?.off?.('game_api_pause', this.pauseCallback);
    if (this.resumeCallback) this.sdk?.off?.('game_api_resume', this.resumeCallback);
  }
}

export {};
