/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { menuClansHtml, menuFriendsHtml, menuReferralHtml } from '../src/ui/gameMenuGui';
import { menuLogicalHeight } from '../src/ui/containerTheme';
import { GameUI } from '../src/ui/GameUI';
import { captureReferralLaunch, clearReferralIntent, referralIntentCode, referralLinkFromApp, settleReferralIntent } from '../src/yandex/referralIntent';
import { parseReferralPayload, referralPublicUrl } from '../shared/referral';
import type { ReferralMenuState } from '../shared/referral';
import type { ClientMenuActionMessage, ServerMenuMessage } from '../shared/protocol';
import { isGameMenuScreenKind } from '../shared/protocol';

const escape = (value: string) => value;

function menu(patch: Partial<ServerMenuMessage> = {}): ServerMenuMessage {
  return {
    type: 'menu',
    screen: 'friends',
    title: 'Друзья',
    friendRequests: [{ name: 'Misha', requestId: 'req-1', playerId: 'p1', online: true, canTeleport: false }],
    friends: [{ name: 'Alex', playerId: 'p2', online: false, canTeleport: false }],
    ...patch,
  };
}

function referral(patch: Partial<ReferralMenuState> = {}): ReferralMenuState {
  return {
    available: true,
    activityNote: 'Активная игра засчитывается на Анархии.',
    code: 'ABCD2345',
    qualifiedCount: 3,
    invitedCount: 4,
    page: 1,
    pageCount: 2,
    codeDraft: 'ZXCV2345',
    guestWarning: 'Без привязки к Яндекс ID прогресс этого персонажа можно потерять после очистки браузера.',
    invitees: Array.from({ length: 8 }, (_unused, index) => ({
      name: `Friend ${index}`,
      activeSeconds: index * 60,
      progressLabel: `${index} мин / 3 ч`,
      status: 'pending' as const,
    })),
    rewards: [
      { milestone: '3_confirmed', title: '3 друга — VIP 7 дней', detail: 'получено' },
      { milestone: '5_confirmed', title: '5 друзей — PREMIUM 7 дней', detail: 'осталось 2' },
    ],
    kit: { state: 'awaiting_setup', detail: 'Ожидает настройки' },
    ...patch,
  };
}

function linkButton(html: string): string {
  return html.match(/<button[^>]*data-referral-copy="link"[^>]*>/)?.[0] ?? '';
}

