import { Inventory, cloneStack, canStacksMerge, parseSerializedItemStack, splitItemStack, type ItemStack } from '../../src/inventory';
import { getItemDefinition } from '../../src/items';
import { inventoryCanAccept } from './auction';
import type { EconomyService } from './economy';
import type { JsonFileStore } from './jsonStore';
import {
  TRADE_ALREADY_REQUEST_ERROR,
  TRADE_ATOMIC_ERROR,
  TRADE_BUSY_ERROR,
  TRADE_CHANGED_ERROR,
  TRADE_ITEM_ERROR,
  TRADE_MISSING_ERROR,
  TRADE_MISSING_PLAYER_ERROR,
  TRADE_MONEY_BALANCE_ERROR,
  TRADE_MONEY_ERROR,
  TRADE_NOT_READY_ERROR,
  TRADE_OFFLINE_ERROR,
  TRADE_PLUGIN_NAME,
  TRADE_SELF_ERROR,
  TRADE_SLOT_COUNT,
  TRADE_STACK_ERROR,
  isTradeSlotIndex,
  tradeSpaceError,
} from '../../shared/trade';

export { TRADE_PLUGIN_NAME, TRADE_SLOT_COUNT, TRADE_CANCELLED_MESSAGE } from '../../shared/trade';

export interface TradeOfferState {
  slots: Array<ItemStack | null>;
  money: number;
  ready: boolean;
  accepted: boolean;
  selectedSlot?: number;
  version: number;
}

export interface TradeSession {
  readonly id: string;
  readonly leftId: string;
  readonly rightId: string;
  readonly offers: Record<string, TradeOfferState>;
}

export interface TradeRequest {
  readonly fromId: string;
  readonly toId: string;
}

export interface TradeResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly session?: TradeSession;
  readonly closed?: boolean;
  readonly completed?: boolean;
  readonly notify?: readonly string[];
}

export interface TradeRuntime {
  isOnline(playerId: string): boolean;
  displayName(playerId: string): string;
  lookupPlayer(idOrName: string): { readonly id: string; readonly name: string } | undefined;
  inventory(playerId: string): Inventory | undefined;
  flushInventory(playerId: string): void;
}

function emptyOffer(): TradeOfferState {
  return {
    slots: Array.from({ length: TRADE_SLOT_COUNT }, () => null),
    money: 0,
    ready: false,
    accepted: false,
    version: 0,
  };
}

function offerFingerprint(offer: TradeOfferState): string {
  return JSON.stringify({
    slots: offer.slots,
    money: offer.money,
  });
}

const emptyRuntime: TradeRuntime = {
  isOnline: () => false,
  displayName: (id) => id.slice(0, 8),
  lookupPlayer: () => undefined,
  inventory: () => undefined,
  flushInventory: () => undefined,
};

export class TradeService {
  private requests: TradeRequest[] = [];
  private sessions = new Map<string, TradeSession>();
  private byPlayer = new Map<string, string>();
  private pendingReturns = new Map<string, ItemStack[]>();
  private readonly locks = new Set<string>();
  private nextId = 1;
  private runtime: TradeRuntime = emptyRuntime;

  constructor(
    private readonly store: JsonFileStore,
    private readonly economy: EconomyService,
  ) {
    this.load();
  }

  setRuntime(runtime: TradeRuntime): void {
    this.runtime = runtime;
  }

  load(): void {
    const file = this.store.load<{
      nextId?: number;
      requests?: unknown[];
      sessions?: unknown[];
      pendingReturns?: unknown;
    }>(
      `${TRADE_PLUGIN_NAME}/sessions`,
      { nextId: 1, requests: [], sessions: [], pendingReturns: {} },
    );
    this.nextId = Number.isInteger(file.nextId) && (file.nextId ?? 0) > 0 ? file.nextId! : 1;
    this.requests = Array.isArray(file.requests)
      ? file.requests.flatMap((row) => {
        if (!row || typeof row !== 'object') return [];
        const rec = row as { fromId?: unknown; toId?: unknown };
        if (typeof rec.fromId !== 'string' || typeof rec.toId !== 'string') return [];
        return [{ fromId: rec.fromId, toId: rec.toId }];
      })
      : [];
    this.sessions.clear();
    this.byPlayer.clear();
    if (Array.isArray(file.sessions)) {
      for (const raw of file.sessions) {
        const session = this.parseSession(raw);
        if (!session) continue;
        this.sessions.set(session.id, session);
        this.byPlayer.set(session.leftId, session.id);
        this.byPlayer.set(session.rightId, session.id);
      }
    }
    this.pendingReturns.clear();
    if (file.pendingReturns && typeof file.pendingReturns === 'object' && !Array.isArray(file.pendingReturns)) {
      for (const [id, value] of Object.entries(file.pendingReturns as Record<string, unknown>)) {
        if (!Array.isArray(value)) continue;
        this.pendingReturns.set(id, value.map((entry) => {
          try {
            return parseSerializedItemStack(entry);
          } catch {
            return null;
          }
        }).filter((stack): stack is ItemStack => Boolean(stack)));
      }
    }
  }

