import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAME_MENU_BUTTONS, showsMenuBack } from '../shared/gameMenu';
import { formatMegacoinAmount } from '../shared/megacoins';
import { menuBackHtml, menuBalanceHtml, menuBodyHtml, menuRootHtml } from '../src/ui/gameMenuGui';
import { MC_MENU_MAX_SCALE, MC_MENU_WIDTH, menuUiScale } from '../src/ui/containerTheme';
import type { ServerMenuMessage } from '../shared/protocol';

const gameUi = readFileSync(new URL('../src/ui/GameUI.ts', import.meta.url), 'utf8');
const gameSource = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
const inputSource = readFileSync(new URL('../src/input/InputManager.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

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
      'spawn', 'homes', 'friends', 'clans', 'claims', 'trade', 'auction',
    ]);
    expect(GAME_MENU_BUTTONS.map((button) => button.label)).toEqual([
      'Спавн', 'Дома', 'Друзья', 'Кланы', 'Приваты', 'Обмен', 'Аукцион',
    ]);
    const html = menuRootHtml({ balance: 5645, balanceLabel: formatMegacoinAmount(5645) });
    expect(html).toContain('Спавн');
    expect(html).toContain('Дома');
    expect(html).toContain('Друзья');
    expect(html).toContain('Кланы');
    expect(html).toContain('Приваты');
    expect(html).toContain('Обмен');
    expect(html).toContain('Аукцион');
    expect(html).not.toContain('Топ');
    expect(html).toContain('mc-menu-grid-row-4');
    expect(html).toContain('mc-menu-grid-row-3');
    expect(html).toContain('icon_spawn.png');
    expect(html).toContain('icon_auction.png');
    expect(html).toContain('Баланс: 5 645 монет');
    expect(html.indexOf('mc-menu-grid-row-4')).toBeLessThan(html.indexOf('mc-menu-grid-row-3'));
    expect(html.indexOf('data-menu-open="spawn"')).toBeLessThan(html.indexOf('data-menu-open="claims"'));
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
    expect(menuUiScale(1920, 1080, MC_MENU_WIDTH, 176)).toBeLessThanOrEqual(MC_MENU_MAX_SCALE);
    expect(menuBalanceHtml({ balance: 100, balanceLabel: '100' })).toContain('Баланс: 100 монет');
    for (const file of [
      'icon_spawn.png', 'icon_homes.png', 'icon_friends.png', 'icon_clans.png',
      'icon_claims.png', 'icon_trade.png', 'icon_auction.png', 'icon_coin.png',
      'close.png', 'close_hover.png', 'pause.png', 'chat.png', 'menu.png', 'back.png',
    ]) {
      expect(existsSync(new URL(`../public/ui/menu/${file}`, import.meta.url))).toBe(true);
    }
  });

  it('shows a back arrow on nested pages and a square X+E close on the menu', () => {
    expect(showsMenuBack('root')).toBe(false);
    expect(showsMenuBack('homes')).toBe(true);
    expect(showsMenuBack('claim-settings')).toBe(true);
    expect(menuBackHtml('root')).toBe('');
    expect(menuBackHtml('friends')).toContain('class="mc-close mc-back"');
    expect(menuBackHtml('friends')).toContain('data-menu-action="back"');
    expect(menuBackHtml('friends')).not.toContain('mc-close-hotkey');
    expect(gameUi).toContain('menuBackHtml(state.screen)');
    expect(gameUi).toContain('this.closeButtonHtml()');
    expect(gameSource).toContain('this.closeGameMenuAndResumeLook(true)');
  });

  it('keeps homes, friends, claims and auction pages in inventory chrome', () => {
    const homes = menuBodyHtml(menu({
      screen: 'homes',
      homes: [{ name: 'Дом', x: 123, y: 64, z: -245 }],
      homeCount: 1,
      homeMax: 4,
    }), (value) => value);
    expect(homes).toContain('Мои дома (1/4)');
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
  });
});
