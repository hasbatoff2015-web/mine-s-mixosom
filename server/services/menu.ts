import { Inventory } from '../../src/inventory';
import {
  CLAIM_MAX_OWNED,
  CLAIM_MEMBER_MISSING_ERROR,
  CLAIM_MEMBER_SELF_ERROR,
  CLAIM_MISSING_ERROR,
  CLAIM_NAME_TAKEN_ERROR,
  CLAIM_RENAME_ERROR,
  type MenuActionKind,
  type MenuScreenKind,
} from '../../shared/menu';
import { FRIEND_MAX } from '../../shared/friends';
import { HOME_MAX_DEFAULT, HOME_MISSING_ERROR, HOME_NAME_LENGTH_ERROR, validateHomeName } from '../../shared/homes';
import { TRADE_CANCELLED_MESSAGE, TRADE_SLOT_COUNT } from '../../shared/trade';
import { formatCompactMegacoins } from '../../shared/megacoins';
import type {
  ClientMenuActionMessage,
  NetworkMenuClaim,
  NetworkMenuHome,
  NetworkMenuPlayerRow,
  NetworkTradeOffer,
  ServerMenuMessage,
} from '../../shared/protocol';
import type { AuctionView } from './auction';
import type { ClanView } from './clan';
import {
  migrateClaimStore,
  type Claim,
  type ClaimStore,
} from './claims';
import { claimCoords, claimPvpEnabled, ownedClaims } from './claimCommands';
import type { EconomyService } from './economy';
import type { FriendService } from './friends';
import type { HomeService } from './home';
import type { JsonFileStore } from './jsonStore';
import type { TradeService } from './trade';

export interface MenuSession {
  screen: MenuScreenKind;
  homeNameText: string;
  friendNameText: string;
  tradeNameText: string;
  claimNameText: string;
  claimMemberText: string;
  selectedHome?: string;
  selectedFriendId?: string;
  selectedClaimId?: string;
  message?: string;
}

export interface MenuResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly close?: boolean;
  readonly openClan?: ClanView;
  readonly openClanExtra?: string;
  readonly openAuction?: AuctionView;
  readonly notify?: readonly string[];
}

export interface MenuRuntime {
  displayName(playerId: string): string;
  ownerKey(playerId: string): string;
  isOnline(playerId: string): boolean;
  lookupPlayer(idOrName: string): { readonly id: string; readonly name: string } | undefined;
  position(playerId: string): { readonly x: number; readonly y: number; readonly z: number } | undefined;
  worldId(): string;
  inventory(playerId: string): Inventory | undefined;
  inClan(playerId: string): boolean;
  clanNotice(playerId: string): string | undefined;
  maxHomes(playerId: string): number;
  teleportHome(playerId: string, name: string): { ok: boolean; error?: string };
  runSpawn(playerId: string): { ok: boolean; error?: string };
}

const emptyRuntime: MenuRuntime = {
  displayName: (id) => id.slice(0, 8),
  ownerKey: (id) => id.toLowerCase(),
  isOnline: () => false,
  lookupPlayer: () => undefined,
  position: () => undefined,
  worldId: () => 'world',
  inventory: () => undefined,
  inClan: () => false,
  clanNotice: () => undefined,
  maxHomes: () => HOME_MAX_DEFAULT,
  teleportHome: () => ({ ok: false, error: HOME_MISSING_ERROR }),
  runSpawn: () => ({ ok: false, error: 'Spawn failed.' }),
};

function emptySession(): MenuSession {
  return {
    screen: 'closed',
    homeNameText: '',
    friendNameText: '',
    tradeNameText: '',
    claimNameText: '',
    claimMemberText: '',
  };
}

export class MenuService {
  private readonly sessions = new Map<string, MenuSession>();
  private runtime: MenuRuntime = emptyRuntime;

  constructor(
    private readonly store: JsonFileStore,
    private readonly economy: EconomyService,
    private readonly homes: HomeService,
    private readonly friends: FriendService,
    private readonly trades: TradeService,
  ) {}

