import { displayNameFor } from '../../src/i18n/displayNames';
import {
  Inventory,
  canStacksMerge,
  cloneStack,
  parseSerializedItemStack,
  splitItemStack,
  type ItemStack,
} from '../../src/inventory';
import { getItemDefinition } from '../../src/items';
import type { NetworkAuctionListing, ServerAuctionMessage } from '../../shared/protocol';
import { formatMegacoins } from './economy';
import type { EconomyService } from './economy';
import type { JsonFileStore } from './jsonStore';

export const AUCTION_PLUGIN_NAME = 'auction';
export const AUCTION_DURATION_MS = 2 * 24 * 60 * 60 * 1000;
export const AUCTION_MAX_ACTIVE = 30;
export const AUCTION_MIN_PRICE = 10;
export const AUCTION_MAX_PRICE = 100_000_000;
export const AUCTION_PAGE_SIZE = 27;

export type AuctionView = 'browse' | 'sell' | 'list';

export type AuctionListingStatus =
  | 'ACTIVE'
  | 'SOLD'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'RELISTED'
  | 'CLAIMED';

export type AuctionScreen =
  | 'browse'
  | 'buy'
  | 'sell-pick'
  | 'sell-confirm'
  | 'mine'
  | 'manage'
  | 'claim'
  | 'relist'
  | 'closed';

export interface AuctionListing {
  listingId: string;
  sellerPlayerId: string;
  sellerName: string;
  item: ItemStack;
  price: number;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
  status: AuctionListingStatus;
  soldToPlayerId?: string;
  salePairId?: string;
}

export interface AuctionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly listing?: AuctionListing;
  readonly previous?: AuctionListing;
}

export interface AuctionQuery {
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
  readonly excludeSellerId?: string;
}

export interface AuctionPage {
  readonly listings: AuctionListing[];
  readonly totalCount: number;
  readonly page: number;
  readonly totalPages: number;
}

export interface AuctionSession {
  screen: AuctionScreen;
  search: string;
  page: number;
  listingId?: string;
  slot?: number;
  expectedItem?: ItemStack;
  amount?: number;
  priceText: string;
  message?: string;
}

interface AuctionFile {
  nextId: number;
  listings: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function inventoryCanAccept(inventory: Inventory, stack: ItemStack): boolean {
  const copy = inventory.clone();
  return copy.add(cloneStack(stack)!) === null;
}

export const AUCTION_PRICE_EMPTY_ERROR = 'Укажите цену этого предмета';
export const AUCTION_PRICE_RANGE_ERROR =
  'Доступная цена для выставления на продажу - от 10 до 100 000 000 Мегакоинов';

export function parseAuctionPrice(raw: string | number | undefined): number | undefined {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < AUCTION_MIN_PRICE || raw > AUCTION_MAX_PRICE) return undefined;
    return raw;
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < AUCTION_MIN_PRICE || value > AUCTION_MAX_PRICE) return undefined;
  return value;
}

export function isAuctionPriceEmpty(raw: string | number | undefined): boolean {
  if (raw === undefined) return true;
  if (typeof raw === 'string') return raw.trim() === '';
  return false;
}

/** Authoritative user-facing price rejection. Empty is distinct from out-of-range. */
export function auctionPriceError(raw: string | number | undefined): string | undefined {
  if (isAuctionPriceEmpty(raw)) return AUCTION_PRICE_EMPTY_ERROR;
  if (parseAuctionPrice(raw) !== undefined) return undefined;
  return AUCTION_PRICE_RANGE_ERROR;
}

export function itemSearchText(stack: ItemStack): string {
  const definition = getItemDefinition(stack.itemId);
  return [
    definition.name,
    stack.itemId,
    displayNameFor(stack.itemId, 'ru'),
    displayNameFor(stack.itemId, 'en'),
  ].join('\n').toLowerCase();
}

