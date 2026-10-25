import { randomBytes } from 'node:crypto';
import {
  BUYER_BUSY_ERROR,
  BUYER_HOLOGRAM_TEXT_MAX,
  BUYER_HOLOGRAM_Y_OFFSET,
  BUYER_ITEM_INVALID_ERROR,
  BUYER_MAX_PRICE,
  BUYER_MAX_STOCK,
  BUYER_MIN_PRICE,
  BUYER_NAME_TAKEN_ERROR,
  BUYER_NOT_A_SELLER_ERROR,
  BUYER_NOT_CONFIGURED_ERROR,
  BUYER_NOT_FOUND_ERROR,
  BUYER_PRICE_EMPTY_ERROR,
  BUYER_STALE_ERROR,
  BUYER_STORE_KEY,
  BUYER_WRONG_ITEM_ERROR,
  SELLER_BUSY_ERROR,
  SELLER_CHOOSE_AMOUNT_ERROR,
  SELLER_NOT_A_BUYER_ERROR,
  SELLER_NOT_CONFIGURED_ERROR,
  SELLER_OUT_OF_STOCK_ERROR,
  SELLER_SOLD_OUT_ERROR,
  SELLER_NO_ROOM_ERROR,
  SELLER_STOCK_EMPTY_ERROR,
  buyerHologramName,
  buyerPayout,
  buyerPriceError,
  buyerStockError,
  isBuyerHologramName,
  normalizeBuyerRole,
  parseBuyerPrice,
  parseBuyerStock,
  validateBuyerName,
  type BuyerRole,
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
  /** Missing files from before seller mode load as buyers. */
  role: BuyerRole;
  itemId?: string;
  pricePerItem?: number;
  /** Units the seller can still hand out. Buyers do not use this. */
  stock?: number;
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
  readonly openHologramEditor?: boolean;
}

interface BuyerSession {
  screen: BuyerScreen;
  buyerId: string;
  nameText: string;
  priceText: string;
  hologramText: string;
  draftItemId?: string;
  role: BuyerRole;
  stockText: string;
  /** Seller order. Buyer sales keep using `tradeSlot` instead. */
  orderQuantity: number;
  tradeSlot: ItemStack | null;
  message?: string;
}

/** Stock is already reserved. `paid` means the Megacoin withdraw is durable. */
interface SellerPurchase {
  id: string;
  playerId: string;
  buyerId: string;
  itemId: string;
  quantity: number;
  unitPrice: number;
  total: number;
  phase: 'reserved' | 'paid';
  createdAt: number;
}

interface BuyerStoreFile {
  buyers: BuyerRecord[];
  returns?: Record<string, ItemStack | ItemStack[]>;
  purchases?: SellerPurchase[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizePurchase(raw: unknown): SellerPurchase | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id.length === 0) return undefined;
  if (typeof raw.playerId !== 'string' || raw.playerId.length === 0) return undefined;
  if (typeof raw.buyerId !== 'string' || raw.buyerId.length === 0) return undefined;
  if (typeof raw.itemId !== 'string' || !isKnownItemId(raw.itemId)) return undefined;
  const quantity = raw.quantity;
  const unitPrice = parseBuyerPrice(raw.unitPrice);
  if (typeof quantity !== 'number' || unitPrice === undefined) return undefined;
  const total = buyerPayout(quantity, unitPrice);
  if (total === undefined || total !== raw.total) return undefined;
  if (raw.phase !== 'reserved' && raw.phase !== 'paid') return undefined;
  return {
    id: raw.id,
    playerId: raw.playerId,
    buyerId: raw.buyerId,
    itemId: raw.itemId,
    quantity,
    unitPrice,
    total,
    phase: raw.phase,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
  };
}

function itemName(itemId: string | undefined): string | undefined {
  if (!itemId) return undefined;
  return tryGetItemDefinition(itemId)?.name ?? itemId;
}

function compactMk(amount: number): string {
  return `${formatCompactMegacoins(amount)} МК`;
}