  setRuntime(runtime: MenuRuntime): void {
    this.runtime = runtime;
  }

  session(playerId: string): MenuSession {
    const existing = this.sessions.get(playerId);
    if (existing) return existing;
    const created = emptySession();
    this.sessions.set(playerId, created);
    return created;
  }

  isOpen(playerId: string): boolean {
    const screen = this.sessions.get(playerId)?.screen;
    return Boolean(screen && screen !== 'closed');
  }

  closeSession(playerId: string): void {
    const session = this.sessions.get(playerId);
    if (session) session.screen = 'closed';
  }

  open(playerId: string, screen: MenuScreenKind = 'main'): void {
    const session = this.session(playerId);
    session.screen = screen;
    session.message = undefined;
    if (screen === 'main') {
      session.selectedHome = undefined;
      session.selectedFriendId = undefined;
      session.selectedClaimId = undefined;
    }
  }

  handleAction(playerId: string, message: ClientMenuActionMessage): MenuResult {
    const session = this.session(playerId);
    session.message = undefined;
    const action: MenuActionKind = message.action;
    if (action === 'close') {
      if (session.screen === 'trade-session') {
        const result = this.trades.cancel(playerId);
        session.screen = 'closed';
        return { ok: result.ok, error: result.error, close: true, notify: result.notify };
      }
      session.screen = 'closed';
      return { ok: true, close: true };
    }
    if (action === 'open') {
      session.screen = 'main';
      return { ok: true };
    }
    if (action === 'back') return this.goBack(playerId);
    if (action === 'spawn') {
      const result = this.runtime.runSpawn(playerId);
      if (!result.ok) {
        session.message = result.error;
        session.screen = 'main';
        return { ok: false, error: result.error };
      }
      session.screen = 'closed';
      return { ok: true, close: true };
    }
    if (action === 'open_homes') {
      session.screen = 'homes';
      return { ok: true };
    }
    if (action === 'set_home_name') {
      session.homeNameText = message.name ?? '';
      if (session.screen !== 'homes' && session.screen !== 'home-delete-confirm') session.screen = 'homes';
      return { ok: true };
    }
    if (action === 'create_home') {
      const name = (message.name ?? session.homeNameText).trim();
      const parsed = validateHomeName(name);
      if (!parsed.ok) {
        session.message = parsed.error;
        session.screen = 'homes';
        return { ok: false, error: parsed.error };
      }
      const pos = this.runtime.position(playerId);
      if (!pos) return { ok: false, error: 'Игрок не найден.' };
      const result = this.homes.set(
        this.runtime.ownerKey(playerId),
        parsed.name,
        { worldId: this.runtime.worldId(), ...pos },
        this.runtime.maxHomes(playerId),
      );
      session.message = result.ok ? undefined : result.error;
      session.homeNameText = result.ok ? '' : session.homeNameText;
      session.screen = 'homes';
      return { ok: result.ok, error: result.error };
    }
    if (action === 'teleport_home') {
      const name = message.homeName ?? message.name;
      if (!name) return { ok: false, error: HOME_MISSING_ERROR };
      const result = this.runtime.teleportHome(playerId, name);
      if (!result.ok) {
        session.message = result.error;
        session.screen = 'homes';
        return { ok: false, error: result.error };
      }
      session.screen = 'closed';
      return { ok: true, close: true };
    }
    if (action === 'delete_home') {
      const name = message.homeName ?? message.name;
      if (!name) return { ok: false, error: HOME_MISSING_ERROR };
      session.selectedHome = name;
      session.screen = 'home-delete-confirm';
      return { ok: true };
    }
    if (action === 'confirm_delete_home') {
      const name = session.selectedHome;
      if (!name) {
        session.screen = 'homes';
        return { ok: false, error: HOME_MISSING_ERROR };
      }
      const result = this.homes.remove(this.runtime.ownerKey(playerId), name);
      session.selectedHome = undefined;
      session.screen = 'homes';
      session.message = result.ok ? undefined : result.error;
      return { ok: result.ok, error: result.error };
    }
    if (action === 'cancel_delete_home') {
      session.selectedHome = undefined;
      session.screen = 'homes';
      return { ok: true };
    }
    if (action === 'open_friends') {
      session.screen = 'friends';
      return { ok: true };
    }
    if (action === 'set_teleport_allowed') {
      const result = this.friends.setTeleportAllowed(playerId, message.allowed === true);
      session.screen = 'friends';
      session.message = result.ok ? undefined : result.error;
      return { ok: result.ok, error: result.error };
    }
    if (action === 'set_friend_name') {
      session.friendNameText = message.name ?? '';
      session.screen = 'friends';
      return { ok: true };
    }
    if (action === 'send_friend_request') {
      const result = this.friends.request(playerId, (message.name ?? session.friendNameText).trim());
      session.message = result.ok ? undefined : result.error;
      if (result.ok) session.friendNameText = '';
      session.screen = 'friends';
      return { ok: result.ok, error: result.error, notify: [playerId] };
    }
    if (action === 'accept_friend' && message.playerId) {
      const result = this.friends.accept(playerId, message.playerId);
      session.screen = 'friends';
      session.message = result.ok ? undefined : result.error;
      return { ok: result.ok, error: result.error, notify: [playerId, message.playerId] };
    }
    if (action === 'reject_friend' && message.playerId) {
      const result = this.friends.reject(playerId, message.playerId);
      session.screen = 'friends';
      session.message = result.ok ? undefined : result.error;
      return { ok: result.ok, error: result.error };
    }
    if (action === 'teleport_friend' && message.playerId) {
      const result = this.friends.teleport(playerId, message.playerId);
      if (!result.ok) {
        session.screen = 'friends';
        session.message = result.error;
        return { ok: false, error: result.error };
      }
      session.screen = 'closed';
      return { ok: true, close: true };
    }
    if (action === 'remove_friend' && message.playerId) {
      session.selectedFriendId = message.playerId;
      session.screen = 'friend-delete-confirm';
      return { ok: true };
    }
    if (action === 'confirm_remove_friend') {
      const other = session.selectedFriendId;
      if (!other) {
        session.screen = 'friends';
        return { ok: false, error: 'Игрок не найден.' };
      }
      const result = this.friends.remove(playerId, other);
      session.selectedFriendId = undefined;
      session.screen = 'friends';
      session.message = result.ok ? undefined : result.error;
      return { ok: result.ok, error: result.error, notify: other ? [playerId, other] : [playerId] };
    }
    if (action === 'cancel_remove_friend') {
      session.selectedFriendId = undefined;
      session.screen = 'friends';
      return { ok: true };
    }
    if (action === 'open_clans') {
      session.screen = 'clans';
      return { ok: true };
    }
    if (action === 'open_my_clan') {
      if (!this.runtime.inClan(playerId)) return { ok: false, error: 'Вы не состоите в клане.' };
      return { ok: true, openClan: 'mine' };
    }
    if (action === 'open_clan_list') return { ok: true, openClan: 'ranking', openClanExtra: 'menu-clans' };
    if (action === 'open_create_clan') return { ok: true, openClan: 'create', openClanExtra: 'menu-clans' };
    if (action === 'open_claims') {
      session.screen = 'claims';
      return { ok: true };
    }
    if (action === 'open_claim' && message.claimId) {
      const claim = this.findOwnedClaim(playerId, message.claimId);
      if (!claim) {
        session.screen = 'claims';
        session.message = CLAIM_MISSING_ERROR;
        return { ok: false, error: CLAIM_MISSING_ERROR };
      }
      session.selectedClaimId = claim.id;
      session.claimNameText = claim.name;
      session.claimMemberText = '';
      session.screen = 'claim-detail';
      return { ok: true };
    }
    if (action === 'set_claim_name') {
      session.claimNameText = message.name ?? '';
      session.screen = 'claim-detail';
      return { ok: true };
    }
    if (action === 'save_claim_name') return this.renameClaim(playerId, message.name ?? session.claimNameText);
    if (action === 'set_claim_pvp') return this.setClaimPvp(playerId, message.pvp === true);
    if (action === 'set_claim_member_name') {
      session.claimMemberText = message.name ?? '';
      session.screen = 'claim-detail';
      return { ok: true };
    }
    if (action === 'add_claim_member') return this.addClaimMember(playerId, message.name ?? session.claimMemberText);
    if (action === 'remove_claim_member' && message.name) return this.removeClaimMember(playerId, message.name);
    if (action === 'delete_claim') {
      session.screen = 'claim-delete-confirm';
      return { ok: true };
    }
    if (action === 'confirm_delete_claim') return this.deleteClaim(playerId);
    if (action === 'cancel_delete_claim') {
      session.screen = 'claim-detail';
      return { ok: true };
    }
    if (action === 'open_trade') {
      session.screen = 'trade';
      return { ok: true };
    }
    if (action === 'set_trade_name') {
      session.tradeNameText = message.name ?? '';
      session.screen = 'trade';
      return { ok: true };
    }
    if (action === 'send_trade') {
      const result = this.trades.request(playerId, (message.name ?? session.tradeNameText).trim());
      session.message = result.ok ? undefined : result.error;
      if (result.ok) session.tradeNameText = '';
      if (result.session) session.screen = 'trade-session';
      else session.screen = 'trade';
      return { ok: result.ok, error: result.error, notify: result.notify };
    }
    if (action === 'accept_trade_invite' && message.playerId) {
      const result = this.trades.acceptRequest(playerId, message.playerId);
      if (result.session) {
        session.screen = 'trade-session';
      } else {
        session.screen = 'trade';
        session.message = result.error;
      }
      return { ok: result.ok, error: result.error, notify: result.notify };
    }
    if (action === 'reject_trade_invite' && message.playerId) {
      const result = this.trades.rejectRequest(playerId, message.playerId);
      session.screen = 'trade';
      return { ok: result.ok, error: result.error, notify: result.notify };
    }
    if (action === 'select_inventory_slot' && message.slot !== undefined) {
      const result = this.trades.selectInventory(playerId, message.slot);
      session.screen = 'trade-session';
      session.message = result.ok ? undefined : result.error;
      return { ok: result.ok, error: result.error, notify: result.notify };
    }
    if (action === 'click_offer_slot' && message.slot !== undefined) {
      const result = this.trades.clickOfferSlot(playerId, message.slot);
      session.screen = 'trade-session';
      session.message = result.ok ? undefined : result.error;
      return { ok: result.ok, error: result.error, notify: result.notify };
    }
    if (action === 'set_trade_money') {
      const result = this.trades.setMoney(playerId, message.money);
      session.screen = 'trade-session';
      session.message = result.ok ? undefined : result.error;
      return { ok: result.ok, error: result.error, notify: result.notify };
    }
    if (action === 'ready_trade') {
      const result = this.trades.ready(playerId);
      session.screen = 'trade-session';
      session.message = result.ok ? undefined : result.error;
      return { ok: result.ok, error: result.error, notify: result.notify };
    }
    if (action === 'accept_trade') {
      const result = this.trades.accept(playerId);
      if (result.completed || result.closed) {
        session.screen = result.completed ? 'closed' : 'trade';
        return { ok: result.ok, error: result.error, close: result.completed, notify: result.notify };
      }
      session.screen = 'trade-session';
      session.message = result.ok ? undefined : result.error;
      return { ok: result.ok, error: result.error, notify: result.notify };
    }
    if (action === 'cancel_trade') {
      const result = this.trades.cancel(playerId);
      session.screen = 'trade';
      session.message = TRADE_CANCELLED_MESSAGE;
      return { ok: result.ok, error: result.error, notify: result.notify };
    }
    if (action === 'open_auction') {
      session.screen = 'auction';
      return { ok: true };
    }
    if (action === 'open_auction_browse') return { ok: true, openAuction: 'browse' };
    if (action === 'open_auction_list') return { ok: true, openAuction: 'list' };
    if (action === 'open_auction_sell') return { ok: true, openAuction: 'sell' };
    return { ok: false, error: HOME_NAME_LENGTH_ERROR };
  }