describe('referral menu', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    clearReferralIntent();
  });

  it('keeps the friends list and opens the referral bonus', () => {
    const html = menuFriendsHtml(menu(), escape);
    expect(html).toContain('Заявки в друзья');
    expect(html).toContain('data-menu-friend-accept');
    expect(html).toContain('data-menu-friend-chat');
    expect(html).toContain('data-menu-open="friends-invites"');
    expect(html).toContain('>Бонус за друга</button>');
    expect(html).toContain('mc-social-menu-body');
    expect(html).not.toContain('>Приглашения</button>');
    expect(menuClansHtml(menu({ screen: 'clans' }))).toContain('data-menu-action="clans_invitations"');
    expect(menuClansHtml(menu({ screen: 'clans' }))).toContain('>Приглашения</button>');
    expect(isGameMenuScreenKind('friends-invites')).toBe(true);
    expect(menuLogicalHeight('friends-invites')).toBe(340);
    expect(menuLogicalHeight('friends-invites')).toBeGreaterThan(menuLogicalHeight('friends'));
  });

  it('renders the code, progress, rewards, and a scrolling invitee list', () => {
    const html = menuReferralHtml(menu({
      screen: 'friends-invites',
      title: 'Бонус за друга',
      message: 'Код принят.',
      referral: referral({
        rankNote: 'Уже есть оплаченный ранг.',
        invitedBy: 'Ada',
        inviteeProgress: '1 ч 2 мин / 3 ч',
      }),
    }), escape);
    expect(html).toContain('Бонус за друга');
    expect(html).toContain('mc-social-menu-body');
    expect(html).toContain('mc-referral-code-block');
    expect(html).toContain('ABCD2345');
    expect(html).toContain('data-referral-code');
    expect(html).toContain('data-referral-copy="code"');
    expect(html).toContain('data-referral-value="ABCD2345"');
    expect(html).toContain('Скопировать код');
    expect(html).toContain('Скопировать ссылку');
    expect(html).toContain('data-referral-copy-note');
    expect(linkButton(html)).toContain('hidden');
    expect(linkButton(html)).not.toContain('disabled');
    expect(html).toContain('data-referral-code-input');
    expect(html).toContain('maxlength="12"');
    expect(html).toContain('placeholder="Код друга"');
    expect(html).toContain('data-menu-action="referral_accept"');
    expect(html).toContain('Принять приглашение');
    expect(html).toContain('Приглашено: 4');
    expect(html).toContain('Подтверждено: 3');
    expect(html).toContain('3 друга — VIP 7 дней');
    expect(html).toContain('5 друзей — PREMIUM 7 дней');
    expect(html).toContain('получено');
    expect(html).toContain('осталось 2');
    expect(html).toContain('Friend 7');
    expect(html).toContain('7 мин / 3 ч');
    expect(html).toContain('ожидает');
    expect(html).toContain('mc-referral-list');
    expect(html).toContain('data-menu-action="referral_refresh" data-referral-page="1"');
    expect(html).toContain('data-menu-action="referral_refresh" data-referral-page="2"');
    expect(html).toContain('data-menu-action="referral_claim"');
    expect(html).toContain('Ожидает настройки');
    expect(html).toContain('Уже есть оплаченный ранг.');
    expect(html).toContain('Вас пригласил Ada.');
    expect(html).toContain('1 ч 2 мин / 3 ч');
    expect(html).toContain('Код принят.');
    expect(html).not.toContain('Анархии');
    expect(html).not.toContain('Яндекс ID');
    expect(html).not.toContain('openAuthDialog');
    expect(html).not.toContain('class="mc-menu-list">');
    const confirmed = menuReferralHtml(menu({
      screen: 'friends-invites',
      referral: referral({
        invitees: [{ name: 'Done', activeSeconds: 10800, progressLabel: '3/3 ч — подтверждён', status: 'qualified' }],
        pageCount: 1,
      }),
    }), escape);
    expect(confirmed).toContain('3/3 ч — подтверждён');
    expect(confirmed.match(/подтверждён/g)).toEqual(['подтверждён']);
  });

  it('shows an active copy-link button only when the server already has a url', () => {
    const html = menuReferralHtml(menu({
      screen: 'friends-invites',
      referral: referral({
        link: 'https://yandex.ru/games/app/42?payload=ref_ABCD2345',
        invitees: [],
        pageCount: 1,
        guestWarning: undefined,
      }),
    }), escape);
    const button = linkButton(html);
    expect(button).toContain('data-referral-value="https://yandex.ru/games/app/42?payload=ref_ABCD2345"');
    expect(button).not.toContain('hidden');
    expect(button).not.toContain('disabled');
    expect(html).toContain('Пока никого.');
    expect(html).not.toContain('data-referral-page=');
  });

  it('does not present an empty success list when referrals are unavailable', () => {
    const html = menuReferralHtml(menu({
      screen: 'friends-invites',
      referral: {
        available: false,
        activityNote: 'Активная игра засчитывается на Анархии.',
        unavailableReason: 'Реферальная программа временно недоступна. Сохранённый прогресс не потерян.',
        qualifiedCount: 0,
        invitedCount: 0,
        invitees: [],
        page: 1,
        pageCount: 1,
        rewards: [],
        kit: { state: 'none', detail: '' },
      },
    }), escape);
    expect(html).toContain('Бонус за друга');
    expect(html).toContain('mc-social-menu-body');
    expect(html).toContain('временно недоступна');
    expect(html).not.toContain('Анархии');
    expect(html).not.toContain('Яндекс ID');
    expect(html).not.toContain('Приглашено:');
    expect(html).not.toContain('Пока никого');
    expect(html).not.toContain('data-referral-copy');
  });

  it('reads a Yandex payload without building a fake link', () => {
    expect(parseReferralPayload('ref_abcd2345')).toBe('ABCD2345');
    expect(parseReferralPayload('ref_IIIIIIII')).toBeUndefined();
    expect(parseReferralPayload('https://localhost/ref_ABCD2345')).toBeUndefined();
    expect(referralPublicUrl('http://localhost:3000', 'ABCD2345')).toBeUndefined();
    expect(referralPublicUrl('https://yandex.ru/games/app/42?token=secret', 'ABCD2345')).toBe(
      'https://yandex.ru/games/app/42?payload=ref_ABCD2345',
    );
    captureReferralLaunch('ref_ZXCV2345', '99');
    expect(referralIntentCode()).toBe('ZXCV2345');
    expect(referralLinkFromApp('ZXCV2345')).toBe('https://yandex.ru/games/app/99?payload=ref_ZXCV2345');
    captureReferralLaunch('broken', undefined);
    expect(referralIntentCode()).toBe('ZXCV2345');
    settleReferralIntent({ available: false, invitedBy: 'Ada' });
    expect(referralIntentCode()).toBe('ZXCV2345');
    settleReferralIntent({ available: true });
    expect(referralIntentCode()).toBe('ZXCV2345');
    settleReferralIntent({ available: true, invitedBy: 'Ada' });
    expect(referralIntentCode()).toBeUndefined();
    clearReferralIntent();
  });

  it('reveals the hidden link button from the Yandex app url and keeps the actions', async () => {
    clearReferralIntent();
    captureReferralLaunch(undefined, '99');
    expect(referralLinkFromApp('ABCD2345')).toBe('https://yandex.ru/games/app/99?payload=ref_ABCD2345');
    const root = document.createElement('div');
    document.body.append(root);
    const sent: ClientMenuActionMessage[] = [];
    const ui = new GameUI(root);
    const state = menu({
      screen: 'friends-invites',
      title: 'Бонус за друга',
      referral: referral({ link: undefined, pageCount: 1, invitees: referral().invitees.slice(0, 1) }),
    });
    ui.openGameMenu(state, { send: (message) => sent.push(message), close: () => undefined });
    const hiddenWithoutCode = root.querySelector<HTMLButtonElement>('[data-referral-copy="link"]');
    expect(hiddenWithoutCode).toBeInstanceOf(HTMLButtonElement);
    expect(hiddenWithoutCode?.hidden).toBe(false);
    expect(hiddenWithoutCode?.disabled).toBe(false);
    expect(hiddenWithoutCode?.dataset.referralValue).toBe('https://yandex.ru/games/app/99?payload=ref_ABCD2345');

    ui.openGameMenu(menu({
      screen: 'friends-invites',
      referral: referral({ code: undefined, link: undefined, pageCount: 1, invitees: [] }),
    }), { send: (message) => sent.push(message), close: () => undefined });
    const stillHidden = root.querySelector<HTMLButtonElement>('[data-referral-copy="link"]');
    expect(stillHidden?.hidden).toBe(true);
    expect(stillHidden?.dataset.referralValue ?? '').toBe('');

    const serverLink = 'https://yandex.ru/games/app/42?payload=ref_ABCD2345';
    ui.openGameMenu(menu({
      screen: 'friends-invites',
      referral: referral({ link: serverLink, pageCount: 1 }),
    }), { send: (message) => sent.push(message), close: () => undefined });
    const visible = root.querySelector<HTMLButtonElement>('[data-referral-copy="link"]');
    expect(visible?.hidden).toBe(false);
    expect(visible?.disabled).toBe(false);
    expect(visible?.dataset.referralValue).toBe(serverLink);

    const writes: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { writes.push(value); } },
    });
    root.querySelector<HTMLButtonElement>('[data-referral-copy="code"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toEqual(['ABCD2345']);
    expect(root.querySelector('[data-referral-copy-note]')?.textContent).toBe('Скопировано.');

    const input = root.querySelector<HTMLInputElement>('[data-referral-code-input]');
    expect(input?.maxLength).toBe(12);
    if (input) input.value = 'ZXCV2345';
    root.querySelector('[data-menu-action="referral_accept"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root.querySelector('[data-menu-action="referral_claim"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(sent).toContainEqual({ type: 'menu_action', action: 'referral_accept', name: 'ZXCV2345' });
    expect(sent).toContainEqual({ type: 'menu_action', action: 'referral_claim' });

    ui.openGameMenu(menu({
      screen: 'friends-invites',
      referral: referral({ page: 2, pageCount: 3 }),
    }), { send: (message) => sent.push(message), close: () => undefined });
    root.querySelector<HTMLButtonElement>('[data-referral-page="3"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('[data-referral-page="1"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const refresh = [...root.querySelectorAll<HTMLButtonElement>('[data-menu-action="referral_refresh"]')]
      .find((button) => button.dataset.referralPage === undefined && button.textContent === 'Обновить');
    refresh?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(sent).toContainEqual({ type: 'menu_action', action: 'referral_refresh', page: 3 });
    expect(sent).toContainEqual({ type: 'menu_action', action: 'referral_refresh', page: 1 });
    expect(sent).toContainEqual({ type: 'menu_action', action: 'referral_refresh' });
    clearReferralIntent();
  });
});
