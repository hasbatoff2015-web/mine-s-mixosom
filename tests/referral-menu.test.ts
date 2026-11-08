import { describe, expect, it } from 'vitest';
import { menuFriendsHtml, menuReferralHtml } from '../src/ui/gameMenuGui';
import { menuLogicalHeight } from '../src/ui/containerTheme';
import { captureReferralLaunch, referralIntentCode, referralLinkFromApp } from '../src/yandex/referralIntent';
import { parseReferralPayload, referralPublicUrl } from '../shared/referral';
import type { ServerMenuMessage } from '../shared/protocol';
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

describe('referral menu', () => {
  it('keeps the friends list and adds an invitations section', () => {
    const html = menuFriendsHtml(menu(), escape);
    expect(html).toContain('Заявки в друзья');
    expect(html).toContain('data-menu-friend-accept');
    expect(html).toContain('data-menu-friend-chat');
    expect(html).toContain('data-menu-open="friends-invites"');
    expect(html).toContain('Приглашения');
    expect(isGameMenuScreenKind('friends-invites')).toBe(true);
    expect(menuLogicalHeight('friends-invites')).toBeGreaterThan(menuLogicalHeight('friends'));
  });

  it('renders the code, progress, rewards, and a scrolling invitee list', () => {
    const html = menuReferralHtml(menu({
      screen: 'friends-invites',
      referral: {
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
      },
    }), escape);
    expect(html).toContain('ABCD2345');
    expect(html).toContain('Скопировать код');
    expect(html).toContain('Скопировать ссылку');
    expect(html).toContain('data-referral-code-input');
    expect(html).toContain('Принять приглашение');
    expect(html).toContain('Подтверждено: 3');
    expect(html).toContain('Friend 7');
    expect(html).toContain('mc-referral-list');
    expect(html).toContain('Ожидает настройки');
    expect(html).toContain('Анархии');
    expect(html).toContain('Яндекс ID');
    expect(html).not.toContain('openAuthDialog');
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
    expect(html).toContain('временно недоступна');
    expect(html).not.toContain('Приглашено:');
    expect(html).not.toContain('Пока никого');
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
  });
});
