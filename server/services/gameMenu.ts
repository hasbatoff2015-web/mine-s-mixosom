import type { Claim } from './claims';
import { claimCoords } from './claimCommands';
import {
  CLAIM_MAX_OWNED,
  GAME_MENU_MAX_CLAIMS,
  claimAnchorTitle,
  type GameMenuScreen,
} from '../../shared/gameMenu';
import { FRIENDS_MAX } from '../../shared/friends';
import { HOME_MAX_DEFAULT } from '../../shared/homes';
import type { TradeService } from './trade';
import type { ClanService } from './clan';
import type { EconomyService } from './economy';
import {
  RANKING_NO_CLAN_MESSAGE,
  formatKillsLabel,
  personalRankText,
  sliceRankingPage,
  type RankingKind,
} from '../../shared/ranking';
import { formatMegacoinAmount } from '../../shared/megacoins';
import type {
  ServerMenuMessage,
  ServerTradeMessage,
  GameMenuScreenKind,
  NetworkRankingRow,
} from '../../shared/protocol';

export interface GameMenuSession {
  screen: GameMenuScreen;
  homeNameText: string;
  pendingHomeName?: string;
  friendNameText: string;
  pendingFriendId?: string;
  pendingFriendName?: string;
  claimId?: string;
  claimNameText: string;
  claimMemberText: string;
  pendingClaimName?: string;
  tradeNameText: string;
  ratingKind: RankingKind;
  ratingPage: number;
  message?: string;
}

export function createMenuSession(): GameMenuSession {
  return {
    screen: 'root',
    homeNameText: '',
    friendNameText: '',
    claimNameText: '',
    claimMemberText: '',
    tradeNameText: '',
    ratingKind: 'players-money',
    ratingPage: 1,
  };
}

export function parentMenuScreen(screen: GameMenuScreen): GameMenuScreen {
  if (screen === 'home-delete-confirm') return 'homes';
  if (screen === 'friend-delete-confirm') return 'friends';
  if (screen === 'claim-settings' || screen === 'claim-delete-confirm') {
    return screen === 'claim-delete-confirm' ? 'claim-settings' : 'claims';
  }
  return 'root';
}

export { claimCoords };

export function toMenuClaim(claim: Claim): {
  claimId: string;
  name: string;
  title: string;
  x: number;
  y: number;
  z: number;
} {
  const coords = claimCoords(claim);
  return {
    claimId: claim.id,
    name: claim.name,
    title: claimAnchorTitle(claim.anchor?.block, claim.name),
    ...coords,
  };
}

export function closedMenuMessage(): ServerMenuMessage {
  return { type: 'menu', screen: 'closed', title: '' };
}

export function buildTradeMessage(
  trade: TradeService,
  playerId: string,
  inventorySlots: readonly unknown[],
  extra?: { message?: string },
): ServerTradeMessage {
  const session = trade.sessionFor(playerId);
  if (!session) {
    return { type: 'trade', screen: 'closed', title: '', ...(extra?.message ? { message: extra.message } : {}) };
  }
  const partnerId = session.playerA === playerId ? session.playerB : session.playerA;
  const self = session.offers[playerId] ?? { slots: [], money: 0, ready: false, accepted: false };
  const partner = session.offers[partnerId] ?? { slots: [], money: 0, ready: false, accepted: false };
  return {
    type: 'trade',
    screen: 'session',
    title: 'Обмен',
    tradeId: session.tradeId,
    partnerId,
    partnerName: partnerId,
    selfReady: self.ready,
    partnerReady: partner.ready,
    selfAccepted: self.accepted,
    partnerAccepted: partner.accepted,
    bothReady: self.ready && partner.ready,
    money: self.money,
    moneyText: String(self.money),
    partnerMoney: partner.money,
    partnerMoneyText: String(partner.money),
    selfSlots: self.slots,
    partnerSlots: partner.slots,
    inventorySlots,
    ...(extra?.message ? { message: extra.message } : {}),
  };
}

export function menuTitle(screen: GameMenuScreenKind): string {
  if (screen === 'homes' || screen === 'home-delete-confirm') return 'Дома';
  if (screen === 'friends' || screen === 'friend-delete-confirm') return 'Друзья';
  if (screen === 'clans') return 'Кланы';
  if (screen === 'claims' || screen === 'claim-settings' || screen === 'claim-delete-confirm') return 'Приваты';
  if (screen === 'trade') return 'Обмен';
  if (screen === 'auction') return 'Аукцион';
  if (screen === 'rating') return 'Рейтинг';
  return 'Меню';
}

export function buildRankingSnapshot(
  clan: ClanService,
  economy: EconomyService,
  playerId: string,
  kind: RankingKind,
  page: number,
): Pick<ServerMenuMessage, 'ratingKind' | 'ratingPage' | 'ratingTotalPages' | 'ratingRows' | 'personalRank' | 'personalText'> {
  const viewerClan = clan.playerClan(playerId);
  if (kind === 'players-money' || kind === 'players-kills') {
    const metric = kind === 'players-kills' ? 'kills' : 'money';
    const ranked = economy.rankPlayers(metric);
    const self = ranked.find((row) => row.playerId === playerId);
    const paged = sliceRankingPage(ranked, page);
    const rows: NetworkRankingRow[] = paged.items.map((row) => ({
      rank: row.rank,
      id: row.playerId,
      name: row.name,
      value: metric === 'kills' ? row.kills : row.balance,
      valueLabel: metric === 'kills' ? formatKillsLabel(row.kills) : `🪙 ${formatMegacoinAmount(row.balance)}`,
      metric,
      highlight: row.playerId === playerId,
    }));
    return {
      ratingKind: kind,
      ratingPage: paged.page,
      ratingTotalPages: paged.totalPages,
      ratingRows: rows,
      ...(self ? { personalRank: self.rank, personalText: personalRankText(self.rank) } : {}),
    };
  }
  const metric = kind === 'clans-kills' ? 'kills' : 'money';
  const ranked = clan.ranked('', metric);
  const self = viewerClan ? ranked.find((row) => row.clan.clanId === viewerClan.clanId) : undefined;
  const paged = sliceRankingPage(ranked, page);
  const rows: NetworkRankingRow[] = paged.items.map((row) => ({
    rank: row.rank,
    id: row.clan.clanId,
    name: row.clan.name,
    value: metric === 'kills' ? row.kills : row.total,
    valueLabel: metric === 'kills' ? formatKillsLabel(row.kills) : `🪙 ${formatMegacoinAmount(row.total)}`,
    metric,
    highlight: viewerClan?.clanId === row.clan.clanId,
  }));
  return {
    ratingKind: kind,
    ratingPage: paged.page,
    ratingTotalPages: paged.totalPages,
    ratingRows: rows,
    ...(viewerClan
      ? (self ? { personalRank: self.rank, personalText: personalRankText(self.rank) } : {})
      : { personalText: RANKING_NO_CLAN_MESSAGE }),
  };
}

export { CLAIM_MAX_OWNED, GAME_MENU_MAX_CLAIMS, FRIENDS_MAX, HOME_MAX_DEFAULT };
