/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { EmoteSession } from '../src/gameplay/emoteSession';
import { Inventory, createItemStack } from '../src/inventory';
import { InputManager, type InputCallbacks } from '../src/input/InputManager';
import {
  isMobileBreakableTarget,
  resolveMobileTouchIntent,
  type MobileTouchFacts,
} from '../src/input/mobileTouch';
import { shouldSuppressContextMenu } from '../src/input/contextMenu';
import { TOUCH_HOLD_MS, TOUCH_SWIPE_THRESHOLD_PX, emptyHoldCanBecomeSwipe } from '../src/input/touchGesture';
import { pickBuyerInteractTarget } from '../src/net/buyerInteract';
import { GameUI } from '../src/ui/GameUI';
import {
  INVENTORY_TOUCH_DRAG_THRESHOLD_PX,
  catalogTapSuppressed,
  nextCatalogScrollTop,
  stepInventoryGesture,
  type PointerDownContext,
  type PointerSample,
} from '../src/ui/inventoryPointerGesture';
import { emoteTouchSelection } from '../src/ui/emotePointer';
import { auctionBackParent, auctionShowsBack } from '../src/ui/auctionGui';
import type { ClientAuctionActionMessage, ClientInventoryActionMessage, ServerAuctionMessage } from '../shared/protocol';
import type { EmoteId } from '../shared/emotes';

const sessions: GameUI[] = [];

afterEach(() => {
  vi.useRealTimers();
  sessions.splice(0);
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function facts(patch: Partial<MobileTouchFacts> & Pick<MobileTouchFacts, 'phase'>): MobileTouchFacts {
  return {
    attackEntity: false,
    useEntity: false,
    buyerUse: false,
    interactiveBlock: false,
    hasBlockTarget: false,
    breakableBlock: false,
    tapUseItem: false,
    priorityHeldUse: false,
    continuousUse: false,
    ...patch,
  };
}

function installCoarsePointer(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)',
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  }));
}

function pointer(type: string, target: Element, init: PointerEventInit): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', ...init }));
}

