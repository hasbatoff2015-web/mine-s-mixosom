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
import { randomUUID } from 'node:crypto';
import { inventoryCanAccept } from './auction';
import { isPromise, thenResult, type CurrencyPort } from '../economy/currencyPort';
import { isClientMoneyRequestId, MONEY_REQUEST_REQUIRED } from '../economy/moneyRequest';
import type { ItemDurability, ItemEffectResult } from '../settlements/durability';
import { stackRecord, tradeDeliveryReceipt, tradeEscrowReceipt } from '../settlements/receipts';
import type { SettlementService } from '../settlements/service';
import { SETTLEMENT_RECOVERING } from '../settlements/messages';

export { TRADE_PLUGIN_NAME, TRADE_SLOT_COUNT };

export interface TradeOffer {
  slots: Array<ItemStack | null>;
  money: number;
  ready: boolean;
  accepted: boolean;
}

export interface TradeSession {
  readonly tradeId: string;
  /** Stable for the money legs of this session. Not the presentation counter. */
  readonly settlementId: string;
  readonly playerA: string;
  readonly playerB: string;
  offers: Record<string, TradeOffer>;
  /** Set synchronously when final settlement starts. Offer mutations must stop. */
  settling?: boolean;
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
  notifyUnread?(playerId: string, category: 'trade'): void;
  /** Accepts a stack that does not fit in the live inventory. Returns false if it was not retained. */
  retainStack?(playerId: string, stack: ItemStack): boolean;
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

  constructor(private readonly economy: CurrencyPort) {}

  setRuntime(runtime: TradeRuntime): void {
    this.runtime = runtime;
  }

  incomingRequests(playerId: string): TradeRequest[] {
    return this.requests.filter((request) => request.toPlayerId === playerId);
  }

  outgoingRequests(playerId: string): TradeRequest[] {
    return this.requests.filter((request) => request.fromPlayerId === playerId);
  }

  private durability?: ItemDurability;
  private settlements?: SettlementService;
  haltAfter?: string;

  setStage2C(input: { durability?: ItemDurability; settlements?: SettlementService }): void {
    this.durability = input.durability;
    this.settlements = input.settlements;
  }

  async recoverTrades(paid: (settlementId: string) => Promise<boolean>): Promise<number> {
    if (!this.settlements || !this.durability) return 0;
    let changed = 0;
    for (const row of await this.settlements.listOpen()) {
      if (row.kind !== 'TRADE_SETTLEMENT') continue;
      const playerA = String(row.payload.playerA ?? '');
      const playerB = String(row.payload.playerB ?? '');
      const escrow = tradeEscrowReceipt(row.settlementId);
      const money = await paid(row.settlementId);
      if (!money) {
        const restoredA = await this.durability.restoreAll(playerA, escrow, payloadStacks(row.payload.offersA));
        const restoredB = await this.durability.restoreAll(playerB, escrow, payloadStacks(row.payload.offersB));
        if (restoredA === 'full' || restoredB === 'full' || restoredA === 'missing' || restoredB === 'missing') continue;
        if (row.phase === 'PREPARED' || row.phase === 'ESCROW_DURABLE') {
          await this.settlements.transition(row.settlementId, row.phase, 'CANCELLED');
        }
        changed += 1;
        continue;
      }
      const forA = payloadStacks(row.payload.itemsForA);
      const forB = payloadStacks(row.payload.itemsForB);
      const deliveredA = await this.durability.deliverAll(playerA, tradeDeliveryReceipt(row.settlementId, playerA), forA);
      const deliveredB = await this.durability.deliverAll(playerB, tradeDeliveryReceipt(row.settlementId, playerB), forB);
      if (deliveredA === 'full' || deliveredA === 'missing' || deliveredB === 'full' || deliveredB === 'missing') continue;
      if (row.phase === 'PREPARED' || row.phase === 'ESCROW_DURABLE') {
        await this.settlements.advance(row.settlementId, row.phase, 'MONEY_COMMITTED');
      }
      const current = await this.settlements.get(row.settlementId);
      if (current && (current.phase === 'MONEY_COMMITTED' || current.phase === 'DOMAIN_DURABLE' || current.phase === 'DELIVERY_DURABLE')) {
        await this.settlements.advance(row.settlementId, current.phase, 'COMPLETE');
      }
      changed += 1;
    }
    return changed;
  }