function hologramLines(text: string, fallback: string): string[] {
  const source = (text.trim() || fallback).slice(0, BUYER_HOLOGRAM_TEXT_MAX);
  const lines = source.split('\n').map((line) => line.slice(0, BUYER_HOLOGRAM_TEXT_MAX)).filter((line) => line.length > 0);
  return lines.length > 0 ? lines.slice(0, 8) : [fallback.slice(0, BUYER_HOLOGRAM_TEXT_MAX)];
}

export function isBuyerConfigured(buyer: BuyerRecord): buyer is BuyerRecord & { itemId: string; pricePerItem: number } {
  const priced = typeof buyer.itemId === 'string'
    && isKnownItemId(buyer.itemId)
    && Number.isInteger(buyer.pricePerItem)
    && buyer.pricePerItem! >= BUYER_MIN_PRICE
    && buyer.pricePerItem! <= BUYER_MAX_PRICE;
  if (!priced) return false;
  if (buyer.role === 'seller') return parseBuyerStock(buyer.stock) !== undefined;
  return true;
}

function inventoryRoomFor(inventory: Inventory, itemId: string): number {
  const maxStack = tryGetItemDefinition(itemId)?.maxStack ?? 1;
  if (maxStack < 1) return 0;
  const probe = createItemStack(itemId, 1);
  let room = 0;
  for (let index = 0; index < Inventory.SLOT_COUNT; index += 1) {
    const stack = inventory.getSlot(index);
    if (!stack) {
      room += maxStack;
      continue;
    }
    if (stack.itemId === itemId && canStacksMerge(stack, probe)) {
      room += Math.max(0, maxStack - stack.count);
    }
  }
  return room;
}