describe('mobile interactive blocks', () => {
  it('uses a crafting table on tap and mines it on hold', () => {
    const table = getBlockDefinition(BlockId.CraftingTable);
    const furnace = getBlockDefinition(BlockId.Furnace);
    const chest = getBlockDefinition(BlockId.Chest);
    const bedrock = getBlockDefinition(BlockId.Bedrock);
    for (const definition of [table, furnace, chest]) {
      expect(isMobileBreakableTarget(true, definition)).toBe(true);
      expect(resolveMobileTouchIntent(facts({
        phase: 'tap',
        interactiveBlock: true,
        hasBlockTarget: true,
        breakableBlock: true,
      }))).toBe('use');
      expect(resolveMobileTouchIntent(facts({
        phase: 'hold',
        interactiveBlock: true,
        hasBlockTarget: true,
        breakableBlock: true,
      }))).toBe('mine');
    }
    expect(isMobileBreakableTarget(true, bedrock)).toBe(false);
    expect(resolveMobileTouchIntent(facts({
      phase: 'hold',
      interactiveBlock: false,
      hasBlockTarget: true,
      breakableBlock: false,
    }))).toBe('none');
    expect(resolveMobileTouchIntent(facts({
      phase: 'hold',
      interactiveBlock: true,
      breakableBlock: true,
      priorityHeldUse: true,
    }))).toBe('use-hold');
    expect(resolveMobileTouchIntent(facts({
      phase: 'hold',
      interactiveBlock: true,
      breakableBlock: true,
      bow: true,
      priorityHeldUse: true,
    }))).toBe('bow-hold');
    expect(resolveMobileTouchIntent(facts({
      phase: 'tap',
      interactiveBlock: true,
      hasBlockTarget: true,
      breakableBlock: true,
      tapUseItem: true,
    }))).toBe('use');
    expect(resolveMobileTouchIntent(facts({
      phase: 'hold',
      buyerUse: true,
      breakableBlock: true,
      interactiveBlock: true,
    }))).toBe('use');
  });

  it('starts mining from a hold and use from a tap without doing both', () => {
    installCoarsePointer();
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app"></div><canvas id="game"></canvas>';
    const canvas = document.querySelector('canvas')!;
    let phase: 'tap' | 'hold' = 'tap';
    const aims: Array<{ x: number; y: number }> = [];
    const input = new InputManager(canvas, {
      canCapture: () => true,
      toggleInventory: () => {},
      togglePause: () => {},
      openChat: () => {},
      dropItem: () => {},
      selectHotbar: () => {},
      classifyWorldTouch: (_x, _y, next) => {
        phase = next;
        return next === 'hold'
          ? { intent: 'mine', yaw: 0.2, pitch: -0.1 }
          : { intent: 'use', yaw: 1.1, pitch: 0.3 };
      },
      aimAtClientPoint: (x, y) => {
        aims.push({ x, y });
        return { yaw: x / 100, pitch: y / 100 };
      },
      onPointerLockAcquired: () => {},
      onPointerLockReleased: () => {},
      onPointerLockRequestFailed: () => {},
    } satisfies InputCallbacks);
    const look = document.querySelector('#touch-look-zone')!;

    pointer('pointerdown', look, { pointerId: 4, clientX: 30, clientY: 40 });
    vi.advanceTimersByTime(TOUCH_HOLD_MS);
    expect(phase).toBe('hold');
    expect(input.mining).toBe(true);
    expect(input.usePressed).toBe(false);
    expect(input.interactionLook()).toEqual({ yaw: 0.3, pitch: 0.4 });
    pointer('pointermove', look, { pointerId: 4, clientX: 48, clientY: 70 });
    expect(input.interactionLook()).toEqual({ yaw: 0.48, pitch: 0.7 });
    expect(aims.at(-1)).toEqual({ x: 48, y: 70 });
    pointer('pointerup', look, { pointerId: 4, clientX: 48, clientY: 70 });
    expect(input.mining).toBe(false);
    expect(input.consumeMiningReleased()).toBe(true);
    expect(input.consumeUsePressed()).toBe(false);
    expect(input.consumeAttackPresses()).toBeGreaterThan(0);

    pointer('pointerdown', look, { pointerId: 5, clientX: 12, clientY: 12 });
    pointer('pointerup', look, { pointerId: 5, clientX: 14, clientY: 13 });
    expect(phase).toBe('tap');
    expect(input.mining).toBe(false);
    expect(input.consumeUsePressed()).toBe(true);
    expect(input.consumeAttackPresses()).toBe(0);
    expect(input.interactionLook()).toEqual({ yaw: 1.1, pitch: 0.3 });

    pointer('pointerdown', look, { pointerId: 6, clientX: 20, clientY: 20 });
    vi.advanceTimersByTime(TOUCH_HOLD_MS);
    expect(input.mining).toBe(true);
    pointer('pointercancel', look, { pointerId: 6, clientX: 20, clientY: 20 });
    expect(input.mining).toBe(false);
    expect(input.consumeMiningReleased()).toBe(true);
    expect(input.consumeUsePressed()).toBe(false);
    expect(input.consumeAttackPresses()).toBeGreaterThan(0);

    pointer('pointerdown', look, { pointerId: 7, clientX: 8, clientY: 8 });
    pointer('pointercancel', look, { pointerId: 7, clientX: 8, clientY: 8 });
    expect(input.consumeUsePressed()).toBe(false);
    expect(input.consumeAttackPresses()).toBe(0);
  });
});

describe('buyer touch target', () => {
  it('picks the nearest buyer and rejects walls, reach misses, and nearer entities', () => {
    expect(pickBuyerInteractTarget({
      buyers: [{ id: 'far', distance: 3.2 }, { id: 'near', distance: 1.4 }],
    })?.id).toBe('near');
    expect(pickBuyerInteractTarget({
      buyers: [{ id: 'near', distance: 2 }],
      occluderDistance: 0.8,
    })).toBeUndefined();
    expect(pickBuyerInteractTarget({
      buyers: [],
      hologram: { name: 'shop', distance: 2.2 },
      buyerIdForHologram: (name) => (name === 'shop' ? 'buyer' : undefined),
    })?.id).toBe('buyer');
    expect(pickBuyerInteractTarget({
      buyers: [],
      hologram: { name: 'sign', distance: 1 },
      buyerIdForHologram: () => undefined,
    })).toBeUndefined();
    expect(pickBuyerInteractTarget({ buyers: [] })).toBeUndefined();
    expect(resolveMobileTouchIntent(facts({ phase: 'tap', buyerUse: true }))).toBe('use');
    expect(resolveMobileTouchIntent(facts({ phase: 'tap', buyerUse: false, attackEntity: true }))).toBe('attack');
  });
});

