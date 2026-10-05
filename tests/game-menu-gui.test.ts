import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CHAT_CHANNELS } from '../shared/chat';
import { MAX_CHAT_LENGTH, PROTOCOL_VERSION } from '../shared/config';
import { DIRECT_MESSAGE_EMPTY_HISTORY } from '../shared/directMessages';
import { GAME_MENU_BUTTONS, showsMenuBack } from '../shared/gameMenu';
import { HOME_MAX_DEFAULT } from '../shared/homes';
import { formatMegacoinAmount } from '../shared/megacoins';
import { friendChatMessageHtml, menuBackHtml, menuBalanceHtml, menuBodyHtml, menuRootHtml } from '../src/ui/gameMenuGui';
import { MC_MENU_MAX_SCALE, MC_MENU_ROOT_HEIGHT, MC_MENU_WIDTH, menuLogicalHeight, menuUiScale } from '../src/ui/containerTheme';
import type { ServerMenuMessage } from '../shared/protocol';

const gameUi = readFileSync(new URL('../src/ui/GameUI.ts', import.meta.url), 'utf8');
const gameSource = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
const inputSource = readFileSync(new URL('../src/input/InputManager.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

function cssRule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  expect(end, `${selector} end`).toBeGreaterThan(start);
  return css.slice(start, end + 2);
}

function menu(partial: Partial<ServerMenuMessage> = {}): ServerMenuMessage {
  return { type: 'menu', screen: 'root', title: 'Меню', ...partial };
}

describe('main menu HUD and chrome', () => {
  it('places Pause, Chat and Menu buttons in the top-right HUD', () => {
    expect(gameUi).toContain('id="hud-corner"');
    expect(gameUi).toContain('id="hud-pause"');
    expect(gameUi).toContain('id="hud-chat"');
    expect(gameUi).toContain('id="hud-menu"');
    expect(gameUi).toContain('hud-corner-key">TAB');
    expect(gameUi).toContain('hud-corner-key">T');
    expect(gameUi).toContain('hud-corner-key">M');
    expect(gameUi).toContain('hud-corner-label">Пауза');
    expect(gameUi).toContain('hud-corner-label">Чат');
    expect(gameUi).toContain('hud-corner-label">Меню');
    expect(css).toContain('#hud-corner');
    expect(css).toContain('flex-direction: column');
    expect(cssRule('#hud-corner button')).toContain('width: calc(76px * var(--hud-scale));');
    expect(cssRule('#hud-corner button')).toContain('height: calc(76px * var(--hud-scale));');
    expect(cssRule('#hud-corner button')).toContain('background-size: contain;');
    expect(cssRule('#hud-corner button')).toContain('aspect-ratio: 1;');
    expect(css).toContain('#chat.open ~ #hud-corner');
  });

  it('binds TAB to pause, T to chat and M to menu without replacing existing pause/chat', () => {
    expect(inputSource).toContain("event.code === 'Tab'");
    expect(inputSource).toContain('this.callbacks.togglePause()');
    expect(inputSource).toContain("event.code === 'KeyT'");
    expect(inputSource).toContain("event.code === 'KeyM'");
    expect(inputSource).toContain('this.callbacks.toggleMenu?.()');
    expect(gameSource).toContain('togglePause: () => this.togglePause()');
    expect(gameSource).toContain('toggleMenu: () => this.toggleGameMenu()');
    expect(gameSource).toContain('this.ui.onHudPause');
    expect(gameSource).toContain('this.ui.onHudChat');
    expect(gameSource).toContain('this.ui.onHudMenu');
  });

  it('lists the required menu buttons and omits Top', () => {
    expect(GAME_MENU_BUTTONS.map((button) => button.id)).toEqual([
      'spawn', 'homes', 'friends', 'clans', 'claims', 'trade', 'auction', 'rating', 'duels',
    ]);
    expect(GAME_MENU_BUTTONS.map((button) => button.label)).toEqual([
      'Спавн', 'Дома', 'Друзья', 'Кланы', 'Приваты', 'Обмен', 'Аукцион', 'Рейтинг', 'Дуэли',
    ]);
    const html = menuRootHtml({ balance: 5645, balanceLabel: formatMegacoinAmount(5645) });
    expect(html).toContain('Спавн');
    expect(html).toContain('Дома');
    expect(html).toContain('Друзья');
    expect(html).toContain('Кланы');
    expect(html).toContain('Приваты');
    expect(html).toContain('Обмен');
    expect(html).toContain('Аукцион');
    expect(html).toContain('Рейтинг');
    expect(html).toContain('Дуэли');
    expect(html).not.toContain('Топ');
    expect(html.match(/mc-menu-grid-row-3-full/g)).toHaveLength(3);
    expect(html).not.toContain('mc-menu-grid-row-4');
    expect(html).toContain('icon_spawn.png');
    expect(html).toContain('icon_auction.png');
    expect(html).toContain('icon_rating.png');
    expect(html).toContain('icon_duels.png');
    const openOrder = [...html.matchAll(/data-menu-open="([^"]+)"/g)].map((match) => match[1]);
    expect(openOrder).toEqual([
      'spawn', 'homes', 'friends', 'clans', 'claims', 'trade', 'auction', 'rating', 'duels',
    ]);
    expect(html).toContain('Баланс: 5 645 монет');
    expect(html.indexOf('data-menu-open="spawn"')).toBeLessThan(html.indexOf('data-menu-open="claims"'));
    expect(gameUi).toContain('isGameMenuScreenKind');
    expect(gameUi).toContain("action: 'open', screen: id");
    expect(gameUi).toContain("id === 'rating'");
    expect(gameUi).toContain("action: 'open', screen: 'rating'");
    expect(gameUi).toContain("action: 'rating_set'");
    expect(gameUi).toContain("target.closest('[data-ui=\"close\"]')");
    expect(gameUi).toContain("target.closest('input, textarea, label')");
    expect(css).toContain('#app.controls-suppressed canvas');
    expect(css).toContain('#app.controls-suppressed #ui-root');
    expect(gameUi).toContain('resetOverlayModal');
    expect(gameUi).toContain('bindOverlayPointerShield');
    expect(gameUi).toContain('event.stopPropagation()');
    expect(css).toContain('.mc-menu-tile-icon');
    expect(cssRule('.mc-menu-tile-icon')).toContain('background: transparent;');
    const icon = readFileSync(new URL('../public/ui/menu/icon_rating.png', import.meta.url));
    expect(icon.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(icon[25]).toBe(6);
    expect(icon.readUInt32BE(16)).toBeLessThanOrEqual(128);
    expect(icon.readUInt32BE(20)).toBeLessThanOrEqual(128);
    const alpha = execFileSync('python3', ['-c', [
      'from PIL import Image',
      "im = Image.open('public/ui/menu/icon_rating.png').convert('RGBA')",
      'zeros = sum(1 for px in im.getdata() if px[3] == 0)',
      "print('transparent' if zeros > 1000 and im.getpixel((0,0))[3] == 0 else 'opaque')",
    ].join('; ')], { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname.replace(/\/$/, '') });
    expect(alpha.trim()).toBe('transparent');
  });

  it('keeps a compact dark menu panel and ships pixel-art chrome assets', () => {
    expect(css).toContain('.mc-menu-panel');
    expect(css).toContain('.mc-menu-tile');
    expect(css).toContain('.mc-menu-grid-row-4');
    expect(css).toContain('.mc-menu-grid-row-3');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(gameUi).toContain('this.closeButtonHtml()');
    expect(gameUi).toContain('mc-menu-stage');
    expect(gameUi).toContain('overlayStageStyle(');
    expect(MC_MENU_WIDTH).toBe(248);
    expect(MC_MENU_ROOT_HEIGHT).toBe(238);
    expect(menuLogicalHeight('root')).toBe(238);
    expect(menuLogicalHeight('duels')).toBe(292);
    expect(menuUiScale(1920, 1080, MC_MENU_WIDTH, MC_MENU_ROOT_HEIGHT)).toBeLessThanOrEqual(MC_MENU_MAX_SCALE);
    for (const [width, height] of [[1920, 1080], [1366, 768], [844, 390]] as const) {
      for (const logicalHeight of [MC_MENU_ROOT_HEIGHT, menuLogicalHeight('duels')]) {
        const scale = menuUiScale(width, height, MC_MENU_WIDTH, logicalHeight);
        expect(scale).toBeGreaterThanOrEqual(1);
        expect(scale).toBeLessThanOrEqual(MC_MENU_MAX_SCALE);
        expect(scale * MC_MENU_WIDTH).toBeLessThanOrEqual(width - 24 + 1e-6);
        expect(scale * logicalHeight).toBeLessThanOrEqual(height - 24 + 1e-6);
      }
    }
    expect(css).toContain('.mc-menu-grid-row-3-full');
    expect(cssRule('.mc-menu-grid-row-3-full')).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(cssRule('.mc-menu-grid-row-3-full')).toContain('width: 100%;');
    expect(cssRule('.mc-menu-grid-row-3')).toContain('width: calc(75% - var(--mc-menu-gap) / 4);');
    expect(css).not.toContain('--duel-scale');
    expect(gameUi).toContain('menuUiScale(');
    expect(menuBalanceHtml({ balance: 100, balanceLabel: '100' })).toContain('Баланс: 100 монет');
    expect(menuBalanceHtml({ balance: 100, balanceLabel: '100' })).toContain('mc-menu-coin');
    expect(menuBalanceHtml({ balance: 100, balanceLabel: '100' })).toContain('mc-menu-coin-wrap');
    expect(cssRule('.mc-menu-coin')).toContain('object-fit: contain;');
    expect(cssRule('.mc-menu-coin')).toContain('image-rendering: auto;');
    expect(cssRule('.mc-menu-coin-wrap')).toContain('width: calc(16px * var(--mc-ui-scale, 3));');
    expect(cssRule('.mc-menu-coin-wrap')).toContain('height: calc(16px * var(--mc-ui-scale, 3));');
    expect(cssRule('.mc-menu-coin-wrap')).toContain('flex-shrink: 0;');
    expect(cssRule('.mc-menu-coin')).toContain('max-width: 100%;');
    expect(cssRule('.mc-menu-balance')).toContain('align-items: center;');
    expect(cssRule('.mc-menu-balance')).toContain('overflow: visible;');
    for (const file of [
      'icon_spawn.png', 'icon_homes.png', 'icon_friends.png', 'icon_clans.png',
      'icon_claims.png', 'icon_trade.png', 'icon_auction.png', 'icon_rating.png', 'icon_coin.png',
      'close.png', 'close_hover.png', 'pause.png', 'chat.png', 'menu.png', 'back.png',
    ]) {
      expect(existsSync(new URL(`../public/ui/menu/${file}`, import.meta.url))).toBe(true);
    }
  });

  it('shows a back arrow on nested pages and a square X+E close on the menu', () => {
    expect(showsMenuBack('root')).toBe(false);
    expect(showsMenuBack('homes')).toBe(true);
    expect(showsMenuBack('claim-settings')).toBe(true);
    expect(showsMenuBack('auction-history')).toBe(true);
    expect(menuBackHtml('root')).toBe('');
    expect(menuBackHtml('friends')).toContain('class="mc-close mc-back"');
    expect(menuBackHtml('friends')).toContain('data-menu-action="back"');
    expect(menuBackHtml('friends')).not.toContain('mc-close-hotkey');
    expect(gameUi).toContain('menuBackHtml(state.screen)');
    expect(gameUi).toContain('this.closeButtonHtml()');
    expect(gameSource).toContain('this.closeGameMenuAndResumeLook(true)');
    expect(gameSource).toContain('resumeLookIfNoOverlay');
    expect(gameSource).toContain('if (this.ui.isBlockingOverlay()) return;');
    const resumeLook = gameSource.slice(
      gameSource.indexOf('private resumeLookIfNoOverlay'),
      gameSource.indexOf('private closeAuctionAndResumeLook'),
    );
    expect(resumeLook).toContain('tryRequestPointerLock');
    expect(resumeLook).not.toContain('this.enterPlaying()');
    expect(gameSource).toContain('this.ui.closeGameMenu();');
    expect(gameSource).toContain('this.ui.closeTrade();');
  });

  it('keeps homes, friends, claims and auction pages in inventory chrome', () => {
    const homes = menuBodyHtml(menu({
      screen: 'homes',
      homes: [{ name: 'Дом', x: 123, y: 64, z: -245 }],
      homeCount: 1,
      homeMax: HOME_MAX_DEFAULT,
    }), (value) => value);
    expect(HOME_MAX_DEFAULT).toBe(3);
    expect(homes).toContain('Мои дома (1/3)');
    expect(menuBodyHtml(menu({ screen: 'homes', homeCount: 2 }), (value) => value)).toContain('Мои дома (2/3)');
    expect(homes).toContain('X: 123');
    expect(homes).toContain('Y: 64');
    expect(homes).toContain('Z: -245');
    expect(homes).toContain('Телепорт');
    expect(homes).toContain('Удалить');
    expect(homes).toContain('data-menu-action="home_create"');

    const friends = menuBodyHtml(menu({
      screen: 'friends',
      allowFriendTeleport: true,
      friends: [{ playerId: 'a', name: 'Ada', online: true, canTeleport: true }],
      friendCount: 1,
      friendMax: 50,
    }), (value) => value);
    expect(friends).toContain('Разрешена');
    expect(friends).toContain('Телепорт');
    expect(friends).toContain('Удалить');
    expect(friends).toContain('mc-status-dot');
    expect(friends).toContain('mc-toggle is-on');
    expect(friends).toContain('data-menu-friend-tp');
    expect(friends).toContain('Мои друзья (1/50)');

    const offline = menuBodyHtml(menu({
      screen: 'friends',
      allowFriendTeleport: false,
      friends: [{ playerId: 'b', name: 'Bob', online: false, canTeleport: false }],
    }), (value) => value);
    expect(offline).toContain('Запрещена');
    expect(offline).not.toContain('data-menu-friend-tp');
    expect(offline).toContain('Оффлайн');

    const claims = menuBodyHtml(menu({
      screen: 'claims',
      claims: [{ claimId: 'c1', name: '1', title: 'Алмазный приват', x: 1, y: 2, z: 3 }],
      claimCount: 1,
      claimMax: 4,
    }), (value) => value);
    expect(claims).toContain('Ваши приваты (1/4)');
    expect(claims).toContain('Алмазный приват');

    const auction = menuBodyHtml(menu({ screen: 'auction' }), (value) => value);
    expect(auction).toContain('auction_open');
    expect(auction).toContain('auction_list');
    expect(auction).toContain('auction_sell');
    expect(auction).toContain('auction_history');
    expect(auction).toContain('История сделок');

    const trade = menuBodyHtml(menu({
      screen: 'trade',
      tradeNearby: [{ playerId: 'p1', name: 'PlayerOne', distance: 5 }],
    }), (value) => value);
    expect(trade).toContain('Рядом');
    expect(trade).toContain('trade_refresh');
    expect(trade).toContain('5 бл.');
    expect(trade).toContain('data-menu-trade-nearby="PlayerOne"');
    expect(trade).toContain('Обмен');

    const tradeEmpty = menuBodyHtml(menu({ screen: 'trade' }), (value) => value);
    expect(tradeEmpty).toContain('Обмениваться можно только с игроками, которые находятся рядом с вами (до 20 блоков).');

    const rating = menuBodyHtml(menu({
      screen: 'rating',
      ratingKind: 'players-money',
      ratingPage: 2,
      ratingTotalPages: 5,
      ratingRows: [
        { rank: 11, id: 'a', name: 'Ada', value: 100, valueLabel: '100', metric: 'money', highlight: true },
        { rank: 12, id: 'b', name: 'Bob', value: 90, valueLabel: '90', metric: 'money', highlight: false },
      ],
      personalRank: 11,
      personalText: 'Ваше место: #11',
    }), (value) => value);
    expect(rating).toContain('Игроки');
    expect(rating).toContain('Кланы');
    expect(rating).toContain('По монетам');
    expect(rating).toContain('По убийствам');
    expect(rating).toContain('Страница 2 / 5');
    expect(rating).toContain('mc-rank-you');
    expect(rating).toContain('Ваше место: #11');
    expect(rating).toContain('data-menu-rating="players-kills"');
    expect(rating).toContain('data-menu-rating="clans-kills"');
    expect(rating).toContain('mc-menu-coin');
    expect(rating).toContain('icon_coin.png');
    expect(rating).not.toContain('🪙');
    const clansTab = menuBodyHtml(menu({ screen: 'clans' }), (value) => value);
    expect(clansTab).toContain('clans_invitations');
    expect(clansTab).toContain('Приглашения');
  });

  it('renders yellow square unread badges on menu tiles without shifting layout', () => {
    const hidden = menuRootHtml({ balance: 0, balanceLabel: '0' });
    expect(hidden).not.toContain('mc-menu-badge');
    const shown = menuRootHtml({
      notifications: { friends: 3, clans: 1, auction: 2, trade: 1, duels: 0 },
    });
    expect(shown).toContain('data-menu-open="friends"');
    expect(shown.match(/mc-menu-badge/g)?.length).toBe(4);
    expect(shown).toContain('>3</span>');
    expect(shown).toContain('>1</span>');
    expect(shown).toContain('>2</span>');
    const huge = menuRootHtml({ notifications: { friends: 100, clans: 0, auction: 0, trade: 0, duels: 0 } });
    expect(huge).toContain('99+');
    expect(huge.match(/mc-menu-badge/g)?.length).toBe(1);
    expect(cssRule('.mc-menu-tile')).toContain('position: relative;');
    expect(cssRule('.mc-menu-badge')).toContain('position: absolute;');
    expect(cssRule('.mc-menu-badge')).toContain('top: calc(2px * var(--mc-ui-scale, 3));');
    expect(cssRule('.mc-menu-badge')).toContain('right: calc(2px * var(--mc-ui-scale, 3));');
    expect(cssRule('.mc-menu-badge')).toContain('background: #f5d000;');
    expect(cssRule('.mc-menu-badge')).toContain('color: #111;');
    expect(cssRule('.mc-menu-badge')).toContain('pointer-events: none;');
    expect(cssRule('.mc-menu-badge')).toContain('z-index: 2;');
    expect(gameUi).toContain('resetOverlayModal');
    expect(gameUi).toContain('bindOverlayPointerShield');
  });

  it('renders auction deal history as a nested menu screen', () => {
    const empty = menuBodyHtml(menu({ screen: 'auction-history', auctionHistory: [] }), (value) => value);
    expect(empty).toContain('История сделок');
    expect(empty).toContain('История сделок пуста');
    const filled = menuBodyHtml(menu({
      screen: 'auction-history',
      auctionHistory: [{
        id: 'ahist-1',
        kind: 'sell',
        title: 'Вы продали 32 Алмаз за 12 000 Мегакоинов',
        ago: '2 часа назад',
        timestamp: 1,
      }],
    }), (value) => value);
    expect(filled).toContain('Вы продали 32 Алмаз за 12 000 Мегакоинов');
    expect(filled).toContain('2 часа назад');
    expect(filled).not.toContain('История сделок пуста');
    expect(menuBackHtml('auction-history')).toContain('data-menu-action="back"');
  });

  it('puts a green Chat button immediately left of Delete on every friend row', () => {
    const escape = (value: string) => value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const withTeleport = menuBodyHtml(menu({
      screen: 'friends',
      allowFriendTeleport: true,
      friends: [{
        playerId: 'ada',
        name: 'ThirteenChars',
        online: true,
        canTeleport: true,
        unreadCount: 3,
      }],
      friendCount: 1,
      friendMax: 50,
    }), escape);
    const teleportRow = withTeleport.slice(withTeleport.indexOf('mc-friend-row'));
    const teleportAt = teleportRow.indexOf('data-menu-friend-tp');
    const chatAt = teleportRow.indexOf('data-menu-friend-chat');
    const deleteAt = teleportRow.indexOf('data-menu-friend-delete');
    expect(teleportAt).toBeGreaterThan(0);
    expect(teleportAt).toBeLessThan(chatAt);
    expect(chatAt).toBeLessThan(deleteAt);
    expect(teleportRow).toContain('>Телепорт</button>');
    expect(teleportRow).toContain('class="mc-ah-btn mc-btn-positive" data-menu-friend-chat="ada"');
    expect(teleportRow).toContain('class="mc-ah-btn mc-btn-danger" data-menu-friend-delete="ada"');
    expect(teleportRow).toContain('ThirteenChars');
    expect(teleportRow).toContain('class="mc-menu-badge mc-friend-unread">3</span>');
    expect(teleportRow).toContain('Онлайн');

    const withoutTeleport = menuBodyHtml(menu({
      screen: 'friends',
      friends: [
        { playerId: 'bob', name: 'Bo', online: false, canTeleport: false, unreadCount: 0 },
        { playerId: 'cara', name: 'Cara', online: true, canTeleport: false, unreadCount: 100 },
      ],
    }), escape);
    expect(withoutTeleport).not.toContain('data-menu-friend-tp');
    const bobRow = withoutTeleport.slice(withoutTeleport.indexOf('data-menu-friend-chat="bob"') - 80);
    expect(bobRow.indexOf('data-menu-friend-chat="bob"')).toBeLessThan(bobRow.indexOf('data-menu-friend-delete="bob"'));
    expect(bobRow).toContain('>Чат</button>');
    expect(bobRow).toContain('>Удалить</button>');
    expect(withoutTeleport).not.toContain('mc-friend-unread">0');
    expect(withoutTeleport).toContain('class="mc-menu-badge mc-friend-unread">99+</span>');
    expect(withoutTeleport).toContain('Оффлайн');
    expect(cssRule('.mc-friend-row')).toContain('flex-wrap: nowrap;');
    expect(cssRule('.mc-friend-row .mc-ah-btn')).toContain('min-width: calc(32px * var(--mc-ui-scale, 3));');
    expect(cssRule('.mc-menu-badge.mc-friend-unread')).toContain('position: static;');
  });

  it('renders the friend chat screen inside the friends footprint and escapes message text', () => {
    const escape = (value: string) => value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, '&#39;')
      .replace(/"/g, '&quot;');
    expect(MC_MENU_WIDTH).toBe(248);
    expect(MC_MENU_MAX_SCALE).toBe(3);
    expect(menuLogicalHeight('friends')).toBe(268);
    expect(menuLogicalHeight('friend-chat')).toBe(268);
    expect(showsMenuBack('friend-chat')).toBe(true);
    expect(menuBackHtml('friend-chat')).toContain('data-menu-action="back"');
    expect(CHAT_CHANNELS).toEqual(['global', 'nearby', 'clan']);
    expect(PROTOCOL_VERSION).toBe(4);
    expect(MAX_CHAT_LENGTH).toBe(128);

    const online = menuBodyHtml(menu({
      screen: 'friend-chat',
      title: 'Чат',
      activeFriendId: 'ada',
      activeFriendName: 'ThirteenChars',
      activeFriendOnline: true,
    }), escape);
    expect(online).toContain('Чат с ThirteenChars');
    expect(online).toContain('data-menu-screen="friend-chat"');
    expect(online).toContain('data-friend-id="ada"');
    expect(online).toContain('is-online');
    expect(online).toContain('data-friend-chat-presence');
    expect(online).toContain('Онлайн');
    expect(online).toContain(DIRECT_MESSAGE_EMPTY_HISTORY);
    expect(online).toContain(`maxlength="${MAX_CHAT_LENGTH}"`);
    expect(online).toContain('placeholder="Сообщение..."');
    expect(online).toContain('data-friend-chat-input');
    expect(online).toContain('data-friend-chat-send');
    expect(online).toContain('>Отправить</button>');
    expect(online).toContain('mc-btn-positive');

    const offline = menuBodyHtml(menu({
      screen: 'friend-chat',
      activeFriendId: 'bob',
      activeFriendName: 'Bob',
      activeFriendOnline: false,
    }), escape);
    expect(offline).toContain('Чат с Bob');
    expect(offline).toContain('is-offline');
    expect(offline).toContain('Оффлайн');

    const hostile = '<img src=x onerror=alert(1)>';
    const incoming = friendChatMessageHtml({
      messageId: 'm1',
      seq: 1,
      senderId: 'ada',
      recipientId: 'bob',
      text: hostile,
      createdAt: Date.UTC(2026, 0, 2, 15, 4),
    }, 'bob', escape);
    expect(incoming).toContain('mc-dm is-in');
    expect(incoming).toContain('data-dm-id="m1"');
    expect(incoming).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(incoming).not.toContain('<img');
    expect(incoming).toContain('mc-dm-time');
    const outgoing = friendChatMessageHtml({
      messageId: 'm2',
      seq: 2,
      senderId: 'bob',
      recipientId: 'ada',
      text: 'привет',
      createdAt: Date.UTC(2026, 0, 2, 15, 5),
    }, 'bob', escape);
    expect(outgoing).toContain('mc-dm is-out');
    expect(outgoing).toContain('привет');
    expect(cssRule('.mc-menu-panel.mc-menu-panel-chat')).toContain('height: calc(268px * var(--mc-ui-scale, 3));');
    expect(cssRule('.mc-menu-panel-chat .mc-friend-chat')).toContain('minmax(0, 1fr)');
    expect(cssRule('.mc-friend-chat-log')).toContain('touch-action: pan-y;');
    expect(cssRule('.mc-friend-chat-log')).toContain('scrollbar-width: none;');
    expect(cssRule('.mc-friend-chat-log')).toContain('background: #15171b;');
    expect(cssRule('.mc-dm.is-in .mc-dm-text')).toContain('background: #2c3036;');
    expect(cssRule('.mc-dm.is-out .mc-dm-text')).toContain('background: #24412d;');
    expect(cssRule('.mc-dm')).toContain('max-width: 78%;');
    expect(cssRule('.mc-dm-text')).toContain('border-radius: 2px;');
    expect(gameUi).toContain('data-friend-chat-input');
    expect(gameUi).toContain('sendDirect');
    expect(gameUi).toContain("action: 'friends_chat'");
    expect(gameUi).toContain('event.isComposing');
    expect(gameUi).toContain('planDirectMessageScroll');
    expect(gameSource).toContain("case 'direct_message'");
  });

  it('renders the duel screen inside the same 248px menu chrome', () => {
    const escape = (value: string) => value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const html = menuBodyHtml(menu({
      screen: 'duels',
      title: 'Дуэли',
      duelStats: { wins: 12, losses: 7 },
      duelArenaConfigured: true,
      duelArenaBusy: false,
      duelCooldownMs: 0,
      duelIncoming: [{ requestId: 'req-1', playerId: 'b', name: '<Bob>', wins: 3, losses: 1 }],
      duelOutgoing: { playerId: 'c', name: 'Cara', secondsLeft: 24 },
      duelNearby: [{ playerId: 'd', name: 'Dan', wins: 0, losses: 0, distance: 8, canChallenge: true }],
      message: 'Арена свободна.',
    }), escape);
    expect(html).toContain('Дуэли');
    expect(html).toContain('Победы: 12');
    expect(html).toContain('Поражения: 7');
    expect(html).toContain('● Арена свободна');
    expect(html).toContain('is-free');
    expect(html).toContain('Входящие вызовы');
    expect(html).toContain('&lt;Bob&gt;');
    expect(html).not.toContain('<Bob>');
    expect(html).toContain('Счёт: 3 : 1');
    expect(html).toContain('data-menu-duel-accept="req-1"');
    expect(html).toContain('Принять');
    expect(html).toContain('data-menu-duel-decline="req-1"');
    expect(html).toContain('Отклонить');
    expect(html).toContain('Вызов отправлен: Cara');
    expect(html).toContain('осталось 24 сек.');
    expect(html).toContain('Игроки рядом');
    expect(html).toContain('data-menu-action="duel_refresh"');
    expect(html).toContain('Обновить');
    expect(html).toContain('Счёт: 0 : 0');
    expect(html).toContain('8 блоков');
    expect(html).toContain('data-menu-duel-challenge="d"');
    expect(html).toContain('Вызвать');
    expect(html).toContain('Арена свободна.');
    expect(html).toContain('mc-player-row');
    expect(html).toContain('mc-btn-positive');
    expect(html).toContain('mc-btn-danger');
    const busy = menuBodyHtml(menu({
      screen: 'duels',
      duelStats: { wins: 0, losses: 0 },
      duelArenaConfigured: true,
      duelArenaBusy: true,
      duelIncoming: [{ requestId: 'req-2', playerId: 'b', name: 'Bob', wins: 0, losses: 0 }],
    }), escape);
    expect(busy).toContain('● Арена занята');
    expect(busy).toContain('is-busy');
    expect(busy).toContain('data-menu-duel-accept="req-2" disabled');
    const missing = menuBodyHtml(menu({
      screen: 'duels',
      duelArenaConfigured: false,
      duelNearby: [{ playerId: 'd', name: 'Dan', wins: 0, losses: 0, distance: 4, canChallenge: false }],
    }), escape);
    expect(missing).toContain('Арена не настроена.');
    expect(missing).toContain('data-menu-duel-challenge="d" disabled');
    expect(cssRule('.mc-duel-summary')).toContain('justify-content: space-between;');
    expect(cssRule('.mc-duel-summary')).toContain('var(--mc-ui-scale, 3)');
    expect(cssRule('.mc-duel-incoming')).toContain('max-height: calc(60px * var(--mc-ui-scale, 3));');
    expect(cssRule('.mc-duel-nearby')).toContain('max-height: calc(100px * var(--mc-ui-scale, 3));');
    expect(cssRule('.mc-duel-list')).toContain('touch-action: pan-y;');
    expect(css).toContain('.mc-duel-wins { color: #6fbf78; }');
    expect(css).toContain('.mc-duel-losses { color: #d67b7b; }');
    expect(gameUi).toContain('data-menu-duel-challenge');
    expect(gameUi).toContain("action: 'duel_challenge'");
    expect(gameUi).toContain("action: 'duel_accept'");
    expect(gameUi).toContain("action: 'duel_decline'");
  });
});
