import { createItemStack, Inventory } from '../inventory';
import type { WorldSummary } from '../save/types';
import { GameUI } from '../ui/GameUI';
import type { ServerMenuMessage, ServerTradeMessage } from '../../shared/protocol';
import { HOME_MAX_DEFAULT } from '../../shared/homes';
import { TRADE_SLOT_COUNT } from '../../shared/trade';

export type UiQaScene =
  | 'loading'
  | 'hud-full'
  | 'hud-low'
  | 'hud-absorption'
  | 'creative'
  | 'world-list'
  | 'menu-root'
  | 'menu-homes'
  | 'menu-friends'
  | 'menu-trade'
  | 'trade-session'
  | 'chat-open'
  | 'pause';

const HUD_ITEMS = [
  ['tnt', 64],
  ['flint_and_steel', 1],
  ['bow', 1],
  ['arrow', 64],
  ['torch', 54],
  ['iron_pickaxe', 1],
  ['iron_shovel', 1],
  ['dirt', 8],
  ['golden_apple', 7],
] as const;

function fixtureInventory(): Inventory {
  const inventory = new Inventory();
  HUD_ITEMS.forEach(([itemId, count], index) => {
    const stack = itemId === 'iron_pickaxe'
      ? createItemStack(itemId, count, { durability: 40 })
      : createItemStack(itemId, count);
    inventory.setSlot(index, stack);
  });
  inventory.setSlot({ section: 'armor', slot: 'head' }, createItemStack('diamond_helmet', 1, { durability: 80 }));
  inventory.setSlot({ section: 'armor', slot: 'chest' }, createItemStack('diamond_chestplate', 1, { durability: 120 }));
  inventory.setSlot({ section: 'armor', slot: 'legs' }, createItemStack('diamond_leggings', 1, { durability: 90 }));
  inventory.setSlot({ section: 'armor', slot: 'feet' }, createItemStack('diamond_boots', 1, { durability: 40 }));
  inventory.setSlot(9, createItemStack('iron_helmet', 1, { durability: 40 }));
  inventory.setSlot(10, createItemStack('potion_repair', 8));
  return inventory;
}

function fixtureWorlds(now = Date.UTC(2026, 7, 30)): WorldSummary[] {
  return [
    { id: 'qa-new', name: 'Новый мир', seed: '1575551675', mode: 'creative', createdAt: now, updatedAt: now, playTimeSeconds: 33 * 60 },
    { id: 'qa-mobs', name: 'Visual QA: мобы', seed: 'visual-parity-mobs', mode: 'creative', createdAt: now - 86_400_000, updatedAt: now - 3 * 86_400_000, playTimeSeconds: 14 * 60 },
    { id: 'qa-survival', name: 'Таёжный рубеж', seed: '72349282', mode: 'survival', createdAt: now - 8 * 86_400_000, updatedAt: now - 4 * 86_400_000, playTimeSeconds: 5 * 60 },
    { id: 'qa-lever', name: 'Visual QA: рычаг', seed: 'visual-parity-lever', mode: 'creative', createdAt: now - 14 * 86_400_000, updatedAt: now - 14 * 86_400_000, playTimeSeconds: 60 },
  ];
}