  unsavedOfferStacks(playerId: string, receipts: ReadonlySet<string>): ItemStack[] {
    const session = this.sessionFor(playerId);
    if (!session) return [];
    if (receipts.has(tradeEscrowReceipt(session.settlementId))) return [];
    const offer = session.offers[playerId];
    if (!offer) return [];
    return offer.slots.filter((slot): slot is ItemStack => slot !== null);
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
    this.runtime.notifyUnread?.(target.id, 'trade');
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
      settlementId: randomUUID(),
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
    if (session.settling) return { ok: false, error: 'Обмен уже выполняется.' };
    const offer = offerOf(session, playerId);
    offer.ready = true;
    offer.accepted = false;
    const other = partnerOf(session, playerId);
    if (other) offerOf(session, other).accepted = false;
    return { ok: true, affected: [session.playerA, session.playerB] };
  }

  accept(playerId: string, clientRequestId?: string): TradeResult {
    const session = this.sessionFor(playerId);
    if (!session) return { ok: false, error: TRADE_STALE_ERROR };
    if (session.settling) return { ok: false, error: 'Обмен уже выполняется.' };
    const other = partnerOf(session, playerId);
    if (!other) return { ok: false, error: TRADE_STALE_ERROR };
    const self = offerOf(session, playerId);
    const partner = offerOf(session, other);
    if (!self.ready || !partner.ready) return { ok: false, error: TRADE_NOT_READY_ERROR };
    self.accepted = true;
    if (!partner.accepted) return { ok: true, affected: [session.playerA, session.playerB] };
    return this.complete(session, clientRequestId) as TradeResult;
  }

  cancel(playerId: string): TradeResult {
    const session = this.sessionFor(playerId);
    if (!session) {
      this.dropRequestsInvolving(playerId);
      return { ok: true, closed: true, affected: [playerId] };
    }
    if (session.settling) return { ok: false, error: 'Обмен уже выполняется.' };
    return this.closeSession(session, 'Обмен отклонён.');
  }