export class BuyerService {
  private buyers = new Map<string, BuyerRecord>();
  private sessions = new Map<string, BuyerSession>();
  private returns = new Map<string, ItemStack[]>();
  private readonly locks = new Set<string>();
  private affectedPlayers = new Set<string>();
  private purchases = new Map<string, SellerPurchase>();

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
    this.purchases.clear();
    if (Array.isArray(raw.purchases)) {
      for (const entry of raw.purchases) {
        const purchase = normalizePurchase(entry);
        if (purchase) this.purchases.set(purchase.id, purchase);
      }
    }
    this.recoverPurchases();
  }

  persist(): void {
    this.store.save(BUYER_STORE_KEY, {
      buyers: this.list(),
      returns: Object.fromEntries(this.returns.entries()),
      purchases: [...this.purchases.values()],
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
      role: buyer.role,
      ...(buyer.itemId ? { itemId: buyer.itemId } : {}),
      ...(buyer.role === 'seller' && buyer.stock !== undefined ? { stock: buyer.stock } : {}),
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
    role?: BuyerRole;
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
      role: input.role === 'seller' ? 'seller' : 'buyer',
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
    role?: BuyerRole;
    stock?: number | null;
  }): BuyerResult {
    const buyer = this.buyers.get(id);
    if (!buyer) return { ok: false, error: BUYER_NOT_FOUND_ERROR };
    const nextRole = patch.role !== undefined ? (patch.role === 'seller' ? 'seller' : 'buyer') : buyer.role;
    if (nextRole === 'seller' && patch.stock !== undefined && patch.stock !== null && parseBuyerStock(patch.stock) === undefined) {
      return { ok: false, error: buyerStockError(patch.stock) ?? SELLER_STOCK_EMPTY_ERROR };
    }
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
    buyer.role = nextRole;
    if (nextRole === 'buyer') buyer.stock = undefined;
    else if (patch.stock !== undefined) {
      buyer.stock = patch.stock === null ? undefined : parseBuyerStock(patch.stock);
    }
    if (patch.hologramText !== undefined) {
      const text = patch.hologramText.trim().slice(0, BUYER_HOLOGRAM_TEXT_MAX);
      buyer.hologramText = text.length > 0 ? text : buyer.name;
      this.holograms.setLines(buyer.hologramName, hologramLines(buyer.hologramText, buyer.name));
    }
    this.syncHologram(buyer);
    this.persist();
    this.refreshSessions(buyer);
    return { ok: true, buyer, broadcast: true };
  }

  openAdmin(playerId: string, buyerId: string, inventory?: Inventory): BuyerResult {
    const buyer = this.buyers.get(buyerId);
    if (!buyer) return { ok: false, error: BUYER_NOT_FOUND_ERROR };
    this.releaseSession(playerId, inventory);
    this.restoreOverflow(playerId, inventory);
    this.sessions.set(playerId, this.sessionFrom(buyer, 'admin'));
    return { ok: true, buyer };
  }

  openTrade(playerId: string, buyerId: string, inventory: Inventory): BuyerResult {
    const buyer = this.buyers.get(buyerId);
    if (!buyer) return { ok: false, error: BUYER_NOT_FOUND_ERROR };
    this.releaseSession(playerId, inventory);
    this.restoreOverflow(playerId, inventory);
    const session = this.sessionFrom(buyer, 'trade');
    this.sessions.set(playerId, session);
    if (buyer.role === 'seller' && isBuyerConfigured(buyer)) {
      session.orderQuantity = this.sellerLimit(playerId, buyer, inventory).max >= 1 ? 1 : 0;
    }
    return { ok: true, buyer };
  }

  session(playerId: string): BuyerSession | undefined {
    return this.sessions.get(playerId);
  }

  closeSession(playerId: string, inventory?: Inventory): BuyerResult {
    if (!this.sessions.has(playerId)) return { ok: true };
    this.releaseSession(playerId, inventory);
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
      if (!can.edit) return { ok: false, error: 'Недостаточно прав для выполнения этой команды.' };
      session.nameText = typeof message.name === 'string' ? message.name.slice(0, 32) : '';
      return { ok: true };
    }
    if (message.action === 'set_price') {
      if (!can.edit) return { ok: false, error: 'Недостаточно прав для выполнения этой команды.' };
      session.priceText = typeof message.price === 'string' || typeof message.price === 'number'
        ? String(message.price)
        : '';
      return { ok: true };
    }
    if (message.action === 'set_role') {
      if (!can.edit) return { ok: false, error: 'Недостаточно прав для выполнения этой команды.' };
      if (session.screen !== 'admin') return { ok: true };
      if (message.role === 'buyer' || message.role === 'seller') session.role = message.role;
      return { ok: true };
    }
    if (message.action === 'set_stock') {
      if (!can.edit) return { ok: false, error: 'Недостаточно прав для выполнения этой команды.' };
      session.stockText = typeof message.stock === 'string' || typeof message.stock === 'number'
        ? String(message.stock).replace(/[^\d]/g, '').slice(0, 7)
        : '';
      return { ok: true };
    }
    if (message.action === 'set_hologram_text') {
      if (!can.edit) return { ok: false, error: 'Недостаточно прав для выполнения этой команды.' };
      return { ok: true };
    }
    if (message.action === 'edit_hologram') {
      if (!can.edit) return { ok: false, error: 'Недостаточно прав для выполнения этой команды.' };
      if (session.screen !== 'admin') return { ok: true };
      this.syncHologram(buyer);
      if (!this.holograms.get(buyer.hologramName)) {
        return { ok: false, error: 'Голограмма скупщика не найдена.' };
      }
      return { ok: true, buyer, openHologramEditor: true };
    }
    if (message.action === 'pick_item') {
      if (!can.edit) return { ok: false, error: 'Недостаточно прав для выполнения этой команды.' };
      session.screen = 'pick-item';
      return { ok: true };
    }
    if (message.action === 'back') {
      if (session.screen === 'pick-item') session.screen = 'admin';
      return { ok: true };
    }
    if (message.action === 'open_trade') {
      if (!can.use) return { ok: false, error: 'Недостаточно прав для выполнения этой команды.' };
      this.returnTradeSlot(playerId, session, inventory);
      session.screen = 'trade';
      session.tradeSlot = null;
      session.orderQuantity = 0;
      if (buyer.role === 'seller' && isBuyerConfigured(buyer)) {
        session.orderQuantity = this.sellerLimit(playerId, buyer, inventory).max >= 1 ? 1 : 0;
      }
      return { ok: true, inventoryDirty: true };
    }
    if (message.action === 'select_slot' && message.slot !== undefined) {
      if (session.screen === 'pick-item') {
        if (!can.edit) return { ok: false, error: 'Недостаточно прав для выполнения этой команды.' };
        return this.pickFromInventory(session, inventory, message.slot);
      }
      if (session.screen === 'trade') {
        if (!can.use) return { ok: false, error: 'Недостаточно прав для выполнения этой команды.' };
        if (buyer.role === 'seller') return { ok: true };
        if (message.slot === -1) return this.returnTradeToInventory(session, inventory);
        return this.placeTradeItem(session, buyer, inventory, message.slot);
      }
      return { ok: true };
    }
    if (message.action === 'set_amount') {
      if (session.screen !== 'trade' || !can.use) return { ok: false, error: 'Недостаточно прав для выполнения этой команды.' };
      if (buyer.role === 'seller') return this.setSellerAmount(playerId, session, buyer, inventory, message.amount ?? 0);
      return this.setTradeAmount(session, buyer, inventory, message.amount ?? 0);
    }
    if (message.action === 'save') {
      if (!can.edit) return { ok: false, error: 'Недостаточно прав для выполнения этой команды.' };
      return this.saveAdmin(session, message);
    }
    if (message.action === 'delete') {
      if (!can.delete) return { ok: false, error: 'Недостаточно прав для выполнения этой команды.' };
      return this.deleteById(session.buyerId);
    }
    if (message.action === 'sell') {
      if (!can.use) return { ok: false, error: 'Недостаточно прав для выполнения этой команды.' };
      return this.sell(playerId, inventory, session);
    }
    if (message.action === 'buy') {
      if (!can.use) return { ok: false, error: 'Недостаточно прав для выполнения этой команды.' };
      return this.buy(playerId, inventory, session);
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
      const leftover = session.tradeSlot;
      session.tradeSlot = null;
      this.sessions.delete(playerId);
      if (leftover) this.stashReturn(playerId, leftover);
      return this.buildMessage(playerId, inventory);
    }
    const drafting = session.screen === 'admin' || session.screen === 'pick-item';
    const role: BuyerRole = drafting ? session.role : buyer.role;
    const itemId = drafting ? session.draftItemId : buyer.itemId;
    const configured = isBuyerConfigured(buyer);
    let quantity = session.tradeSlot?.count ?? 0;
    let maxQuantity = configured && buyer.role === 'buyer'
      ? inventory.count(buyer.itemId) + quantity
      : 0;
    let trade: ItemStack | null = session.tradeSlot;
    if (session.screen === 'trade' && buyer.role === 'seller') {
      if (configured) {
        const limit = this.sellerLimit(playerId, buyer, inventory);
        if (session.orderQuantity > limit.max) session.orderQuantity = limit.max;
        quantity = session.orderQuantity;
        maxQuantity = limit.max;
        trade = quantity > 0 ? createItemStack(buyer.itemId, quantity) : null;
      } else {
        quantity = 0;
        maxQuantity = 0;
        trade = null;
      }
    }
    const price = configured ? buyer.pricePerItem : parseBuyerPrice(session.priceText);
    const total = quantity > 0 && price !== undefined ? buyerPayout(quantity, price) ?? 0 : 0;
    const slots = inventory.slots;
    const setupTitle = role === 'seller' ? 'Настройка продавца' : 'Настройка скупщика';
    const tradeTitle = buyer.role === 'seller' ? `Продавец ${buyer.name}` : `Скупщик ${buyer.name}`;
    return {
      type: 'buyer',
      screen: session.screen,
      title: drafting ? setupTitle : tradeTitle,
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
      role,
      ...(buyer.role === 'seller' && buyer.stock !== undefined ? { stock: buyer.stock } : {}),
      stockText: session.stockText,
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
    else this.returns.delete(playerId);
    this.persist();
  }

  private removeBuyer(buyer: BuyerRecord): void {
    this.buyers.delete(buyer.id);
    for (const [id, purchase] of [...this.purchases]) {
      if (purchase.buyerId !== buyer.id) continue;
      if (this.purchaseWasPaid(purchase)) {
        this.rememberReturn(purchase.playerId, createItemStack(purchase.itemId, purchase.quantity));
      }
      this.purchases.delete(id);
    }
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

  captureHologramText(buyerId: string): void {
    const buyer = this.buyers.get(buyerId);
    if (!buyer) return;
    const hologram = this.holograms.get(buyer.hologramName);
    if (!hologram) return;
    const text = hologram.lines.map((line) => line.trim()).filter((line) => line.length > 0).join('\n').trim();
    buyer.hologramText = (text || buyer.name).slice(0, BUYER_HOLOGRAM_TEXT_MAX);
    this.persist();
    this.refreshSessions(buyer);
  }

  private syncHologram(buyer: BuyerRecord): void {
    const existing = this.holograms.get(buyer.hologramName);
    if (!existing) {
      this.holograms.upsert(createHologramRecord({
        name: buyer.hologramName,
        worldId: buyer.worldId || this.worldId(),
        x: buyer.x,
        y: buyer.y + BUYER_HOLOGRAM_Y_OFFSET,
        z: buyer.z,
        lines: hologramLines(buyer.hologramText, buyer.name),
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
    const priceRaw = message.price ?? session.priceText;
    const role: BuyerRole = message.role === 'seller' || message.role === 'buyer' ? message.role : session.role;
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
    const stockRaw = message.stock ?? session.stockText;
    if (role === 'seller') {
      const stockErr = buyerStockError(stockRaw);
      if (stockErr) {
        session.message = stockErr;
        return { ok: false, error: stockErr };
      }
    }
    const result = this.configure(session.buyerId, {
      name,
      itemId,
      pricePerItem: parseBuyerPrice(priceRaw),
      role,
      stock: role === 'seller' ? parseBuyerStock(stockRaw) : null,
    });
    if (!result.ok) {
      session.message = result.error;
      return result;
    }
    session.nameText = result.buyer!.name;
    session.priceText = String(result.buyer!.pricePerItem);
    session.hologramText = result.buyer!.hologramText;
    session.draftItemId = result.buyer!.itemId;
    session.role = result.buyer!.role;
    session.stockText = result.buyer!.stock !== undefined ? String(result.buyer!.stock) : '';
    session.screen = 'admin';
    session.message = result.buyer!.role === 'seller'
      ? 'Настройки продавца сохранены.'
      : 'Настройки скупщика сохранены.';
    return { ok: true, buyer: result.buyer, broadcast: true };
  }

  private sell(playerId: string, inventory: Inventory, session: BuyerSession): BuyerResult {
    return this.withLocks([`player:${playerId}`, `buyer:${session.buyerId}`], () => {
      const buyer = this.buyers.get(session.buyerId);
      if (!buyer) return { ok: false, error: BUYER_STALE_ERROR };
      if (buyer.role === 'seller') {
        session.message = SELLER_NOT_A_BUYER_ERROR;
        return { ok: false, error: SELLER_NOT_A_BUYER_ERROR };
      }
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

  private buy(playerId: string, inventory: Inventory, session: BuyerSession): BuyerResult {
    return this.withLocks([`player:${playerId}`, `buyer:${session.buyerId}`], () => {
      const buyer = this.buyers.get(session.buyerId);
      if (!buyer) return { ok: false, error: BUYER_STALE_ERROR };
      if (buyer.role !== 'seller') {
        session.message = BUYER_NOT_A_SELLER_ERROR;
        return { ok: false, error: BUYER_NOT_A_SELLER_ERROR };
      }
      if (!isBuyerConfigured(buyer) || buyer.stock === undefined) {
        session.message = SELLER_NOT_CONFIGURED_ERROR;
        return { ok: false, error: SELLER_NOT_CONFIGURED_ERROR };
      }
      const quantity = session.orderQuantity;
      if (!Number.isInteger(quantity) || quantity < 1) {
        const empty = buyer.stock < 1 ? SELLER_SOLD_OUT_ERROR : SELLER_CHOOSE_AMOUNT_ERROR;
        session.message = empty;
        return { ok: false, error: empty };
      }
      if (quantity > buyer.stock) {
        const error = buyer.stock < 1 ? SELLER_SOLD_OUT_ERROR : SELLER_OUT_OF_STOCK_ERROR;
        session.message = error;
        return { ok: false, error };
      }
      const total = buyerPayout(quantity, buyer.pricePerItem);
      if (total === undefined) {
        session.message = BUYER_PRICE_EMPTY_ERROR;
        return { ok: false, error: BUYER_PRICE_EMPTY_ERROR };
      }
      if (!this.economy.hasBalance(playerId, total)) {
        session.message = 'Недостаточно Мегакоинов.';
        return { ok: false, error: session.message };
      }
      const room = inventoryRoomFor(inventory, buyer.itemId);
      if (quantity > room) {
        session.message = SELLER_NO_ROOM_ERROR;
        return { ok: false, error: SELLER_NO_ROOM_ERROR };
      }
      const purchase: SellerPurchase = {
        id: `sp-${randomBytes(8).toString('hex')}`,
        playerId,
        buyerId: buyer.id,
        itemId: buyer.itemId,
        quantity,
        unitPrice: buyer.pricePerItem,
        total,
        phase: 'reserved',
        createdAt: this.now(),
      };
      buyer.stock -= quantity;
      this.purchases.set(purchase.id, purchase);
      this.persist();
      const paid = this.economy.withdraw(playerId, total, 'TRADER_PURCHASE', buyer.id, purchase.id);
      if (!paid.ok) {
        buyer.stock += quantity;
        this.purchases.delete(purchase.id);
        this.persist();
        session.message = paid.error ?? 'Недостаточно Мегакоинов.';
        return { ok: false, error: session.message };
      }
      purchase.phase = 'paid';
      this.persist();
      this.rememberReturn(playerId, createItemStack(buyer.itemId, quantity));
      this.purchases.delete(purchase.id);
      this.persist();
      this.restoreOverflow(playerId, inventory);
      session.orderQuantity = 0;
      session.message = undefined;
      this.noteWatchers(buyer.id);
      const name = itemName(buyer.itemId) ?? buyer.itemId;
      const chat = `Вы купили ${quantity} × ${name} за ${formatMegacoins(total)}.`;
      return { ok: true, chat, inventoryDirty: true, broadcast: true };
    }, SELLER_BUSY_ERROR);
  }

  private sellerLimit(
    playerId: string,
    buyer: BuyerRecord & { itemId: string; pricePerItem: number },
    inventory: Inventory,
  ): { stock: number; affordable: number; room: number; max: number } {
    const stock = buyer.stock ?? 0;
    const affordable = buyer.pricePerItem > 0
      ? Math.floor(this.economy.getBalance(playerId) / buyer.pricePerItem)
      : 0;
    const room = inventoryRoomFor(inventory, buyer.itemId);
    return { stock, affordable, room, max: Math.max(0, Math.min(stock, affordable, room)) };
  }

  private setSellerAmount(
    playerId: string,
    session: BuyerSession,
    buyer: BuyerRecord,
    inventory: Inventory,
    amount: number,
  ): BuyerResult {
    if (buyer.role !== 'seller' || !isBuyerConfigured(buyer)) {
      session.message = SELLER_NOT_CONFIGURED_ERROR;
      return { ok: false, error: SELLER_NOT_CONFIGURED_ERROR };
    }
    const max = this.sellerLimit(playerId, buyer, inventory).max;
    session.orderQuantity = Math.max(0, Math.min(Math.trunc(amount) || 0, max));
    return { ok: true };
  }

  private releaseSession(playerId: string, inventory?: Inventory): void {
    const session = this.sessions.get(playerId);
    if (!session) return;
    const leftover = this.returnTradeSlot(playerId, session, inventory);
    this.sessions.delete(playerId);
    if (leftover) this.stashReturn(playerId, leftover);
  }

  private sessionFrom(buyer: BuyerRecord, screen: BuyerScreen): BuyerSession {
    return {
      screen,
      buyerId: buyer.id,
      nameText: buyer.name,
      priceText: buyer.pricePerItem !== undefined ? String(buyer.pricePerItem) : '',
      hologramText: buyer.hologramText,
      draftItemId: buyer.itemId,
      role: buyer.role,
      stockText: buyer.stock !== undefined ? String(buyer.stock) : '',
      orderQuantity: 0,
      tradeSlot: null,
    };
  }

  private noteWatchers(buyerId: string): void {
    for (const [playerId, session] of this.sessions) {
      if (session.buyerId === buyerId) this.affectedPlayers.add(playerId);
    }
  }

  private rememberReturn(playerId: string, stack: ItemStack): void {
    const existing = this.returns.get(playerId) ?? [];
    existing.push(stack);
    this.returns.set(playerId, existing);
  }

  /**
   * Reserved stock without a matching withdraw is returned.
   * A withdraw (or an explicit paid phase) becomes owed items in `returns`,
   * in the same buyers.json write that drops the journal row.
   */
  private recoverPurchases(): void {
    if (this.purchases.size === 0) return;
    let changed = false;
    for (const purchase of [...this.purchases.values()]) {
      if (this.purchaseWasPaid(purchase)) {
        this.rememberReturn(purchase.playerId, createItemStack(purchase.itemId, purchase.quantity));
      } else {
        const buyer = this.buyers.get(purchase.buyerId);
        if (buyer?.role === 'seller' && buyer.stock !== undefined) {
          const restored = buyer.stock + purchase.quantity;
          buyer.stock = restored > BUYER_MAX_STOCK ? BUYER_MAX_STOCK : restored;
        }
      }
      this.purchases.delete(purchase.id);
      changed = true;
    }
    if (changed) this.persist();
  }

  private purchaseWasPaid(purchase: SellerPurchase): boolean {
    if (purchase.phase === 'paid') return true;
    const tx = this.economy.findTransactionByPairId(purchase.id);
    return !!tx
      && tx.type === 'withdraw'
      && tx.playerId === purchase.playerId
      && tx.amount === purchase.total
      && tx.reason === 'TRADER_PURCHASE';
  }

  private returnTradeSlot(playerId: string, session: BuyerSession, inventory?: Inventory): ItemStack | null {
    if (!session.tradeSlot) return null;
    const stack = session.tradeSlot;
    session.tradeSlot = null;
    if (!inventory) return stack;
    return inventory.add(stack);
  }

  private refreshSessions(buyer: BuyerRecord): void {
    for (const [playerId, session] of this.sessions) {
      if (session.buyerId !== buyer.id) continue;
      if (buyer.role === 'seller' && session.tradeSlot) {
        const stack = session.tradeSlot;
        session.tradeSlot = null;
        this.stashReturn(playerId, stack);
      }
      if (session.screen === 'admin' || session.screen === 'pick-item') {
        session.draftItemId = buyer.itemId;
        session.nameText = buyer.name;
        session.priceText = buyer.pricePerItem !== undefined ? String(buyer.pricePerItem) : session.priceText;
        session.hologramText = buyer.hologramText;
        session.role = buyer.role;
        session.stockText = buyer.stock !== undefined ? String(buyer.stock) : '';
      }
      this.affectedPlayers.add(playerId);
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
    const role = normalizeBuyerRole(raw.role);
    const stock = role === 'seller' ? parseBuyerStock(raw.stock) : undefined;
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
      role,
      ...(stock !== undefined ? { stock } : {}),
      hologramName,
      hologramText,
      createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    };
  }

  private withLocks(keys: readonly string[], fn: () => BuyerResult, busyError = BUYER_BUSY_ERROR): BuyerResult {
    const unique = [...new Set(keys.filter(Boolean))].sort();
    for (const key of unique) {
      if (this.locks.has(key)) return { ok: false, error: busyError };
    }
    for (const key of unique) this.locks.add(key);
    try {
      return fn();
    } finally {
      for (const key of unique) this.locks.delete(key);
    }
  }
}
