import { CLAN_ICON_GLYPH, CLAN_ICON_IDS, CLAN_MAX_MEMBERS, isClanIconId, type ClanIconId } from '../../shared/clans';
import { formatCompactMegacoins } from '../../shared/megacoins';
import { keepAuctionSearchDraft } from './auctionGui';
import type { NetworkClanRow, ServerClanMessage } from '../../shared/protocol';

export const keepClanSearchDraft = keepAuctionSearchDraft;

export const CLAN_COIN_HTML = '<span class="mc-clan-coin" aria-hidden="true"></span>';

export function clanIconGlyph(icon: string | undefined): string {
  return isClanIconId(icon) ? CLAN_ICON_GLYPH[icon] : '⚔';
}

export function clanIconHtml(icon: string | undefined, extraClass = ''): string {
  const id = isClanIconId(icon) ? icon : 'swords';
  return `<span class="mc-clan-icon ${extraClass}" data-clan-icon="${id}" aria-hidden="true">${clanIconGlyph(id)}</span>`;
}

export function clanRankHtml(rank: number): string {
  if (rank === 1) return '<span class="mc-clan-trophy mc-clan-trophy-1" aria-label="#1">🏆<b>1</b></span>';
  if (rank === 2) return '<span class="mc-clan-trophy mc-clan-trophy-2" aria-label="#2">🏆<b>2</b></span>';
  if (rank === 3) return '<span class="mc-clan-trophy mc-clan-trophy-3" aria-label="#3">🏆<b>3</b></span>';
  if (rank > 0) return `<span class="mc-clan-rank">#${rank}</span>`;
  return '<span class="mc-clan-rank"></span>';
}

export function clanBalanceHtml(label: string): string {
  return `<span class="mc-clan-balance">${CLAN_COIN_HTML}<span>${label} МК</span></span>`;
}

export function clanMembersHtml(count: number): string {
  return `<span class="mc-clan-count">${count}/${CLAN_MAX_MEMBERS}</span>`;
}

export function clanRowLabel(row: Pick<NetworkClanRow, 'icon' | 'name'>): string {
  return `${clanIconGlyph(row.icon)} ${row.name}`;
}

export function clanJoinDisabled(state: ServerClanMessage['card']): boolean {
  if (!state) return true;
  return state.joinState !== 'none';
}

export function clanJoinCaption(state: ServerClanMessage['card']): string {
  if (!state) return 'Отправить запрос на вступление в клан';
  if (state.joinState === 'sent') return 'Заявка отправлена';
  if (state.joinState === 'full') return 'Клан заполнен';
  if (state.joinState === 'other-clan') return state.joinLabel ?? 'Вы уже состоите в другом клане.';
  return 'Отправить запрос на вступление в клан';
}

export function showsClanBack(screen: ServerClanMessage['screen']): boolean {
  return screen === 'card'
    || screen === 'create-confirm'
    || screen === 'invite-confirm'
    || screen === 'accept-confirm'
    || screen === 'makeleader-confirm'
    || screen === 'kick-confirm'
    || screen === 'requests'
    || screen === 'request-confirm'
    || screen === 'join-confirm'
    || screen === 'replace-request-confirm';
}

export function clanIconIds(): readonly ClanIconId[] {
  return CLAN_ICON_IDS;
}

export { formatCompactMegacoins, isClanIconId };
