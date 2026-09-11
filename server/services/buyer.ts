import { randomBytes } from 'node:crypto';
import {
  BUYER_BUSY_ERROR,
  BUYER_HOLOGRAM_TEXT_MAX,
  BUYER_HOLOGRAM_Y_OFFSET,
  BUYER_ITEM_INVALID_ERROR,
  BUYER_MAX_PRICE,
  BUYER_MIN_PRICE,
  BUYER_NAME_TAKEN_ERROR,
  BUYER_NOT_CONFIGURED_ERROR,
  BUYER_NOT_FOUND_ERROR,
  BUYER_PRICE_EMPTY_ERROR,
  BUYER_STALE_ERROR,
  BUYER_STORE_KEY,
  BUYER_WRONG_ITEM_ERROR,
  buyerHologramName,
  isBuyerHologramName,
  buyerPayout,
  buyerPriceError,
  parseBuyerPrice,
  validateBuyerName,
} from '../../shared/buyers';
import { formatCompactMegacoins } from '../../shared/megacoins';
import type { ClientBuyerActionMessage, NetworkBuyerNpc, ServerBuyerMessage } from '../../shared/protocol';
import {
  Inventory,
  canStacksMerge,
  cloneStack,
  createItemStack,
  type ItemStack,
} from '../../src/inventory';
import { isKnownItemId, tryGetItemDefinition } from '../../src/items';
import { formatMegacoins } from './economy';
import type { EconomyService } from './economy';
import { createHologramRecord, type HologramNetwork } from './holograms';
import type { JsonFileStore } from './jsonStore';

export type BuyerScreen = 'admin' | 'pick-item' | 'trade' | 'closed';

export interface BuyerRecord {
  id: string;
  name: string;
  worldId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  itemId?: string;
  pricePerItem?: number;
  hologramName: string;
  hologramText: string;
  createdAt: number;
}

export interface BuyerResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly buyer?: BuyerRecord;
  readonly chat?: string;
  readonly inventoryDirty?: boolean;
  readonly broadcast?: boolean;
  readonly affectedPlayerIds?: readonly string[];
}

interface BuyerSession {
  screen: BuyerScreen;
  buyerId: string;
  nameText: string;
  priceText: string;
  hologramText: string;
  draftItemId?: string;
  tradeSlot: ItemStack | null;
  message?: string;
}

interface BuyerStoreFile {
  buyers: BuyerRecord[];
  returns?: Record<string, ItemStack | ItemStack[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function itemName(itemId: string | undefined): string | undefined {
  if (!itemId) return undefined;
  return tryGetItemDefinition(itemId)?.name ?? itemId;
}

function compactMk(amount: number): string {
  return `${formatCompactMegacoins(amount)} МК`;
}

function hologramLines(text: string, fallback: string): string[] {
  const line = text.trim() || fallback;
  return [line.slice(0, BUYER_HOLOGRAM_TEXT_MAX)];
}

export function isBuyerConfigured(buyer: BuyerRecord): buyer is BuyerRecord & { itemId: string; pricePerItem: number } {
  return typeof buyer.itemId === 'string'
    && isKnownItemId(buyer.itemId)
    && Number.isInteger(buyer.pricePerItem)
    && buyer.pricePerItem! >= BUYER_MIN_PRICE
    && buyer.pricePerItem! <= BUYER_MAX_PRICE;
}

export class BuyerService {
  private buyers = new Map<string, BuyerRecord>();
  private sessions = new Map<string, BuyerSession>();
  private returns = new Map<string, ItemStack[]>();
  private readonly locks = new Set<string>();
  private affectedPlayers = new Set<string>();

  constructor(
    private readonly store: JsonFileStore,
    private readonly economy: EconomyService,
    private readonly holograms: HologramNetwork,
    private readonly worldId: () => string = () => 'anarchy',
    private readonly now: () => number = Date.now,
    private readonly nextId: () => string = () => randomBytes(4).toString('hex'),
  ) {}

  load(): void {
    const raw = this.store.load<BuyerStoreFile>(BUYER_STORE_KEY, { buyers: [] });
    this.buyers.clear();
    const list = Array.isArray(raw.buyers) ? raw.buyers : [];
    for (const entry of list) {
      const buyer = this.normalize(entry);
      if (buyer) this.buyers.set(buyer.id, buyer);
    }
    this.returns.clear();
    if (raw.returns && isRecord(raw.returns)) {
      for (const [playerId, value] of Object.entries(raw.returns)) {
        const stacks = Array.isArray(value) ? value : [value];
        const parsed = stacks
          .map((stack) => cloneStack(stack as ItemStack))
          .filter((stack): stack is ItemStack => !!stack && isKnownItemId(stack.itemId) && stack.count > 0);
        if (parsed.length > 0) this.returns.set(playerId, parsed);
      }
    }
  }

  persist(): void {
    this.store.save(BUYER_STORE_KEY, {
      buyers: this.list(),
      returns: Object.fromEntries(this.returns.entries()),
    });
  }

  ensureHolograms(): void {
    const known = new Set<string>();
    for (const buyer of this.buyers.values()) {
      this.syncHologram(buyer);
      known.add(buyer.hologramName);
    }
    for (const hologram of [...this.holograms.listRecords()]) {
      if (isBuyerHologramName(hologram.name) && !known.has(hologram.name)) {
        this.holograms.remove(hologram.name);
      }
    }
  }

  takeAffectedPlayers(): string[] {
    const ids = [...this.affectedPlayers];
    this.affectedPlayers.clear();
    return ids;
  }

  list(): BuyerRecord[] {
    return [...this.buyers.values()].sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name, 'ru'));
  }