  syncTradeScreen(playerId: string): void {
    const session = this.session(playerId);
    if (this.trades.sessionFor(playerId)) session.screen = 'trade-session';
    else if (session.screen === 'trade-session') {
      session.screen = 'trade';
      session.message = session.message ?? TRADE_CANCELLED_MESSAGE;
    }
  }

  buildMessage(playerId: string, inventory?: Inventory): ServerMenuMessage {
    const session = this.session(playerId);
    const screen = session.screen;
    const balance = this.economy.getBalance(playerId);
    const base = {
      type: 'menu' as const,
      screen,
      title: this.titleFor(screen),
      ...(session.message ? { message: session.message } : {}),
      balance,
      balanceLabel: `${formatCompactMegacoins(balance)} монеты`,
    };
    if (screen === 'closed') {
      return { ...base, title: '' };
    }
    if (screen === 'main') {
      return {
        ...base,
        inClan: this.runtime.inClan(playerId),
        ...(this.runtime.clanNotice(playerId) ? { clanNotice: this.runtime.clanNotice(playerId) } : {}),
      };
    }
    if (screen === 'homes' || screen === 'home-delete-confirm') {
      const homes = this.homes.list(this.runtime.ownerKey(playerId));
      return {
        ...base,
        homeNameText: session.homeNameText,
        homes: homes.map((home): NetworkMenuHome => ({
          name: home.name,
          x: Math.round(home.x),
          y: Math.round(home.y),
          z: Math.round(home.z),
        })),
        homeMax: this.runtime.maxHomes(playerId),
        ...(session.selectedHome ? { confirmName: session.selectedHome } : {}),
      };
    }
    if (screen === 'friends' || screen === 'friend-delete-confirm') {
      const friends = this.friends.list(playerId);
      const confirm = friends.find((row) => row.playerId === session.selectedFriendId);
      return {
        ...base,
        teleportAllowed: this.friends.ensure(playerId).teleportAllowed,
        friendNameText: session.friendNameText,
        friendRequests: this.friends.incomingRows(playerId),
        friends,
        friendMax: FRIEND_MAX,
        ...(confirm ? { confirmName: confirm.name } : {}),
      };
    }
    if (screen === 'clans') {
      return { ...base, inClan: this.runtime.inClan(playerId) };
    }
    if (screen === 'claims' || screen === 'claim-detail' || screen === 'claim-delete-confirm') {
      const claims = ownedClaims(this.loadClaims().claims, this.runtime.ownerKey(playerId)).map((claim) => this.toClaimRow(claim));
      const selected = claims.find((claim) => claim.id === session.selectedClaimId);
      return {
        ...base,
        claims,
        claimMax: CLAIM_MAX_OWNED,
        ...(selected ? { claim: selected, claimNameText: session.claimNameText || selected.name } : {}),
        claimMemberText: session.claimMemberText,
        ...(screen === 'claim-delete-confirm' && selected ? { confirmName: selected.name } : {}),
      };
    }
    if (screen === 'trade' || screen === 'trade-session') {
      const trade = this.trades.sessionFor(playerId);
      const incoming = this.trades.incoming(playerId).map((row): NetworkMenuPlayerRow => ({
        playerId: row.fromId,
        name: this.runtime.displayName(row.fromId),
      }));
      const outgoing = this.trades.outgoing(playerId).map((row): NetworkMenuPlayerRow => ({
        playerId: row.toId,
        name: this.runtime.displayName(row.toId),
      }));
      if (!trade || screen === 'trade') {
        return {
          ...base,
          screen: 'trade',
          title: 'Обмен',
          tradeNameText: session.tradeNameText,
          incomingTrades: incoming,
          outgoingTrades: outgoing,
        };
      }
      const self = trade.offers[playerId]!;
      const partnerId = this.trades.partnerId(trade, playerId);
      const partner = trade.offers[partnerId]!;
      const inv = inventory ?? this.runtime.inventory(playerId);
      return {
        ...base,
        screen: 'trade-session',
        title: 'Обмен',
        tradePartnerName: this.runtime.displayName(partnerId),
        tradeSelf: this.toOffer(self),
        tradePartner: this.toOffer(partner),
        inventorySlots: inv?.slots ?? [],
        selectedSlot: self.selectedSlot,
      };
    }
    if (screen === 'auction') {
      return { ...base, title: 'Аукцион' };
    }
    return base;
  }

