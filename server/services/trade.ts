import { getItemDefinition } from '../../src/items';
import {
  Inventory,
  canStacksMerge,
  cloneStack,
  splitItemStack,
  type ItemStack,
} from '../../src/inventory';
import {
  TRADE_BUSY_ERROR,
  TRADE_DUPLICATE_REQUEST_ERROR,
  TRADE_EMPTY_NAME_ERROR,
  TRADE_ITEM_MISSING_ERROR,
  TRADE_MONEY_ERROR,
  TRADE_NOT_READY_ERROR,
  TRADE_OFFLINE_ERROR,
  TRADE_PLUGIN_NAME,
  TRADE_REQUEST_MISSING_ERROR,
  TRADE_SELF_ERROR,
  TRADE_SLOT_COUNT,
  TRADE_STACK_ERROR,
  TRADE_STALE_ERROR,
  TRADE_UNKNOWN_ERROR,
  tradeInventoryFullError,
} from '../../shared/trade';
import { inventoryCanAccept } from './auction';
import type { EconomyService } from './economy';

export { TRADE_PLUGIN_NAME, TRADE_SLOT_COUNT };

export interface TradeOffer {
  slots: Array<ItemStack | null>;
  money: number;
  ready: boolean;
  accepted: boolean;
}

export interface TradeSession {
  readonly tradeId: string;
  readonly playerA: string;
  readonly playerB: string;
  offers: Record<string, TradeOffer>;
}

export interface TradeRequest {
  readonly requestId: string;
  readonly fromPlayerId: string;
  readonly toPlayerId: string;
  readonly createdAt: number;
}

export interface TradeResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly closed?: boolean;
  readonly completed?: boolean;
  readonly affected?: readonly string[];
}

export interface TradeRuntime {
  isOnline(playerId: string): boolean;
  displayName(playerId: string): string;
  lookupPlayer(idOrName: string): { id: string; name: string; connected: boolean } | undefined;
  inventory(playerId: string): Inventory | undefined;
  balance(playerId: string): number;
  sendMessage(playerId: string, text: string): void;
}

function emptyOffer(): TradeOffer {
  return {
    slots: Array.from({ length: TRADE_SLOT_COUNT }, () => null),
    money: 0,
    ready: false,
    accepted: false,
  };
}

function partnerOf(session: TradeSession, playerId: string): string | undefined {
  if (session.playerA === playerId) return session.playerB;
  if (session.playerB === playerId) return session.playerA;
  return undefined;
}

function offerOf(session: TradeSession, playerId: string): TradeOffer {
  const current = session.offers[playerId];
  if (current) return current;
  const created = emptyOffer();
  session.offers[playerId] = created;
  return created;
}

export class TradeService {
  private readonly requests: TradeRequest[] = [];
  private readonly sessions = new Map<string, TradeSession>();
  private readonly byPlayer = new Map<string, string>();
  private readonly locks = new Set<string>();
  private nextRequest = 1;
  private nextTrade = 1;
  private runtime: TradeRuntime = {
    isOnline: () => false,
    displayName: (id) => id.slice(0, 8),
    lookupPlayer: () => undefined,
    inventory: () => undefined,
    balance: () => 0,
    sendMessage: () => undefined,
  };

  constructor(private readonly economy: EconomyService) {}

  setRuntime(runtime: TradeRuntime): void {
    this.runtime = runtime;
  }

  incomingRequests(playerId: string): TradeRequest[] {
    return this.requests.filter((request) => request.toPlayerId === playerId);
  }

  outgoingRequests(playerId: string): TradeRequest[] {
    return this.requests.filter((request) => request.fromPlayerId === playerId);
  }

  sessionFor(playerId: string): TradeSession | undefined {
    const id = this.byPlayer.get(playerId);
    return id ? this.sessions.get(id) : undefined;
  }