  persist(): void {
    const pendingReturns: Record<string, ItemStack[]> = {};
    for (const [id, stacks] of this.pendingReturns) pendingReturns[id] = stacks;
    this.store.save(`${TRADE_PLUGIN_NAME}/sessions`, {
      nextId: this.nextId,
      requests: this.requests,
      sessions: [...this.sessions.values()],
      pendingReturns,
    });
  }

  deliverPending(playerId: string): void {
    const pending = this.pendingReturns.get(playerId);
    if (!pending || pending.length === 0) return;
    const inventory = this.runtime.inventory(playerId);
    if (!inventory) return;
    const leftover: ItemStack[] = [];
    for (const stack of pending) {
      const rest = inventory.add(stack);
      if (rest) leftover.push(rest);
    }
    if (leftover.length === 0) this.pendingReturns.delete(playerId);
    else this.pendingReturns.set(playerId, leftover);
    this.runtime.flushInventory(playerId);
    this.persist();
  }

  restoreEscrow(): void {
    for (const session of [...this.sessions.values()]) {
      this.cancelSession(session, false);
    }
  }

  incoming(playerId: string): TradeRequest[] {
    return this.requests.filter((row) => row.toId === playerId);
  }

  outgoing(playerId: string): TradeRequest[] {
    return this.requests.filter((row) => row.fromId === playerId);
  }

  sessionFor(playerId: string): TradeSession | undefined {
    const id = this.byPlayer.get(playerId);
    return id ? this.sessions.get(id) : undefined;
  }

  request(fromId: string, targetRaw: string): TradeResult {
    const target = this.runtime.lookupPlayer(targetRaw);
    if (!target) return { ok: false, error: TRADE_MISSING_PLAYER_ERROR };
    if (target.id === fromId) return { ok: false, error: TRADE_SELF_ERROR };
    if (!this.runtime.isOnline(target.id)) return { ok: false, error: TRADE_OFFLINE_ERROR };
    if (this.requests.some((row) => row.fromId === target.id && row.toId === fromId)) {
      return this.acceptRequest(fromId, target.id);
    }
    return this.withLock(fromId, () => {
      if (this.byPlayer.has(fromId) || this.byPlayer.has(target.id)) return { ok: false, error: TRADE_BUSY_ERROR };
      if (this.requests.some((row) => row.fromId === fromId && row.toId === target.id)) {
        return { ok: false, error: TRADE_ALREADY_REQUEST_ERROR };
      }
      this.requests.push({ fromId, toId: target.id });
      this.persist();
      return { ok: true, notify: [fromId, target.id] };
    });
  }

  acceptRequest(playerId: string, fromId: string): TradeResult {
    return this.withLocks(playerId, fromId, () => {
      const index = this.requests.findIndex((row) => row.toId === playerId && row.fromId === fromId);
      if (index < 0) return { ok: false, error: TRADE_MISSING_ERROR };
      if (!this.runtime.isOnline(fromId) || !this.runtime.isOnline(playerId)) {
        return { ok: false, error: TRADE_OFFLINE_ERROR };
      }
      if (this.byPlayer.has(playerId) || this.byPlayer.has(fromId)) return { ok: false, error: TRADE_BUSY_ERROR };
      this.requests.splice(index, 1);
      this.requests = this.requests.filter((row) => row.fromId !== playerId && row.toId !== playerId
        && row.fromId !== fromId && row.toId !== fromId);
      const session: TradeSession = {
        id: `trade-${this.nextId++}`,
        leftId: fromId,
        rightId: playerId,
        offers: {
          [fromId]: emptyOffer(),
          [playerId]: emptyOffer(),
        },
      };
      this.sessions.set(session.id, session);
      this.byPlayer.set(fromId, session.id);
      this.byPlayer.set(playerId, session.id);
      this.persist();
      return { ok: true, session, notify: [fromId, playerId] };
    });
  }