  private goBack(playerId: string): MenuResult {
    const session = this.session(playerId);
    if (session.screen === 'home-delete-confirm') {
      session.screen = 'homes';
      session.selectedHome = undefined;
      return { ok: true };
    }
    if (session.screen === 'friend-delete-confirm') {
      session.screen = 'friends';
      session.selectedFriendId = undefined;
      return { ok: true };
    }
    if (session.screen === 'claim-detail' || session.screen === 'claim-delete-confirm') {
      session.screen = session.screen === 'claim-delete-confirm' ? 'claim-detail' : 'claims';
      if (session.screen === 'claims') session.selectedClaimId = undefined;
      return { ok: true };
    }
    if (session.screen === 'trade-session') {
      return this.handleAction(playerId, { type: 'menu_action', action: 'cancel_trade' });
    }
    session.screen = 'main';
    return { ok: true };
  }

  private loadClaims(): ClaimStore {
    return migrateClaimStore(this.store.load<unknown>('claims/claims', { claims: [] }));
  }

  private saveClaims(store: ClaimStore): void {
    this.store.save('claims/claims', store);
  }

  private findOwnedClaim(playerId: string, claimId: string): Claim | undefined {
    const owner = this.runtime.ownerKey(playerId);
    return this.loadClaims().claims.find((claim) => claim.id === claimId && claim.owner === owner);
  }