  disconnect(playerId: string): TradeResult {
    const session = this.sessionFor(playerId);
    this.dropRequestsInvolving(playerId);
    if (!session) return { ok: true, closed: true, affected: [playerId] };
    if (session.settling) return { ok: false, error: 'Обмен уже выполняется.', affected: [playerId] };
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
    if (session.settling) return { ok: false, error: 'Обмен уже выполняется.' };
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

  private complete(session: TradeSession, clientRequestId?: string): TradeResult | Promise<TradeResult> {
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
      if ((offerA.money > 0 || offerB.money > 0) && this.economy.backend === 'postgres' && !isClientMoneyRequestId(clientRequestId)) {
        return { ok: false, error: MONEY_REQUEST_REQUIRED };
      }
      if (this.durability && this.settlements && this.economy.backend === 'postgres') {
        return this.completeDurable(session, offerA, offerB, incomingA, incomingB, invA, invB);
      }
      // The request UUID is a boundary check. Money identity stays
      // `session.settlementId` (`:a`, `:b`, `:a:undo`). One request id cannot
      // wrap both legs in IdempotencyService, and this settlement is not crash-atomic.
      const moved = this.payTrade(session, offerA.money, offerB.money);
      return thenResult(moved, (paid) => {
        if (!paid.ok) return { ok: false as const, error: paid.error ?? TRADE_MONEY_ERROR };
        for (const stack of incomingA) invA.add(cloneStack(stack)!);
        for (const stack of incomingB) invB.add(cloneStack(stack)!);
        offerA.slots.fill(null);
        offerB.slots.fill(null);
        this.dropSession(session);
        this.runtime.sendMessage(session.playerA, 'Обмен выполнен.');
        this.runtime.sendMessage(session.playerB, 'Обмен выполнен.');
        return {
          ok: true as const,
          completed: true,
          closed: true,
          affected: [session.playerA, session.playerB],
        };
      });
    });
  }

  private completeDurable(
    session: TradeSession,
    offerA: TradeOffer,
    offerB: TradeOffer,
    incomingA: ItemStack[],
    incomingB: ItemStack[],
    invA: Inventory,
    invB: Inventory,
  ): Promise<TradeResult> {
    const durability = this.durability;
    const settlements = this.settlements;
    if (!durability || !settlements) return Promise.resolve({ ok: false, error: SETTLEMENT_RECOVERING });
    const receipt = tradeEscrowReceipt(session.settlementId);
    session.settling = true;
    const offersA = incomingB.map((stack) => stackRecord(stack));
    const offersB = incomingA.map((stack) => stackRecord(stack));
    return (async () => {
      await settlements.begin({
        settlementId: session.settlementId,
        kind: 'TRADE_SETTLEMENT',
        payload: {
          playerA: session.playerA,
          playerB: session.playerB,
          moneyA: offerA.money,
          moneyB: offerB.money,
          offersA,
          offersB,
          itemsForA: incomingA.map((stack) => stackRecord(stack)),
          itemsForB: incomingB.map((stack) => stackRecord(stack)),
        },
      });
      if (this.haltAfter === 'trade-prepared') return { ok: false as const, error: 'halt:trade-prepared' };
      if (!durability.hasReceipt(session.playerA, receipt)) await durability.escrow(session.playerA, receipt);
      if (this.haltAfter === 'trade-escrow-a') return { ok: false as const, error: 'halt:trade-escrow-a' };
      if (!durability.hasReceipt(session.playerB, receipt)) await durability.escrow(session.playerB, receipt);
      await settlements.advance(session.settlementId, 'PREPARED', 'ESCROW_DURABLE');
      if (this.haltAfter === 'trade-escrowed') return { ok: false as const, error: 'halt:trade-escrowed' };
      const paid = await Promise.resolve(this.payTrade(session, offerA.money, offerB.money));
      if (!paid.ok) {
        const backA = await this.returnEscrow(durability, session.playerA, offerA, receipt, payloadStacks(offersA));
        const backB = await this.returnEscrow(durability, session.playerB, offerB, receipt, payloadStacks(offersB));
        const blocked = backA === 'full' || backA === 'missing' || backB === 'full' || backB === 'missing';
        if (!blocked) {
          const phase = (await settlements.get(session.settlementId))?.phase;
          if (phase === 'PREPARED' || phase === 'ESCROW_DURABLE') {
            await settlements.transition(session.settlementId, phase, 'CANCELLED');
          }
          this.returnOffers(session);
          this.dropSession(session);
        }
        return paid;
      }
      if (this.haltAfter === 'trade-paid') return { ok: false as const, error: SETTLEMENT_RECOVERING };
      await settlements.advance(session.settlementId, 'ESCROW_DURABLE', 'MONEY_COMMITTED');
      if (this.haltAfter === 'trade-money') return { ok: false as const, error: SETTLEMENT_RECOVERING };
      const deliveredA = await durability.deliverAll(session.playerA, tradeDeliveryReceipt(session.settlementId, session.playerA), incomingA);
      if (deliveredA === 'full' || deliveredA === 'missing') return { ok: false as const, error: SETTLEMENT_RECOVERING };
      if (this.haltAfter === 'trade-delivered-a') return { ok: false as const, error: SETTLEMENT_RECOVERING };
      const deliveredB = await durability.deliverAll(session.playerB, tradeDeliveryReceipt(session.settlementId, session.playerB), incomingB);
      if (deliveredB === 'full' || deliveredB === 'missing') return { ok: false as const, error: SETTLEMENT_RECOVERING };
      await settlements.advance(session.settlementId, 'MONEY_COMMITTED', 'COMPLETE');
      offerA.slots.fill(null);
      offerB.slots.fill(null);
      this.dropSession(session);
      this.runtime.sendMessage(session.playerA, 'Обмен выполнен.');
      this.runtime.sendMessage(session.playerB, 'Обмен выполнен.');
      return { ok: true as const, completed: true, closed: true, affected: [session.playerA, session.playerB] };
    })();
  }

  private payTrade(session: TradeSession, moneyA: number, moneyB: number): TradeResult | Promise<TradeResult> {
    const net = this.economy as CurrencyPort & {
      settleNet?(playerA: string, playerB: string, deltaA: number, sourceId: string): Promise<{ ok: boolean; error?: string }>;
    };
    if (this.economy.backend === 'postgres' && net.settleNet) {
      const deltaA = moneyB - moneyA;
      const settled = net.settleNet(session.playerA, session.playerB, deltaA, session.settlementId);
      return thenResult(settled, (paid) => (
        paid.ok ? { ok: true as const } : { ok: false as const, error: paid.error ?? TRADE_MONEY_ERROR }
      ));
    }
    const pay = (
      from: string,
      to: string,
      amount: number,
      sourceId: string,
    ): { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }> => {
      if (amount <= 0) return { ok: true };
      return this.economy.transfer(from, to, amount, 'TRADE', undefined, sourceId);
    };
    const first = pay(session.playerA, session.playerB, moneyA, `${session.settlementId}:a`);
    return thenResult(first, (paidA) => {
      if (!paidA.ok) return { ok: false as const, error: paidA.error ?? TRADE_MONEY_ERROR };
      const second = pay(session.playerB, session.playerA, moneyB, `${session.settlementId}:b`);
      return thenResult(second, (paidB) => {
        if (paidB.ok) return { ok: true as const };
        if (moneyA <= 0) return { ok: false as const, error: paidB.error ?? TRADE_MONEY_ERROR };
        const undo = this.economy.transfer(
          session.playerB,
          session.playerA,
          moneyA,
          'TRADE',
          undefined,
          `${session.settlementId}:a:undo`,
        );
        return thenResult(undo, () => ({ ok: false as const, error: paidB.error ?? TRADE_MONEY_ERROR }));
      });
    });
  }

  private async returnEscrow(
    durability: ItemDurability,
    playerId: string,
    offer: TradeOffer,
    receipt: string,
    stacks: readonly ItemStack[],
  ): Promise<ItemEffectResult> {
    if (!durability.hasReceipt(playerId, receipt)) return 'already';
    offer.slots.fill(null);
    return durability.restoreAll(playerId, receipt, stacks);
  }

  private closeSession(session: TradeSession, message: string): TradeResult {
    if (!this.returnOffers(session)) {
      return {
        ok: false,
        error: 'Не удалось вернуть предметы обмена.',
        affected: [session.playerA, session.playerB],
      };
    }
    this.dropSession(session);
    this.runtime.sendMessage(session.playerA, message);
    this.runtime.sendMessage(session.playerB, message);
    return { ok: true, closed: true, affected: [session.playerA, session.playerB] };
  }

  /** Places every offer into inventory or heldReturns. A slot stays occupied until that handoff succeeds. */
  private returnOffers(session: TradeSession): boolean {
    let complete = true;
    for (const playerId of [session.playerA, session.playerB]) {
      const inventory = this.runtime.inventory(playerId);
      const offer = session.offers[playerId];
      if (!offer) continue;
      for (let index = 0; index < offer.slots.length; index += 1) {
        const stack = offer.slots[index];
        if (!stack) continue;
        const placed = inventory
          ? this.placeOfferStack(playerId, inventory, stack)
          : this.runtime.retainStack?.(playerId, stack) === true;
        if (placed) offer.slots[index] = null;
        else complete = false;
      }
    }
    return complete;
  }

  private placeOfferStack(playerId: string, inventory: Inventory, stack: ItemStack): boolean {
    const copy = inventory.clone();
    if (copy.add(cloneStack(stack)!) === null) {
      inventory.restore(copy.serialize());
      return true;
    }
    return this.runtime.retainStack?.(playerId, stack) === true;
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

  private withLocks<T extends TradeResult | Promise<TradeResult>>(playerIds: readonly string[], fn: () => T): T {
    const unique = [...new Set(playerIds)].sort();
    if (unique.some((id) => this.locks.has(id))) {
      return { ok: false, error: 'Обмен уже выполняется.' } as T;
    }
    for (const id of unique) this.locks.add(id);
    let asyncResult = false;
    const release = (): void => {
      for (const id of unique) this.locks.delete(id);
    };
    try {
      const result = fn();
      if (isPromise(result)) {
        asyncResult = true;
        return result.finally(release) as T;
      }
      return result;
    } finally {
      if (!asyncResult) release();
    }
  }
}

function payloadStacks(value: unknown): ItemStack[] {
  if (!Array.isArray(value)) return [];
  const stacks: ItemStack[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as { itemId?: ItemStack['itemId']; count?: number; durability?: number | null; metadata?: ItemStack['metadata'] };
    if (!row.itemId || !Number.isInteger(row.count)) continue;
    stacks.push({
      itemId: row.itemId,
      count: row.count as number,
      ...(typeof row.durability === 'number' ? { durability: row.durability } : {}),
      ...(row.metadata !== undefined ? { metadata: row.metadata } : {}),
    });
  }
  return stacks;
}