describe('creative catalog scroll', () => {
  const creative: PointerDownContext = {
    cursorOccupied: false,
    sourceOccupied: false,
    sourceClass: 'creative',
    allowLongPress: false,
    catalogScroll: true,
  };

  function sample(patch: Partial<PointerSample> = {}): PointerSample {
    return {
      pointerId: 1,
      pointerClass: 'coarse',
      x: 40,
      y: 80,
      button: 'left',
      shift: false,
      zone: 'slot',
      slotKey: 'creative-3',
      now: 0,
      ...patch,
    };
  }

  it('scrolls on a vertical swipe and still taps a still finger', () => {
    expect(nextCatalogScrollTop(10, 400, 100, -25)).toBe(35);
    expect(nextCatalogScrollTop(35, 400, 100, 25)).toBe(10);
    expect(nextCatalogScrollTop(0, 400, 100, 40)).toBe(0);
    expect(nextCatalogScrollTop(290, 400, 100, -40)).toBe(300);

    const started = stepInventoryGesture(null, { type: 'down', sample: sample(), context: creative });
    const scrolled = stepInventoryGesture(started.gesture, {
      type: 'move',
      sample: sample({ y: 80 - (INVENTORY_TOUCH_DRAG_THRESHOLD_PX + 12) }),
    });
    expect(scrolled.gesture?.phase).toBe('scroll');
    expect(scrolled.effects).toEqual([]);
    expect(catalogTapSuppressed({
      cancelled: false,
      verticalTravel: -(INVENTORY_TOUCH_DRAG_THRESHOLD_PX + 12),
      horizontalTravel: 0,
      scrollDelta: 20,
    })).toBe(true);
    expect(catalogTapSuppressed({
      cancelled: true,
      verticalTravel: 1,
      horizontalTravel: 0,
      scrollDelta: 0,
    })).toBe(true);
    expect(catalogTapSuppressed({
      cancelled: false,
      verticalTravel: 2,
      horizontalTravel: 1,
      scrollDelta: 0,
    })).toBe(false);
    const released = stepInventoryGesture(scrolled.gesture, {
      type: 'up',
      sample: sample({ y: 40 }),
    });
    expect(released.effects).toEqual([]);

    const down = stepInventoryGesture(null, { type: 'down', sample: sample(), context: creative });
    const tap = stepInventoryGesture(down.gesture, {
      type: 'up',
      sample: sample({ y: 80 + INVENTORY_TOUCH_DRAG_THRESHOLD_PX - 1 }),
    });
    expect(tap.effects).toEqual([{ type: 'click', key: 'creative-3', button: 'left', shift: false }]);

    const pending = stepInventoryGesture(null, { type: 'down', sample: sample(), context: creative });
    const fast = stepInventoryGesture(pending.gesture, {
      type: 'move',
      sample: sample({ y: 10 }),
    });
    const cancelled = stepInventoryGesture(fast.gesture, { type: 'cancel' });
    expect(cancelled.effects).toEqual([{ type: 'cancel' }]);
    expect(cancelled.effects.some((effect) => effect.type === 'click')).toBe(false);
  });

  it('changes the catalog scrollTop from a swipe and does not grant an item', () => {
    installCoarsePointer();
    const root = document.createElement('div');
    document.body.append(root);
    const messages: ClientInventoryActionMessage[] = [];
    const ui = new GameUI(root);
    sessions.push(ui);
    ui.openInventory({
      inventory: new Inventory(),
      mode: 'creative',
      kind: 'inventory',
      onClose() {},
      onDrop() {},
      onChanged() {},
      submitAction: (message) => messages.push(message),
    });
    const catalog = root.querySelector<HTMLElement>('[data-creative-catalog]')!;
    const slot = catalog.querySelector<HTMLElement>('[data-slot]')!;
    expect(slot.querySelector('img')).toBeTruthy();
    let hit: Element | null = slot;
    document.elementFromPoint = () => hit;
    document.elementsFromPoint = () => (hit ? [hit] : []);
    Object.defineProperty(catalog, 'scrollHeight', { configurable: true, get: () => 480 });
    Object.defineProperty(catalog, 'clientHeight', { configurable: true, get: () => 90 });
    pointer('pointerdown', slot, { pointerId: 9, clientX: 30, clientY: 120, button: 0 });
    catalog.scrollTop = 48;
    catalog.dispatchEvent(new Event('scroll'));
    pointer('pointermove', root.querySelector('.mc-backdrop')!, { pointerId: 9, clientX: 32, clientY: 70, button: 0 });
    expect(catalog.scrollTop).toBe(48);
    pointer('pointerup', root.querySelector('.mc-backdrop')!, { pointerId: 9, clientX: 32, clientY: 70, button: 0 });
    expect(messages).toEqual([]);

    pointer('pointerdown', slot, { pointerId: 10, clientX: 30, clientY: 120, button: 0 });
    pointer('pointerup', slot, { pointerId: 10, clientX: 31, clientY: 122, button: 0 });
    expect(messages).toEqual([expect.objectContaining({ action: 'click', key: slot.getAttribute('data-slot') })]);

    messages.length = 0;
    catalog.scrollTop = 40;
    pointer('pointerdown', slot, { pointerId: 11, clientX: 30, clientY: 40, button: 0 });
    pointer('pointermove', root.querySelector('.mc-backdrop')!, { pointerId: 11, clientX: 28, clientY: 90, button: 0 });
    expect(catalog.scrollTop).toBe(40);
    pointer('pointercancel', root.querySelector('.mc-backdrop')!, { pointerId: 11, clientX: 28, clientY: 90 });
    expect(messages).toEqual([]);

    const survivalRoot = document.createElement('div');
    document.body.append(survivalRoot);
    const inventory = new Inventory();
    inventory.setSlot(9, createItemStack('stone', 4));
    const survivalMessages: ClientInventoryActionMessage[] = [];
    const survival = new GameUI(survivalRoot);
    sessions.push(survival);
    survival.openInventory({
      inventory,
      mode: 'survival',
      kind: 'inventory',
      onClose() {},
      onDrop() {},
      onChanged() {},
      submitAction: (message) => survivalMessages.push(message),
    });
    const from = survivalRoot.querySelector<HTMLElement>('[data-slot="inventory-9"]');
    const to = survivalRoot.querySelector<HTMLElement>('[data-slot="inventory-10"]');
    expect(from?.getAttribute('data-slot')).toBe('inventory-9');
    expect(to?.getAttribute('data-slot')).toBe('inventory-10');
    hit = to;
    const survivalModal = survivalRoot.querySelector('.mc-backdrop')!;
    pointer('pointerdown', from!, { pointerId: 12, clientX: 220, clientY: 220, button: 0 });
    pointer('pointermove', survivalModal, {
      pointerId: 12,
      clientX: 280,
      clientY: 224,
      button: 0,
    });
    pointer('pointerup', survivalModal, { pointerId: 12, clientX: 280, clientY: 224, button: 0 });
    expect(survivalMessages).toEqual([
      expect.objectContaining({ action: 'move_stack', sourceKey: 'inventory-9', targetKey: 'inventory-10' }),
    ]);
  });
});