  rejectRequest(playerId: string, fromId: string): TradeResult {
    return this.withLock(playerId, () => {
      const next = this.requests.filter((row) => !(row.toId === playerId && row.fromId === fromId));
      if (next.length === this.requests.length) return { ok: false, error: TRADE_MISSING_ERROR };
      this.requests = next;
      this.persist();
      return { ok: true, notify: [playerId, fromId] };
    });
  }

  selectInventory(playerId: string, slot: number): TradeResult {
    const session = this.sessionFor(playerId);
    if (!session) return { ok: false, error: TRADE_MISSING_ERROR };
    return this.mutateOffer(session, playerId, (offer) => {
      if (!Number.isInteger(slot) || slot < 0 || slot >= Inventory.SLOT_COUNT) {
        return { ok: false, error: TRADE_ITEM_ERROR };
      }
      offer.selectedSlot = slot;
      return { ok: true, session };
    }, false);
  }

  clickOfferSlot(playerId: string, slot: number): TradeResult {
    const session = this.sessionFor(playerId);
    if (!session) return { ok: false, error: TRADE_MISSING_ERROR };
    if (!isTradeSlotIndex(slot)) return { ok: false, error: TRADE_ITEM_ERROR };
    const inventory = this.runtime.inventory(playerId);
    if (!inventory) return { ok: false, error: TRADE_OFFLINE_ERROR };
    return this.mutateOffer(session, playerId, (offer) => {
      const current = offer.slots[slot] ?? null;
      const selected = offer.selectedSlot;
      const incoming = selected !== undefined ? inventory.getSlot(selected) : null;
      if (current && (!incoming || !canStacksMerge(current, incoming))) {
        const leftover = inventory.add(current);
        if (leftover) {
          offer.slots[slot] = leftover;
          return { ok: false, error: tradeSpaceError(this.runtime.displayName(playerId)) };
        }
        offer.slots[slot] = null;
        this.runtime.flushInventory(playerId);
        return { ok: true, session };
      }
      if (selected === undefined || !incoming) return { ok: false, error: TRADE_ITEM_ERROR };
      const cap = getItemDefinition(incoming.itemId).maxStack;
      const already = current?.count ?? 0;
      const room = cap - already;
      if (room <= 0) {
        return { ok: false, error: TRADE_STACK_ERROR };
      }
      const { taken, remainder } = splitItemStack(incoming, Math.min(incoming.count, room));
      if (!taken) return { ok: false, error: TRADE_ITEM_ERROR };
      inventory.setSlot(selected, remainder);
      offer.slots[slot] = current
        ? { ...current, count: current.count + taken.count }
        : taken;
      this.runtime.flushInventory(playerId);
      return { ok: true, session };
    });
  }

  setMoney(playerId: string, raw: string | number | undefined): TradeResult {
    const session = this.sessionFor(playerId);
    if (!session) return { ok: false, error: TRADE_MISSING_ERROR };
    return this.mutateOffer(session, playerId, (offer) => {
      const amount = parseTradeMoney(raw);
      if (amount === undefined) return { ok: false, error: TRADE_MONEY_ERROR };
      if (amount > this.economy.getBalance(playerId)) return { ok: false, error: TRADE_MONEY_BALANCE_ERROR };
      offer.money = amount;
      return { ok: true, session };
    });
  }

  ready(playerId: string): TradeResult {
    const session = this.sessionFor(playerId);
    if (!session) return { ok: false, error: TRADE_MISSING_ERROR };
    return this.withLocks(session.leftId, session.rightId, () => {
      const live = this.sessions.get(session.id);
      if (!live) return { ok: false, error: TRADE_MISSING_ERROR };
      const offer = live.offers[playerId];
      if (!offer) return { ok: false, error: TRADE_MISSING_ERROR };
      offer.ready = true;
      offer.accepted = false;
      this.persist();
      return { ok: true, session: live, notify: [live.leftId, live.rightId] };
    });
  }

