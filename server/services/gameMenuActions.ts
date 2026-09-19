import type { ClientMenuActionMessage, GameMenuScreenKind } from '../../shared/protocol';
import { FRIENDS_EMPTY_NAME_ERROR } from '../../shared/friends';
import { HOME_MISSING_ERROR, validateHomeName } from '../../shared/homes';
import { TRADE_EMPTY_NAME_ERROR } from '../../shared/trade';
import type { HomeService } from './home';
import type { FriendsService } from './friends';
import type { TradeService } from './trade';
import type { ClanService } from './clan';
import type { Claim, ClaimStore } from './claims';
import type { GameMenuSession } from './gameMenu';
import { parentMenuScreen } from './gameMenu';
import { isRankingKind } from '../../shared/ranking';

export interface MenuPlayer {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
}

export type MenuActionOutcome =
  | { kind: 'flush' }
  | { kind: 'close' }
  | { kind: 'spawn' }
  | { kind: 'home-teleport'; name: string }
  | { kind: 'friend-teleport'; playerId: string }
  | { kind: 'open-clan'; view: 'ranking' | 'create' | 'mine' }
  | { kind: 'open-auction'; view: 'browse' | 'list' | 'sell' }
  | { kind: 'trade-request'; affected: readonly string[] }
  | { kind: 'trade-session'; affected: readonly string[] }
  | { kind: 'refresh-players'; affected: readonly string[] };

export interface MenuActionHost {
  homes: HomeService;
  friends: FriendsService;
  trade: TradeService;
  clan: ClanService;
  worldId: string;
  maxHomesFor(player: MenuPlayer): number;
  loadClaims(): ClaimStore;
  saveClaims(store: ClaimStore): void;
  findOwnedClaim(player: MenuPlayer, claimId: string): Claim | undefined;
}