export function startUiQaHarness(canvas: HTMLCanvasElement, uiRoot: HTMLElement, scene: UiQaScene): () => void {
  const previousCanvasStyle = canvas.getAttribute('style');
  canvas.style.background = scene === 'pause'
    ? 'linear-gradient(180deg, #6eb7ff 0 42%, #7bc15a 42% 58%, #4a8a3a 58% 78%, #2f5c28 78% 100%)'
    : `linear-gradient(rgba(4, 11, 10, 0.28), rgba(4, 11, 10, 0.48)), url('${import.meta.env.BASE_URL}ui/frontier-menu-background.png') center / cover`;
  const ui = new GameUI(uiRoot);
  const inventory = fixtureInventory();

  const showHud = (health: number, hunger: number, absorption = 0): void => {
    ui.enterGame();
    ui.updateHud({
      inventory,
      selectedSlot: 2,
      health,
      hunger,
      armor: 20,
      absorption,
      miningProgress: 0,
    });
  };

  const menuActions = { send: () => {}, close: () => {} };
  const openMenu = (state: ServerMenuMessage): void => {
    showHud(20, 20);
    ui.openGameMenu(state, menuActions);
  };

  if (scene === 'loading') {
    ui.showLoading('Расчёт освещения', 79, 'Подготавливаем чанки…');
  } else if (scene === 'hud-full') {
    showHud(20, 20);
  } else if (scene === 'hud-low') {
    showHud(1, 1);
  } else if (scene === 'hud-absorption') {
    showHud(19, 17, 4);
  } else if (scene === 'creative') {
    ui.enterGame();
    ui.openInventory({
      inventory,
      mode: 'creative',
      kind: 'inventory',
      onClose: () => {
        ui.closeInventory(false);
        showHud(20, 20);
      },
      onDrop: () => {},
      onChanged: () => {},
    });
  } else if (scene === 'menu-root') {
    openMenu({
      type: 'menu',
      screen: 'root',
      title: 'Меню',
      balance: 5645,
      balanceLabel: '5 645',
    });
  } else if (scene === 'menu-homes') {
    openMenu({
      type: 'menu',
      screen: 'homes',
      title: 'Дома',
      homeCount: 2,
      homeMax: HOME_MAX_DEFAULT,
      homes: [
        { name: 'Дом', x: 12, y: 70, z: -4 },
        { name: 'Шахта', x: 40, y: 64, z: 18 },
      ],
    });
  } else if (scene === 'menu-friends') {
    openMenu({
      type: 'menu',
      screen: 'friends',
      title: 'Друзья',
      allowFriendTeleport: true,
      friendCount: 4,
      friendMax: 50,
      friends: [
        { playerId: '1', name: 'ViBeMiXoS1K', online: true, canTeleport: true },
        { playerId: '2', name: 'PlayerOne', online: true, canTeleport: true },
        { playerId: '3', name: 'BestFriend', online: false, canTeleport: false },
        { playerId: '4', name: 'AnotherPlayer', online: false, canTeleport: false },
      ],
    });
  } else if (scene === 'menu-trade') {
    openMenu({
      type: 'menu',
      screen: 'trade',
      title: 'Обмен',
      tradeNearby: [
        { playerId: '1', name: 'PlayerOne', distance: 5 },
        { playerId: '2', name: 'NotchFan', distance: 12 },
        { playerId: '3', name: 'Steve123', distance: 18 },
      ],
    });
  } else if (scene === 'trade-session') {
    showHud(20, 20);
    const emptySlots = Array.from({ length: TRADE_SLOT_COUNT }, () => null);
    const trade: ServerTradeMessage = {
      type: 'trade',
      screen: 'session',
      title: 'Обмен',
      partnerName: 'Bob',
      selfReady: false,
      partnerReady: false,
      bothReady: false,
      money: 100,
      moneyText: '100',
      partnerMoney: 500,
      partnerMoneyText: '500',
      selfSlots: emptySlots,
      partnerSlots: emptySlots,
      inventorySlots: Array.from({ length: 36 }, () => null),
    };
    ui.openTrade(trade, { send: () => {}, close: () => {} });
  } else if (scene === 'chat-open') {
    showHud(20, 20);
    ui.appendChat({ id: '1', kind: 'player', text: 'Привет, как дела?', createdAtMs: Date.now(), channel: 'global', from: 'Ada' });
    ui.appendChat({ id: '2', kind: 'player', text: 'Рядом есть железо', createdAtMs: Date.now(), channel: 'nearby', from: 'Bob' });
    ui.appendChat({ id: '3', kind: 'system', text: 'Добро пожаловать на сервер.', createdAtMs: Date.now() });
    ui.openChat();
  } else if (scene === 'pause') {
    showHud(20, 20);
    ui.showPause({
      resume: () => undefined,
      settings: () => undefined,
      saveAndQuit: () => undefined,
    });
  } else {
    let worlds = fixtureWorlds();
    const renderWorlds = (): void => ui.showWorldList(worlds, {
      load: (id) => ui.toast(`Загрузка: ${worlds.find((world) => world.id === id)?.name ?? id}`),
      create: () => ui.toast('Создание мира'),
      delete: (id) => {
        worlds = worlds.filter((world) => world.id !== id);
        renderWorlds();
      },
      back: () => ui.toast('Назад'),
    });
    renderWorlds();
  }

  return () => {
    ui.closeInventory(false);
    uiRoot.replaceChildren();
    if (previousCanvasStyle === null) canvas.removeAttribute('style');
    else canvas.setAttribute('style', previousCanvasStyle);
  };
}
