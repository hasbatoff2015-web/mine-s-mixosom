import { getItemDefinition, isKnownItemId } from '../../src/items';

export const KIT_NAME_MAX = 24;
export const KIT_MAX_ITEM_COUNT = 9_999;
export const KIT_START_NAME = 'start';

export interface KitStack {
  itemId: string;
  count: number;
}

export interface KitDefinition {
  name: string;
  items: KitStack[];
}

export interface KitStore {
  kits: KitDefinition[];
  receivedStart: string[];
  pendingStart: string[];
}

export interface KitGiveResult {
  readonly given: number;
  readonly leftover: number;
}

export interface KitPlayer {
  give(itemId: string, count: number): KitGiveResult;
}

const NAME_PATTERN = new RegExp(`^[a-z0-9_]{1,${KIT_NAME_MAX}}$`);

export function parseKitName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const name = raw.trim().toLowerCase();
  if (!NAME_PATTERN.test(name)) return undefined;
  return name;
}

export function emptyKitStore(): KitStore {
  return { kits: [], receivedStart: [], pendingStart: [] };
}

export function parseKitStore(raw: unknown): KitStore {
  const store = emptyKitStore();
  if (!raw || typeof raw !== 'object') return store;
  const value = raw as { kits?: unknown; receivedStart?: unknown; pendingStart?: unknown };
  if (Array.isArray(value.kits)) {
    const seen = new Set<string>();
    for (const entry of value.kits) {
      const kit = parseKit(entry);
      if (!kit || seen.has(kit.name)) continue;
      seen.add(kit.name);
      store.kits.push(kit);
    }
  }
  store.receivedStart = parseIdList(value.receivedStart);
  store.pendingStart = parseIdList(value.pendingStart).filter((id) => !store.receivedStart.includes(id));
  return store;
}

function parseKit(raw: unknown): KitDefinition | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as { name?: unknown; items?: unknown };
  const name = parseKitName(typeof value.name === 'string' ? value.name : undefined);
  if (!name || !Array.isArray(value.items)) return undefined;
  const items: KitStack[] = [];
  for (const entry of value.items) {
    if (!entry || typeof entry !== 'object') continue;
    const stack = entry as { itemId?: unknown; count?: unknown };
    if (typeof stack.itemId !== 'string' || !isKnownItemId(stack.itemId)) continue;
    if (!Number.isInteger(stack.count) || (stack.count as number) < 1 || (stack.count as number) > KIT_MAX_ITEM_COUNT) {
      continue;
    }
    const existing = items.find((item) => item.itemId === stack.itemId);
    if (existing) existing.count = Math.min(KIT_MAX_ITEM_COUNT, existing.count + (stack.count as number));
    else items.push({ itemId: stack.itemId, count: stack.count as number });
  }
  return { name, items };
}

function parseIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 80 || seen.has(entry)) continue;
    seen.add(entry);
    ids.push(entry);
  }
  return ids;
}

export type KitMutation = { ok: true; kit: KitDefinition } | { ok: false; error: string };

/**
 * Kit definitions and the one-time start-kit ledger.
 * Item delivery stays in the caller so a failed give is not marked received.
 */
export class KitService {
  private store: KitStore = emptyKitStore();
  private readonly granting = new Set<string>();

  constructor(
    private readonly loadRaw: () => unknown,
    private readonly saveRaw: (store: KitStore) => void,
  ) {}

  load(): void {
    this.store = parseKitStore(this.loadRaw());
  }

  list(): readonly KitDefinition[] {
    return this.store.kits.map(cloneKit);
  }

  get(name: string): KitDefinition | undefined {
    const kit = this.store.kits.find((entry) => entry.name === name);
    return kit ? cloneKit(kit) : undefined;
  }

  hasReceivedStart(playerId: string): boolean {
    return this.store.receivedStart.includes(playerId);
  }

  isPendingStart(playerId: string): boolean {
    return this.store.pendingStart.includes(playerId);
  }

  /** First appearance, or a previous first appearance whose give did not finish. */
  shouldAutoGrantStart(firstJoin: boolean, playerId: string): boolean {
    if (this.hasReceivedStart(playerId) || this.granting.has(playerId)) return false;
    return firstJoin || this.isPendingStart(playerId);
  }

  create(name: string): KitMutation {
    if (parseKitName(name) !== name) return { ok: false, error: `Некорректное имя набора '${name}'.` };
    if (this.store.kits.some((kit) => kit.name === name)) {
      return { ok: false, error: `Набор '${name}' уже существует.` };
    }
    const kit: KitDefinition = { name, items: [] };
    this.store.kits.push(kit);
    this.persist();
    return { ok: true, kit: cloneKit(kit) };
  }

