import { createItemStack, Inventory } from '../inventory';
import type { WorldSummary } from '../save/types';
import { GameUI } from '../ui/GameUI';
import type { ClientClanActionMessage, ClientMenuActionMessage, ServerClanMessage, ServerMenuMessage, ServerTradeMessage } from '../../shared/protocol';
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
  | 'menu-rating'
  | 'clan-ranking'
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

  const menuActions = {
    send: (action: ClientMenuActionMessage) => {
      if (action.action === 'open' && action.screen === 'rating') {
        openMenu(ratingState());
        return;
      }
      if (action.action === 'rating_set' && action.ratingKind) {
        openMenu({ ...ratingState(), ratingKind: action.ratingKind as ServerMenuMessage['ratingKind'] });
        return;
      }
      if (action.action === 'back' || action.action === 'open') {
        openMenu({
          type: 'menu',
          screen: 'root',
          title: 'Меню',
          balance: 5645,
          balanceLabel: '5 645',
        });
      }
    },
    close: () => ui.closeGameMenu(),
  };
  const openMenu = (state: ServerMenuMessage): void => {
    showHud(20, 20);
    ui.openGameMenu(state, menuActions);
  };

  function ratingState(): ServerMenuMessage {
    return {
      type: 'menu',
      screen: 'rating',
      title: 'Рейтинг',
      ratingKind: 'players-money',
      ratingPage: 1,
      ratingTotalPages: 1,
      ratingRows: [
        { rank: 1, id: 'a', name: 'Ada', value: 5645, valueLabel: '5 645', metric: 'money', highlight: true },
        { rank: 2, id: 'b', name: 'Bob', value: 900, valueLabel: '900', metric: 'money', highlight: false },
      ],
      personalRank: 1,
      personalText: 'Ваше место: #1',
    };
  }

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
  } else if (scene === 'menu-rating') {
    openMenu(ratingState());
  } else if (scene === 'clan-ranking') {
    showHud(20, 20);
    const ranking: ServerClanMessage = {
      type: 'clan',
      screen: 'ranking',
      title: 'Кланы',
      search: '',
      page: 1,
      totalPages: 1,
      totalCount: 2,
      rankingSort: 'money',
      source: 'menu',
      clans: [
        {
          clanId: 'clan-1',
          name: '123',
          icon: 'flame',
          rank: 1,
          totalBalance: 185900,
          totalLabel: '185.9К',
          totalKills: 12,
          killsLabel: '🗡️ 12 Уб.',
          memberCount: 1,
          createdAt: 1,
          sort: 'money',
        },
        {
          clanId: 'clan-2',
          name: 'test',
          icon: 'crown',
          rank: 2,
          totalBalance: 90100,
          totalLabel: '90.1К',
          totalKills: 3,
          killsLabel: '🗡️ 3 Уб.',
          memberCount: 1,
          createdAt: 2,
          sort: 'money',
        },
      ],
    };
    const clanActions = {
      send: (action: ClientClanActionMessage) => {
        if (action.action === 'set_ranking_sort' && (action.sort === 'money' || action.sort === 'kills')) {
          const sorted = [...ranking.clans]
            .sort((a, b) => (action.sort === 'kills'
              ? (b.totalKills ?? 0) - (a.totalKills ?? 0)
              : b.totalBalance - a.totalBalance))
            .map((row, index) => ({ ...row, rank: index + 1, sort: action.sort as 'money' | 'kills' }));
          ui.openClan({
            ...ranking,
            rankingSort: action.sort,
            clans: sorted,
          }, clanActions);
          return;
        }
        if (action.action === 'select_clan' && action.clanId) {
          const row = ranking.clans.find((entry) => entry.clanId === action.clanId);
          ui.openClan({
            ...ranking,
            screen: 'card',
            title: row?.name ?? 'Клан',
            card: {
              clanId: action.clanId,
              name: row?.name ?? 'Клан',
              icon: row?.icon ?? 'swords',
              totalBalance: row?.totalBalance ?? 0,
              totalLabel: row?.totalLabel ?? '0',
              memberCount: row?.memberCount ?? 1,
              ownerId: 'a',
              ownerName: 'Ada',
              isOwner: false,
              isMember: false,
              isFull: false,
              joinState: 'none',
            },
            members: [],
          }, clanActions);
          return;
        }
        if (action.action === 'back') {
          ui.openClan(ranking, clanActions);
        }
      },
      close: () => ui.closeClan(),
    };
    ui.openClan(ranking, clanActions);
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
