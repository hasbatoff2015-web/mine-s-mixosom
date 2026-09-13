import { createItemStack, type Inventory, type ItemMetadata, type ItemStack } from '../inventory';
import { ItemId } from './types';

export const MAX_BOOK_PAGES = 32;
export const MAX_BOOK_PAGE_CHARS = 1024;
export const MAX_BOOK_TITLE_CHARS = 64;

export interface BookContent {
  readonly pages: readonly string[];
  readonly title?: string;
  readonly author?: string;
  readonly locked?: boolean;
}

/** Plain Unicode text only. Remove controls and unpaired UTF-16 surrogates. */
function plainText(value: string): string {
  return value.normalize('NFC')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

export function sanitizeBookDraft(value: unknown): BookContent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.pages) || raw.pages.length > MAX_BOOK_PAGES
    || raw.pages.some((page) => typeof page !== 'string' || page.length > MAX_BOOK_PAGE_CHARS)) return undefined;
  if (raw.title !== undefined && (typeof raw.title !== 'string' || raw.title.length > MAX_BOOK_TITLE_CHARS)) return undefined;
  const pages = raw.pages.map((page) => plainText(page as string));
  const title = raw.title === undefined ? undefined : plainText(raw.title as string).trim();
  return { pages, ...(title ? { title } : {}) };
}

export function readBookContent(stack: ItemStack): BookContent | undefined {
  const book = stack.metadata?.book;
  if (!book || typeof book !== 'object' || Array.isArray(book)) return undefined;
  const draft = sanitizeBookDraft(book);
  if (!draft) return undefined;
  const raw = book as Record<string, unknown>;
  return {
    ...draft,
    ...(typeof raw.author === 'string' ? { author: plainText(raw.author).slice(0, MAX_BOOK_TITLE_CHARS) } : {}),
    ...(raw.locked === true ? { locked: true } : {}),
  };
}

/** Replaces the selected book; blank remainder is returned if inventory is full. */
export function writeBookInSlot(inventory: Inventory, slot: number, content: BookContent): ItemStack | null | undefined {
  const stack = inventory.getSlot(slot);
  if (stack?.itemId !== ItemId.Book || readBookContent(stack)?.locked) return undefined;
  const draft = sanitizeBookDraft(content);
  if (!draft) return undefined;
  const metadata: ItemMetadata = { ...stack.metadata, book: {
    pages: [...draft.pages],
    ...(draft.title ? { title: draft.title } : {}),
    ...(readBookContent(stack)?.author ? { author: readBookContent(stack)!.author! } : {}),
  } };
  const edited = createItemStack(ItemId.Book, 1, { metadata });
  inventory.setSlot(slot, edited);
  return stack.count > 1
    ? inventory.add(createItemStack(ItemId.Book, stack.count - 1, { metadata: stack.metadata }))
    : null;
}
