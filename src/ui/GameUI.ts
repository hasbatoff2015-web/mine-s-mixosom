import { consumeCraftingGrid, matchCraftingRecipe } from '../crafting';
import {
  Inventory,
  applySlotClick,
  canStacksMerge,
  cloneStack,
  createItemStack,
  mergeItemStacks,
  type InventorySlotRef,
  type ItemStack,
} from '../inventory';
import { getItemDefinition, obtainableItems } from '../items';
import type { GameMode, WorldSummary } from '../save/types';
import type { ChestState, FurnaceState } from '../world/World';
import { TextureAtlas } from '../rendering/TextureAtlas';

export interface MainMenuActions {
  play(): void;
  settings(): void;
  controls(): void;
}

export interface WorldListActions {
  load(id: string): void;
  create(): void;
  delete(id: string): void;
  back(): void;
}

export interface CreateWorldActions {
  create(name: string, seed: string, mode: GameMode): void;
  back(): void;
}

export interface PauseActions {
  resume(): void;
  settings(): void;
  saveAndQuit(): void;
}

export interface HudState {
  inventory: Inventory;
  selectedSlot: number;
  health: number;
  hunger: number;
  miningProgress: number;
  attackStrength: number;
  debug?: string;
}

export interface InventoryContext {
  inventory: Inventory;
  mode: GameMode;
  kind: 'inventory' | 'crafting-table' | 'chest' | 'furnace';
  chest?: ChestState;
  furnace?: FurnaceState;
  onClose(): void;
  onDrop(stack: ItemStack): void;
  onChanged(): void;
}

interface ContainerAdapter {
  slots: Array<ItemStack | null>;
}

export class GameUI {
  private screen?: HTMLElement;
  private hud: HTMLElement;
  private hotbar: HTMLElement;
  private selectedItem: HTMLElement;
  private hearts: HTMLElement;
  private hunger: HTMLElement;
  private mining: HTMLElement;
  private attack: HTMLElement;
  private debug: HTMLElement;
  private toasts: HTMLElement;
  private modal?: HTMLElement;
  private cursorStack: ItemStack | null = null;
  private craftSlots: Array<ItemStack | null> = [];
  private inventoryContext?: InventoryContext;
  private hotbarHtml = '';
  private selectedItemText = '';
  private heartsHtml = '';
  private hungerHtml = '';
  private miningWidth = '';
  private miningVisible = false;
  private attackTransform = '';
  private debugText = '';
  private debugVisible = false;
  private settings = { volume: 0.7, sensitivity: 0.0022, renderDistance: 4, fov: 75 };
  private itemIconResolver?: (itemId: string) => string;

  constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = `
      <div id="hud" class="hidden">
        <div id="crosshair"></div>
        <div id="mining-progress" class="hidden"><span></span></div>
        <div id="attack-indicator"><span></span></div>
        <div id="status-bars"><div class="hearts"></div><div class="hunger"></div></div>
        <div id="selected-item"></div>
        <div id="hotbar"></div>
        <div id="debug-panel" class="hidden"></div>
        <div id="toast-stack"></div>
      </div>`;
    this.hud = this.root.querySelector('#hud')!;
    this.hotbar = this.root.querySelector('#hotbar')!;
    this.selectedItem = this.root.querySelector('#selected-item')!;
    this.hearts = this.root.querySelector('.hearts')!;
    this.hunger = this.root.querySelector('.hunger')!;
    this.mining = this.root.querySelector('#mining-progress')!;
    this.attack = this.root.querySelector('#attack-indicator span')!;
    this.debug = this.root.querySelector('#debug-panel')!;
    this.toasts = this.root.querySelector('#toast-stack')!;
    document.addEventListener('pointermove', (event) => {
      const cursor = this.modal?.querySelector<HTMLElement>('#cursor-stack');
      if (cursor) {
        cursor.style.left = `${event.clientX}px`;
        cursor.style.top = `${event.clientY}px`;
      }
    });
  }

  setItemIconResolver(resolver: (itemId: string) => string): void {
    this.itemIconResolver = resolver;
  }

  showLoading(label = 'Подготавливаем мир…'): void {
    this.hideHud();
    this.setScreen(`
      <div id="loading-screen" class="screen">
        <div class="menu-card">
          <div class="brand"><div class="brand-mark"></div><h1>FRONTIER CUBES</h1><p>survival alpha</p></div>
          <strong>${this.escape(label)}</strong><div class="loading-bar"></div>
        </div>
      </div>`);
  }

  showMainMenu(actions: MainMenuActions): void {
    this.hideHud();
    this.setScreen(`
      <section class="screen"><div class="menu-card">
        <div class="brand"><div class="brand-mark"></div><h1>FRONTIER CUBES</h1><p>survival alpha · 0.1</p></div>
        <div class="menu-stack">
          <button class="game-button primary" data-action="play">Играть</button>
          <button class="game-button" data-action="settings">Настройки</button>
          <button class="game-button ghost" data-action="controls">Управление</button>
        </div>
      </div></section>`);
    this.bindAction('play', actions.play);
    this.bindAction('settings', actions.settings);
    this.bindAction('controls', actions.controls);
  }

  showWorldList(worlds: readonly WorldSummary[], actions: WorldListActions): void {
    const rows = worlds.length
      ? worlds.map((world) => `
        <div class="world-row">
          <button data-load="${this.escape(world.id)}"><strong>${this.escape(world.name)}</strong><small>${world.mode === 'creative' ? 'Творческий' : 'Выживание'} · seed ${this.escape(world.seed)} · ${new Date(world.updatedAt).toLocaleDateString()}</small></button>
          <button class="game-button danger" data-delete="${this.escape(world.id)}" aria-label="Удалить мир">×</button>
        </div>`).join('')
      : '<div class="empty-state">Сохранённых миров пока нет</div>';
    this.setScreen(`
      <section class="screen"><div class="menu-card">
        <div class="menu-heading"><h2>Ваши миры</h2><button class="game-button ghost" data-action="back">Назад</button></div>
        <div class="world-list">${rows}</div>
        <button class="game-button primary" data-action="create">Создать новый мир</button>
      </div></section>`);
    this.bindAction('back', actions.back);
    this.bindAction('create', actions.create);
    for (const button of this.screen!.querySelectorAll<HTMLButtonElement>('[data-load]')) button.addEventListener('click', () => actions.load(button.dataset.load!));
    for (const button of this.screen!.querySelectorAll<HTMLButtonElement>('[data-delete]')) {
      button.addEventListener('click', () => {
        if (window.confirm('Удалить этот мир без возможности восстановления?')) actions.delete(button.dataset.delete!);
      });
    }
  }

  showCreateWorld(actions: CreateWorldActions): void {
    this.setScreen(`
      <section class="screen"><form class="menu-card" id="create-world-form">
        <div class="menu-heading"><h2>Создание мира</h2><button type="button" class="game-button ghost" data-action="back">Назад</button></div>
        <label class="field">Название мира<input name="name" maxlength="42" value="Новый мир" required /></label>
        <label class="field">Seed (можно оставить пустым)<input name="seed" maxlength="80" placeholder="Случайный seed" /></label>
        <label class="field">Режим<select name="mode"><option value="survival">Выживание</option><option value="creative">Творческий</option></select></label>
        <button class="game-button primary" type="submit">Создать и играть</button>
      </form></section>`);
    this.bindAction('back', actions.back);
    this.screen!.querySelector<HTMLFormElement>('#create-world-form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget as HTMLFormElement);
      actions.create(String(data.get('name') ?? ''), String(data.get('seed') ?? ''), data.get('mode') === 'creative' ? 'creative' : 'survival');
    });
  }

  showPause(actions: PauseActions): void {
    this.setScreen(`
      <section class="screen"><div class="menu-card">
        <div class="brand"><div class="brand-mark"></div><h2>Пауза</h2><p>мир остановлен и сохранён</p></div>
        <div class="menu-stack">
          <button class="game-button primary" data-action="resume">Продолжить</button>
          <button class="game-button" data-action="settings">Настройки</button>
          <button class="game-button ghost" data-action="quit">Сохранить и выйти</button>
        </div>
      </div></section>`);
    this.bindAction('resume', actions.resume);
    this.bindAction('settings', actions.settings);
    this.bindAction('quit', actions.saveAndQuit);
  }

  showSettings(onApply: (settings: typeof this.settings) => void, onBack: () => void): void {
    this.setScreen(`
      <section class="screen"><form class="menu-card" id="settings-form">
        <div class="menu-heading"><h2>Настройки</h2><button type="button" class="game-button ghost" data-action="back">Назад</button></div>
        <label class="field">Громкость <input type="range" name="volume" min="0" max="1" step="0.05" value="${this.settings.volume}" /></label>
        <label class="field">Чувствительность <input type="range" name="sensitivity" min="0.0007" max="0.005" step="0.0001" value="${this.settings.sensitivity}" /></label>
        <label class="field">Дальность чанков <input type="range" name="renderDistance" min="2" max="6" step="1" value="${this.settings.renderDistance}" /></label>
        <label class="field">Поле зрения <input type="range" name="fov" min="60" max="100" step="1" value="${this.settings.fov}" /></label>
        <button class="game-button primary" type="submit">Применить</button>
      </form></section>`);
    this.bindAction('back', onBack);
    this.screen!.querySelector<HTMLFormElement>('#settings-form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget as HTMLFormElement);
      this.settings = {
        volume: Number(data.get('volume')),
        sensitivity: Number(data.get('sensitivity')),
        renderDistance: Number(data.get('renderDistance')),
        fov: Number(data.get('fov')),
      };
      onApply({ ...this.settings });
      onBack();
    });
  }

  showControls(onBack: () => void): void {
    this.setScreen(`
      <section class="screen"><div class="menu-card">
        <div class="menu-heading"><h2>Управление</h2><button class="game-button ghost" data-action="back">Назад</button></div>
        <p><strong>Desktop:</strong> WASD — ходьба, Space — прыжок, Shift — бег, C — присесть, мышь — взгляд, ЛКМ — добыча/атака, ПКМ — поставить/использовать/есть, E — инвентарь, Q — выбросить, 1–9/колесо — hotbar, F3 — отладка, Esc — пауза.</p>
        <p><strong>Mobile landscape:</strong> левый стик — движение, проводите по правой части для камеры; отдельные кнопки отвечают за прыжок, бег, приседание, добычу, использование, инвентарь и паузу.</p>
      </div></section>`);
    this.bindAction('back', onBack);
  }

  showDeath(onRespawn: () => void, onQuit: () => void): void {
    this.setScreen(`
      <section class="screen"><div class="menu-card">
        <h1 class="death-title">Вы погибли</h1>
        <div class="menu-stack"><button class="game-button primary" data-action="respawn">Возродиться</button><button class="game-button ghost" data-action="quit">Главное меню</button></div>
      </div></section>`);
    this.bindAction('respawn', onRespawn);
    this.bindAction('quit', onQuit);
  }

  enterGame(): void {
    this.removeScreen();
    this.hud.classList.remove('hidden');
    this.setControlsSuppressed(false);
  }

  hideHud(): void {
    this.hud.classList.add('hidden');
    this.setControlsSuppressed(true);
  }

  updateHud(state: HudState): void {
    const slots = state.inventory.slots.slice(0, Inventory.HOTBAR_SIZE);
    const hotbarHtml = slots.map((stack, index) => this.slotHtml(stack, `hotbar-${index}`, index === state.selectedSlot)).join('');
    if (hotbarHtml !== this.hotbarHtml) {
      this.hotbarHtml = hotbarHtml;
      this.hotbar.innerHTML = hotbarHtml;
      for (const element of this.hotbar.querySelectorAll<HTMLElement>('.slot')) {
        element.addEventListener('pointerdown', () => this.onHotbarSelect?.(Number(element.dataset.index)));
      }
    }
    const selected = slots[state.selectedSlot] ?? null;
    const selectedItemText = selected ? getItemDefinition(selected.itemId).name : '';
    if (selectedItemText !== this.selectedItemText) {
      this.selectedItemText = selectedItemText;
      this.selectedItem.textContent = selectedItemText;
    }
    const heartsHtml = this.pips('♥', Math.ceil(state.health / 2), 10);
    if (heartsHtml !== this.heartsHtml) {
      this.heartsHtml = heartsHtml;
      this.hearts.innerHTML = heartsHtml;
    }
    const hungerHtml = this.pips('◆', Math.ceil(state.hunger / 2), 10);
    if (hungerHtml !== this.hungerHtml) {
      this.hungerHtml = hungerHtml;
      this.hunger.innerHTML = hungerHtml;
    }
    const miningVisible = state.miningProgress > 0;
    if (miningVisible !== this.miningVisible) {
      this.miningVisible = miningVisible;
      this.mining.classList.toggle('hidden', !miningVisible);
    }
    const miningBar = this.mining.querySelector<HTMLElement>('span')!;
    const miningWidth = `${Math.max(0, Math.min(1, state.miningProgress)) * 100}%`;
    if (miningWidth !== this.miningWidth) {
      this.miningWidth = miningWidth;
      miningBar.style.width = miningWidth;
    }
    const attackTransform = `scaleX(${Math.max(0, Math.min(1, state.attackStrength))})`;
    if (attackTransform !== this.attackTransform) {
      this.attackTransform = attackTransform;
      this.attack.style.transform = attackTransform;
    }
    const debugText = state.debug ?? '';
    if (debugText !== this.debugText) {
      this.debugText = debugText;
      this.debug.textContent = debugText;
    }
    const debugVisible = debugText.length > 0;
    if (debugVisible !== this.debugVisible) {
      this.debugVisible = debugVisible;
      this.debug.classList.toggle('hidden', !debugVisible);
    }
  }

  onHotbarSelect?: (index: number) => void;

  toast(message: string, timeout = 1900): void {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    this.toasts.append(toast);
    window.setTimeout(() => toast.remove(), timeout);
  }

  openInventory(context: InventoryContext): void {
    this.closeInventory(false);
    this.inventoryContext = context;
    this.cursorStack = null;
    this.craftSlots = Array.from({ length: context.kind === 'crafting-table' ? 9 : 4 }, () => null);
    this.renderInventory();
    this.setControlsSuppressed(true);
    document.exitPointerLock?.();
  }

  closeInventory(returnStacks = true): void {
    const context = this.inventoryContext;
    if (context && returnStacks) {
      for (const stack of [...this.craftSlots, this.cursorStack]) {
        if (!stack) continue;
        const remainder = context.inventory.add(stack);
        if (remainder) context.onDrop(remainder);
      }
      context.onChanged();
    }
    this.modal?.remove();
    this.modal = undefined;
    this.inventoryContext = undefined;
    this.cursorStack = null;
    this.craftSlots = [];
    this.setControlsSuppressed(false);
  }

  isInventoryOpen(): boolean {
    return this.modal !== undefined;
  }

  private renderInventory(): void {
    const context = this.inventoryContext;
    if (!context) return;
    this.modal?.remove();
    this.modal = document.createElement('div');
    this.modal.className = 'modal-backdrop';
    const inventory = context.inventory;
    const mainSlots = inventory.slots.slice(9, 36);
    const hotbar = inventory.slots.slice(0, 9);
    const craftSize = context.kind === 'crafting-table' ? 3 : 2;
    const match = matchCraftingRecipe(this.craftSlots, craftSize, craftSize);
    const leftPanel = context.kind === 'chest'
      ? this.containerHtml('Сундук', context.chest?.slots ?? [])
      : context.kind === 'furnace'
        ? this.furnaceHtml(context.furnace!)
        : `<h3>${context.kind === 'crafting-table' ? 'Верстак 3×3' : 'Создание 2×2'}</h3><div class="craft-area"><div class="craft-grid ${craftSize === 3 ? 'table' : ''}">${this.craftSlots.map((slot, index) => this.slotHtml(slot, `craft-${index}`)).join('')}</div><span>→</span>${this.slotHtml(match?.output ?? null, 'result')}</div>
           <div class="equipment-grid">${this.slotHtml(inventory.armor.head, 'armor-head')}${this.slotHtml(inventory.armor.chest, 'armor-chest')}${this.slotHtml(inventory.armor.legs, 'armor-legs')}${this.slotHtml(inventory.armor.feet, 'armor-feet')}${this.slotHtml(inventory.offhand, 'offhand')}</div>`;
    const catalog = obtainableItems();
    const creative = context.mode === 'creative'
      ? `<h3>Творческий каталог</h3><div class="container-grid">${catalog.map((item, index) => this.slotHtml(createItemStack(item.id, 1), `creative-${index}`)).join('')}</div>`
      : '';
    this.modal.innerHTML = `
      <div class="inventory-window">
        <div class="menu-heading"><h2>${this.inventoryTitle(context.kind)}</h2><button class="game-button ghost" data-ui="close">Закрыть</button></div>
        ${creative}
        <div class="inventory-layout"><section>${leftPanel}<p class="inventory-hint">ЛКМ — взять/положить стек · ПКМ — половина/один · Shift+ЛКМ — быстро переместить</p></section><section>
          <h3>Инвентарь</h3><div class="inventory-grid">${mainSlots.map((slot, index) => this.slotHtml(slot, `inventory-${index + 9}`)).join('')}</div>
          <div class="inventory-grid hotbar-grid">${hotbar.map((slot, index) => this.slotHtml(slot, `inventory-${index}`)).join('')}</div>
        </section></div>
        <div id="cursor-stack">${this.cursorStack ? this.slotHtml(this.cursorStack, 'cursor') : ''}</div>
      </div>`;
    this.root.append(this.modal);
    this.modal.querySelector('[data-ui="close"]')!.addEventListener('click', () => context.onClose());
    this.modal.addEventListener('pointerdown', (event) => {
      const slot = (event.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      if (!slot) return;
      event.preventDefault();
      this.handleInventorySlot(slot.dataset.slot!, event.button === 2 ? 'right' : 'left', event.shiftKey);
    });
    this.modal.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private handleInventorySlot(key: string, button: 'left' | 'right', shift: boolean): void {
    const context = this.inventoryContext;
    if (!context || key === 'cursor') return;
    if (key.startsWith('inventory-')) {
      const index = Number(key.slice('inventory-'.length));
      if (shift && context.kind === 'chest' && context.chest) this.quickMoveInventoryToContainer(index, context.chest);
      else this.cursorStack = context.inventory.clickSlot(index, this.cursorStack, button);
    } else if (key.startsWith('armor-')) {
      const slot = key.slice('armor-'.length) as 'head' | 'chest' | 'legs' | 'feet';
      this.cursorStack = context.inventory.clickSlot({ section: 'armor', slot }, this.cursorStack, button);
    } else if (key === 'offhand') this.cursorStack = context.inventory.clickSlot({ section: 'offhand' }, this.cursorStack, button);
    else if (key.startsWith('craft-')) {
      const index = Number(key.slice('craft-'.length));
      const result = applySlotClick(this.craftSlots[index] ?? null, this.cursorStack, button);
      this.craftSlots[index] = result.slot;
      this.cursorStack = result.cursor;
    } else if (key === 'result') this.takeCraftResult();
    else if (key.startsWith('container-')) this.clickContainer(Number(key.slice('container-'.length)), button, shift);
    else if (key.startsWith('furnace-')) this.clickFurnace(Number(key.slice('furnace-'.length)), button);
    else if (key.startsWith('creative-')) {
      const definition = obtainableItems()[Number(key.slice('creative-'.length))];
      if (definition) this.cursorStack = createItemStack(definition.id, button === 'right' ? 1 : definition.maxStack);
    }
    context.onChanged();
    this.renderInventory();
  }

  private takeCraftResult(): void {
    const size = this.inventoryContext?.kind === 'crafting-table' ? 3 : 2;
    const match = matchCraftingRecipe(this.craftSlots, size, size);
    if (!match) return;
    if (this.cursorStack === null) this.cursorStack = cloneStack(match.output);
    else {
      if (!canStacksMerge(this.cursorStack, match.output)) return;
      const merged = mergeItemStacks(this.cursorStack, match.output);
      if (merged.remainder) return;
      this.cursorStack = merged.target;
    }
    this.craftSlots = [...consumeCraftingGrid(this.craftSlots, match)];
  }

  private clickContainer(index: number, button: 'left' | 'right', shift: boolean): void {
    const context = this.inventoryContext;
    const container = context?.chest;
    if (!context || !container) return;
    const stack = container.slots[index] ?? null;
    if (shift && stack) {
      const remainder = context.inventory.add(stack);
      container.slots[index] = remainder;
      return;
    }
    const result = applySlotClick(stack, this.cursorStack, button);
    container.slots[index] = result.slot;
    this.cursorStack = result.cursor;
  }

  private clickFurnace(index: number, button: 'left' | 'right'): void {
    const furnace = this.inventoryContext?.furnace;
    if (!furnace) return;
    const result = applySlotClick(furnace.slots[index] ?? null, this.cursorStack, button);
    furnace.slots[index] = result.slot;
    this.cursorStack = result.cursor;
  }

  private quickMoveInventoryToContainer(index: number, container: ContainerAdapter): void {
    const inventory = this.inventoryContext!.inventory;
    let moving = inventory.getSlot(index);
    if (!moving) return;
    for (let slot = 0; slot < container.slots.length && moving; slot += 1) {
      const target = container.slots[slot];
      if (!target || !canStacksMerge(target, moving)) continue;
      const merged = mergeItemStacks(target, moving);
      container.slots[slot] = merged.target;
      moving = merged.remainder;
    }
    for (let slot = 0; slot < container.slots.length && moving; slot += 1) {
      if (container.slots[slot]) continue;
      container.slots[slot] = moving;
      moving = null;
    }
    inventory.setSlot(index, moving);
  }

  private containerHtml(title: string, slots: readonly (ItemStack | null)[]): string {
    return `<h3>${title}</h3><div class="container-grid">${slots.map((slot, index) => this.slotHtml(slot, `container-${index}`)).join('')}</div>`;
  }

  private furnaceHtml(furnace: FurnaceState): string {
    const burn = furnace.burnTotal > 0 ? furnace.burnTime / furnace.burnTotal : 0;
    const cook = furnace.cookTime / 200;
    return `<h3>Печь</h3><div class="furnace-layout">${this.slotHtml(furnace.slots[0], 'furnace-0')}<div class="furnace-meter"><span>жар</span><div class="meter-track"><span style="width:${burn * 100}%"></span></div><span>готово</span><div class="meter-track"><span style="width:${cook * 100}%"></span></div></div>${this.slotHtml(furnace.slots[2], 'furnace-2')}${this.slotHtml(furnace.slots[1], 'furnace-1')}</div>`;
  }

  private slotHtml(stack: ItemStack | null, key: string, selected = false): string {
    if (!stack) return `<button class="slot${selected ? ' selected' : ''}" data-slot="${key}" data-index="${key.startsWith('hotbar-') ? key.slice(7) : ''}"></button>`;
    const definition = getItemDefinition(stack.itemId);
    const maxDurability = 'durability' in definition ? definition.durability : undefined;
    const durability = maxDurability && stack.durability !== undefined
      ? `<div class="durability"><span style="width:${Math.max(0, stack.durability / maxDurability) * 100}%"></span></div>`
      : '';
    return `<button class="slot${selected ? ' selected' : ''}" data-slot="${key}" data-index="${key.startsWith('hotbar-') ? key.slice(7) : ''}" title="${this.escape(definition.name)}"><img src="${this.itemIcon(stack.itemId)}" alt="" />${stack.count > 1 ? `<span class="count">${stack.count}</span>` : ''}${durability}</button>`;
  }

  private itemIcon(itemId: string): string {
    return this.itemIconResolver?.(itemId) ?? TextureAtlas.url(getItemDefinition(itemId).texture);
  }

  private pips(symbol: string, filled: number, total: number): string {
    return Array.from({ length: total }, (_value, index) => `<span class="${index < filled ? '' : 'empty'}">${symbol}</span>`).join('');
  }

  private inventoryTitle(kind: InventoryContext['kind']): string {
    return kind === 'crafting-table' ? 'Верстак' : kind === 'chest' ? 'Сундук' : kind === 'furnace' ? 'Печь' : 'Инвентарь';
  }

  private setScreen(html: string): void {
    this.removeScreen();
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    this.screen = template.content.firstElementChild as HTMLElement;
    this.root.append(this.screen);
    this.setControlsSuppressed(true);
  }

  private removeScreen(): void {
    this.screen?.remove();
    this.screen = undefined;
  }

  private bindAction(action: string, callback: () => void): void {
    this.screen?.querySelector(`[data-action="${action}"]`)?.addEventListener('click', callback);
  }

  private setControlsSuppressed(suppressed: boolean): void {
    this.root.parentElement?.classList.toggle('controls-suppressed', suppressed);
  }

  private escape(value: string): string {
    return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
  }
}