  get(id: string): BuyerRecord | undefined {
    return this.buyers.get(id);
  }

  findByName(name: string): BuyerRecord | undefined {
    const key = name.trim().toLowerCase();
    for (const buyer of this.buyers.values()) {
      if (buyer.name.toLowerCase() === key) return buyer;
    }
    return undefined;
  }

  findByHologram(name: string): BuyerRecord | undefined {
    const key = name.trim().toLowerCase();
    for (const buyer of this.buyers.values()) {
      if (buyer.hologramName === key) return buyer;
    }
    return undefined;
  }

  networkBuyers(): NetworkBuyerNpc[] {
    return this.list().map((buyer) => ({
      id: buyer.id,
      name: buyer.name,
      x: buyer.x,
      y: buyer.y,
      z: buyer.z,
      yaw: buyer.yaw,
      pitch: buyer.pitch,
      hologramName: buyer.hologramName,
      ...(buyer.itemId ? { itemId: buyer.itemId } : {}),
    }));
  }

  create(input: {
    name: string;
    worldId: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
  }): BuyerResult {
    const named = validateBuyerName(input.name);
    if (!named.ok) return { ok: false, error: named.error };
    if (this.findByName(named.name)) return { ok: false, error: BUYER_NAME_TAKEN_ERROR };
    const id = this.nextId();
    const hologramName = buyerHologramName(id);
    const buyer: BuyerRecord = {
      id,
      name: named.name,
      worldId: input.worldId,
      x: input.x,
      y: input.y,
      z: input.z,
      yaw: input.yaw,
      pitch: input.pitch,
      hologramName,
      hologramText: named.name,
      createdAt: this.now(),
    };
    this.buyers.set(id, buyer);
    this.syncHologram(buyer);
    this.persist();
    return { ok: true, buyer, broadcast: true };
  }

  move(name: string, pose: {
    worldId: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
  }): BuyerResult {
    const buyer = this.findByName(name);
    if (!buyer) return { ok: false, error: BUYER_NOT_FOUND_ERROR };
    buyer.worldId = pose.worldId;
    buyer.x = pose.x;
    buyer.y = pose.y;
    buyer.z = pose.z;
    buyer.yaw = pose.yaw;
    buyer.pitch = pose.pitch;
    this.holograms.setPosition(
      buyer.hologramName,
      pose.x,
      pose.y + BUYER_HOLOGRAM_Y_OFFSET,
      pose.z,
      pose.worldId,
    );
    this.syncHologram(buyer);
    this.persist();
    return { ok: true, buyer, broadcast: true };
  }

  delete(name: string): BuyerResult {
    const buyer = this.findByName(name);
    if (!buyer) return { ok: false, error: BUYER_NOT_FOUND_ERROR };
    this.removeBuyer(buyer);
    return { ok: true, buyer, broadcast: true };
  }

