import { showsMenuBack, type MenuScreenKind } from '../../shared/menu';
import { TRADE_SLOT_COUNT } from '../../shared/trade';
import type { NetworkMenuFriend, ServerMenuMessage } from '../../shared/protocol';
import { keepAuctionSearchDraft } from './auctionGui';

export const keepMenuDraft = keepAuctionSearchDraft;

export const MENU_SPAWN_LABEL = 'Телепортироваться на спавн';

export const MENU_PAGE_ICONS: readonly { readonly id: string; readonly action: string; readonly label: string; readonly glyph: string }[] = [
  { id: 'homes', action: 'open_homes', label: 'Дома', glyph: '⌂' },
  { id: 'friends', action: 'open_friends', label: 'Друзья', glyph: '👥' },
  { id: 'clans', action: 'open_clans', label: 'Кланы', glyph: '◆' },
  { id: 'claims', action: 'open_claims', label: 'Приваты', glyph: '🔒' },
  { id: 'trade', action: 'open_trade', label: 'Обмен', glyph: '⇄' },
  { id: 'auction', action: 'open_auction', label: 'Аукцион', glyph: '⚖' },
];

export function menuShowsBack(screen: MenuScreenKind): boolean {
  return showsMenuBack(screen);
}

export function menuConfirmPrompt(kind: 'home' | 'friend' | 'claim', name: string): string {
  if (kind === 'home') return `Вы уверены, что хотите удалить дом «${name}»?`;
  if (kind === 'friend') return `Вы уверены, что хотите удалить игрока «${name}»?`;
  return `Вы уверены, что хотите удалить приват «${name}»?`;
}

export function tradeReadyLabel(selfReady: boolean, selfAccepted: boolean, partnerReady: boolean, partnerAccepted: boolean): {
  readonly self: string;
  readonly partner: string;
} {
  return {
    self: selfAccepted ? 'Вы приняли' : selfReady ? 'Вы готовы' : 'Вы не готовы',
    partner: partnerAccepted ? 'Партнёр принял' : partnerReady ? 'Партнёр готов' : 'Партнёр не готов',
  };
}

export function tradeAcceptEnabled(selfReady: boolean, partnerReady: boolean): boolean {
  return selfReady && partnerReady;
}

export function formatMenuCoords(x: number, y: number, z: number): string {
  return `(${x}, ${y}, ${z})`;
}

export function menuIconButton(action: string, label: string, glyph: string): string {
  return `<button type="button" class="mc-menu-icon" data-menu-action="${action}" aria-label="${label}">
    <span class="mc-menu-glyph" aria-hidden="true">${glyph}</span>
    <span class="mc-menu-icon-label">${label}</span>
  </button>`;
}

export function menuFriendTeleportVisible(friend: Pick<NetworkMenuFriend, 'online' | 'teleportAllowed'>): boolean {
  return friend.online && friend.teleportAllowed;
}

export function menuFriendStatusClass(online: boolean): string {
  return online ? 'is-online' : 'is-offline';
}

export function menuFriendStatusLabel(online: boolean): string {
  return online ? 'Онлайн' : 'Оффлайн';
}

export function menuHudQuickActions(): readonly ['pause', 'chat', 'menu'] {
  return ['pause', 'chat', 'menu'];
}

export function menuMessageHtml(message: string | undefined): string {
  return message
    ? `<div class="mc-ah-message" data-menu-message>${message}</div>`
    : '<div class="mc-ah-message" data-menu-message hidden></div>';
}

export function menuBodyShell(
  screen: string,
  title: string,
  inner: string,
  message: string,
): string {
  return `<div class="mc-ah-body mc-menu-body" data-menu-screen="${screen}">
    <div class="mc-label">${title}</div>
    ${inner}
    ${message}
  </div>`;
}

export function mainMenuHasTopButton(html: string): boolean {
  return html.includes('data-menu-action="spawn"') && !html.includes('Топ') && !html.includes('open_top');
}

export function isMenuSnapshot(state: Pick<ServerMenuMessage, 'type' | 'screen'>): boolean {
  return state.type === 'menu' && state.screen !== 'closed';
}

export { TRADE_SLOT_COUNT };
export type { ServerMenuMessage };