  remove(name: string): { ok: true } | { ok: false; error: string } {
    if (name === KIT_START_NAME) {
      return { ok: false, error: 'Стартовый набор нельзя удалить. Очистите его: /kit edit start clear.' };
    }
    const next = this.store.kits.filter((kit) => kit.name !== name);
    if (next.length === this.store.kits.length) return { ok: false, error: `Набор '${name}' не найден.` };
    this.store.kits = next;
    this.persist();
    return { ok: true };
  }

  addItem(name: string, itemId: string, count: number): KitMutation {
    if (!isKnownItemId(itemId)) return { ok: false, error: `Неизвестный предмет '${itemId}'.` };
    if (!Number.isInteger(count) || count < 1 || count > KIT_MAX_ITEM_COUNT) {
      return { ok: false, error: `Количество должно быть целым от 1 до ${KIT_MAX_ITEM_COUNT}.` };
    }
    const kit = this.ensure(name);
    if (!kit) return { ok: false, error: `Набор '${name}' не найден.` };
    const existing = kit.items.find((item) => item.itemId === itemId);
    if (existing) {
      const next = existing.count + count;
      if (next > KIT_MAX_ITEM_COUNT) {
        return { ok: false, error: `В наборе не может быть больше ${KIT_MAX_ITEM_COUNT} предметов одного вида.` };
      }
      existing.count = next;
    } else {
      kit.items.push({ itemId, count });
    }
    this.persist();
    return { ok: true, kit: cloneKit(kit) };
  }

  removeItem(name: string, itemId: string): KitMutation {
    const kit = this.store.kits.find((entry) => entry.name === name);
    if (!kit) return { ok: false, error: `Набор '${name}' не найден.` };
    const next = kit.items.filter((item) => item.itemId !== itemId);
    if (next.length === kit.items.length) return { ok: false, error: `В наборе '${name}' нет '${itemId}'.` };
    kit.items = next;
    this.persist();
    return { ok: true, kit: cloneKit(kit) };
  }

  clear(name: string): KitMutation {
    const kit = name === KIT_START_NAME
      ? this.ensure(name)
      : this.store.kits.find((entry) => entry.name === name);
    if (!kit) return { ok: false, error: `Набор '${name}' не найден.` };
    kit.items = [];
    this.persist();
    return { ok: true, kit: cloneKit(kit) };
  }

  /**
   * Gives `name` once for the start-kit ledger.
   * `deliver` must return true only after items were inserted or handed to the existing drop path.
   * A throw or false leaves the player pending and does not mark the kit received.
   * A nested call for the same player does not give a second time.
   */
  grantStart(playerId: string, deliver: () => boolean): 'granted' | 'already' | 'busy' | 'failed' {
    if (this.hasReceivedStart(playerId)) return 'already';
    if (this.granting.has(playerId)) return 'busy';
    this.granting.add(playerId);
    try {
      let delivered = false;
      try {
        delivered = deliver();
      } catch {
        delivered = false;
      }
      if (delivered) {
        this.markReceived(playerId);
        return 'granted';
      }
      this.markPending(playerId);
      return 'failed';
    } finally {
      this.granting.delete(playerId);
    }
  }

  private ensure(name: string): KitDefinition | undefined {
    const found = this.store.kits.find((kit) => kit.name === name);
    if (found) return found;
    if (name !== KIT_START_NAME) return undefined;
    const kit: KitDefinition = { name, items: [] };
    this.store.kits.push(kit);
    return kit;
  }

  private markReceived(playerId: string): void {
    if (!this.store.receivedStart.includes(playerId)) this.store.receivedStart.push(playerId);
    this.store.pendingStart = this.store.pendingStart.filter((id) => id !== playerId);
    this.persist();
  }

  private markPending(playerId: string): void {
    if (!this.store.pendingStart.includes(playerId)) this.store.pendingStart.push(playerId);
    this.persist();
  }

  private persist(): void {
    this.saveRaw({
      kits: this.store.kits.map(cloneKit),
      receivedStart: [...this.store.receivedStart],
      pendingStart: [...this.store.pendingStart],
    });
  }
}

export function deliverKit(player: KitPlayer, kit: KitDefinition | undefined): boolean {
  if (!kit) return true;
  for (const item of kit.items) {
    const maxStack = Math.max(1, getItemDefinition(item.itemId).maxStack);
    let remaining = item.count;
    while (remaining > 0) {
      const batch = Math.min(remaining, maxStack);
      player.give(item.itemId, batch);
      remaining -= batch;
    }
  }
  return true;
}

function cloneKit(kit: KitDefinition): KitDefinition {
  return {
    name: kit.name,
    items: kit.items.map((item) => ({ itemId: item.itemId, count: item.count })),
  };
}