export function listingMatchesSearch(listing: AuctionListing, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return itemSearchText(listing.item).includes(needle);
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Срок истёк';
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return hours > 0 ? `${days} д ${hours} ч` : `${days} д`;
  if (hours > 0) return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`;
  if (minutes > 0) return `${minutes} мин`;
  return `${Math.max(1, seconds)} с`;
}

export function isReturnableStatus(status: AuctionListingStatus): boolean {
  return status === 'CANCELLED' || status === 'EXPIRED';
}

export function listingTooltip(listing: AuctionListing, now: number): string {
  const name = getItemDefinition(listing.item.itemId).name;
  const remaining = listing.expiresAt - now;
  const lines = [
    name,
    `Количество: ${listing.item.count}`,
    `Цена: ${formatMegacoins(listing.price)}`,
    `Продавец: ${listing.sellerName}`,
  ];
  if (listing.status === 'ACTIVE') lines.push(`Осталось: ${formatRemaining(remaining)}`);
  else if (listing.status === 'EXPIRED') {
    lines.push('Срок истёк', 'Можно забрать');
  } else if (listing.status === 'CANCELLED') {
    lines.push('Товар снят с продажи', 'Можно забрать');
  } else {
    lines.push(`Статус: ${listing.status}`);
  }
  return lines.join('\n');
}

function parseListing(value: unknown): AuctionListing | undefined {
  if (!isRecord(value) || typeof value.listingId !== 'string') return undefined;
  if (typeof value.sellerPlayerId !== 'string' || typeof value.sellerName !== 'string') return undefined;
  let item: ItemStack;
  try {
    const parsed = parseSerializedItemStack(value.item);
    if (!parsed) return undefined;
    item = parsed;
  } catch {
    return undefined;
  }
  const price = Number(value.price);
  const createdAt = Number(value.createdAt);
  const expiresAt = Number(value.expiresAt);
  const updatedAt = Number(value.updatedAt ?? createdAt);
  const status = value.status;
  if (!Number.isInteger(price) || !Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) return undefined;
  if (
    status !== 'ACTIVE' && status !== 'SOLD' && status !== 'CANCELLED'
    && status !== 'EXPIRED' && status !== 'RELISTED' && status !== 'CLAIMED'
  ) return undefined;
  return {
    listingId: value.listingId,
    sellerPlayerId: value.sellerPlayerId,
    sellerName: value.sellerName,
    item,
    price,
    createdAt,
    expiresAt,
    updatedAt,
    status,
    ...(typeof value.soldToPlayerId === 'string' ? { soldToPlayerId: value.soldToPlayerId } : {}),
    ...(typeof value.salePairId === 'string' ? { salePairId: value.salePairId } : {}),
  };
}

export class AuctionService {
  private listings = new Map<string, AuctionListing>();
  private nextId = 1;
  private readonly sessions = new Map<string, AuctionSession>();
  private readonly listingLocks = new Set<string>();
  private readonly playerLocks = new Set<string>();

  constructor(
    private readonly store: JsonFileStore,
    private readonly economy: EconomyService,
    private readonly now: () => number = Date.now,
  ) {
    this.load();
  }

  load(): void {
    const file = this.store.load<AuctionFile>('auction/listings', { nextId: 1, listings: [] });
    this.nextId = Number.isInteger(file.nextId) && file.nextId > 0 ? file.nextId : 1;
    this.listings.clear();
    for (const entry of Array.isArray(file.listings) ? file.listings : []) {
      const listing = parseListing(entry);
      if (listing) this.listings.set(listing.listingId, listing);
    }
    this.expireDue();
  }

  persist(): void {
    this.store.save('auction/listings', {
      nextId: this.nextId,
      listings: [...this.listings.values()],
    });
  }

  expireDue(now = this.now()): number {
    let changed = 0;
    for (const listing of this.listings.values()) {
      if (listing.status !== 'ACTIVE') continue;
      if (listing.expiresAt > now) continue;
      listing.status = 'EXPIRED';
      listing.updatedAt = now;
      changed += 1;
    }
    if (changed) this.persist();
    return changed;
  }

  session(playerId: string): AuctionSession {
    const existing = this.sessions.get(playerId);
    if (existing) return existing;
    const created: AuctionSession = { screen: 'closed', search: '', page: 1, priceText: '' };
    this.sessions.set(playerId, created);
    return created;
  }

  closeSession(playerId: string): void {
    const session = this.sessions.get(playerId);
    if (session) {
      session.screen = 'closed';
      session.message = undefined;
      session.listingId = undefined;
      session.slot = undefined;
      session.expectedItem = undefined;
    }
  }

  openBrowse(playerId: string, search = ''): AuctionSession {
    const session = this.session(playerId);
    session.screen = 'browse';
    session.search = search;
    session.page = 1;
    session.listingId = undefined;
    session.message = undefined;
    session.priceText = '';
    return session;
  }

  openSell(playerId: string): AuctionSession {
    const session = this.session(playerId);
    session.screen = 'sell-pick';
    session.slot = undefined;
    session.expectedItem = undefined;
    session.amount = undefined;
    session.priceText = '';
    session.message = undefined;
    session.listingId = undefined;
    return session;
  }

  openMine(playerId: string): AuctionSession {
    const session = this.session(playerId);
    session.screen = 'mine';
    session.page = 1;
    session.listingId = undefined;
    session.message = undefined;
    return session;
  }

  setSearch(playerId: string, search: string): AuctionSession {
    const session = this.session(playerId);
    session.search = search;
    session.page = 1;
    if (session.screen !== 'browse') session.screen = 'browse';
    session.listingId = undefined;
    session.message = undefined;
    return session;
  }

  setPage(playerId: string, page: number): AuctionSession {
    const session = this.session(playerId);
    session.page = Math.max(1, Math.floor(page));
    session.message = undefined;
    return session;
  }

  getListing(listingId: string): AuctionListing | undefined {
    this.expireDue();
    return this.listings.get(listingId);
  }

  activeCount(playerId: string): number {
    this.expireDue();
    let count = 0;
    for (const listing of this.listings.values()) {
      if (listing.sellerPlayerId === playerId && listing.status === 'ACTIVE') count += 1;
    }
    return count;
  }

  queryBrowse(query: AuctionQuery = {}): AuctionPage {
    this.expireDue();
    const pageSize = Math.max(1, Math.min(query.pageSize ?? AUCTION_PAGE_SIZE, AUCTION_PAGE_SIZE));
    const search = query.search ?? '';
    const matched = [...this.listings.values()]
      .filter((listing) => listing.status === 'ACTIVE')
      .filter((listing) => listing.expiresAt > this.now())
      .filter((listing) => !query.excludeSellerId || listing.sellerPlayerId !== query.excludeSellerId)
      .filter((listing) => listingMatchesSearch(listing, search))
      .sort((a, b) => b.createdAt - a.createdAt || a.listingId.localeCompare(b.listingId));
    return paginate(matched, query.page ?? 1, pageSize);
  }

  queryMine(playerId: string, page = 1): AuctionPage {
    this.expireDue();
    const matched = [...this.listings.values()]
      .filter((listing) => listing.sellerPlayerId === playerId)
      .filter((listing) => listing.status === 'ACTIVE' || isReturnableStatus(listing.status))
      .sort((a, b) => {
        const aActive = a.status === 'ACTIVE' ? 0 : 1;
        const bActive = b.status === 'ACTIVE' ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return b.updatedAt - a.updatedAt || a.listingId.localeCompare(b.listingId);
      });
    return paginate(matched, page, AUCTION_PAGE_SIZE);
  }

  createListing(
    playerId: string,
    sellerName: string,
    inventory: Inventory,
    slot: number,
    amount: number,
    price: number,
    expected?: ItemStack,
  ): AuctionResult {
    return this.withPlayerLock(playerId, () => {
      this.expireDue();
      const priceError = auctionPriceError(price);
      if (priceError) return { ok: false, error: priceError };
      const parsedPrice = parseAuctionPrice(price)!;
      if (!Number.isInteger(slot) || slot < 0 || slot >= Inventory.SLOT_COUNT) {
        return { ok: false, error: 'Предмет больше недоступен для продажи.' };
      }
      if (this.activeCount(playerId) >= AUCTION_MAX_ACTIVE) {
        return { ok: false, error: `У вас уже максимальное количество товаров на аукционе: ${AUCTION_MAX_ACTIVE}.` };
      }
      const current = inventory.getSlot(slot);
      if (!current) return { ok: false, error: 'Предмет больше недоступен для продажи.' };
      if (expected && !canStacksMerge(current, expected)) {
        return { ok: false, error: 'Предмет больше недоступен для продажи.' };
      }
      if (!Number.isInteger(amount) || amount < 1 || amount > current.count) {
        return { ok: false, error: 'Предмет больше недоступен для продажи.' };
      }
      const { taken, remainder } = splitItemStack(current, amount);
      inventory.setSlot(slot, remainder);
      const now = this.now();
      const listing: AuctionListing = {
        listingId: `ah-${this.nextId++}`,
        sellerPlayerId: playerId,
        sellerName,
        item: taken,
        price: parsedPrice,
        createdAt: now,
        expiresAt: now + AUCTION_DURATION_MS,
        updatedAt: now,
        status: 'ACTIVE',
      };
      this.listings.set(listing.listingId, listing);
      this.persist();
      return { ok: true, listing };
    });
  }

  buyListing(buyerId: string, buyerName: string, inventory: Inventory, listingId: string): AuctionResult {
    return this.withLocks(buyerId, listingId, () => {
      this.expireDue();
      const listing = this.listings.get(listingId);
      if (!listing) return { ok: false, error: 'Этот товар уже продан.' };
      if (listing.status === 'EXPIRED') return { ok: false, error: 'Срок продажи этого товара истёк.' };
      if (listing.status === 'CANCELLED' || listing.status === 'CLAIMED' || listing.status === 'RELISTED') {
        return { ok: false, error: 'Этот товар уже продан.' };
      }
      if (listing.status !== 'ACTIVE') return { ok: false, error: 'Этот товар уже продан.' };
      if (listing.expiresAt <= this.now()) {
        listing.status = 'EXPIRED';
        listing.updatedAt = this.now();
        this.persist();
        return { ok: false, error: 'Срок продажи этого товара истёк.' };
      }
      if (listing.sellerPlayerId === buyerId) {
        return { ok: false, error: 'Нельзя купить собственный товар.' };
      }
      if (!this.economy.hasBalance(buyerId, listing.price)) {
        return { ok: false, error: 'Недостаточно Мегакоинов.' };
      }
      if (!inventoryCanAccept(inventory, listing.item)) {
        return { ok: false, error: 'Недостаточно места в инвентаре.' };
      }
      const moved = this.economy.settle(
        buyerId,
        listing.sellerPlayerId,
        listing.price,
        'AUCTION_PURCHASE',
        'AUCTION_SALE',
        listing.listingId,
      );
      if (!moved.ok) {
        return { ok: false, error: moved.error ?? 'Недостаточно Мегакоинов.' };
      }
      const leftover = inventory.add(cloneStack(listing.item)!);
      if (leftover) {
        this.economy.settle(
          listing.sellerPlayerId,
          buyerId,
          listing.price,
          'AUCTION_SALE',
          'AUCTION_PURCHASE',
          `${listing.listingId}-rollback`,
        );
        return { ok: false, error: 'Недостаточно места в инвентаре.' };
      }
      listing.status = 'SOLD';
      listing.updatedAt = this.now();
      listing.soldToPlayerId = buyerId;
      listing.salePairId = listing.listingId;
      this.economy.rememberName(buyerId, buyerName);
      this.persist();
      return { ok: true, listing };
    });
  }

  cancelListing(playerId: string, listingId: string): AuctionResult {
    return this.withLocks(playerId, listingId, () => {
      this.expireDue();
      const listing = this.listings.get(listingId);
      if (!listing || listing.sellerPlayerId !== playerId) {
        return { ok: false, error: 'Этот товар уже продан.' };
      }
      if (listing.status !== 'ACTIVE') {
        return { ok: false, error: 'Этот товар уже продан.' };
      }
      listing.status = 'CANCELLED';
      listing.updatedAt = this.now();
      this.persist();
      return { ok: true, listing };
    });
  }

  relist(playerId: string, listingId: string, price: number): AuctionResult {
    return this.withLocks(playerId, listingId, () => {
      this.expireDue();
      const priceError = auctionPriceError(price);
      if (priceError) return { ok: false, error: priceError };
      const parsedPrice = parseAuctionPrice(price)!;
      const old = this.listings.get(listingId);
      if (!old || old.sellerPlayerId !== playerId || old.status !== 'ACTIVE') {
        return { ok: false, error: 'Этот товар уже продан.' };
      }
      const now = this.now();
      const created: AuctionListing = {
        listingId: `ah-${this.nextId++}`,
        sellerPlayerId: old.sellerPlayerId,
        sellerName: old.sellerName,
        item: cloneStack(old.item)!,
        price: parsedPrice,
        createdAt: now,
        expiresAt: now + AUCTION_DURATION_MS,
        updatedAt: now,
        status: 'ACTIVE',
      };
      old.status = 'RELISTED';
      old.updatedAt = now;
      this.listings.set(created.listingId, created);
      this.persist();
      return { ok: true, listing: created, previous: old };
    });
  }

  claimListing(playerId: string, inventory: Inventory, listingId: string): AuctionResult {
    return this.withLocks(playerId, listingId, () => {
      this.expireDue();
      const listing = this.listings.get(listingId);
      if (!listing || listing.sellerPlayerId !== playerId) {
        return { ok: false, error: 'Этот товар уже продан.' };
      }
      if (!isReturnableStatus(listing.status)) {
        return { ok: false, error: 'Этот товар уже продан.' };
      }
      if (!inventoryCanAccept(inventory, listing.item)) {
        return { ok: false, error: 'Недостаточно места в инвентаре.' };
      }
      const leftover = inventory.add(cloneStack(listing.item)!);
      if (leftover) return { ok: false, error: 'Недостаточно места в инвентаре.' };
      listing.status = 'CLAIMED';
      listing.updatedAt = this.now();
      this.persist();
      return { ok: true, listing };
    });
  }

  selectSellSlot(playerId: string, inventory: Inventory, slot: number): AuctionResult {
    if (!Number.isInteger(slot) || slot < 0 || slot >= Inventory.SLOT_COUNT) {
      return { ok: false, error: 'Предмет больше недоступен для продажи.' };
    }
    const current = inventory.getSlot(slot);
    if (!current) return { ok: false, error: 'Предмет больше недоступен для продажи.' };
    const session = this.session(playerId);
    session.screen = 'sell-confirm';
    session.slot = slot;
    session.expectedItem = cloneStack(current)!;
    session.amount = current.count;
    session.priceText = '';
    session.message = undefined;
    return { ok: true };
  }

  private withPlayerLock(playerId: string, fn: () => AuctionResult): AuctionResult {
    if (this.playerLocks.has(playerId)) return { ok: false, error: 'Предмет больше недоступен для продажи.' };
    this.playerLocks.add(playerId);
    try {
      return fn();
    } finally {
      this.playerLocks.delete(playerId);
    }
  }

  private withLocks(playerId: string, listingId: string, fn: () => AuctionResult): AuctionResult {
    if (this.listingLocks.has(listingId) || this.playerLocks.has(playerId)) {
      return { ok: false, error: 'Этот товар уже продан.' };
    }
    this.listingLocks.add(listingId);
    this.playerLocks.add(playerId);
    try {
      return fn();
    } finally {
      this.listingLocks.delete(listingId);
      this.playerLocks.delete(playerId);
    }
  }

  toNetworkListing(listing: AuctionListing, now = this.now()): NetworkAuctionListing {
    return {
      listingId: listing.listingId,
      sellerName: listing.sellerName,
      sellerPlayerId: listing.sellerPlayerId,
      price: listing.price,
      createdAt: listing.createdAt,
      expiresAt: listing.expiresAt,
      remainingMs: Math.max(0, listing.expiresAt - now),
      status: listing.status,
      item: cloneStack(listing.item),
      itemName: getItemDefinition(listing.item.itemId).name,
      tooltip: listingTooltip(listing, now),
    };
  }

  buildMessage(playerId: string, inventory: Inventory): ServerAuctionMessage {
    const session = this.session(playerId);
    if (session.screen === 'closed') {
      return {
        type: 'auction',
        screen: 'closed',
        title: '',
        search: session.search,
        page: 1,
        totalPages: 1,
        totalCount: 0,
        listings: [],
      };
    }
    const now = this.now();
    if (session.screen === 'browse' || session.screen === 'buy') {
      const page = this.queryBrowse({
        search: session.search,
        page: session.page,
        excludeSellerId: playerId,
      });
      session.page = page.page;
      const selected = session.listingId ? this.listings.get(session.listingId) : undefined;
      return {
        type: 'auction',
        screen: session.screen === 'buy' && selected ? 'buy' : 'browse',
        title: session.screen === 'buy' ? 'Подтверждение покупки' : 'Аукцион',
        search: session.search,
        page: page.page,
        totalPages: page.totalPages,
        totalCount: page.totalCount,
        listings: page.listings.map((listing) => this.toNetworkListing(listing, now)),
        ...(session.message ? { message: session.message } : {}),
        ...(selected ? {
          selected: {
            listingId: selected.listingId,
            item: cloneStack(selected.item),
            prompt: `Вы уверены, что хотите купить этот предмет за ${formatMegacoins(selected.price)}?`,
          },
        } : {}),
      };
    }
    if (session.screen === 'sell-pick' || session.screen === 'sell-confirm') {
      const slot = session.slot;
      const current = slot !== undefined ? inventory.getSlot(slot) : null;
      const maxAmount = current?.count ?? session.expectedItem?.count ?? 1;
      const amount = Math.min(session.amount ?? maxAmount, maxAmount);
      return {
        type: 'auction',
        screen: session.screen,
        title: session.screen === 'sell-confirm' ? 'Подтверждение продажи' : 'Выставить на продажу',
        search: '',
        page: 1,
        totalPages: 1,
        totalCount: 0,
        listings: [],
        inventorySlots: inventory.slots,
        ...(session.message ? { message: session.message } : {}),
        selected: {
          ...(slot !== undefined ? { slot } : {}),
          amount,
          maxAmount,
          priceText: session.priceText,
          ...(current || session.expectedItem
            ? {
              item: {
                ...cloneStack(current ?? session.expectedItem!)!,
                count: amount,
              },
            }
            : {}),
        },
      };
    }
    if (session.screen === 'mine' || session.screen === 'manage' || session.screen === 'claim' || session.screen === 'relist') {
      const page = this.queryMine(playerId, session.page);
      session.page = page.page;
      const selected = session.listingId ? this.listings.get(session.listingId) : undefined;
      if (session.screen === 'manage' && selected && isReturnableStatus(selected.status)) {
        session.screen = 'claim';
      }
      const title = session.screen === 'claim' ? 'Возврат предмета'
        : session.screen === 'relist' ? 'Изменить цену'
          : session.screen === 'manage' ? 'Ваш товар'
            : 'Мои товары';
      return {
        type: 'auction',
        screen: session.screen,
        title,
        search: '',
        page: page.page,
        totalPages: page.totalPages,
        totalCount: page.totalCount,
        listings: page.listings.map((listing) => this.toNetworkListing(listing, now)),
        ...(session.message ? { message: session.message } : {}),
        ...(selected ? {
          selected: {
            listingId: selected.listingId,
            item: cloneStack(selected.item),
            priceText: session.priceText,
            prompt: selected.status === 'EXPIRED'
              ? 'Срок продажи истёк'
              : selected.status === 'CANCELLED'
                ? 'Товар снят с продажи'
                : `Цена: ${formatMegacoins(selected.price)}`,
          },
        } : {}),
      };
    }
    return {
      type: 'auction',
      screen: 'closed',
      title: '',
      search: '',
      page: 1,
      totalPages: 1,
      totalCount: 0,
      listings: [],
    };
  }
}

function paginate(listings: AuctionListing[], requestedPage: number, pageSize: number): AuctionPage {
  const totalCount = listings.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize) || 1);
  const page = totalCount === 0 ? 1 : Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  return {
    listings: listings.slice(start, start + pageSize),
    totalCount,
    page,
    totalPages: totalCount === 0 ? 1 : totalPages,
  };
}