describe('mobile emote button', () => {
  function box(left: number, top: number, width: number, height: number): DOMRect {
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON() { return {}; },
    } as DOMRect;
  }

  it('opens the wheel from the button and starts the touched sector once', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const ui = new GameUI(root);
    sessions.push(ui);
    const button = root.querySelector<HTMLButtonElement>('#hud-emote')!;
    const disc = root.querySelector<HTMLElement>('.emote-disc')!;
    expect(button.tagName).toBe('BUTTON');
    button.getBoundingClientRect = () => box(700, 8, 48, 48);
    disc.getBoundingClientRect = () => box(100, 100, 200, 200);
    const session = new EmoteSession();
    const sent: Array<{ action: 'start' | 'stop'; id?: EmoteId }> = [];
    ui.onEmoteOpen = () => {
      if (!session.tryOpen(true)) return;
      ui.showEmoteWheel();
      ui.setEmoteWheelSelection(null);
    };
    ui.onEmotePoint = (dx, dy) => {
      ui.setEmoteWheelSelection(session.point(dx, dy, ui.emoteWheelRadius() || 100));
    };
    ui.onEmoteCommit = () => {
      const id = session.release();
      ui.hideEmoteWheel();
      if (id) sent.push({ action: 'start', id });
    };
    ui.onEmoteAbort = () => {
      if (session.phaseName !== 'wheel') return;
      session.point(0, 0, 100);
      session.release();
      ui.hideEmoteWheel();
    };

    let worldHits = 0;
    document.addEventListener('pointerdown', () => { worldHits += 1; });
    pointer('pointerdown', button, { pointerId: 1, clientX: 720, clientY: 24, button: 0 });
    pointer('pointerup', button, { pointerId: 1, clientX: 720, clientY: 24, button: 0 });
    expect(ui.isEmoteWheelOpen()).toBe(true);
    expect(session.phaseName).toBe('wheel');
    expect(sent).toEqual([]);

    const sectors: Array<[number, number, EmoteId]> = [
      [200, 120, 'wave'],
      [280, 200, 'celebrate'],
      [200, 280, 'point'],
      [120, 200, 'bow'],
    ];
    for (const [x, y, id] of sectors) {
      if (!ui.isEmoteWheelOpen()) {
        pointer('pointerdown', button, { pointerId: 2, clientX: 720, clientY: 24, button: 0 });
        pointer('pointerup', button, { pointerId: 2, clientX: 720, clientY: 24, button: 0 });
      }
      const wheel = root.querySelector('#emote-wheel')!;
      pointer('pointerdown', wheel, { pointerId: 3, clientX: x, clientY: y, button: 0 });
      expect(root.querySelector('.emote-disc')?.getAttribute('data-selected')).toBe(id);
      pointer('pointerup', wheel, { pointerId: 3, clientX: x, clientY: y, button: 0 });
      expect(sent.at(-1)).toEqual({ action: 'start', id });
      session.cancel();
    }
    expect(sent).toHaveLength(4);

    pointer('pointerdown', button, { pointerId: 4, clientX: 720, clientY: 24, button: 0 });
    pointer('pointerup', button, { pointerId: 4, clientX: 720, clientY: 24, button: 0 });
    const wheel = root.querySelector('#emote-wheel')!;
    pointer('pointerdown', wheel, { pointerId: 5, clientX: 200, clientY: 200, button: 0 });
    pointer('pointerup', wheel, { pointerId: 5, clientX: 200, clientY: 200, button: 0 });
    expect(session.phaseName).toBe('idle');
    expect(sent).toHaveLength(4);

    pointer('pointerdown', button, { pointerId: 6, clientX: 720, clientY: 24, button: 0 });
    pointer('pointerup', button, { pointerId: 6, clientX: 720, clientY: 24, button: 0 });
    pointer('pointerdown', wheel, { pointerId: 7, clientX: 280, clientY: 200, button: 0 });
    pointer('pointercancel', wheel, { pointerId: 7, clientX: 280, clientY: 200 });
    expect(session.phaseName).toBe('idle');
    expect(sent).toHaveLength(4);
    expect(ui.isEmoteWheelOpen()).toBe(false);
    expect(worldHits).toBe(0);

    expect(emoteTouchSelection(box(100, 100, 200, 200), 200, 120).id).toBe('wave');
    expect(emoteTouchSelection(box(100, 100, 200, 200), 200, 200).id).toBeNull();
    expect(emoteTouchSelection(box(100, 100, 200, 200), 20, 20).inside).toBe(false);
  });
});

