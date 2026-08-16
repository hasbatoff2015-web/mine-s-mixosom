import { getItemDefinition, type ArmorSlot } from '../items';
import {
  applySlotClick,
  canStacksMerge,
  cloneStack,
  createItemStack,
  splitItemStack,
  validateItemStack,
} from './stack';
import type {
  InventoryClickButton,
  InventorySlotRef,
  ItemMetadata,
  ItemStack,
  SerializedInventory,
} from './types';

const ARMOR_SLOTS: readonly ArmorSlot[] = ['head', 'chest', 'legs', 'feet'];

function emptyArmor(): Record<ArmorSlot, ItemStack | null> {
  return { head: null, chest: null, legs: null, feet: null };
}

function assertSlotIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= Inventory.SLOT_COUNT) {
    throw new RangeError(`Inventory slot must be an integer from 0 to ${Inventory.SLOT_COUNT - 1}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseStack(value: unknown): ItemStack | null {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.itemId !== 'string' || typeof value.count !== 'number') {
    throw new TypeError('Serialized item stack is malformed');
  }
  if (value.durability !== undefined && typeof value.durability !== 'number') {
    throw new TypeError('Serialized item durability is malformed');
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    throw new TypeError('Serialized item metadata is malformed');
  }
  const stack: ItemStack = {
    itemId: value.itemId,
    count: value.count,
    ...(value.durability === undefined ? {} : { durability: value.durability }),
    ...(value.metadata === undefined ? {} : { metadata: value.metadata as ItemMetadata }),
  };
  validateItemStack(stack);
  return cloneStack(stack);
}

export class Inventory {
  static readonly SLOT_COUNT = 36;
  static readonly HOTBAR_SIZE = 9;

  readonly #slots: Array<ItemStack | null>;
  readonly #armor: Record<ArmorSlot, ItemStack | null>;
  #offhand: ItemStack | null;

  constructor() {
    this.#slots = Array.from({ length: Inventory.SLOT_COUNT }, () => null);
    this.#armor = emptyArmor();
    this.#offhand = null;
  }

  get slots(): readonly (ItemStack | null)[] {
    return this.#slots.map(cloneStack);
  }

  get armor(): Readonly<Record<ArmorSlot, ItemStack | null>> {
    return {
      head: cloneStack(this.#armor.head),
      chest: cloneStack(this.#armor.chest),
      legs: cloneStack(this.#armor.legs),
      feet: cloneStack(this.#armor.feet),
    };
  }

  get offhand(): ItemStack | null {
    return cloneStack(this.#offhand);
  }

  getSlot(ref: InventorySlotRef): ItemStack | null {
    if (typeof ref === 'number') {
      assertSlotIndex(ref);
      return cloneStack(this.#slots[ref] ?? null);
    }
    return ref.section === 'armor'
      ? cloneStack(this.#armor[ref.slot])
      : cloneStack(this.#offhand);
  }

  setSlot(ref: InventorySlotRef, stack: ItemStack | null): void {
    if (stack !== null) {
      validateItemStack(stack);
      if (!this.accepts(ref, stack)) throw new TypeError(`${stack.itemId} cannot be placed in this slot`);
    }
    if (typeof ref === 'number') {
      assertSlotIndex(ref);
      this.#slots[ref] = cloneStack(stack);
    } else if (ref.section === 'armor') {
      this.#armor[ref.slot] = cloneStack(stack);
    } else {
      this.#offhand = cloneStack(stack);
    }
  }

  accepts(ref: InventorySlotRef, stack: ItemStack): boolean {
    if (typeof ref === 'number' || ref.section === 'offhand') return true;
    const definition = getItemDefinition(stack.itemId);
    return definition.kind === 'armor' && definition.slot === ref.slot;
  }

  clear(): void {
    this.#slots.fill(null);
    for (const slot of ARMOR_SLOTS) this.#armor[slot] = null;
    this.#offhand = null;
  }

  count(itemId: string): number {
    let count = 0;
    for (const stack of this.allStacks()) {
      if (stack?.itemId === itemId) count += stack.count;
    }
    return count;
  }

  has(itemId: string, count = 1): boolean {
    if (!Number.isInteger(count) || count < 0) throw new RangeError('Count must be a non-negative integer');
    return this.count(itemId) >= count;
  }

  firstEmptySlot(): number | undefined {
    const index = this.#slots.findIndex((stack) => stack === null);
    return index < 0 ? undefined : index;
  }

  findFirst(itemId: string): number | undefined {
    const index = this.#slots.findIndex((stack) => stack?.itemId === itemId);
    return index < 0 ? undefined : index;
  }

  /** Adds as much as possible and returns the remainder, or `null` on complete success. */
  add(stack: ItemStack): ItemStack | null {
    validateItemStack(stack);
    return this.insertIntoSlots(stack, Array.from({ length: Inventory.SLOT_COUNT }, (_unused, index) => index));
  }

  /** Convenience for adding counts larger than one stack. Returns the number not inserted. */
  addItem(itemId: string, count: number, options: { readonly durability?: number; readonly metadata?: ItemMetadata } = {}): number {
    if (!Number.isInteger(count) || count < 0) throw new RangeError('Count must be a non-negative integer');
    const definition = getItemDefinition(itemId);
    if (count === 0) return 0;
    let remaining = count;
    while (remaining > 0) {
      const batch = Math.min(remaining, definition.maxStack);
      const remainder = this.add(createItemStack(itemId, batch, options));
      remaining -= batch - (remainder?.count ?? 0);
      if (remainder !== null) break;
    }
    return remaining;
  }

  /** Removes up to `count` items and returns the amount actually removed. */
  remove(itemId: string, count: number): number {
    if (!Number.isInteger(count) || count < 0) throw new RangeError('Count must be a non-negative integer');
    let remaining = count;
    for (let index = this.#slots.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const stack = this.#slots[index];
      if (stack?.itemId !== itemId) continue;
      const removed = Math.min(stack.count, remaining);
      const nextCount = stack.count - removed;
      this.#slots[index] = nextCount === 0 ? null : { ...stack, count: nextCount };
      remaining -= removed;
    }
    if (this.#offhand?.itemId === itemId && remaining > 0) {
      const removed = Math.min(this.#offhand.count, remaining);
      const nextCount = this.#offhand.count - removed;
      this.#offhand = nextCount === 0 ? null : { ...this.#offhand, count: nextCount };
      remaining -= removed;
    }
    for (const slot of ARMOR_SLOTS) {
      const stack = this.#armor[slot];
      if (stack?.itemId !== itemId || remaining === 0) continue;
      const removed = Math.min(stack.count, remaining);
      const nextCount = stack.count - removed;
      this.#armor[slot] = nextCount === 0 ? null : { ...stack, count: nextCount };
      remaining -= removed;
    }
    return count - remaining;
  }

  removeItem(itemId: string, count: number): number {
    return this.remove(itemId, count);
  }

  /** Atomic removal: changes nothing unless every requested item is available. */
  consume(requirements: Readonly<Record<string, number>>): boolean {
    for (const [itemId, count] of Object.entries(requirements)) {
      if (!Number.isInteger(count) || count < 0) throw new RangeError('Recipe counts must be non-negative integers');
      if (!this.has(itemId, count)) return false;
    }
    for (const [itemId, count] of Object.entries(requirements)) this.remove(itemId, count);
    return true;
  }

  clickSlot(ref: InventorySlotRef, cursor: ItemStack | null, button: InventoryClickButton): ItemStack | null {
    const result = applySlotClick(
      this.getSlot(ref),
      cursor,
      button,
      (candidate) => this.accepts(ref, candidate),
    );
    this.setSlot(ref, result.slot);
    return result.cursor;
  }

  /** Shift-click style transfer between hotbar/main inventory and equipment. */
  quickMove(ref: InventorySlotRef): boolean {
    const source = this.getSlot(ref);
    if (source === null) return false;

    if (typeof ref === 'number') {
      const definition = getItemDefinition(source.itemId);
      if (definition.kind === 'armor') {
        const armorRef: InventorySlotRef = { section: 'armor', slot: definition.slot };
        if (this.getSlot(armorRef) === null) {
          this.setSlot(armorRef, source);
          this.setSlot(ref, null);
          return true;
        }
      }
      if (definition.kind === 'shield' && this.#offhand === null) {
        this.#offhand = cloneStack(source);
        this.setSlot(ref, null);
        return true;
      }

      const targetIndices = ref < Inventory.HOTBAR_SIZE
        ? Array.from({ length: Inventory.SLOT_COUNT - Inventory.HOTBAR_SIZE }, (_unused, index) => index + Inventory.HOTBAR_SIZE)
        : Array.from({ length: Inventory.HOTBAR_SIZE }, (_unused, index) => index);
      const remainder = this.insertIntoSlots(source, targetIndices);
      if (remainder?.count === source.count) return false;
      this.setSlot(ref, remainder);
      return true;
    }

    const remainder = this.insertIntoSlots(
      source,
      Array.from({ length: Inventory.SLOT_COUNT }, (_unused, index) => index),
    );
    if (remainder?.count === source.count) return false;
    this.setSlot(ref, remainder);
    return true;
  }

  /** Places one item into each supplied slot, matching RMB drag behavior. */
  dragPlace(cursor: ItemStack | null, refs: readonly InventorySlotRef[]): ItemStack | null {
    let remaining = cloneStack(cursor);
    for (const ref of refs) {
      if (remaining === null) break;
      remaining = this.clickSlot(ref, remaining, 'right');
    }
    return remaining;
  }

  /** Removes a whole stack or a requested amount for spawning a dropped-item entity. */
  dropFromSlot(ref: InventorySlotRef, amount?: number): ItemStack | null {
    const stack = this.getSlot(ref);
    if (stack === null) return null;
    const take = amount ?? stack.count;
    const split = splitItemStack(stack, take);
    this.setSlot(ref, split.remainder);
    return split.taken;
  }

  swapSlots(a: InventorySlotRef, b: InventorySlotRef): boolean {
    const first = this.getSlot(a);
    const second = this.getSlot(b);
    if ((first !== null && !this.accepts(b, first)) || (second !== null && !this.accepts(a, second))) {
      return false;
    }
    this.setSlot(a, second);
    this.setSlot(b, first);
    return true;
  }

  serialize(): SerializedInventory {
    return {
      version: 1,
      slots: this.#slots.map(cloneStack),
      armor: {
        head: cloneStack(this.#armor.head),
        chest: cloneStack(this.#armor.chest),
        legs: cloneStack(this.#armor.legs),
        feet: cloneStack(this.#armor.feet),
      },
      offhand: cloneStack(this.#offhand),
    };
  }

  toJSON(): SerializedInventory {
    return this.serialize();
  }

  static deserialize(value: unknown): Inventory {
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.slots)
      || value.slots.length !== Inventory.SLOT_COUNT || !isRecord(value.armor)) {
      throw new TypeError('Serialized inventory is malformed or has an unsupported version');
    }

    const inventory = new Inventory();
    value.slots.forEach((stack, index) => inventory.setSlot(index, parseStack(stack)));
    for (const slot of ARMOR_SLOTS) {
      if (!(slot in value.armor)) throw new TypeError(`Serialized inventory is missing armor slot ${slot}`);
      inventory.setSlot({ section: 'armor', slot }, parseStack(value.armor[slot]));
    }
    inventory.setSlot({ section: 'offhand' }, parseStack(value.offhand));
    return inventory;
  }

  clone(): Inventory {
    return Inventory.deserialize(this.serialize());
  }

  private allStacks(): readonly (ItemStack | null)[] {
    return [...this.#slots, ...ARMOR_SLOTS.map((slot) => this.#armor[slot]), this.#offhand];
  }

  private insertIntoSlots(stack: ItemStack, indices: readonly number[]): ItemStack | null {
    let remainder = cloneStack(stack) as ItemStack;
    const maximum = getItemDefinition(stack.itemId).maxStack;

    for (const index of indices) {
      if (remainder.count === 0) break;
      assertSlotIndex(index);
      const current = this.#slots[index];
      if (current === undefined || current === null || !canStacksMerge(current, remainder)
        || current.count >= maximum) continue;
      const moved = Math.min(maximum - current.count, remainder.count);
      this.#slots[index] = { ...current, count: current.count + moved };
      remainder = { ...remainder, count: remainder.count - moved };
    }

    for (const index of indices) {
      if (remainder.count === 0) break;
      assertSlotIndex(index);
      if (this.#slots[index] !== null) continue;
      const moved = Math.min(maximum, remainder.count);
      this.#slots[index] = { ...remainder, count: moved };
      remainder = { ...remainder, count: remainder.count - moved };
    }

    return remainder.count === 0 ? null : remainder;
  }
}