  deleteById(id: string): BuyerResult {
    const buyer = this.buyers.get(id);
    if (!buyer) return { ok: false, error: BUYER_NOT_FOUND_ERROR };
    this.removeBuyer(buyer);
    return { ok: true, buyer, broadcast: true };
  }

  configure(id: string, patch: {
    name?: string;
    itemId?: string | null;
    pricePerItem?: number;
    hologramText?: string;
  }): BuyerResult {
    const buyer = this.buyers.get(id);
    if (!buyer) return { ok: false, error: BUYER_NOT_FOUND_ERROR };
    if (patch.name !== undefined) {
      const named = validateBuyerName(patch.name);
      if (!named.ok) return { ok: false, error: named.error };
      const taken = this.findByName(named.name);
      if (taken && taken.id !== id) return { ok: false, error: BUYER_NAME_TAKEN_ERROR };
      buyer.name = named.name;
    }
    if (patch.itemId !== undefined) {
      if (patch.itemId === null || patch.itemId === '') {
        buyer.itemId = undefined;
      } else {
        if (!isKnownItemId(patch.itemId)) return { ok: false, error: BUYER_ITEM_INVALID_ERROR };
        buyer.itemId = patch.itemId;
      }
    }
    if (patch.pricePerItem !== undefined) {
      const price = parseBuyerPrice(patch.pricePerItem);
      if (price === undefined) return { ok: false, error: buyerPriceError(patch.pricePerItem) ?? BUYER_PRICE_EMPTY_ERROR };
      buyer.pricePerItem = price;
    }
    if (patch.hologramText !== undefined) {
      const text = patch.hologramText.trim().slice(0, BUYER_HOLOGRAM_TEXT_MAX);
      buyer.hologramText = text.length > 0 ? text : buyer.name;
    }
    this.syncHologram(buyer);
    this.persist();
    this.refreshSessions(buyer);
    return { ok: true, buyer, broadcast: true };
  }

  openAdmin(playerId: string, buyerId: string, inventory?: Inventory): BuyerResult {
    const buyer = this.buyers.get(buyerId);
    if (!buyer) return { ok: false, error: BUYER_NOT_FOUND_ERROR };
    this.restoreOverflow(playerId, inventory);
    this.sessions.set(playerId, {
      screen: 'admin',
      buyerId: buyer.id,
      nameText: buyer.name,
      priceText: buyer.pricePerItem !== undefined ? String(buyer.pricePerItem) : '',
      hologramText: buyer.hologramText,
      draftItemId: buyer.itemId,
      tradeSlot: null,
    });
    return { ok: true, buyer };
  }

  openTrade(playerId: string, buyerId: string, inventory: Inventory): BuyerResult {
    const buyer = this.buyers.get(buyerId);
    if (!buyer) return { ok: false, error: BUYER_NOT_FOUND_ERROR };
    this.restoreOverflow(playerId, inventory);
    this.sessions.set(playerId, {
      screen: 'trade',
      buyerId: buyer.id,
      nameText: buyer.name,
      priceText: buyer.pricePerItem !== undefined ? String(buyer.pricePerItem) : '',
      hologramText: buyer.hologramText,
      draftItemId: buyer.itemId,
      tradeSlot: null,
    });
    return { ok: true, buyer };
  }

  session(playerId: string): BuyerSession | undefined {
    return this.sessions.get(playerId);
  }

  closeSession(playerId: string, inventory?: Inventory): BuyerResult {
    const session = this.sessions.get(playerId);
    if (!session) return { ok: true };
    const leftover = this.returnTradeSlot(playerId, session, inventory);
    this.sessions.delete(playerId);
    if (leftover) this.stashReturn(playerId, leftover);
    return { ok: true, inventoryDirty: true };
  }

