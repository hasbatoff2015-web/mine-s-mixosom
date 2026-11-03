interface YandexGameplayApi {
  start(): void;
  stop(): void;
}

interface YandexPlayer {
  signature?: string;
  isAuthorized?: () => boolean;
}

interface YandexSdk {
  environment?: { i18n?: { lang?: string } };
  features?: {
    LoadingAPI?: { ready(): Promise<void> | void };
    GameplayAPI?: YandexGameplayApi;
  };
  auth?: { openAuthDialog(): Promise<void> };
  getPlayer?(options?: { signed?: boolean }): Promise<YandexPlayer>;
  EVENTS?: {
    ACCOUNT_SELECTION_DIALOG_OPENED?: string;
    ACCOUNT_SELECTION_DIALOG_CLOSED?: string;
  };
  on?(event: string, callback: () => void): (() => void) | void;
  off?(event: string, callback: () => void): void;
}

export type SignedProofResult =
  | { readonly ok: true; readonly proof: string; readonly clientAuthorized: boolean }
  | { readonly ok: false; readonly reason: 'unavailable' | 'cancelled' | 'rate_limited' | 'error' };

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
  private accountDialogOpen = false;
  private proofGeneration = 0;
  private readonly playerCalls: number[] = [];
  private unsubscribers: Array<() => void> = [];

  async initialize(onPause: () => void, onResume: () => void): Promise<void> {
    if (!window.YaGames) return;
    try {
      this.sdk = await window.YaGames.init();
      this.pauseCallback = onPause;
      this.resumeCallback = onResume;
      this.sdk.on?.('game_api_pause', onPause);
      this.sdk.on?.('game_api_resume', onResume);
      this.watchAccountSelection(this.sdk);
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

  sdkAvailable(): boolean {
    return Boolean(this.sdk?.getPlayer);
  }

  /**
   * Asks the SDK for a signed profile. The dialog opens only when `openDialog`
   * is true. The returned string is sent to the game server and is not stored.
   * `clientAuthorized` is a UI hint; the server does not trust it.
   */
  async requestSignedProof(openDialog: boolean): Promise<SignedProofResult> {
    const sdk = this.sdk;
    if (!sdk?.getPlayer || this.accountDialogOpen) return { ok: false, reason: 'unavailable' };
    const generation = this.proofGeneration;
    if (!this.notePlayerCall()) return { ok: false, reason: 'rate_limited' };
    try {
      let player = await sdk.getPlayer({ signed: true });
      if (generation !== this.proofGeneration) return { ok: false, reason: 'cancelled' };
      const authorized = player.isAuthorized?.() === true;
      if (openDialog && player.isAuthorized && !authorized) {
        if (!sdk.auth?.openAuthDialog) return { ok: false, reason: 'unavailable' };
        try {
          await sdk.auth.openAuthDialog();
        } catch {
          return { ok: false, reason: 'cancelled' };
        }
        if (generation !== this.proofGeneration || !this.notePlayerCall()) {
          return { ok: false, reason: generation !== this.proofGeneration ? 'cancelled' : 'rate_limited' };
        }
        player = await sdk.getPlayer({ signed: true });
      }
      if (generation !== this.proofGeneration) return { ok: false, reason: 'cancelled' };
      if (typeof player.signature !== 'string' || player.signature.length === 0) {
        return { ok: false, reason: 'error' };
      }
      return { ok: true, proof: player.signature, clientAuthorized: player.isAuthorized?.() === true };
    } catch {
      return { ok: false, reason: 'error' };
    }
  }

  language(): 'ru' | 'en' {
    const lang = this.sdk?.environment?.i18n?.lang ?? navigator.language;
    return lang.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  }

  dispose(): void {
    if (this.pauseCallback) this.sdk?.off?.('game_api_pause', this.pauseCallback);
    if (this.resumeCallback) this.sdk?.off?.('game_api_resume', this.resumeCallback);
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  private watchAccountSelection(sdk: YandexSdk): void {
    const opened = sdk.EVENTS?.ACCOUNT_SELECTION_DIALOG_OPENED;
    const closed = sdk.EVENTS?.ACCOUNT_SELECTION_DIALOG_CLOSED;
    if (!opened || !closed || !sdk.on) return;
    const onOpen = (): void => {
      this.accountDialogOpen = true;
      this.proofGeneration += 1;
    };
    const onClose = (): void => {
      this.accountDialogOpen = false;
      this.proofGeneration += 1;
    };
    const stopOpen = sdk.on(opened, onOpen);
    const stopClose = sdk.on(closed, onClose);
    if (typeof stopOpen === 'function') this.unsubscribers.push(stopOpen);
    if (typeof stopClose === 'function') this.unsubscribers.push(stopClose);
  }

  private notePlayerCall(): boolean {
    const now = Date.now();
    while (this.playerCalls.length > 0 && now - this.playerCalls[0]! > 5 * 60 * 1000) this.playerCalls.shift();
    if (this.playerCalls.length >= 20) return false;
    this.playerCalls.push(now);
    return true;
  }
}

export {};
