import { describe, expect, it, vi } from 'vitest';
import { Game } from '../src/core/Game';
import { Inventory, createItemStack } from '../src/inventory';
import { ItemId, readBookContent } from '../src/items';

const methods = Game.prototype as unknown as {
  sendOnlineUse: (this: object, session: unknown) => void;
  useTargetOrItem: (this: object) => void;
  openSelectedBook: (this: object, session: unknown) => void;
};

function setup(online = false) {
  const inventory = new Inventory();
  inventory.setSlot(0, createItemStack(ItemId.Book));
  const client = { send: vi.fn() };
  const session = { inventory, selectedSlot: 0, target: undefined,
    ...(online ? { online: { client } } : {}) };
  const ui = { openBook: vi.fn() };
  const host = {
    session, ui,
    selectedStack: () => inventory.getSlot(0),
    tryInteractBuyer: () => false,
    tryInteractHologram: () => false,
    openSelectedBook: vi.fn(),
    openGameplayModal: vi.fn(),
    enterPlaying: vi.fn(),
    input: { tryRequestPointerLock: vi.fn() },
    refreshHud: vi.fn(),
    saveSession: vi.fn(async () => {}),
    spawnDroppedStack: vi.fn(),
  };
  return { host, session, inventory, client, ui };
}

describe('held book use routing', () => {
  it('opens the same editor from singleplayer RMB', () => {
    const { host, session } = setup();
    methods.useTargetOrItem.call(host);
    expect(host.openSelectedBook).toHaveBeenCalledWith(session);
  });

  it('consumes online RMB locally without an unrelated interact packet', () => {
    const { host, session, client } = setup(true);
    methods.sendOnlineUse.call(host, session);
    expect(host.openSelectedBook).toHaveBeenCalledWith(session);
    expect(client.send).not.toHaveBeenCalled();
  });

  it('saves a draft locally through the existing item metadata path', () => {
    const { host, session, inventory, ui } = setup();
    methods.openSelectedBook.call(host, session);
    const save = ui.openBook.mock.calls[0]![1] as (content: { pages: string[] }, sign: boolean) => void;
    save({ pages: ['Draft'] }, false);
    expect(readBookContent(inventory.getSlot(0)!)).toMatchObject({ pages: ['Draft'] });
    expect(host.saveSession).toHaveBeenCalledTimes(1);
  });

  it('sends a signed draft to the authoritative server without client author/lock fields', () => {
    const { host, session, client, ui } = setup(true);
    methods.openSelectedBook.call(host, session);
    const save = ui.openBook.mock.calls[0]![1] as (content: { pages: string[]; title: string }, sign: boolean) => void;
    save({ pages: ['Final'], title: 'Notes' }, true);
    expect(client.send).toHaveBeenCalledWith({ type: 'book_update', slot: 0,
      pages: ['Final'], title: 'Notes', sign: true });
  });
});