  handleAction(
    playerId: string,
    inventory: Inventory,
    message: ClientBuyerActionMessage,
    can: { edit: boolean; delete: boolean; use: boolean },
  ): BuyerResult {
    if (message.action === 'close') return this.closeSession(playerId, inventory);
    const session = this.sessions.get(playerId);
    if (!session) return { ok: false, error: BUYER_STALE_ERROR };
    session.message = undefined;
    const buyer = this.buyers.get(session.buyerId);
    if (!buyer) {
      this.sessions.delete(playerId);
      return { ok: false, error: BUYER_STALE_ERROR };
    }
    if (message.action === 'set_name') {
      if (!can.edit) return { ok: false, error: 'You do not have permission.' };
      session.nameText = typeof message.name === 'string' ? message.name.slice(0, 32) : '';
      return { ok: true };
    }
    if (message.action === 'set_price') {
      if (!can.edit) return { ok: false, error: 'You do not have permission.' };
      session.priceText = typeof message.price === 'string' || typeof message.price === 'number'
        ? String(message.price)
        : '';
      return { ok: true };
    }
    if (message.action === 'set_hologram_text') {
      if (!can.edit) return { ok: false, error: 'You do not have permission.' };
      session.hologramText = typeof message.hologramText === 'string'
        ? message.hologramText.slice(0, BUYER_HOLOGRAM_TEXT_MAX)
        : '';
      return { ok: true };
    }
    if (message.action === 'pick_item') {
      if (!can.edit) return { ok: false, error: 'You do not have permission.' };
      session.screen = 'pick-item';
      return { ok: true };
    }
    if (message.action === 'back') {
      if (session.screen === 'pick-item') session.screen = 'admin';
      return { ok: true };
    }
    if (message.action === 'open_trade') {
      if (!can.use) return { ok: false, error: 'You do not have permission.' };
      this.returnTradeSlot(playerId, session, inventory);
      session.screen = 'trade';
      session.tradeSlot = null;
      return { ok: true, inventoryDirty: true };
    }
    if (message.action === 'select_slot' && message.slot !== undefined) {
      if (session.screen === 'pick-item') {
        if (!can.edit) return { ok: false, error: 'You do not have permission.' };
        return this.pickFromInventory(session, inventory, message.slot);
      }
      if (session.screen === 'trade') {
        if (!can.use) return { ok: false, error: 'You do not have permission.' };
        if (message.slot === -1) return this.returnTradeToInventory(session, inventory);
        return this.placeTradeItem(session, buyer, inventory, message.slot);
      }
      return { ok: true };
    }
    if (message.action === 'set_amount') {
      if (session.screen !== 'trade' || !can.use) return { ok: false, error: 'You do not have permission.' };
      return this.setTradeAmount(session, buyer, inventory, message.amount ?? 0);
    }
    if (message.action === 'save') {
      if (!can.edit) return { ok: false, error: 'You do not have permission.' };
      return this.saveAdmin(session, message);
    }
    if (message.action === 'delete') {
      if (!can.delete) return { ok: false, error: 'You do not have permission.' };
      return this.deleteById(session.buyerId);
    }
    if (message.action === 'sell') {
      if (!can.use) return { ok: false, error: 'You do not have permission.' };
      return this.sell(playerId, inventory, session);
    }
    return { ok: true };
  }

  buildMessage(playerId: string, inventory: Inventory): ServerBuyerMessage {
    const session = this.sessions.get(playerId);
    if (!session) {
      return {
        type: 'buyer',
        screen: 'closed',
        title: '',
        buyerId: '',
        name: '',
        hologramText: '',
        priceText: '',
        quantity: 0,
        maxQuantity: 0,
        total: 0,
        totalLabel: '',
        configured: false,
      };
    }
    const buyer = this.buyers.get(session.buyerId);
    if (!buyer) {
      this.sessions.delete(playerId);
      return this.buildMessage(playerId, inventory);
    }
    const itemId = session.screen === 'admin' || session.screen === 'pick-item'
      ? session.draftItemId
      : buyer.itemId;
    const configured = isBuyerConfigured(buyer);
    const trade = session.tradeSlot;
    const quantity = trade?.count ?? 0;
    const maxQuantity = configured
      ? inventory.count(buyer.itemId) + quantity
      : 0;
    const price = configured ? buyer.pricePerItem : parseBuyerPrice(session.priceText);
    const total = quantity > 0 && price !== undefined ? buyerPayout(quantity, price) ?? 0 : 0;
    const slots = inventory.slots;
    return {
      type: 'buyer',
      screen: session.screen,
      title: session.screen === 'admin' || session.screen === 'pick-item'
        ? 'Настройка скупщика'
        : `Скупщик ${buyer.name}`,
      buyerId: buyer.id,
      name: session.screen === 'admin' ? session.nameText : buyer.name,
      hologramText: session.hologramText,
      itemId,
      itemName: itemName(itemId),
      pricePerItem: configured ? buyer.pricePerItem : parseBuyerPrice(session.priceText),
      priceText: session.priceText,
      priceLabel: configured ? compactMk(buyer.pricePerItem) : undefined,
      quantity,
      maxQuantity,
      total,
      totalLabel: total > 0 ? formatMegacoins(total) : compactMk(0),
      configured,
      inventorySlots: slots,
      tradeSlot: trade,
      item: itemId ? createItemStack(itemId, Math.max(1, quantity || 1)) : undefined,
      message: session.message,
    };
  }