  private renameClaim(playerId: string, rawName: string): MenuResult {
    const session = this.session(playerId);
    const id = session.selectedClaimId;
    if (!id) return { ok: false, error: CLAIM_MISSING_ERROR };
    const name = rawName.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 32 || /[<>&"'`]/.test(name)) {
      session.message = CLAIM_RENAME_ERROR;
      session.screen = 'claim-detail';
      return { ok: false, error: CLAIM_RENAME_ERROR };
    }
    const store = this.loadClaims();
    const index = store.claims.findIndex((claim) => claim.id === id && claim.owner === this.runtime.ownerKey(playerId));
    if (index < 0) return { ok: false, error: CLAIM_MISSING_ERROR };
    const live = store.claims[index]!;
    const taken = store.claims.some((claim) => (
      claim.owner === live.owner && claim.id !== live.id && claim.name.toLowerCase() === name.toLowerCase()
    ));
    if (taken) {
      session.message = CLAIM_NAME_TAKEN_ERROR;
      return { ok: false, error: CLAIM_NAME_TAKEN_ERROR };
    }
    store.claims[index] = { ...live, name };
    this.saveClaims(store);
    session.claimNameText = name;
    session.screen = 'claim-detail';
    return { ok: true };
  }

  private setClaimPvp(playerId: string, enabled: boolean): MenuResult {
    const session = this.session(playerId);
    const id = session.selectedClaimId;
    if (!id) return { ok: false, error: CLAIM_MISSING_ERROR };
    const store = this.loadClaims();
    const live = store.claims.find((claim) => claim.id === id && claim.owner === this.runtime.ownerKey(playerId));
    if (!live) return { ok: false, error: CLAIM_MISSING_ERROR };
    live.flags.pvp = enabled;
    this.saveClaims(store);
    session.screen = 'claim-detail';
    return { ok: true };
  }