export function applyGameMenuAction(
  host: MenuActionHost,
  player: MenuPlayer,
  session: GameMenuSession,
  message: ClientMenuActionMessage,
): MenuActionOutcome {
  const action = message.action;
  if (action === 'open') {
    session.screen = message.screen && message.screen !== 'closed' ? message.screen as GameMenuSession['screen'] : 'root';
    if (session.screen === 'rating') {
      session.ratingKind = session.ratingKind || 'players-money';
      session.ratingPage = 1;
    }
    return { kind: 'flush' };
  }
  if (action === 'rating_set' && isRankingKind(message.ratingKind ?? message.name)) {
    session.screen = 'rating';
    session.ratingKind = (message.ratingKind ?? message.name) as typeof session.ratingKind;
    session.ratingPage = 1;
    return { kind: 'flush' };
  }
  if (action === 'rating_page') {
    session.screen = 'rating';
    session.ratingPage = message.page ?? session.ratingPage;
    return { kind: 'flush' };
  }
  if (action === 'back') {
    session.screen = parentMenuScreen(session.screen);
    return { kind: 'flush' };
  }
  if (action === 'spawn') return { kind: 'spawn' };
  if (action === 'set_home_name') {
    session.homeNameText = message.name ?? '';
    return { kind: 'flush' };
  }
  if (action === 'home_create') {
    const parsed = validateHomeName(message.name ?? session.homeNameText);
    if (!parsed.ok) {
      session.message = parsed.error;
      return { kind: 'flush' };
    }
    if (host.homes.get(player.name, parsed.name)) {
      session.message = host.homes.uniqueError().error;
      return { kind: 'flush' };
    }
    const result = host.homes.set(player.name, parsed.name, {
      worldId: host.worldId,
      x: player.x,
      y: player.y,
      z: player.z,
      yaw: player.yaw,
      pitch: player.pitch,
    }, host.maxHomesFor(player));
    session.message = result.ok ? undefined : result.error;
    if (result.ok) session.homeNameText = '';
    session.screen = 'homes';
    return { kind: 'flush' };
  }
  if (action === 'home_teleport' && message.name) {
    if (!host.homes.get(player.name, message.name)) {
      session.message = HOME_MISSING_ERROR;
      return { kind: 'flush' };
    }
    return { kind: 'home-teleport', name: message.name };
  }
  if (action === 'home_delete' && message.name) {
    session.pendingHomeName = message.name;
    session.screen = 'home-delete-confirm';
    return { kind: 'flush' };
  }
  if (action === 'home_cancel_delete') {
    session.pendingHomeName = undefined;
    session.screen = 'homes';
    return { kind: 'flush' };
  }
  if (action === 'home_confirm_delete') {
    if (session.pendingHomeName) {
      const result = host.homes.remove(player.name, session.pendingHomeName);
      if (!result.ok) session.message = result.error;
    }
    session.pendingHomeName = undefined;
    session.screen = 'homes';
    return { kind: 'flush' };
  }
  if (action === 'set_friend_name') {
    session.friendNameText = message.name ?? '';
    return { kind: 'flush' };
  }
  if (action === 'friends_set_tp') {
    host.friends.setAllowTeleport(player.id, message.enabled === true);
    return { kind: 'flush' };
  }
  if (action === 'friends_request') {
    const name = (message.name ?? session.friendNameText).trim();
    if (!name) {
      session.message = FRIENDS_EMPTY_NAME_ERROR;
      return { kind: 'flush' };
    }
    const result = host.friends.request(player.id, name);
    session.message = result.ok ? undefined : result.error;
    if (result.ok) session.friendNameText = '';
    session.screen = 'friends';
    return { kind: 'refresh-players', affected: result.affected ?? [player.id] };
  }
  if (action === 'friends_accept' && message.requestId) {
    const result = host.friends.accept(player.id, message.requestId);
    session.message = result.ok ? undefined : result.error;
    return { kind: 'refresh-players', affected: result.affected ?? [player.id] };
  }
  if (action === 'friends_reject' && message.requestId) {
    const result = host.friends.reject(player.id, message.requestId);
    session.message = result.ok ? undefined : result.error;
    return { kind: 'refresh-players', affected: result.affected ?? [player.id] };
  }
  if (action === 'friends_teleport' && message.playerId) {
    const gate = host.friends.canTeleportTo(player.id, message.playerId);
    if (!gate.ok) {
      session.message = gate.error;
      return { kind: 'flush' };
    }
    return { kind: 'friend-teleport', playerId: message.playerId };
  }
  if (action === 'friends_delete' && message.playerId) {
    session.pendingFriendId = message.playerId;
    session.pendingFriendName = host.friends.sortedFriends(player.id).find((row) => row.playerId === message.playerId)?.name
      ?? message.playerId;
    session.screen = 'friend-delete-confirm';
    return { kind: 'flush' };
  }
  if (action === 'friends_cancel_delete') {
    session.pendingFriendId = undefined;
    session.pendingFriendName = undefined;
    session.screen = 'friends';
    return { kind: 'flush' };
  }
  if (action === 'friends_confirm_delete') {
    const affected = [player.id];
    if (session.pendingFriendId) {
      const result = host.friends.remove(player.id, session.pendingFriendId);
      if (!result.ok) session.message = result.error;
      if (result.affected) affected.push(...result.affected);
    }
    session.pendingFriendId = undefined;
    session.pendingFriendName = undefined;
    session.screen = 'friends';
    return { kind: 'refresh-players', affected };
  }
  if (action === 'clans_list') return { kind: 'open-clan', view: 'ranking' };
  if (action === 'clans_create') return { kind: 'open-clan', view: 'create' };
  if (action === 'clans_mine') {
    if (!host.clan.playerClan(player.id)) {
      session.screen = 'clans';
      session.message = 'Вы не состоите в клане.';
      return { kind: 'flush' };
    }
    return { kind: 'open-clan', view: 'mine' };
  }
  if (action === 'claim_open' && message.claimId) {
    const claim = host.findOwnedClaim(player, message.claimId);
    if (!claim) {
      session.message = 'Приват не найден.';
      return { kind: 'flush' };
    }
    session.claimId = claim.id;
    session.claimNameText = claim.name;
    session.screen = 'claim-settings';
    return { kind: 'flush' };
  }
  if (action === 'set_claim_name') {
    session.claimNameText = message.name ?? '';
    return { kind: 'flush' };
  }
  if (action === 'claim_rename') {
    const claim = session.claimId ? host.findOwnedClaim(player, session.claimId) : undefined;
    const parsed = (message.name ?? session.claimNameText).trim();
    if (!claim || !parsed) {
      session.message = 'Введите название привата.';
      return { kind: 'flush' };
    }
    if (parsed.length > 24) {
      session.message = 'Название привата не длиннее 24 символов.';
      return { kind: 'flush' };
    }
    const store = host.loadClaims();
    const live = store.claims.find((entry) => entry.id === claim.id);
    if (!live) {
      session.message = 'Приват не найден.';
      return { kind: 'flush' };
    }
    const key = parsed.toLowerCase();
    if (store.claims.some((entry) => entry.owner === live.owner && entry.name.toLowerCase() === key && entry.id !== live.id)) {
      session.message = `Приват с названием «${parsed}» уже есть.`;
      return { kind: 'flush' };
    }
    live.name = parsed;
    host.saveClaims(store);
    session.claimNameText = parsed;
    return { kind: 'flush' };
  }
  if (action === 'claim_set_pvp') {
    const claim = session.claimId ? host.findOwnedClaim(player, session.claimId) : undefined;
    const store = host.loadClaims();
    const live = claim ? store.claims.find((entry) => entry.id === claim.id) : undefined;
    if (!live) {
      session.message = 'Приват не найден.';
      return { kind: 'flush' };
    }
    live.flags.pvp = message.enabled === true;
    host.saveClaims(store);
    return { kind: 'flush' };
  }
  if (action === 'set_claim_member') {
    session.claimMemberText = message.name ?? '';
    return { kind: 'flush' };
  }
  if (action === 'claim_add_member') {
    const claim = session.claimId ? host.findOwnedClaim(player, session.claimId) : undefined;
    const name = (message.name ?? session.claimMemberText).trim().toLowerCase();
    if (!claim || !name) {
      session.message = 'Введите ник игрока.';
      return { kind: 'flush' };
    }
    const store = host.loadClaims();
    const live = store.claims.find((entry) => entry.id === claim.id);
    if (!live) {
      session.message = 'Приват не найден.';
      return { kind: 'flush' };
    }
    if (!live.members.includes(name)) live.members.push(name);
    host.saveClaims(store);
    session.claimMemberText = '';
    return { kind: 'flush' };
  }
  if (action === 'claim_remove_member' && message.name) {
    const claim = session.claimId ? host.findOwnedClaim(player, session.claimId) : undefined;
    const store = host.loadClaims();
    const live = claim ? store.claims.find((entry) => entry.id === claim.id) : undefined;
    if (live) {
      live.members = live.members.filter((member) => member !== message.name!.toLowerCase());
      host.saveClaims(store);
    }
    return { kind: 'flush' };
  }
  if (action === 'claim_delete') {
    const claim = session.claimId ? host.findOwnedClaim(player, session.claimId) : undefined;
    session.pendingClaimName = claim?.name;
    session.screen = 'claim-delete-confirm';
    return { kind: 'flush' };
  }
  if (action === 'claim_cancel_delete') {
    session.screen = 'claim-settings';
    return { kind: 'flush' };
  }
  if (action === 'claim_confirm_delete') {
    const store = host.loadClaims();
    const index = store.claims.findIndex((entry) => entry.id === session.claimId);
    if (index >= 0) {
      store.claims.splice(index, 1);
      host.saveClaims(store);
    }
    session.claimId = undefined;
    session.pendingClaimName = undefined;
    session.screen = 'claims';
    return { kind: 'flush' };
  }
  if (action === 'set_trade_name') {
    session.tradeNameText = message.name ?? '';
    return { kind: 'flush' };
  }
  if (action === 'trade_refresh') {
    session.message = undefined;
    return { kind: 'flush' };
  }
  if (action === 'trade_request') {
    const name = (message.name ?? session.tradeNameText).trim();
    if (!name) {
      session.message = TRADE_EMPTY_NAME_ERROR;
      return { kind: 'flush' };
    }
    const result = host.trade.request(player.id, name);
    session.message = result.ok ? undefined : result.error;
    if (result.ok) session.tradeNameText = '';
    return { kind: 'trade-request', affected: result.affected ?? [player.id] };
  }
  if (action === 'trade_accept' && message.requestId) {
    const result = host.trade.acceptRequest(player.id, message.requestId);
    if (!result.ok) {
      session.message = result.error;
      return { kind: 'flush' };
    }
    return { kind: 'trade-session', affected: result.affected ?? [player.id] };
  }
  if (action === 'trade_reject' && message.requestId) {
    const result = host.trade.rejectRequest(player.id, message.requestId);
    session.message = result.ok ? undefined : result.error;
    return { kind: 'trade-request', affected: result.affected ?? [player.id] };
  }
  if (action === 'auction_open') return { kind: 'open-auction', view: 'browse' };
  if (action === 'auction_list') return { kind: 'open-auction', view: 'list' };
  if (action === 'auction_sell') return { kind: 'open-auction', view: 'sell' };
  void (message.screen as GameMenuScreenKind | undefined);
  return { kind: 'flush' };
}