  restoreOverflow(playerId: string, inventory?: Inventory): void {
    const held = this.returns.get(playerId);
    if (!held || !inventory) return;
    const remaining: ItemStack[] = [];
    for (const stack of held) {
      const leftover = inventory.add(stack);
      if (leftover) remaining.push(leftover);
    }
    if (remaining.length > 0) this.returns.set(playerId, remaining);
    else {
      this.returns.delete(playerId);
      this.persist();
    }
  }

  private removeBuyer(buyer: BuyerRecord): void {
    this.buyers.delete(buyer.id);
    this.holograms.remove(buyer.hologramName);
    for (const [playerId, session] of [...this.sessions]) {
      if (session.buyerId !== buyer.id) continue;
      const leftover = this.returnTradeSlot(playerId, session);
      if (leftover) this.stashReturn(playerId, leftover);
      this.sessions.delete(playerId);
      this.affectedPlayers.add(playerId);
    }
    this.persist();
  }

  private stashReturn(playerId: string, stack: ItemStack): void {
    const existing = this.returns.get(playerId) ?? [];
    existing.push(stack);
    this.returns.set(playerId, existing);
    this.persist();
  }

  private syncHologram(buyer: BuyerRecord): void {
    const existing = this.holograms.get(buyer.hologramName);
    const lines = hologramLines(buyer.hologramText, buyer.name);
    if (!existing) {
      this.holograms.upsert(createHologramRecord({
        name: buyer.hologramName,
        worldId: buyer.worldId || this.worldId(),
        x: buyer.x,
        y: buyer.y + BUYER_HOLOGRAM_Y_OFFSET,
        z: buyer.z,
        lines,
        range: 48,
      }));
      return;
    }
    this.holograms.setPosition(
      buyer.hologramName,
      buyer.x,
      buyer.y + BUYER_HOLOGRAM_Y_OFFSET,
      buyer.z,
      buyer.worldId,
    );
    this.holograms.setLines(buyer.hologramName, lines);
  }

  private pickFromInventory(session: BuyerSession, inventory: Inventory, slot: number): BuyerResult {
    if (!Number.isInteger(slot) || slot < 0 || slot >= Inventory.SLOT_COUNT) {
      session.message = BUYER_ITEM_INVALID_ERROR;
      return { ok: false, error: BUYER_ITEM_INVALID_ERROR };
    }
    const stack = inventory.getSlot(slot);
    if (!stack || !isKnownItemId(stack.itemId)) {
      session.message = BUYER_ITEM_INVALID_ERROR;
      return { ok: false, error: BUYER_ITEM_INVALID_ERROR };
    }
    session.draftItemId = stack.itemId;
    session.screen = 'admin';
    return { ok: true };
  }

  private placeTradeItem(
    session: BuyerSession,
    buyer: BuyerRecord,
    inventory: Inventory,
    slot: number,
  ): BuyerResult {
    if (!isBuyerConfigured(buyer)) {
      session.message = BUYER_NOT_CONFIGURED_ERROR;
      return { ok: false, error: BUYER_NOT_CONFIGURED_ERROR };
    }
    if (!Number.isInteger(slot) || slot < 0 || slot >= Inventory.SLOT_COUNT) {
      session.message = BUYER_WRONG_ITEM_ERROR;
      return { ok: false, error: BUYER_WRONG_ITEM_ERROR };
    }
    const stack = inventory.getSlot(slot);
    if (!stack) return { ok: true };
    if (stack.itemId !== buyer.itemId) {
      session.message = BUYER_WRONG_ITEM_ERROR;
      return { ok: false, error: BUYER_WRONG_ITEM_ERROR };
    }
    const taken = cloneStack(stack)!;
    inventory.setSlot(slot, null);
    if (!session.tradeSlot) {
      session.tradeSlot = taken;
      return { ok: true, inventoryDirty: true };
    }
    if (!canStacksMerge(session.tradeSlot, taken)) {
      inventory.setSlot(slot, taken);
      session.message = BUYER_WRONG_ITEM_ERROR;
      return { ok: false, error: BUYER_WRONG_ITEM_ERROR };
    }
    const max = tryGetItemDefinition(taken.itemId)?.maxStack ?? 64;
    const space = max - session.tradeSlot.count;
    if (space <= 0) {
      inventory.setSlot(slot, taken);
      return { ok: true };
    }
    const moved = Math.min(space, taken.count);
    session.tradeSlot = { ...session.tradeSlot, count: session.tradeSlot.count + moved };
    const remain = taken.count - moved;
    inventory.setSlot(slot, remain > 0 ? { ...taken, count: remain } : null);
    return { ok: true, inventoryDirty: true };
  }