describe('auction navigation chrome', () => {
  function state(patch: Partial<ServerAuctionMessage>): ServerAuctionMessage {
    return {
      type: 'auction',
      screen: 'browse',
      title: 'Аукцион',
      search: '',
      page: 1,
      totalPages: 1,
      totalCount: 0,
      listings: [],
      ...patch,
    };
  }

  it('maps every back parent and paints one control', () => {
    expect(auctionBackParent('browse', 'menu')).toBe('menu');
    expect(auctionBackParent('mine', 'menu')).toBe('menu');
    expect(auctionBackParent('sell-pick', 'menu')).toBe('menu');
    expect(auctionBackParent('browse', undefined)).toBeNull();
    expect(auctionBackParent('buy', undefined)).toBe('browse');
    expect(auctionBackParent('sell-confirm', 'menu')).toBe('sell-pick');
    expect(auctionBackParent('manage', 'menu')).toBe('mine');
    expect(auctionBackParent('claim', undefined)).toBe('mine');
    expect(auctionBackParent('relist', 'menu')).toBe('mine');
    expect(auctionShowsBack('closed', 'menu')).toBe(false);

    const root = document.createElement('div');
    document.body.append(root);
    const sent: ClientAuctionActionMessage[] = [];
    const ui = new GameUI(root);
    sessions.push(ui);
    const actions = {
      send: (message: ClientAuctionActionMessage) => sent.push(message),
      close: () => sent.push({ type: 'auction_action', action: 'close' }),
    };
    ui.openAuction(state({ screen: 'browse' }), actions);
    expect(root.querySelector('[data-ah-action="back"]')).toBeNull();
    ui.openAuction(state({ screen: 'browse', source: 'menu' }), actions);
    expect(root.querySelectorAll('[data-ah-action="back"]')).toHaveLength(1);
    expect(root.querySelector('.mc-ah-back-row [aria-label="Назад"]')).toBeTruthy();
    root.querySelector<HTMLButtonElement>('[data-ah-action="back"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-ui="close"]')!.click();
    expect(sent.map((message) => message.action)).toEqual(['back', 'close']);

    sent.length = 0;
    ui.openAuction(state({
      screen: 'buy',
      title: 'Покупка',
      selected: { prompt: 'Купить?', amount: 1 },
    }), actions);
    expect(root.querySelectorAll('[data-ah-action="back"]')).toHaveLength(1);
    expect(root.textContent).not.toContain('ОТМЕНА');
    ui.openAuction(state({ screen: 'buy', title: 'Покупка', source: 'menu' }), actions);
    expect(root.querySelectorAll('[data-ah-action="back"]')).toHaveLength(1);
    root.querySelector<HTMLButtonElement>('[data-ah-action="back"]')!.click();
    expect(sent).toEqual([{ type: 'auction_action', action: 'back' }]);
  });
});

