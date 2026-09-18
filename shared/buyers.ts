import { PLAYER_HEIGHT, PLAYER_WIDTH } from '../src/core/constants';

export const BUYER_PLUGIN_NAME = 'buyer';
export const BUYER_STORE_KEY = 'buyers/buyers';
export const BUYER_NPC_SKIN_ID = 'buyer_merchant';
export const BUYER_HOLOGRAM_PREFIX = 'buyer-';
export const BUYER_HOLOGRAM_Y_OFFSET = 2.15;
export const BUYER_NAME_MIN = 1;
export const BUYER_NAME_MAX = 32;
export const BUYER_HOLOGRAM_TEXT_MAX = 80;
export const BUYER_MIN_PRICE = 1;
export const BUYER_MAX_PRICE = 999_999_999;
export const BUYER_BUSY_ERROR = 'Подождите, скупщик занят.';

/** Example starting prices for tests and admin setup — not the only allowed values. */
export const BUYER_EXAMPLE_PUMPKIN_PRICE = 50;
export const BUYER_EXAMPLE_MELON_PRICE = 50;
export const BUYER_EXAMPLE_GOLDEN_APPLE_PRICE = 600;
export const BUYER_EXAMPLE_PUMPKIN_ITEM = 'pumpkin';
export const BUYER_EXAMPLE_MELON_ITEM = 'melon';
export const BUYER_EXAMPLE_GOLDEN_APPLE_ITEM = 'golden_apple';

export const BUYER_PRICE_EMPTY_ERROR = 'Укажите цену целым числом.';
export const BUYER_PRICE_RANGE_ERROR = 'Цена должна быть целым числом от 1 до 999 999 999.';
export const BUYER_ITEM_INVALID_ERROR = 'Этот предмет нельзя назначить скупщику.';
export const BUYER_NOT_CONFIGURED_ERROR = 'Этот скупщик ещё не принимает товары.';
export const BUYER_WRONG_ITEM_ERROR = 'Этот скупщик не принимает данный предмет.';
export const BUYER_STALE_ERROR = 'Этот скупщик больше недоступен.';
export const BUYER_NAME_LENGTH_ERROR = `Имя скупщика должно содержать от ${BUYER_NAME_MIN} до ${BUYER_NAME_MAX} символов.`;
export const BUYER_NAME_TAKEN_ERROR = 'Скупщик с таким именем уже существует.';
export const BUYER_NOT_FOUND_ERROR = 'Скупщик не найден.';

export function isBuyerHologramName(name: string): boolean {
  return name.trim().toLowerCase().startsWith(BUYER_HOLOGRAM_PREFIX);
}

export function buyerHologramName(id: string): string {
  return `${BUYER_HOLOGRAM_PREFIX}${id}`.toLowerCase().slice(0, 32);
}

export function normalizeBuyerName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function validateBuyerName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: BUYER_NAME_LENGTH_ERROR };
  const name = normalizeBuyerName(raw);
  if (name.length < BUYER_NAME_MIN || name.length > BUYER_NAME_MAX) {
    return { ok: false, error: BUYER_NAME_LENGTH_ERROR };
  }
  if (/[\u0000-\u001f]/.test(name)) return { ok: false, error: BUYER_NAME_LENGTH_ERROR };
  return { ok: true, name };
}

export function parseBuyerPrice(raw: unknown): number | undefined {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || !Number.isSafeInteger(raw)) return undefined;
    if (raw < BUYER_MIN_PRICE || raw > BUYER_MAX_PRICE) return undefined;
    return raw;
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < BUYER_MIN_PRICE || value > BUYER_MAX_PRICE) return undefined;
  return value;
}

export function buyerPriceError(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return BUYER_PRICE_EMPTY_ERROR;
  if (typeof raw === 'string' && raw.trim() === '') return BUYER_PRICE_EMPTY_ERROR;
  if (parseBuyerPrice(raw) === undefined) return BUYER_PRICE_RANGE_ERROR;
  return undefined;
}

export interface BuyerAabb {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export function buyerAabb(position: { readonly x: number; readonly y: number; readonly z: number }): BuyerAabb {
  const half = PLAYER_WIDTH * 0.5;
  return {
    minX: position.x - half,
    maxX: position.x + half,
    minY: position.y,
    maxY: position.y + PLAYER_HEIGHT,
    minZ: position.z - half,
    maxZ: position.z + half,
  };
}

export function distanceToBuyerAabb(
  eye: { readonly x: number; readonly y: number; readonly z: number },
  position: { readonly x: number; readonly y: number; readonly z: number },
): number {
  const box = buyerAabb(position);
  const cx = Math.min(Math.max(eye.x, box.minX), box.maxX);
  const cy = Math.min(Math.max(eye.y, box.minY), box.maxY);
  const cz = Math.min(Math.max(eye.z, box.minZ), box.maxZ);
  return Math.hypot(eye.x - cx, eye.y - cy, eye.z - cz);
}

export function playerCanReachBuyer(
  eye: { readonly x: number; readonly y: number; readonly z: number },
  position: { readonly x: number; readonly y: number; readonly z: number },
  maxDistance: number,
): boolean {
  return distanceToBuyerAabb(eye, position) <= maxDistance;
}

export function buyerPayout(quantity: number, pricePerItem: number): number | undefined {
  if (!Number.isInteger(quantity) || quantity < 1) return undefined;
  if (!Number.isInteger(pricePerItem) || pricePerItem < BUYER_MIN_PRICE) return undefined;
  const total = quantity * pricePerItem;
  if (!Number.isSafeInteger(total) || total < 1) return undefined;
  return total;
}