  accept(playerId: string): TradeResult {
    const session = this.sessionFor(playerId);
    if (!session) return { ok: false, error: TRADE_MISSING_ERROR };
    return this.withLocks(session.leftId, session.rightId, () => {
      const live = this.sessions.get(session.id);
      if (!live) return { ok: false, error: TRADE_MISSING_ERROR };
      const self = live.offers[playerId];
      const otherId = live.leftId === playerId ? live.rightId : live.leftId;
      const other = live.offers[otherId];
      if (!self || !other) return { ok: false, error: TRADE_MISSING_ERROR };
      if (!self.ready || !other.ready) return { ok: false, error: TRADE_NOT_READY_ERROR };
      self.accepted = true;
      if (!other.accepted) {
        this.persist();
        return { ok: true, session: live, notify: [live.leftId, live.rightId] };
      }
      return this.commit(live);
    });
  }

  cancel(playerId: string): TradeResult {
    const session = this.sessionFor(playerId);
    if (!session) {
      this.requests = this.requests.filter((row) => row.fromId !== playerId && row.toId !== playerId);
      this.persist();
      return { ok: true, closed: true, notify: [playerId] };
    }
    return this.withLocks(session.leftId, session.rightId, () => this.cancelSession(session, true));
  }

  disconnect(playerId: string): TradeResult {
    return this.cancel(playerId);
  }

  partnerId(session: TradeSession, playerId: string): string {
    return session.leftId === playerId ? session.rightId : session.leftId;
  }

  private mutateOffer(
    session: TradeSession,
    playerId: string,
    fn: (offer: TradeOfferState) => TradeResult,
    resetReady = true,
  ): TradeResult {
    return this.withLocks(session.leftId, session.rightId, () => {
      const live = this.sessions.get(session.id);
      if (!live) return { ok: false, error: TRADE_MISSING_ERROR };
      const offer = live.offers[playerId];
      if (!offer) return { ok: false, error: TRADE_MISSING_ERROR };
      const before = offerFingerprint(offer);
      const result = fn(offer);
      if (!result.ok) return result;
      if (resetReady && offerFingerprint(offer) !== before) {
        for (const id of [live.leftId, live.rightId]) {
          const row = live.offers[id];
          if (!row) continue;
          row.ready = false;
          row.accepted = false;
          row.version += 1;
        }
      }
      this.persist();
      return { ok: true, session: live, notify: [live.leftId, live.rightId] };
    });
  }

  private commit(session: TradeSession): TradeResult {
    const left = this.runtime.inventory(session.leftId);
    const right = this.runtime.inventory(session.rightId);
    if (!left || !right || !this.runtime.isOnline(session.leftId) || !this.runtime.isOnline(session.rightId)) {
      return { ok: false, error: TRADE_OFFLINE_ERROR };
    }
    const leftOffer = session.offers[session.leftId]!;
    const rightOffer = session.offers[session.rightId]!;
    if (!leftOffer.ready || !rightOffer.ready || !leftOffer.accepted || !rightOffer.accepted) {
      return { ok: false, error: TRADE_NOT_READY_ERROR };
    }
    if (leftOffer.money < 0 || rightOffer.money < 0 || !Number.isInteger(leftOffer.money) || !Number.isInteger(rightOffer.money)) {
      return { ok: false, error: TRADE_MONEY_ERROR };
    }
    if (leftOffer.money > this.economy.getBalance(session.leftId)) return { ok: false, error: TRADE_MONEY_BALANCE_ERROR };
    if (rightOffer.money > this.economy.getBalance(session.rightId)) return { ok: false, error: TRADE_MONEY_BALANCE_ERROR };
    const net = leftOffer.money - rightOffer.money;

    const leftCopy = left.clone();
    const rightCopy = right.clone();
    for (const stack of rightOffer.slots) {
      if (!stack) continue;
      if (!inventoryCanAccept(leftCopy, stack)) return { ok: false, error: tradeSpaceError(this.runtime.displayName(session.leftId)) };
      leftCopy.add(stack);
    }
    for (const stack of leftOffer.slots) {
      if (!stack) continue;
      if (!inventoryCanAccept(rightCopy, stack)) return { ok: false, error: tradeSpaceError(this.runtime.displayName(session.rightId)) };
      rightCopy.add(stack);
    }

    if (net > 0) {
      const moved = this.economy.settle(session.leftId, session.rightId, net, 'TRADE_SEND', 'TRADE_RECEIVE', session.id);
      if (!moved.ok) return { ok: false, error: moved.error ?? TRADE_ATOMIC_ERROR };
    } else if (net < 0) {
      const moved = this.economy.settle(session.rightId, session.leftId, -net, 'TRADE_SEND', 'TRADE_RECEIVE', session.id);
      if (!moved.ok) return { ok: false, error: moved.error ?? TRADE_ATOMIC_ERROR };
    }

    for (const stack of rightOffer.slots) {
      if (stack) left.add(cloneStack(stack)!);
    }
    for (const stack of leftOffer.slots) {
      if (stack) right.add(cloneStack(stack)!);
    }
    leftOffer.slots = Array.from({ length: TRADE_SLOT_COUNT }, () => null);
    rightOffer.slots = Array.from({ length: TRADE_SLOT_COUNT }, () => null);
    this.dropSession(session);
    this.runtime.flushInventory(session.leftId);
    this.runtime.flushInventory(session.rightId);
    this.persist();
    return {
      ok: true,
      closed: true,
      completed: true,
      notify: [session.leftId, session.rightId],
    };
  }

