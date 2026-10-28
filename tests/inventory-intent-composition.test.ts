/**
 * @vitest-environment happy-dom
 *
 * GameUI stamps an inventory mutation once. Game.sendInventoryAction only
 * transmits that message, even when the online session still remembers a
 * previous chest revision.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Inventory, createItemStack } from '../src/inventory';
import { transmitInventoryIntent } from '../src/net/inventoryIntent';
import { GameUI } from '../src/ui/GameUI';
import { parseClientMessage, type ClientInventoryActionMessage } from '../shared/protocol';

let physicalTarget: Element | null = null;
const sessions: GameUI[] = [];

function fire(type: string, element: Element, init: PointerEventInit = {}): void {
  physicalTarget = element;
  element.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    pointerType: 'mouse',
    button: 0,
    clientX: 20,
    clientY: 20,
    ...init,
  }));
}

function clickSlot(root: ParentNode, key: string): void {
  const element = root.querySelector<HTMLElement>(`[data-slot="${key}"]`);
  if (!element) throw new Error(`missing slot ${key}`);
  fire('pointerdown', element);
  fire('pointerup', element);
}

interface OnlineSend {
  readonly containerRevision: number;
  readonly sent: ClientInventoryActionMessage[];
  readonly handed: ClientInventoryActionMessage[];
  submitAction(message: ClientInventoryActionMessage): void;
}

function onlineSend(containerRevision: number): OnlineSend {
  const sent: ClientInventoryActionMessage[] = [];
  const handed: ClientInventoryActionMessage[] = [];
  const online = { containerRevision, client: { send(message: ClientInventoryActionMessage) { sent.push(message); } } };
  return {
    containerRevision,
    sent,
    handed,
    submitAction(message) {
      handed.push(message);
      transmitInventoryIntent((payload) => online.client.send(payload), message);
    },
  };
}

function openWindow(
  kind: 'inventory' | 'crafting-table' | 'chest' | 'furnace' | 'portal-chest',
  wire: OnlineSend,
  inventory = new Inventory(),
): { root: HTMLElement; ui: GameUI } {
  const root = document.createElement('div');
  document.body.append(root);
  const ui = new GameUI(root);
  sessions.push(ui);
  ui.openInventory({
    kind,
    mode: 'survival',
    inventory,
    ...(kind === 'chest' || kind === 'portal-chest'
      ? { chest: { slots: Array.from({ length: 27 }, () => null) } }
      : {}),
    ...(kind === 'furnace'
      ? { furnace: { slots: [null, null, null], burnTime: 0, burnTotal: 0, cookTime: 0 } }
      : {}),
    onClose() {},
    onDrop() {},
    onChanged() {},
    submitAction: (message) => wire.submitAction(message),
  });
  return { root, ui };
}

function expectNoContainerRevision(message: ClientInventoryActionMessage, inventoryRevision: number): void {
  expect(message.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(message.expectedInventoryRevision).toBe(inventoryRevision);
  expect(message).not.toHaveProperty('expectedContainerRevision');
  const parsed = parseClientMessage(message);
  expect(parsed).toMatchObject({
    requestId: message.requestId,
    expectedInventoryRevision: inventoryRevision,
  });
  expect(parsed).not.toHaveProperty('expectedContainerRevision');
}

describe('inventory intent submission composition', () => {
  beforeEach(() => {
    physicalTarget = null;
    vi.spyOn(document, 'elementFromPoint').mockImplementation(() => physicalTarget);
  });

  afterEach(() => {
    for (const ui of sessions) ui.closeInventory(false);
    sessions.length = 0;
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('does not attach a stale chest revision to a crafting-table craft click', () => {
    const wire = onlineSend(8);
    const { root, ui } = openWindow('crafting-table', wire);
    ui.noteInventoryRevisions(4, wire.containerRevision);
    clickSlot(root, 'result');
    expect(wire.sent).toHaveLength(1);
    expect(wire.sent[0]).toBe(wire.handed[0]);
    expect(wire.sent[0]).toMatchObject({ action: 'click', key: 'result' });
    expectNoContainerRevision(wire.sent[0]!, 4);
  });

  it('does not attach a stale chest revision to an inventory craft', () => {
    const wire = onlineSend(8);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('oak_log', 1));
    const { root, ui } = openWindow('inventory', wire, inventory);
    ui.noteInventoryRevisions(5, wire.containerRevision);
    const menu = root.querySelector<HTMLElement>('[data-craft-menu]');
    if (!menu) throw new Error('missing craft menu');
    fire('pointerdown', menu);
    const craft = root.querySelector<HTMLElement>('[data-craft-once]');
    if (!craft) throw new Error('missing craft button');
    fire('pointerdown', craft);
    expect(wire.sent).toHaveLength(1);
    expect(wire.sent[0]).toBe(wire.handed[0]);
    expect(wire.sent[0]).toMatchObject({ action: 'craft_recipe' });
    expectNoContainerRevision(wire.sent[0]!, 5);
  });

  it('omits container revision for a normal inventory click after a chest', () => {
    const wire = onlineSend(8);
    const { root, ui } = openWindow('inventory', wire);
    ui.noteInventoryRevisions(6, wire.containerRevision);
    clickSlot(root, 'inventory-0');
    expect(wire.sent).toHaveLength(1);
    expect(wire.sent[0]).toMatchObject({ action: 'click', key: 'inventory-0' });
    expectNoContainerRevision(wire.sent[0]!, 6);
  });

  it('keeps the container revision for a chest click', () => {
    const wire = onlineSend(8);
    const { root, ui } = openWindow('chest', wire);
    ui.noteInventoryRevisions(7, 8);
    clickSlot(root, 'container-0');
    expect(wire.sent[0]).toMatchObject({
      action: 'click',
      key: 'container-0',
      expectedInventoryRevision: 7,
      expectedContainerRevision: 8,
    });
    expect(wire.sent[0]).toBe(wire.handed[0]);
  });

  it('keeps the container revision for a furnace click', () => {
    const wire = onlineSend(3);
    const { root, ui } = openWindow('furnace', wire);
    ui.noteInventoryRevisions(2, 3);
    clickSlot(root, 'furnace-0');
    expect(wire.sent[0]).toMatchObject({
      action: 'click',
      key: 'furnace-0',
      expectedInventoryRevision: 2,
      expectedContainerRevision: 3,
    });
  });

  it('keeps the container revision for a portal chest click', () => {
    const wire = onlineSend(11);
    const { root, ui } = openWindow('portal-chest', wire);
    ui.noteInventoryRevisions(1, 11);
    clickSlot(root, 'container-1');
    expect(wire.sent[0]).toMatchObject({
      action: 'click',
      key: 'container-1',
      expectedInventoryRevision: 1,
      expectedContainerRevision: 11,
    });
  });

  it('drops the hotbar item without a remembered container revision when the window is closed', () => {
    const wire = onlineSend(8);
    const root = document.createElement('div');
    document.body.append(root);
    const ui = new GameUI(root);
    sessions.push(ui);
    ui.noteInventoryRevisions(9, 8);
    const stamped = ui.stampInventorySubmission({
      type: 'inventory_action',
      action: 'drop_selected',
      slot: 0,
      count: 1,
    });
    wire.submitAction(stamped);
    expect(wire.sent[0]).toBe(stamped);
    expect(wire.sent[0]?.requestId).toBe(stamped.requestId);
    expectNoContainerRevision(stamped, 9);
  });

  it('keeps one request id from the UI stamp through the send callback', () => {
    const wire = onlineSend(8);
    const { root, ui } = openWindow('crafting-table', wire);
    ui.noteInventoryRevisions(4, 8);
    const recipe = root.querySelector<HTMLElement>('[data-recipe-toggle]');
    if (!recipe) throw new Error('missing recipe book');
    fire('pointerdown', recipe);
    const entry = root.querySelector<HTMLElement>('[data-recipe-id]');
    if (!entry) throw new Error('missing recipe');
    fire('pointerdown', entry);
    expect(wire.sent).toHaveLength(1);
    expect(wire.sent[0]?.action).toBe('recipe');
    expect(wire.sent[0]).toBe(wire.handed[0]);
    expect(wire.sent[0]?.requestId).toBe(wire.handed[0]?.requestId);
    expectNoContainerRevision(wire.sent[0]!, 4);
    const game = readFileSync('src/core/Game.ts', 'utf8');
    expect(game).toContain('transmitInventoryIntent');
    expect(game).not.toContain('stampInventoryIntent');
    expect(game).toContain('this.ui.stampInventorySubmission');
  });
});
