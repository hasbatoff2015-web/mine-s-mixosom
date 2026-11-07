/**
 * The player's connect choice is separate from whether the Yandex SDK
 * currently reports an authorized user. A session may stay on the local
 * guest without signing the player out of Yandex.
 */
export type YandexConnectPlan =
  | { readonly kind: 'guest' }
  | { readonly kind: 'yandex'; readonly proof: string; readonly confirmOtherCharacter: boolean };

/** Inside the server's 10 minute proof window, with margin for clock skew. */
export const YANDEX_PROOF_CLIENT_WINDOW_MS = 8 * 60 * 1000;

export function proofCacheUsable(receivedAt: number, now: number, windowMs = YANDEX_PROOF_CLIENT_WINDOW_MS): boolean {
  return Number.isFinite(receivedAt) && Number.isFinite(now) && now - receivedAt >= 0 && now - receivedAt < windowMs;
}

export function planAfterCharacterChoice(choice: 'guest' | 'yandex', proof: string): YandexConnectPlan {
  if (choice === 'yandex') return { kind: 'yandex', proof, confirmOtherCharacter: true };
  return { kind: 'guest' };
}

/** Remembers a guest choice for one page session and one server. A reload starts empty. */
export class YandexConnectChoices {
  private readonly guestStay = new Set<string>();

  stayGuest(server: string): void {
    this.guestStay.add(server);
  }

  chooseYandex(server: string): void {
    this.guestStay.delete(server);
  }

  /** Account switch or a new page. Does not delete saved guest keys. */
  clear(): void {
    this.guestStay.clear();
  }

  /**
   * `undefined` means the caller may ask the SDK. A guest choice wins over
   * a still-authorized SDK session until the player explicitly picks Yandex.
   */
  resolve(server: string, requested?: YandexConnectPlan): YandexConnectPlan | undefined {
    if (requested?.kind === 'yandex') {
      this.guestStay.delete(server);
      return requested;
    }
    if (requested?.kind === 'guest' || this.guestStay.has(server)) return { kind: 'guest' };
    return undefined;
  }
}

export function yandexSyncNotice(sync: 'linked' | 'restored' | 'unavailable' | 'guest' | undefined): string | undefined {
  if (sync === 'linked') return 'Прогресс сохранён в вашем Яндекс ID.';
  if (sync === 'restored') return 'Персонаж восстановлен через Яндекс ID.';
  if (sync === 'unavailable') return 'Синхронизация прогресса временно недоступна. Вы играете гостем.';
  if (sync === 'guest') {
    return 'Не удалось подтвердить Яндекс ID. Вы продолжаете игру как гость. Для переноса прогресса потребуется повторить вход через Яндекс.';
  }
  return undefined;
}