  private cancelSession(session: TradeSession, persist: boolean): TradeResult {
    this.returnEscrow(session.leftId, session.offers[session.leftId]);
    this.returnEscrow(session.rightId, session.offers[session.rightId]);
    this.dropSession(session);
    this.runtime.flushInventory(session.leftId);
    this.runtime.flushInventory(session.rightId);
    if (persist) this.persist();
    return { ok: true, closed: true, notify: [session.leftId, session.rightId] };
  }

  private returnEscrow(playerId: string, offer: TradeOfferState | undefined): void {
    if (!offer) return;
    const inventory = this.runtime.inventory(playerId);
    for (let i = 0; i < offer.slots.length; i += 1) {
      const stack = offer.slots[i];
      if (!stack) continue;
      if (!inventory) {
        const pending = this.pendingReturns.get(playerId) ?? [];
        pending.push(stack);
        this.pendingReturns.set(playerId, pending);
        offer.slots[i] = null;
        continue;
      }
      const leftover = inventory.add(stack);
      offer.slots[i] = leftover;
    }
  }

  private dropSession(session: TradeSession): void {
    this.sessions.delete(session.id);
    this.byPlayer.delete(session.leftId);
    this.byPlayer.delete(session.rightId);
  }

  private parseSession(raw: unknown): TradeSession | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.id !== 'string' || typeof rec.leftId !== 'string' || typeof rec.rightId !== 'string') return undefined;
    if (!rec.offers || typeof rec.offers !== 'object') return undefined;
    const offers: Record<string, TradeOfferState> = {};
    for (const id of [rec.leftId, rec.rightId]) {
      const row = (rec.offers as Record<string, unknown>)[id];
      offers[id] = parseOffer(row);
    }
    return { id: rec.id, leftId: rec.leftId, rightId: rec.rightId, offers };
  }

  private withLock(playerId: string, fn: () => TradeResult): TradeResult {
    if (this.locks.has(playerId)) return { ok: false, error: TRADE_BUSY_ERROR };
    this.locks.add(playerId);
    try {
      return fn();
    } finally {
      this.locks.delete(playerId);
    }
  }

  private withLocks(a: string, b: string, fn: () => TradeResult): TradeResult {
    const first = a < b ? a : b;
    const second = a < b ? b : a;
    if (this.locks.has(first) || this.locks.has(second)) return { ok: false, error: TRADE_BUSY_ERROR };
    this.locks.add(first);
    this.locks.add(second);
    try {
      return fn();
    } finally {
      this.locks.delete(second);
      this.locks.delete(first);
    }
  }
}

function parseOffer(raw: unknown): TradeOfferState {
  const base = emptyOffer();
  if (!raw || typeof raw !== 'object') return base;
  const rec = raw as Record<string, unknown>;
  const slots = Array.isArray(rec.slots) ? rec.slots.slice(0, TRADE_SLOT_COUNT) : [];
  while (slots.length < TRADE_SLOT_COUNT) slots.push(null);
  base.slots = slots.map((entry) => {
    try {
      return parseSerializedItemStack(entry);
    } catch {
      return null;
    }
  });
  base.money = Number.isInteger(rec.money) && (rec.money as number) >= 0 ? rec.money as number : 0;
  base.ready = rec.ready === true;
  base.accepted = rec.accepted === true;
  base.version = Number.isInteger(rec.version) ? rec.version as number : 0;
  if (Number.isInteger(rec.selectedSlot)) base.selectedSlot = rec.selectedSlot as number;
  return base;
}

export function parseTradeMoney(raw: string | number | undefined): number | undefined {
  if (raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 0) return undefined;
    return raw;
  }
  const trimmed = raw.trim();
  if (trimmed === '') return 0;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) return undefined;
  return value;
}