describe('follow-up mobile ownership and readable menus', () => {
  it('keeps the joystick and the jump button on the first finger', () => {
    installCoarsePointer();
    document.body.innerHTML = '<div id="app"></div><canvas></canvas>';
    const input = new InputManager(document.querySelector('canvas')!, {
      canCapture: () => true,
      toggleInventory: () => {},
      togglePause: () => {},
      openChat: () => {},
      dropItem: () => {},
      selectHotbar: () => {},
      onPointerLockAcquired: () => {},
      onPointerLockReleased: () => {},
      onPointerLockRequestFailed: () => {},
    });
    const stick = document.querySelector<HTMLElement>('#touch-joystick')!;
    stick.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 120, height: 120, right: 120, bottom: 120, x: 0, y: 0, toJSON() { return {}; },
    }) as DOMRect;
    const jump = document.querySelector<HTMLButtonElement>('button[data-action="jump"]')!;
    pointer('pointerdown', stick, { pointerId: 1, clientX: 80, clientY: 40, button: 0 });
    const owned = input.movement().forward;
    pointer('pointerdown', stick, { pointerId: 2, clientX: 20, clientY: 120, button: 0 });
    expect(input.movement().forward).toBeCloseTo(owned, 5);
    pointer('pointermove', stick, { pointerId: 2, clientX: 20, clientY: 140, button: 0 });
    expect(input.movement().forward).toBeCloseTo(owned, 5);
    pointer('pointerup', stick, { pointerId: 2, clientX: 20, clientY: 140, button: 0 });
    expect(input.movement().forward).toBeCloseTo(owned, 5);
    pointer('pointermove', stick, { pointerId: 1, clientX: 80, clientY: 20, button: 0 });
    expect(input.movement().forward).not.toBeCloseTo(owned, 5);
    pointer('pointerup', stick, { pointerId: 1, clientX: 80, clientY: 20, button: 0 });
    expect(input.movement().forward).toBe(0);
    expect(input.movement().sprint).toBe(false);

    pointer('pointerdown', stick, { pointerId: 3, clientX: 70, clientY: 30, button: 0 });
    expect(input.movement().forward).not.toBe(0);
    stick.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 3 }));
    expect(input.movement().forward).toBe(0);

    pointer('pointerdown', jump, { pointerId: 4, clientX: 10, clientY: 10, button: 0 });
    expect(input.movement().manualJump).toBe(true);
    pointer('pointerdown', jump, { pointerId: 5, clientX: 12, clientY: 12, button: 0 });
    pointer('pointerup', jump, { pointerId: 5, clientX: 12, clientY: 12, button: 0 });
    expect(input.movement().manualJump).toBe(true);
    pointer('pointerup', jump, { pointerId: 4, clientX: 10, clientY: 10, button: 0 });
    expect(input.movement().manualJump).toBe(false);
    pointer('pointerdown', jump, { pointerId: 6, clientX: 10, clientY: 10, button: 0 });
    jump.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 6 }));
    expect(input.movement().manualJump).toBe(false);
  });

  it('turns an empty hold into a camera swipe and leaves a mining hold alone', () => {
    expect(emptyHoldCanBecomeSwipe('none', TOUCH_SWIPE_THRESHOLD_PX)).toBe(true);
    expect(emptyHoldCanBecomeSwipe('mine', TOUCH_SWIPE_THRESHOLD_PX + 40)).toBe(false);
    expect(emptyHoldCanBecomeSwipe('bow-hold', 80)).toBe(false);
    expect(emptyHoldCanBecomeSwipe('use-hold', 80)).toBe(false);
    installCoarsePointer();
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app"></div><canvas></canvas>';
    const canvas = document.querySelector('canvas')!;
    let yawBefore = 0;
    const input = new InputManager(canvas, {
      canCapture: () => true,
      toggleInventory: () => {},
      togglePause: () => {},
      openChat: () => {},
      dropItem: () => {},
      selectHotbar: () => {},
      classifyWorldTouch: (_x, _y, phase) => phase === 'hold'
        ? { intent: 'none', yaw: 0, pitch: 0 }
        : { intent: 'none', yaw: 0, pitch: 0 },
      onPointerLockAcquired: () => {},
      onPointerLockReleased: () => {},
      onPointerLockRequestFailed: () => {},
    });
    const look = document.querySelector('#touch-look-zone')!;
    const miningLook = (): Element => {
      const zones = document.querySelectorAll('#touch-look-zone');
      return zones.item(zones.length - 1);
    };
    pointer('pointerdown', look, { pointerId: 1, clientX: 40, clientY: 40 });
    vi.advanceTimersByTime(TOUCH_HOLD_MS);
    expect(input.mining).toBe(false);
    yawBefore = input.yaw;
    pointer('pointermove', look, { pointerId: 1, clientX: 40 + TOUCH_SWIPE_THRESHOLD_PX + 8, clientY: 40 });
    expect(input.yaw).not.toBeCloseTo(yawBefore, 5);
    expect(input.consumeUsePressed()).toBe(false);
    expect(input.consumeAttackPresses()).toBe(0);
    pointer('pointerup', look, { pointerId: 1, clientX: 80, clientY: 40 });
    expect(input.consumeUsePressed()).toBe(false);

    const mining = new InputManager(canvas, {
      canCapture: () => true,
      toggleInventory: () => {},
      togglePause: () => {},
      openChat: () => {},
      dropItem: () => {},
      selectHotbar: () => {},
      classifyWorldTouch: () => ({ intent: 'mine', yaw: 0.2, pitch: 0 }),
      onPointerLockAcquired: () => {},
      onPointerLockReleased: () => {},
      onPointerLockRequestFailed: () => {},
    });
    pointer('pointerdown', miningLook(), { pointerId: 2, clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(TOUCH_HOLD_MS);
    expect(mining.mining).toBe(true);
    const heldYaw = mining.yaw;
    pointer('pointermove', miningLook(), { pointerId: 2, clientX: 80, clientY: 10 });
    expect(mining.mining).toBe(true);
    expect(mining.yaw).toBeCloseTo(heldYaw, 5);
  });

  it('keeps the same home-name field when a server echo arrives', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const ui = new GameUI(root);
    sessions.push(ui);
    const sent: string[] = [];
    const base = {
      type: 'menu' as const,
      screen: 'homes' as const,
      title: 'Дома',
      homes: [] as Array<{ name: string; x: number; y: number; z: number }>,
      homeNameText: '',
      homeCount: 0,
      homeMax: 3,
      message: '',
    };
    ui.openGameMenu(base, {
      send: (message) => sent.push(message.action),
      close() {},
    });
    const input = root.querySelector<HTMLInputElement>('[data-menu-home-name]');
    expect(input).toBeTruthy();
    input!.focus();
    input!.value = 'Дом';
    input!.setSelectionRange(3, 3);
    input!.dispatchEvent(new Event('input'));
    expect(sent).toEqual(['set_home_name']);
    ui.applyGameMenu({
      ...base,
      homeNameText: 'Д',
      message: 'Проверка',
      homes: [{ name: 'Лес', x: 1, y: 2, z: 3 }],
      homeCount: 1,
    });
    expect(root.querySelector('[data-menu-home-name]')).toBe(input);
    expect(input!.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input!.value).toBe('Дом');
    expect(input!.selectionStart).toBe(3);
    expect(root.querySelector('.mc-menu-list')?.textContent).toContain('Лес');
    expect(root.querySelector('.mc-menu-count')?.textContent).toContain('1/3');
    expect(root.querySelector('[data-menu-message]')?.textContent).toBe('Проверка');
    expect(sent).toEqual(['set_home_name']);
    ui.applyGameMenu({ ...base, screen: 'friends', title: 'Друзья' });
    expect(document.activeElement).not.toBe(input);
    expect(input!.isConnected).toBe(false);
    expect(root.querySelector('[data-menu-screen="friends"]')).toBeTruthy();
  });

  it('rescales an open creative catalog without clearing its scroll or granting an item', () => {
    installCoarsePointer();
    const root = document.createElement('div');
    document.body.append(root);
    const messages: ClientInventoryActionMessage[] = [];
    const ui = new GameUI(root);
    sessions.push(ui);
    ui.openInventory({
      inventory: new Inventory(),
      mode: 'creative',
      kind: 'inventory',
      onClose() {},
      onDrop() {},
      onChanged() {},
      submitAction: (message) => messages.push(message),
    });
    const catalog = root.querySelector<HTMLElement>('[data-creative-catalog]')!;
    catalog.scrollTop = 36;
    const stage = root.querySelector<HTMLElement>('.mc-stage')!;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 740 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 360 });
    ui.relayoutOpenOverlays();
    expect(catalog.scrollTop).toBe(36);
    expect(stage.style.getPropertyValue('--mc-ui-scale')).not.toBe('');
    expect(root.querySelector('[data-creative-tab="catalog"]')).toBeTruthy();
    expect(messages).toEqual([]);
    ui.relayoutOpenOverlays();
    expect(messages).toEqual([]);
  });

  it('allows the browser menu on text fields and blocks it on the canvas', () => {
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const canvas = document.createElement('canvas');
    expect(shouldSuppressContextMenu(input)).toBe(false);
    expect(shouldSuppressContextMenu(area)).toBe(false);
    expect(shouldSuppressContextMenu(canvas)).toBe(true);
  });
});