  request(fromPlayerId: string, targetRaw: string): TradeResult {
    const name = targetRaw.trim();
    if (!name) return { ok: false, error: TRADE_EMPTY_NAME_ERROR };
    const target = this.runtime.lookupPlayer(name);
    if (!target) return { ok: false, error: TRADE_UNKNOWN_ERROR };
    if (target.id === fromPlayerId) return { ok: false, error: TRADE_SELF_ERROR };
    if (!target.connected || !this.runtime.isOnline(target.id)) return { ok: false, error: TRADE_OFFLINE_ERROR };
    if (this.byPlayer.has(fromPlayerId) || this.byPlayer.has(target.id)) return { ok: false, error: TRADE_BUSY_ERROR };
    if (this.requests.some((request) => request.fromPlayerId === fromPlayerId && request.toPlayerId === target.id)) {
      return { ok: false, error: TRADE_DUPLICATE_REQUEST_ERROR };
    }
    const reverse = this.requests.find((request) => request.fromPlayerId === target.id && request.toPlayerId === fromPlayerId);
    if (reverse) return this.acceptRequest(fromPlayerId, reverse.requestId);
    const request: TradeRequest = {
      requestId: `tr-${this.nextRequest++}`,
      fromPlayerId,
      toPlayerId: target.id,
      createdAt: Date.now(),
    };
    this.requests.push(request);
    this.runtime.sendMessage(target.id, `${this.runtime.displayName(fromPlayerId)} предлагает обмен.`);
    return { ok: true, affected: [fromPlayerId, target.id] };
  }

  acceptRequest(playerId: string, requestId: string): TradeResult {
    const request = this.requests.find((entry) => entry.requestId === requestId && entry.toPlayerId === playerId);
    if (!request) return { ok: false, error: TRADE_REQUEST_MISSING_ERROR };
    if (!this.runtime.isOnline(request.fromPlayerId) || !this.runtime.isOnline(playerId)) {
      return { ok: false, error: TRADE_OFFLINE_ERROR };
    }
    if (this.byPlayer.has(playerId) || this.byPlayer.has(request.fromPlayerId)) {
      return { ok: false, error: TRADE_BUSY_ERROR };
    }
    this.dropRequestsInvolving(playerId);
    this.dropRequestsInvolving(request.fromPlayerId);
    const tradeId = `trade-${this.nextTrade++}`;
    const session: TradeSession = {
      tradeId,
      playerA: request.fromPlayerId,
      playerB: playerId,
      offers: {
        [request.fromPlayerId]: emptyOffer(),
        [playerId]: emptyOffer(),
      },
    };
    this.sessions.set(tradeId, session);
    this.byPlayer.set(request.fromPlayerId, tradeId);
    this.byPlayer.set(playerId, tradeId);
    return { ok: true, affected: [request.fromPlayerId, playerId] };
  }

  rejectRequest(playerId: string, requestId: string): TradeResult {
    const request = this.requests.find((entry) => (
      entry.requestId === requestId && (entry.toPlayerId === playerId || entry.fromPlayerId === playerId)
    ));
    if (!request) return { ok: false, error: TRADE_REQUEST_MISSING_ERROR };
    this.requests.splice(0, this.requests.length, ...this.requests.filter((entry) => entry.requestId !== requestId));
    return { ok: true, affected: [request.fromPlayerId, request.toPlayerId] };
  }

  putItem(playerId: string, inventorySlot: number, tradeSlot?: number): TradeResult {
    return this.mutateOffer(playerId, (offer, inventory) => {
      if (!Number.isInteger(inventorySlot) || inventorySlot < 0 || inventorySlot >= Inventory.SLOT_COUNT) {
        return { ok: false, error: TRADE_ITEM_MISSING_ERROR };
      }
      const source = inventory.getSlot(inventorySlot);
      if (!source) return { ok: false, error: TRADE_ITEM_MISSING_ERROR };
      const destIndex = tradeSlot ?? offer.slots.findIndex((slot, index) => {
        if (slot === null) return true;
        return canStacksMerge(slot, source) && slot.count < getItemDefinition(slot.itemId).maxStack;
      });
      if (destIndex < 0 || destIndex >= TRADE_SLOT_COUNT) {
        return { ok: false, error: 'Нет свободной ячейки обмена.' };
      }
      const dest = offer.slots[destIndex];
      const max = getItemDefinition(source.itemId).maxStack;
      if (dest && !canStacksMerge(dest, source)) return { ok: false, error: 'В этой ячейке уже другой предмет.' };
      const room = dest ? max - dest.count : max;
      const amount = Math.min(source.count, room);
      if (amount < 1) return { ok: false, error: TRADE_STACK_ERROR };
      const { taken, remainder } = splitItemStack(source, amount);
      inventory.setSlot(inventorySlot, remainder);
      offer.slots[destIndex] = dest
        ? { ...cloneStack(dest)!, count: dest.count + taken.count }
        : taken;
      return { ok: true };
    });
  }