  private addClaimMember(playerId: string, raw: string): MenuResult {
    const session = this.session(playerId);
    const target = this.runtime.lookupPlayer(raw.trim());
    if (!target) {
      session.message = CLAIM_MEMBER_MISSING_ERROR;
      session.screen = 'claim-detail';
      return { ok: false, error: CLAIM_MEMBER_MISSING_ERROR };
    }
    if (target.id === playerId || target.name.toLowerCase() === this.runtime.ownerKey(playerId)) {
      session.message = CLAIM_MEMBER_SELF_ERROR;
      return { ok: false, error: CLAIM_MEMBER_SELF_ERROR };
    }
    const id = session.selectedClaimId;
    if (!id) return { ok: false, error: CLAIM_MISSING_ERROR };
    const store = this.loadClaims();
    const live = store.claims.find((claim) => claim.id === id && claim.owner === this.runtime.ownerKey(playerId));
    if (!live) return { ok: false, error: CLAIM_MISSING_ERROR };
    const key = target.name.toLowerCase();
    if (!live.members.includes(key)) live.members.push(key);
    this.saveClaims(store);
    session.claimMemberText = '';
    session.screen = 'claim-detail';
    return { ok: true };
  }

  private removeClaimMember(playerId: string, name: string): MenuResult {
    const session = this.session(playerId);
    const id = session.selectedClaimId;
    if (!id) return { ok: false, error: CLAIM_MISSING_ERROR };
    const store = this.loadClaims();
    const live = store.claims.find((claim) => claim.id === id && claim.owner === this.runtime.ownerKey(playerId));
    if (!live) return { ok: false, error: CLAIM_MISSING_ERROR };
    const key = name.toLowerCase();
    live.members = live.members.filter((member) => member !== key);
    this.saveClaims(store);
    session.screen = 'claim-detail';
    return { ok: true };
  }

