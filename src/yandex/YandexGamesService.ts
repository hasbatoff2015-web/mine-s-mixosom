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
  | { readonly ok: true; readonly proof: string; readonly clientAuthorized: true }
  | { readonly ok: false; readonly reason: 'unavailable' | 'cancelled' | 'rate_limited' | 'error' | 'anonymous' };

export type YandexInitState = 'pending' | 'ready' | 'unavailable';
export type YandexAccountPhase = 'opened' | 'closed';

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
  private initState: YandexInitState = 'pending';
  private initPromise?: Promise<void>;
  private cached?: { generation: number; result: SignedProofResult };
  private inflight?: Promise<SignedProofResult>;
  private readonly playerCalls: number[] = [];
  private readonly readyWaiters: Array<() => void> = [];
  private readonly accountListeners: Array<(phase: YandexAccountPhase) => void> = [];
  private unsubscribers: Array<() => void> = [];

  initialize(onPause: () => void, onResume: () => void): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initializeOnce(onPause, onResume);
    return this.initPromise;
  }

  private async initializeOnce(onPause: () => void, onResume: () => void): Promise<void> {
    if (!window.YaGames) {
      this.markInit('unavailable');
      return;
    }
    try {
      this.sdk = await window.YaGames.init();
      this.pauseCallback = onPause;
      this.resumeCallback = onResume;
      this.sdk.on?.('game_api_pause', onPause);
      this.sdk.on?.('game_api_resume', onResume);
      this.watchAccountSelection(this.sdk);
      this.markInit(this.sdk.getPlayer ? 'ready' : 'unavailable');
    } catch (error) {
      console.warn('Yandex Games SDK unavailable; continuing in local mode.', error);
      this.markInit('unavailable');
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

  initializationState(): YandexInitState {
    return this.initState;
  }

  /** Resolves when init finishes, or after `timeoutMs` if it is still pending. */
  waitUntilReady(timeoutMs: number): Promise<void> {
    if (this.initState !== 'pending') return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = this.readyWaiters.indexOf(finish);
        if (index >= 0) this.readyWaiters.splice(index, 1);
        resolve();
      }, timeoutMs);
      const finish = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.readyWaiters.push(finish);
    });
  }

  onAccountSelection(listener: (phase: YandexAccountPhase) => void): () => void {
    this.accountListeners.push(listener);
    return () => {
      const index = this.accountListeners.indexOf(listener);
      if (index >= 0) this.accountListeners.splice(index, 1);
    };
  }

  /**
   * Signed profile of a player who is already authorized. Does not open a dialog.
   * An anonymous signed profile is not returned: `isAuthorized()` is the client hint.
   */
  silentAuthorizedProof(): Promise<SignedProofResult> {
    return this.authorizedProof(false);
  }

  /**
   * Opens the auth dialog only when the current player is not authorized.
   * An already authorized player is not prompted again.
   */
  explicitAuthorizedProof(): Promise<SignedProofResult> {
    return this.authorizedProof(true);
  }

  private async authorizedProof(openDialog: boolean): Promise<SignedProofResult> {
    if (!openDialog && this.inflight) return this.inflight;
    if (!openDialog && this.cached && this.cached.generation === this.proofGeneration) return this.cached.result;
    if (openDialog && this.inflight) await this.inflight;
    if (openDialog && this.cached?.generation === this.proofGeneration && this.cached.result.ok) {
      return this.cached.result;
    }
    const started = this.proofGeneration;
    const run = this.requestSignedProof(openDialog).then((result) => {
      const cacheable = result.ok || result.reason === 'anonymous';
      if (cacheable && started === this.proofGeneration) this.cached = { generation: started, result };
      return result;
    });
    if (!openDialog) {
      let flight: Promise<SignedProofResult>;
      flight = run.finally(() => {
        if (this.inflight === flight) this.inflight = undefined;
      });
      this.inflight = flight;
      return flight;
    }
    return run;
  }

  /**
   * Asks the SDK for a signed profile. The dialog opens only when `openDialog`
   * is true and `isAuthorized()` is false. The string is for one server request.
   * It is not stored. `isAuthorized()` is only a client hint.
   */
  async requestSignedProof(openDialog: boolean): Promise<SignedProofResult> {
    const sdk = this.sdk;
    if (!sdk?.getPlayer || this.accountDialogOpen) return { ok: false, reason: 'unavailable' };
    const generation = this.proofGeneration;
    if (!this.notePlayerCall()) return { ok: false, reason: 'rate_limited' };
    try {
      let player = await sdk.getPlayer({ signed: true });
      if (generation !== this.proofGeneration) return { ok: false, reason: 'cancelled' };
      let authorized = player.isAuthorized?.() === true;
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
        if (generation !== this.proofGeneration) return { ok: false, reason: 'cancelled' };
        authorized = player.isAuthorized?.() === true;
      }
      if (generation !== this.proofGeneration) return { ok: false, reason: 'cancelled' };
      if (!authorized) return { ok: false, reason: openDialog ? 'cancelled' : 'anonymous' };
      if (typeof player.signature !== 'string' || player.signature.length === 0) {
        return { ok: false, reason: 'error' };
      }
      return { ok: true, proof: player.signature, clientAuthorized: true };
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
      this.cached = undefined;
      this.inflight = undefined;
      this.emitAccount('opened');
    };
    const onClose = (): void => {
      this.accountDialogOpen = false;
      this.proofGeneration += 1;
      this.cached = undefined;
      this.inflight = undefined;
      this.emitAccount('closed');
    };
    const stopOpen = sdk.on(opened, onOpen);
    const stopClose = sdk.on(closed, onClose);
    if (typeof stopOpen === 'function') this.unsubscribers.push(stopOpen);
    if (typeof stopClose === 'function') this.unsubscribers.push(stopClose);
  }

  private markInit(state: YandexInitState): void {
    this.initState = state;
    const waiters = this.readyWaiters.splice(0);
    for (const wake of waiters) wake();
  }

  private emitAccount(phase: YandexAccountPhase): void {
    for (const listener of [...this.accountListeners]) listener(phase);
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