  private returnTradeToInventory(session: BuyerSession, inventory: Inventory): BuyerResult {
    if (!session.tradeSlot) return { ok: true };
    const leftover = inventory.add(session.tradeSlot);
    session.tradeSlot = leftover;
    if (leftover) session.message = 'Инвентарь полон.';
    return { ok: true, inventoryDirty: true };
  }

  private setTradeAmount(
    session: BuyerSession,
    buyer: BuyerRecord,
    inventory: Inventory,
    amount: number,
  ): BuyerResult {
    if (!isBuyerConfigured(buyer)) {
      session.message = BUYER_NOT_CONFIGURED_ERROR;
      return { ok: false, error: BUYER_NOT_CONFIGURED_ERROR };
    }
    const current = session.tradeSlot?.count ?? 0;
    const available = inventory.count(buyer.itemId) + current;
    const next = Math.max(0, Math.min(Math.trunc(amount), available));
    if (next === current) return { ok: true };
    if (next < current) {
      const extra = current - next;
      const leftover = inventory.add(createItemStack(buyer.itemId, extra));
      const returned = extra - (leftover?.count ?? 0);
      const remain = current - returned;
      session.tradeSlot = remain > 0 ? { ...session.tradeSlot!, count: remain } : null;
      return { ok: true, inventoryDirty: true };
    }
    const need = next - current;
    const removed = inventory.remove(buyer.itemId, need);
    if (removed <= 0) return { ok: true };
    if (!session.tradeSlot) session.tradeSlot = createItemStack(buyer.itemId, removed);
    else session.tradeSlot = { ...session.tradeSlot, count: session.tradeSlot.count + removed };
    return { ok: true, inventoryDirty: true };
  }

  private saveAdmin(session: BuyerSession, message: ClientBuyerActionMessage): BuyerResult {
    const name = message.name ?? session.nameText;
    const hologramText = message.hologramText ?? session.hologramText;
    const priceRaw = message.price ?? session.priceText;
    const itemId = session.draftItemId;
    if (!itemId || !isKnownItemId(itemId)) {
      session.message = BUYER_ITEM_INVALID_ERROR;
      return { ok: false, error: BUYER_ITEM_INVALID_ERROR };
    }
    const priceErr = buyerPriceError(priceRaw);
    if (priceErr) {
      session.message = priceErr;
      return { ok: false, error: priceErr };
    }
    const result = this.configure(session.buyerId, {
      name,
      itemId,
      pricePerItem: parseBuyerPrice(priceRaw),
      hologramText,
    });
    if (!result.ok) {
      session.message = result.error;
      return result;
    }
    session.nameText = result.buyer!.name;
    session.priceText = String(result.buyer!.pricePerItem);
    session.hologramText = result.buyer!.hologramText;
    session.draftItemId = result.buyer!.itemId;
    session.screen = 'admin';
    session.message = 'Настройки скупщика сохранены.';
    return { ok: true, buyer: result.buyer, broadcast: true };
  }