  private deleteClaim(playerId: string): MenuResult {
    const session = this.session(playerId);
    const id = session.selectedClaimId;
    if (!id) return { ok: false, error: CLAIM_MISSING_ERROR };
    const store = this.loadClaims();
    const next = store.claims.filter((claim) => !(claim.id === id && claim.owner === this.runtime.ownerKey(playerId)));
    if (next.length === store.claims.length) {
      session.screen = 'claims';
      return { ok: false, error: CLAIM_MISSING_ERROR };
    }
    store.claims = next;
    this.saveClaims(store);
    session.selectedClaimId = undefined;
    session.screen = 'claims';
    return { ok: true };
  }

  private toClaimRow(claim: Claim): NetworkMenuClaim {
    const pos = claimCoords(claim);
    return {
      id: claim.id,
      name: claim.name,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      pvp: claimPvpEnabled(claim),
      members: [...claim.members],
    };
  }

  private toOffer(offer: { slots: Array<unknown>; money: number; ready: boolean; accepted: boolean }): NetworkTradeOffer {
    const slots = [...offer.slots];
    while (slots.length < TRADE_SLOT_COUNT) slots.push(null);
    return {
      slots: slots.slice(0, TRADE_SLOT_COUNT),
      money: offer.money,
      ready: offer.ready,
      accepted: offer.accepted,
    };
  }

  private titleFor(screen: MenuScreenKind): string {
    if (screen === 'homes' || screen === 'home-delete-confirm') return 'Дома';
    if (screen === 'friends' || screen === 'friend-delete-confirm') return 'Друзья';
    if (screen === 'clans') return 'Кланы';
    if (screen === 'claims' || screen === 'claim-detail' || screen === 'claim-delete-confirm') return 'Приваты';
    if (screen === 'trade' || screen === 'trade-session') return 'Обмен';
    if (screen === 'auction') return 'Аукцион';
    return 'Меню';
  }
}
