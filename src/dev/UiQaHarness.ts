import { createItemStack, Inventory } from '../inventory';
import type { WorldSummary } from '../save/types';
import { GameUI } from '../ui/GameUI';

export type UiQaScene = 'loading' | 'hud-full' | 'hud-low' | 'hud-absorption' | 'creative' | 'world-list';

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
  HUD_ITEMS.forEach(([itemId, count], index) => inventory.setSlot(index, createItemStack(itemId, count)));
  inventory.setSlot({ section: 'armor', slot: 'head' }, createItemStack('diamond_helmet'));
  inventory.setSlot({ section: 'armor', slot: 'chest' }, createItemStack('diamond_chestplate'));
  inventory.setSlot({ section: 'armor', slot: 'legs' }, createItemStack('diamond_leggings'));
  inventory.setSlot({ section: 'armor', slot: 'feet' }, createItemStack('diamond_boots'));
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
  canvas.style.background = `linear-gradient(rgba(4, 11, 10, 0.28), rgba(4, 11, 10, 0.48)), url('${import.meta.env.BASE_URL}ui/frontier-menu-background.png') center / cover`;
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
