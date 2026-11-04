/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { GameUI } from '../src/ui/GameUI';
import { YandexGamesService } from '../src/yandex/YandexGamesService';
import { YandexConnectChoices, planAfterCharacterChoice, proofCacheUsable, yandexSyncNotice } from '../src/net/yandexConnectIntent';
import { confirmGuestWelcome, writeGuestCredential, readGuestCredential } from '../src/net/guestIdentityStorage';
import type { GuestStorage } from '../src/net/guestIdentityStorage';

function memoryStorage(): GuestStorage & { snapshot(): string } {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    keys: () => [...values.keys()],
    snapshot: () => JSON.stringify([...values.entries()]),
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('yandex client authorization', () => {
  it('does not open a dialog for a silent check or for someone already authorized', async () => {
    let dialogs = 0;
    const players = [
      { isAuthorized: () => false, signature: 'guest-signature' },
      { isAuthorized: () => true, signature: 'account-signature' },
    ];
    window.YaGames = {
      init: async () => ({
        getPlayer: async () => players.shift() ?? players[0]!,
        auth: { openAuthDialog: async () => { dialogs += 1; } },
      }),
    };
    const service = new YandexGamesService();
    await service.initialize(() => {}, () => {});
    const silent = await service.silentAuthorizedProof();
    expect(silent).toEqual({ ok: false, reason: 'anonymous' });
    expect(dialogs).toBe(0);
    const again = await service.silentAuthorizedProof();
    expect(again).toEqual(silent);
    const explicit = await service.explicitAuthorizedProof();
    expect(explicit).toEqual({ ok: true, proof: 'account-signature', clientAuthorized: true });
    expect(dialogs).toBe(0);
    service.dispose();
  });

  it('opens the dialog only after an explicit login and leaves storage unchanged on cancel', async () => {
    const storage = memoryStorage();
    const scope = { deployment: 'local', mode: 'anarchy' as const, worldId: 'anarchy' };
    writeGuestCredential(storage, scope, '11111111-1111-4111-8111-111111111111');
    const before = storage.snapshot();
    let dialogs = 0;
    window.YaGames = {
      init: async () => ({
        getPlayer: async () => ({ isAuthorized: () => false, signature: 'guest-signature' }),
        auth: { openAuthDialog: async () => { dialogs += 1; throw new Error('closed'); } },
      }),
    };
    const service = new YandexGamesService();
    await service.initialize(() => {}, () => {});
    const result = await service.explicitAuthorizedProof();
    expect(result).toEqual({ ok: false, reason: 'cancelled' });
    expect(dialogs).toBe(1);
    expect(storage.snapshot()).toBe(before);
    expect(readGuestCredential(storage, scope)?.sessionToken).toBe('11111111-1111-4111-8111-111111111111');
    service.dispose();
  });

  it('drops a late player response after the account dialog changes generation', async () => {
    const first = deferred<{ isAuthorized: () => boolean; signature: string }>();
    const second = deferred<{ isAuthorized: () => boolean; signature: string }>();
    const calls = [first, second];
    let onOpen: (() => void) | undefined;
    let onClose: (() => void) | undefined;
    window.YaGames = {
      init: async () => ({
        EVENTS: { ACCOUNT_SELECTION_DIALOG_OPENED: 'open', ACCOUNT_SELECTION_DIALOG_CLOSED: 'close' },
        on: (event: string, callback: () => void) => {
          if (event === 'open') onOpen = callback;
          if (event === 'close') onClose = callback;
        },
        getPlayer: async () => {
          const next = calls.shift();
          if (!next) return { isAuthorized: () => false, signature: '' };
          return next.promise;
        },
      }),
    };
    const service = new YandexGamesService();
    await service.initialize(() => {}, () => {});
    const pending = service.silentAuthorizedProof();
    onOpen?.();
    await expect(service.silentAuthorizedProof()).resolves.toEqual({ ok: false, reason: 'unavailable' });
    first.resolve({ isAuthorized: () => true, signature: 'old-account' });
    await expect(pending).resolves.toEqual({ ok: false, reason: 'cancelled' });
    onClose?.();
    const next = service.silentAuthorizedProof();
    second.resolve({ isAuthorized: () => true, signature: 'new-account' });
    await expect(next).resolves.toEqual({ ok: true, proof: 'new-account', clientAuthorized: true });
    service.dispose();
  });

  it('stops requesting players after the SDK limit', async () => {
    let calls = 0;
    window.YaGames = {
      init: async () => ({
        getPlayer: async () => {
          calls += 1;
          return { isAuthorized: () => true, signature: `proof-${calls}` };
        },
      }),
    };
    const service = new YandexGamesService();
    await service.initialize(() => {}, () => {});
    for (let i = 0; i < 20; i += 1) {
      const result = await service.requestSignedProof(false);
      expect(result.ok).toBe(true);
    }
    await expect(service.requestSignedProof(false)).resolves.toEqual({ ok: false, reason: 'rate_limited' });
    expect(calls).toBe(20);
    service.dispose();
  });

  it('keeps the previous guest token in retained when the Yandex character is chosen', () => {
    const storage = memoryStorage();
    const scope = { deployment: 'local', mode: 'anarchy' as const, worldId: 'anarchy' };
    writeGuestCredential(storage, scope, '11111111-1111-4111-8111-111111111111');
    const saved = confirmGuestWelcome(storage, null, scope, '22222222-2222-4222-8222-222222222222', []);
    expect(saved.persisted).toBe(true);
    const record = readGuestCredential(storage, scope);
    expect(record?.sessionToken).toBe('22222222-2222-4222-8222-222222222222');
    expect(record?.retained).toContain('11111111-1111-4111-8111-111111111111');
  });

  it('does not send a cached proof after the client window and does not loop on the same signature', async () => {
    let now = 1_000;
    let calls = 0;
    let dialogs = 0;
    window.YaGames = {
      init: async () => ({
        getPlayer: async () => {
          calls += 1;
          return { isAuthorized: () => true, signature: 'same-signature' };
        },
        auth: { openAuthDialog: async () => { dialogs += 1; } },
      }),
    };
    const service = new YandexGamesService();
    service.now = () => now;
    await service.initialize(() => {}, () => {});
    const first = await service.silentAuthorizedProof();
    expect(first).toEqual({ ok: true, proof: 'same-signature', clientAuthorized: true });
    const second = await service.silentAuthorizedProof();
    expect(second).toEqual(first);
    expect(calls).toBe(1);
    expect(proofCacheUsable(now, now + 8 * 60 * 1000)).toBe(false);
    now += 15 * 60 * 1000;
    const stale = await service.silentAuthorizedProof();
    expect(stale).toEqual({ ok: false, reason: 'stale' });
    expect(calls).toBe(2);
    expect(dialogs).toBe(0);
    const again = await service.silentAuthorizedProof();
    expect(again).toEqual({ ok: false, reason: 'stale' });
    expect(calls).toBe(2);
    service.dispose();
  });

  it('forgets the previous proof when the account dialog closes', async () => {
    const signatures = ['old-signature', 'new-signature'];
    let onClose: (() => void) | undefined;
    window.YaGames = {
      init: async () => ({
        EVENTS: { ACCOUNT_SELECTION_DIALOG_OPENED: 'open', ACCOUNT_SELECTION_DIALOG_CLOSED: 'close' },
        on: (event: string, callback: () => void) => {
          if (event === 'close') onClose = callback;
        },
        getPlayer: async () => ({ isAuthorized: () => true, signature: signatures.shift() ?? 'new-signature' }),
      }),
    };
    const service = new YandexGamesService();
    await service.initialize(() => {}, () => {});
    await expect(service.silentAuthorizedProof()).resolves.toMatchObject({ proof: 'old-signature' });
    onClose?.();
    await expect(service.silentAuthorizedProof()).resolves.toMatchObject({ proof: 'new-signature' });
    service.dispose();
  });
});

describe('yandex connect choice', () => {
  it('keeps a guest choice for the page session and clears it when Yandex is chosen', () => {
    const choices = new YandexConnectChoices();
    expect(choices.resolve('anarchy')).toBeUndefined();
    expect(planAfterCharacterChoice('guest', 'proof')).toEqual({ kind: 'guest' });
    choices.stayGuest('anarchy');
    expect(choices.resolve('anarchy')).toEqual({ kind: 'guest' });
    expect(choices.resolve('survival')).toBeUndefined();
    const yandex = planAfterCharacterChoice('yandex', 'proof-b');
    expect(choices.resolve('anarchy', yandex)).toEqual({
      kind: 'yandex',
      proof: 'proof-b',
      confirmOtherCharacter: true,
    });
    expect(choices.resolve('anarchy')).toBeUndefined();
    choices.stayGuest('anarchy');
    choices.clear();
    expect(choices.resolve('anarchy')).toBeUndefined();
    expect(yandexSyncNotice('linked')).toBe('Прогресс сохранён в вашем Яндекс ID.');
    expect(yandexSyncNotice('restored')).toBe('Персонаж восстановлен через Яндекс ID.');
    expect(yandexSyncNotice('unavailable')).toBe('Синхронизация прогресса временно недоступна. Вы играете гостем.');
    expect(yandexSyncNotice('guest')).toBeUndefined();
  });
});

describe('yandex server list and pause', () => {
  function mount(): GameUI {
    const root = document.createElement('div');
    document.body.append(root);
    return new GameUI(root);
  }

  it('removes the pause link button and shows login only to an anonymous player', async () => {
    const ui = mount();
    ui.showPause({ resume: () => {}, settings: () => {}, saveAndQuit: () => {} });
    expect(document.body.textContent).not.toContain('Привязать Яндекс ID');
    expect(document.querySelector('[data-action="link-yandex"]')).toBeNull();
    expect(document.querySelector('[data-action="resume"]')).toBeTruthy();
    expect(document.querySelector('[data-action="settings"]')).toBeTruthy();
    expect(document.querySelector('[data-action="quit"]')).toBeTruthy();
    ui.showOnlineServers({
      back: () => {},
      connect: () => {},
      retry: () => {},
      saveNickname: () => ({ ok: true, name: 'Ada' }),
      yandexLogin: () => {},
    }, {
      anarchy: { phase: 'available', online: 1, maxPlayers: 20 },
      survival: { phase: 'available', online: 0, maxPlayers: 20 },
      peaceful: { phase: 'available', online: 0, maxPlayers: 20 },
    });
    expect(document.querySelector('[data-yandex-panel]')?.getAttribute('data-yandex-panel')).toBe('pending');
    expect(document.querySelector<HTMLButtonElement>('[data-action="yandex-login"]')?.hidden).toBe(true);
    ui.setYandexPanel('anonymous');
    const login = document.querySelector<HTMLButtonElement>('[data-action="yandex-login"]');
    expect(login?.hidden).toBe(false);
    expect(login?.textContent).toContain('Войти через Яндекс');
    expect(document.body.textContent).toContain('Сохраните прогресс и играйте с любого устройства.');
    ui.setYandexPanel('authorized');
    expect(document.querySelector<HTMLButtonElement>('[data-action="yandex-login"]')?.hidden).toBe(true);
    expect(document.body.textContent).toContain('Вы авторизованы в Яндексе');
    expect(document.body.textContent).not.toContain('Яндекс ID подключён');
    expect(document.body.textContent).not.toContain('Сохраните прогресс и играйте с любого устройства.');
    ui.setYandexBusy(true);
    expect(document.querySelector<HTMLButtonElement>('[data-action="connect"]')?.disabled).toBe(true);
    ui.setYandexBusy(false);
    expect(document.querySelector<HTMLButtonElement>('[data-action="connect"]')?.disabled).toBe(false);
    const choice = ui.chooseSavedCharacter();
    document.querySelector<HTMLButtonElement>('[data-choice="guest"]')?.click();
    await expect(choice).resolves.toBe('guest');
    expect(document.querySelector('.yandex-choice-backdrop')).toBeNull();
  });
});
