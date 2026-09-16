import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAME_MENU_BUTTONS, showsMenuBack } from '../shared/gameMenu';
import { menuBackHtml, menuBodyHtml, menuRootHtml } from '../src/ui/gameMenuGui';
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
    const html = menuRootHtml();
    expect(html).toContain('Спавн');
    expect(html).toContain('Дома');
    expect(html).toContain('Друзья');
    expect(html).toContain('Кланы');
    expect(html).toContain('Приваты');
    expect(html).toContain('Обмен');
    expect(html).toContain('Аукцион');
    expect(html).not.toContain('Топ');
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
    expect(homes).toContain('(123, 64, -245)');
    expect(homes).toContain('data-menu-action="home_create"');

    const friends = menuBodyHtml(menu({
      screen: 'friends',
      allowFriendTeleport: true,
      friends: [{ playerId: 'a', name: 'Ada', online: true, canTeleport: true }],
      friendCount: 1,
      friendMax: 50,
    }), (value) => value);
    expect(friends).toContain('Разрешена');
    expect(friends).toContain('Телепортироваться');
    expect(friends).toContain('Мои друзья (1/50)');

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
  });
});
