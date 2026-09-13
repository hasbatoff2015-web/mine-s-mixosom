import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MENU_PAGE_ICONS,
  MENU_SPAWN_LABEL,
  mainMenuHasTopButton,
  menuConfirmPrompt,
  menuFriendStatusClass,
  menuFriendTeleportVisible,
  menuHudQuickActions,
  menuShowsBack,
  tradeAcceptEnabled,
  tradeReadyLabel,
  TRADE_SLOT_COUNT,
} from '../src/ui/menuGui';
import { CONTAINER_STRINGS } from '../src/ui/containerStrings';

const gameUi = readFileSync(new URL('../src/ui/GameUI.ts', import.meta.url), 'utf8');
const gameSource = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
const inputSource = readFileSync(new URL('../src/input/InputManager.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

describe('in-game menu GUI', () => {
  it('keeps the HUD pause/chat/menu stack and M/Tab/T bindings', () => {
    expect(menuHudQuickActions()).toEqual(['pause', 'chat', 'menu']);
    expect(gameUi).toContain('id="hud-quick"');
    expect(gameUi).toContain('data-hud-quick="pause"');
    expect(gameUi).toContain('data-hud-quick="chat"');
    expect(gameUi).toContain('data-hud-quick="menu"');
    expect(css).toContain('#hud-quick');
    expect(css).toContain('flex-direction: column');
    expect(inputSource).toContain("event.code === 'Tab'");
    expect(inputSource).toContain("event.code === 'KeyM'");
    expect(inputSource).toContain('openMenu');
    expect(gameSource).toContain('openGameMenu');
    expect(gameSource).toContain("case 'menu':");
  });

  it('renders inventory-style pages with shared close X+E and back', () => {
    expect(gameUi).toContain('private renderMenu()');
    expect(gameUi).toContain('this.closeButtonHtml()');
    expect(gameUi).toContain('data-menu-action="back"');
    expect(gameUi).toContain('class="mc-close mc-back"');
    expect(menuShowsBack('friends')).toBe(true);
    expect(menuShowsBack('main')).toBe(false);
    expect(CONTAINER_STRINGS.closeHotkey).toBe('E');
    expect(css).toContain('.mc-close-hotkey');
    expect(css).toContain('.mc-menu-list::-webkit-scrollbar');
    expect(css).toContain('touch-action: pan-y');
  });

  it('exposes spawn/homes/friends/clans/claims/trade/auction without Top', () => {
    const html = MENU_PAGE_ICONS.map((icon) => `${icon.action}${icon.label}`).join('|');
    expect(html).toContain('open_homes');
    expect(html).toContain('open_friends');
    expect(html).toContain('open_clans');
    expect(html).toContain('open_claims');
    expect(html).toContain('open_trade');
    expect(html).toContain('open_auction');
    expect(html).not.toContain('Топ');
    expect(MENU_SPAWN_LABEL).toContain('спавн');
    expect(mainMenuHasTopButton('data-menu-action="spawn"')).toBe(true);
    expect(gameUi).toContain('data-menu-action="spawn"');
    expect(gameUi).toContain('data-menu-action="open_auction_browse"');
    expect(gameUi).toContain('data-menu-action="open_auction_list"');
    expect(gameUi).toContain('data-menu-action="open_auction_sell"');
  });

  it('keeps trade ready/accept copy and friend teleport visibility server-driven', () => {
    expect(tradeReadyLabel(false, false, false, false)).toEqual({
      self: 'Вы не готовы',
      partner: 'Партнёр не готов',
    });
    expect(tradeReadyLabel(true, false, true, false)).toEqual({
      self: 'Вы готовы',
      partner: 'Партнёр готов',
    });
    expect(tradeReadyLabel(true, true, true, false)).toEqual({
      self: 'Вы приняли',
      partner: 'Партнёр ещё не принял',
    });
    expect(tradeReadyLabel(true, true, true, true)).toEqual({
      self: 'Вы приняли',
      partner: 'Партнёр принял',
    });
    expect(tradeAcceptEnabled(true, true)).toBe(true);
    expect(tradeAcceptEnabled(true, false)).toBe(false);
    expect(menuFriendTeleportVisible({ online: true, teleportAllowed: true })).toBe(true);
    expect(menuFriendTeleportVisible({ online: true, teleportAllowed: false })).toBe(false);
    expect(menuFriendStatusClass(true)).toBe('is-online');
    expect(menuConfirmPrompt('home', 'Дом')).toContain('Дом');
    expect(gameUi).toContain('data-trade-offer-slot');
    expect(gameUi).toContain('ready_trade');
    expect(gameUi).toContain('accept_trade');
    expect(gameUi).toContain('cancel_trade');
  });

  it('lays the trade window out as two 2x3 grids over the real inventory', () => {
    expect(TRADE_SLOT_COUNT).toBe(6);
    expect(css).toMatch(/\.mc-trade-grid \{[\s\S]*?grid-template-columns: repeat\(3,[\s\S]*?grid-template-rows: repeat\(2,/);
    expect(gameUi).toContain('data-trade-partner-slot');
    expect(gameUi).toContain('data-menu-inv-slot');
    expect(gameUi).toContain('length: 27 }');
    expect(gameUi).toContain('data-menu-trade-money');
    expect(gameUi).toContain('Баланс:');
  });

  it('keeps every menu page reachable and editable on touch devices', () => {
    expect(css).toMatch(/\.mc-menu-list \{[\s\S]*?overflow-y: auto;[\s\S]*?touch-action: pan-y;[\s\S]*?scrollbar-width: none;/);
    expect(css).toMatch(/#hud-quick \{[\s\S]*?pointer-events: auto;/);
    expect(gameUi).toContain('data-menu-home-name');
    expect(gameUi).toContain('data-menu-friend-name');
    expect(gameUi).toContain('data-menu-trade-name');
    expect(gameUi).toContain('data-menu-claim-member');
    expect(gameUi).toContain('data-menu-action="save_claim_name"');
    expect(gameUi).toContain('data-menu-action="set_claim_pvp"');
    expect(gameUi).toContain('data-menu-action="set_teleport_allowed"');
  });
});