  private sell(playerId: string, inventory: Inventory, session: BuyerSession): BuyerResult {
    return this.withLocks([`player:${playerId}`, `buyer:${session.buyerId}`], () => {
      const buyer = this.buyers.get(session.buyerId);
      if (!buyer) return { ok: false, error: BUYER_STALE_ERROR };
      if (!isBuyerConfigured(buyer)) {
        session.message = BUYER_NOT_CONFIGURED_ERROR;
        return { ok: false, error: BUYER_NOT_CONFIGURED_ERROR };
      }
      const slot = session.tradeSlot;
      if (!slot || slot.count < 1) {
        session.message = 'Положите предмет в слот продажи.';
        return { ok: false, error: 'Положите предмет в слот продажи.' };
      }
      if (slot.itemId !== buyer.itemId) {
        session.message = BUYER_WRONG_ITEM_ERROR;
        return { ok: false, error: BUYER_WRONG_ITEM_ERROR };
      }
      const total = buyerPayout(slot.count, buyer.pricePerItem);
      if (total === undefined) {
        session.message = BUYER_PRICE_EMPTY_ERROR;
        return { ok: false, error: BUYER_PRICE_EMPTY_ERROR };
      }
      const held = cloneStack(slot)!;
      session.tradeSlot = null;
      const paid = this.economy.deposit(playerId, total, 'TRADER_SELL');
      if (!paid.ok) {
        session.tradeSlot = held;
        session.message = paid.error ?? 'Не удалось начислить Мегакоины.';
        return { ok: false, error: session.message };
      }
      const name = itemName(buyer.itemId) ?? buyer.itemId;
      const chat = `Вы продали ${held.count} × ${name} за ${formatMegacoins(total)}.`;
      session.message = undefined;
      return { ok: true, chat, inventoryDirty: true };
    });
  }

  private returnTradeSlot(playerId: string, session: BuyerSession, inventory?: Inventory): ItemStack | null {
    if (!session.tradeSlot) return null;
    const stack = session.tradeSlot;
    session.tradeSlot = null;
    if (!inventory) return stack;
    return inventory.add(stack);
  }

  private refreshSessions(buyer: BuyerRecord): void {
    for (const session of this.sessions.values()) {
      if (session.buyerId !== buyer.id) continue;
      if (session.screen === 'admin' || session.screen === 'pick-item') {
        session.draftItemId = buyer.itemId;
        session.nameText = buyer.name;
        session.priceText = buyer.pricePerItem !== undefined ? String(buyer.pricePerItem) : session.priceText;
        session.hologramText = buyer.hologramText;
      }
    }
  }

  private normalize(raw: unknown): BuyerRecord | undefined {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') return undefined;
    const named = validateBuyerName(raw.name);
    if (!named.ok) return undefined;
    const x = typeof raw.x === 'number' && Number.isFinite(raw.x) ? raw.x : 0;
    const y = typeof raw.y === 'number' && Number.isFinite(raw.y) ? raw.y : 0;
    const z = typeof raw.z === 'number' && Number.isFinite(raw.z) ? raw.z : 0;
    const yaw = typeof raw.yaw === 'number' && Number.isFinite(raw.yaw) ? raw.yaw : 0;
    const pitch = typeof raw.pitch === 'number' && Number.isFinite(raw.pitch) ? raw.pitch : 0;
    const itemId = typeof raw.itemId === 'string' && isKnownItemId(raw.itemId) ? raw.itemId : undefined;
    const price = parseBuyerPrice(raw.pricePerItem);
    const hologramName = typeof raw.hologramName === 'string' && raw.hologramName.length > 0
      ? raw.hologramName.toLowerCase()
      : buyerHologramName(raw.id);
    const hologramText = typeof raw.hologramText === 'string' && raw.hologramText.trim().length > 0
      ? raw.hologramText.trim().slice(0, BUYER_HOLOGRAM_TEXT_MAX)
      : named.name;
    return {
      id: raw.id,
      name: named.name,
      worldId: typeof raw.worldId === 'string' && raw.worldId.length > 0 ? raw.worldId : this.worldId(),
      x, y, z, yaw, pitch,
      itemId,
      pricePerItem: price,
      hologramName,
      hologramText,
      createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    };
  }

  private withLocks(keys: readonly string[], fn: () => BuyerResult): BuyerResult {
    const unique = [...new Set(keys.filter(Boolean))].sort();
    for (const key of unique) {
      if (this.locks.has(key)) return { ok: false, error: BUYER_BUSY_ERROR };
    }
    for (const key of unique) this.locks.add(key);
    try {
      return fn();
    } finally {
      for (const key of unique) this.locks.delete(key);
    }
  }
}