  returnItem(playerId: string, tradeSlot: number): TradeResult {
    return this.mutateOffer(playerId, (offer, inventory) => {
      if (!Number.isInteger(tradeSlot) || tradeSlot < 0 || tradeSlot >= TRADE_SLOT_COUNT) {
        return { ok: false, error: TRADE_ITEM_MISSING_ERROR };
      }
      const stack = offer.slots[tradeSlot];
      if (!stack) return { ok: true };
      if (!inventoryCanAccept(inventory, stack)) {
        return { ok: false, error: tradeInventoryFullError(this.runtime.displayName(playerId)) };
      }
      inventory.add(cloneStack(stack)!);
      offer.slots[tradeSlot] = null;
      return { ok: true };
    });
  }

  setMoney(playerId: string, raw: string | number): TradeResult {
    return this.mutateOffer(playerId, (offer) => {
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isInteger(value) || value < 0) return { ok: false, error: TRADE_MONEY_ERROR };
      if (value > this.runtime.balance(playerId)) return { ok: false, error: TRADE_MONEY_ERROR };
      offer.money = value;
      return { ok: true };
    });
  }

  ready(playerId: string): TradeResult {
    const session = this.sessionFor(playerId);
    if (!session) return { ok: false, error: TRADE_STALE_ERROR };
    const offer = offerOf(session, playerId);
    offer.ready = true;
    offer.accepted = false;
    const other = partnerOf(session, playerId);
    if (other) offerOf(session, other).accepted = false;
    return { ok: true, affected: [session.playerA, session.playerB] };
  }

  accept(playerId: string): TradeResult {
    const session = this.sessionFor(playerId);
    if (!session) return { ok: false, error: TRADE_STALE_ERROR };
    const other = partnerOf(session, playerId);
    if (!other) return { ok: false, error: TRADE_STALE_ERROR };
    const self = offerOf(session, playerId);
    const partner = offerOf(session, other);
    if (!self.ready || !partner.ready) return { ok: false, error: TRADE_NOT_READY_ERROR };
    self.accepted = true;
    if (!partner.accepted) return { ok: true, affected: [session.playerA, session.playerB] };
    return this.complete(session);
  }

  cancel(playerId: string): TradeResult {
    const session = this.sessionFor(playerId);
    if (!session) {
      this.dropRequestsInvolving(playerId);
      return { ok: true, closed: true, affected: [playerId] };
    }
    return this.closeSession(session, 'Обмен отклонён.');
  }

  disconnect(playerId: string): TradeResult {
    const session = this.sessionFor(playerId);
    this.dropRequestsInvolving(playerId);
    if (!session) return { ok: true, closed: true, affected: [playerId] };
    return this.closeSession(session, 'Обмен отменён: игрок отключился.');
  }

  offerFingerprint(offer: TradeOffer): string {
    return JSON.stringify({
      money: offer.money,
      slots: offer.slots.map((slot) => slot ? { itemId: slot.itemId, count: slot.count, durability: slot.durability } : null),
    });
  }

  private mutateOffer(
    playerId: string,
    fn: (offer: TradeOffer, inventory: Inventory) => TradeResult,
  ): TradeResult {
    const session = this.sessionFor(playerId);
    if (!session) return { ok: false, error: TRADE_STALE_ERROR };
    const inventory = this.runtime.inventory(playerId);
    if (!inventory) return { ok: false, error: TRADE_STALE_ERROR };
    const offer = offerOf(session, playerId);
    const before = this.offerFingerprint(offer);
    const result = fn(offer, inventory);
    if (!result.ok) return result;
    if (this.offerFingerprint(offer) !== before) {
      for (const id of [session.playerA, session.playerB]) {
        const row = offerOf(session, id);
        row.ready = false;
        row.accepted = false;
      }
    }
    return { ok: true, affected: [session.playerA, session.playerB] };
  }

  private complete(session: TradeSession): TradeResult {
    return this.withLocks([session.playerA, session.playerB], () => {
      if (!this.runtime.isOnline(session.playerA) || !this.runtime.isOnline(session.playerB)) {
        return this.closeSession(session, TRADE_OFFLINE_ERROR);
      }
      const invA = this.runtime.inventory(session.playerA);
      const invB = this.runtime.inventory(session.playerB);
      if (!invA || !invB) return this.closeSession(session, TRADE_STALE_ERROR);
      const offerA = offerOf(session, session.playerA);
      const offerB = offerOf(session, session.playerB);
      if (!offerA.ready || !offerB.ready || !offerA.accepted || !offerB.accepted) {
        return { ok: false, error: TRADE_NOT_READY_ERROR };
      }
      if (offerA.money > this.runtime.balance(session.playerA) || offerB.money > this.runtime.balance(session.playerB)) {
        return { ok: false, error: TRADE_MONEY_ERROR };
      }
      const incomingA = offerB.slots.filter((slot): slot is ItemStack => slot !== null).map((slot) => cloneStack(slot)!);
      const incomingB = offerA.slots.filter((slot): slot is ItemStack => slot !== null).map((slot) => cloneStack(slot)!);
      const cloneA = invA.clone();
      const cloneB = invB.clone();
      for (const stack of incomingA) {
        if (cloneA.add(cloneStack(stack)!) !== null) {
          return { ok: false, error: tradeInventoryFullError(this.runtime.displayName(session.playerA)) };
        }
      }
      for (const stack of incomingB) {
        if (cloneB.add(cloneStack(stack)!) !== null) {
          return { ok: false, error: tradeInventoryFullError(this.runtime.displayName(session.playerB)) };
        }
      }
      if (offerA.money > 0) {
        const moved = this.economy.transfer(session.playerA, session.playerB, offerA.money, 'TRADE');
        if (!moved.ok) return { ok: false, error: moved.error ?? TRADE_MONEY_ERROR };
      }
      if (offerB.money > 0) {
        const moved = this.economy.transfer(session.playerB, session.playerA, offerB.money, 'TRADE');
        if (!moved.ok) {
          if (offerA.money > 0) this.economy.transfer(session.playerB, session.playerA, offerA.money, 'TRADE');
          return { ok: false, error: moved.error ?? TRADE_MONEY_ERROR };
        }
      }
      for (const stack of incomingA) invA.add(cloneStack(stack)!);
      for (const stack of incomingB) invB.add(cloneStack(stack)!);
      offerA.slots.fill(null);
      offerB.slots.fill(null);
      this.dropSession(session);
      this.runtime.sendMessage(session.playerA, 'Обмен выполнен.');
      this.runtime.sendMessage(session.playerB, 'Обмен выполнен.');
      return {
        ok: true,
        completed: true,
        closed: true,
        affected: [session.playerA, session.playerB],
      };
    });
  }

  private closeSession(session: TradeSession, message: string): TradeResult {
    this.returnOffers(session);
    this.dropSession(session);
    this.runtime.sendMessage(session.playerA, message);
    this.runtime.sendMessage(session.playerB, message);
    return { ok: true, closed: true, affected: [session.playerA, session.playerB] };
  }

  private returnOffers(session: TradeSession): void {
    for (const playerId of [session.playerA, session.playerB]) {
      const inventory = this.runtime.inventory(playerId);
      const offer = session.offers[playerId];
      if (!inventory || !offer) continue;
      for (let index = 0; index < offer.slots.length; index += 1) {
        const stack = offer.slots[index];
        if (!stack) continue;
        inventory.add(cloneStack(stack)!);
        offer.slots[index] = null;
      }
    }
  }

  private dropSession(session: TradeSession): void {
    this.sessions.delete(session.tradeId);
    this.byPlayer.delete(session.playerA);
    this.byPlayer.delete(session.playerB);
  }

  private dropRequestsInvolving(playerId: string): void {
    const next = this.requests.filter((entry) => entry.fromPlayerId !== playerId && entry.toPlayerId !== playerId);
    this.requests.splice(0, this.requests.length, ...next);
  }

  private withLocks(playerIds: readonly string[], fn: () => TradeResult): TradeResult {
    const unique = [...new Set(playerIds)].sort();
    if (unique.some((id) => this.locks.has(id))) {
      return { ok: false, error: 'Обмен уже выполняется.' };
    }
    for (const id of unique) this.locks.add(id);
    try {
      return fn();
    } finally {
      for (const id of unique) this.locks.delete(id);
    }
  }
}
