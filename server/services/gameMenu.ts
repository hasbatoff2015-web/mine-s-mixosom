import type { Claim } from './claims';
import type { HomeLocation } from '../../shared/homes';
import { GAME_MENU_MAX_CLAIMS, claimAnchorTitle, type GameMenuScreen } from '../../shared/gameMenu';
import { FRIENDS_MAX } from '../../shared/friends';
import { HOME_MAX_DEFAULT } from '../../shared/homes';
import type { FriendsService } from './friends';
import type { TradeService } from './trade';
import type {
  ServerMenuMessage,
  ServerTradeMessage,
  GameMenuScreenKind,
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

export function claimCoords(claim: Claim): { x: number; y: number; z: number } {
  if (claim.anchor) return { x: claim.anchor.x, y: claim.anchor.y, z: claim.anchor.z };
  return {
    x: Math.floor((claim.volume.minX + claim.volume.maxX) / 2),
    y: Math.floor((claim.volume.minY + claim.volume.maxY) / 2),
    z: Math.floor((claim.volume.minZ + claim.volume.maxZ) / 2),
  };
}

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
  return 'Меню';
}

export { GAME_MENU_MAX_CLAIMS, FRIENDS_MAX, HOME_MAX_DEFAULT };
