import { matchCraftingRecipe } from '../crafting';
import {
  applySlotClick,
  createItemStack,
  Inventory,
  type ItemStack,
} from '../inventory';
import { getItemDefinition, obtainableItems } from '../items';
import type { GameMode, WorldSummary } from '../save/types';
import type { ChestState, FurnaceState } from '../world/World';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { inventoryPaintMode, patchContainerDynamic, patchInventoryDynamic } from './inventoryLayout';
import {
  CONTAINER_STRINGS,
} from './containerStrings';
import {
  containerStageSize,
  containerUiScale,
} from './containerTheme';
import {
  allCraftingBookEntries,
  inventoryItemCounts,
  paginateRecipeBook,
  pickIngredientItem,
  queryRecipeBook,
  recipeEntryCraftable,
  visibleRecipeBookTabs,
  type RecipeBookCategory,
  type RecipeBookEntry,
  type RecipeBookKind,
} from './recipeBook';
import {
  clickFurnaceSlot,
  furnaceAccepts,
  furnaceShiftRoute,
  ghostFromRecipe,
  hasRecipeBook,
  placeCraftingRecipe,
  placeSmeltingIngredient,
  shiftMoveStack,
  showsCreativeCatalog,
  takeCraftOutput,
  type GhostCraftState,
} from './containerInteractions';

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
  private pointerLockFallback: HTMLElement;
  private modal?: HTMLElement;
  private cursorStack: ItemStack | null = null;
  private craftSlots: Array<ItemStack | null> = [];
  private ghostCraft?: GhostCraftState;
  private ghostFurnaceItem?: string;
  private recipeBookOpen = { crafting: false, furnace: false };
  private recipeBookSearch = '';
  private recipeBookCategory: RecipeBookCategory = 'all';
  private recipeBookCraftableOnly = false;
  private recipeBookPage = 0;
  private recipeVariantIndex = 0;
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
      </div>
      <button type="button" id="pointer-lock-fallback" class="hidden">
        <span>Нажмите, чтобы продолжить</span>
      </button>`;
    this.hud = this.root.querySelector('#hud')!;
    this.hotbar = this.root.querySelector('#hotbar')!;
    this.selectedItem = this.root.querySelector('#selected-item')!;
    this.hearts = this.root.querySelector('.hearts')!;
    this.hunger = this.root.querySelector('.hunger')!;
    this.mining = this.root.querySelector('#mining-progress')!;
    this.attack = this.root.querySelector('#attack-indicator span')!;
    this.debug = this.root.querySelector('#debug-panel')!;
    this.toasts = this.root.querySelector('#toast-stack')!;
    this.pointerLockFallback = this.root.querySelector('#pointer-lock-fallback')!;
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
        <p><strong>Desktop:</strong> WASD — ходьба, Space — прыжок, двойной Space в творческом — полёт, Shift — бег (на земле) / вниз (в полёте), Ctrl — ускорение полёта, C — присесть, мышь — взгляд, ЛКМ — добыча/атака, ПКМ — поставить/использовать/есть, E — инвентарь, Q — выбросить, 1–9/колесо — hotbar, F3 — отладка, Esc — пауза.</p>
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
    this.hidePointerLockFallback();
    this.hud.classList.add('hidden');
    this.setControlsSuppressed(true);
  }

  showPointerLockFallback(onEngage: () => void): void {
    this.pointerLockFallback.classList.remove('hidden');
    this.pointerLockFallback.onclick = () => onEngage();
  }

  hidePointerLockFallback(): void {
    this.pointerLockFallback.classList.add('hidden');
    this.pointerLockFallback.onclick = null;
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
    this.ghostCraft = undefined;
    this.ghostFurnaceItem = undefined;
    this.recipeBookSearch = '';
    this.recipeBookCategory = 'all';
    this.recipeBookPage = 0;
    this.craftSlots = Array.from({ length: context.kind === 'crafting-table' ? 9 : 4 }, () => null);
    this.renderInventory();
    this.setControlsSuppressed(true);
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
    this.ghostCraft = undefined;
    this.ghostFurnaceItem = undefined;
    this.setControlsSuppressed(false);
  }

  isInventoryOpen(): boolean {
    return this.modal !== undefined;
  }

  openContainerKind(): InventoryContext['kind'] | undefined {
    return this.inventoryContext?.kind;
  }

  /** Re-paint an already open container from live world/inventory state (furnace progress). */
  refreshOpenInventory(): void {
    if (!this.inventoryContext) return;
    this.renderInventory();
  }

  private renderInventory(): void {
    const context = this.inventoryContext;
    if (!context) return;
    if (showsCreativeCatalog(context.kind, context.mode)) {
      this.renderCreativeInventory(context);
      return;
    }
    this.renderContainerScreen(context);
  }

  private renderCreativeInventory(context: InventoryContext): void {
    const dynamic = this.playerInventoryHtml(context);
    const cursor = this.cursorStack ? this.slotHtml(this.cursorStack, 'cursor') : '';
    if (inventoryPaintMode(this.modal !== undefined) === 'patch-dynamic'
      && this.modal
      && patchInventoryDynamic(this.modal, dynamic, cursor)) {
      return;
    }
    this.modal?.remove();
    this.modal = document.createElement('div');
    this.modal.className = 'modal-backdrop';
    const catalog = obtainableItems();
    this.modal.innerHTML = `
      <div class="inventory-window">
        <div class="menu-heading"><h2>${CONTAINER_STRINGS.inventory}</h2><button class="game-button ghost" data-ui="close">${CONTAINER_STRINGS.close}</button></div>
        <h3>Творческий каталог</h3>
        <div class="container-grid" data-creative-catalog>${catalog.map((item, index) => this.slotHtml(createItemStack(item.id, 1), `creative-${index}`)).join('')}</div>
        <div data-inventory-dynamic>${dynamic}</div>
        <div id="cursor-stack">${cursor}</div>
      </div>`;
    this.root.append(this.modal);
    this.bindContainerChrome(context);
  }

  private renderContainerScreen(context: InventoryContext): void {
    const bookOpen = this.isRecipeBookOpen(context.kind);
    const stage = containerStageSize(context.kind, bookOpen && hasRecipeBook(context.kind) && context.mode !== 'creative');
    const scale = containerUiScale(window.innerWidth, window.innerHeight, stage.width, stage.height);
    const body = this.containerBodyHtml(context);
    const player = this.playerInventoryHtml(context, context.kind !== 'inventory');
    const recipe = hasRecipeBook(context.kind) && (context.kind !== 'inventory' || context.mode !== 'creative')
      ? this.recipeBookHtml(context)
      : '';
    const cursor = this.cursorStack ? this.slotHtml(this.cursorStack, 'cursor') : '';
    const bookUi = `${bookOpen ? 1 : 0}:${this.recipeBookCategory}:${this.recipeBookCraftableOnly ? 1 : 0}`;
    if (this.modal?.classList.contains('mc-backdrop')
      && this.modal.dataset.bookUi === bookUi
      && patchContainerDynamic(this.modal, { body, player, recipeGrid: this.recipeGridHtml(context), cursor })) {
      this.applyContainerScale(scale, stage.width);
      return;
    }
    this.modal?.remove();
    this.modal = document.createElement('div');
    this.modal.className = 'modal-backdrop mc-backdrop';
    this.modal.dataset.bookUi = bookUi;
    this.modal.innerHTML = `
      <div class="mc-stage" style="--mc-ui-scale:${scale}; --mc-logical-width:${stage.width}">
        ${recipe}
        <div class="mc-panel" data-container-kind="${context.kind}">
          ${hasRecipeBook(context.kind) ? `<button type="button" class="mc-book-button" data-recipe-toggle title="${CONTAINER_STRINGS.recipeBook}"><img src="${TextureAtlas.url('item/book')}" alt="" /></button>` : ''}
          <button type="button" class="mc-close" data-ui="close" aria-label="${CONTAINER_STRINGS.close}">×</button>
          <div data-container-body>${body}</div>
          <div data-player-inventory>${player}</div>
        </div>
      </div>
      <div id="cursor-stack">${cursor}</div>`;
    this.root.append(this.modal);
    this.bindContainerChrome(context);
    this.bindRecipeBookControls(context);
  }

  private applyContainerScale(scale: number, logicalWidth: number): void {
    const stage = this.modal?.querySelector<HTMLElement>('.mc-stage');
    if (!stage) return;
    stage.style.setProperty('--mc-ui-scale', String(scale));
    stage.style.setProperty('--mc-logical-width', String(logicalWidth));
  }

  private bindContainerChrome(context: InventoryContext): void {
    this.modal!.querySelector('[data-ui="close"]')?.addEventListener('click', () => context.onClose());
    this.modal!.addEventListener('pointerdown', (event) => {
      const toggle = (event.target as HTMLElement).closest('[data-recipe-toggle]');
      if (toggle) {
        event.preventDefault();
        this.toggleRecipeBook(context.kind);
        this.renderInventory();
        return;
      }
      const recipe = (event.target as HTMLElement).closest<HTMLElement>('[data-recipe-id]');
      if (recipe) {
        event.preventDefault();
        this.handleRecipeClick(recipe.dataset.recipeId!, event.button === 2, event.shiftKey);
        return;
      }
      const slot = (event.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      if (!slot) return;
      event.preventDefault();
      this.handleInventorySlot(slot.dataset.slot!, event.button === 2 ? 'right' : 'left', event.shiftKey);
    });
    this.modal!.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private bindRecipeBookControls(context: InventoryContext): void {
    const search = this.modal?.querySelector<HTMLInputElement>('[data-recipe-search]');
    search?.addEventListener('input', () => {
      this.recipeBookSearch = search.value;
      this.recipeBookPage = 0;
      this.patchRecipeGridOnly(context);
    });
    search?.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.modal?.querySelector('[data-recipe-craftable]')?.addEventListener('click', () => {
      this.recipeBookCraftableOnly = !this.recipeBookCraftableOnly;
      this.recipeBookPage = 0;
      this.renderInventory();
    });
    for (const tab of this.modal?.querySelectorAll<HTMLElement>('[data-recipe-tab]') ?? []) {
      tab.addEventListener('click', () => {
        this.recipeBookCategory = tab.dataset.recipeTab as RecipeBookCategory;
        this.recipeBookPage = 0;
        this.renderInventory();
      });
    }
    this.modal?.querySelector('[data-recipe-prev]')?.addEventListener('click', () => {
      this.recipeBookPage = Math.max(0, this.recipeBookPage - 1);
      this.patchRecipeGridOnly(context);
    });
    this.modal?.querySelector('[data-recipe-next]')?.addEventListener('click', () => {
      this.recipeBookPage += 1;
      this.patchRecipeGridOnly(context);
    });
  }

  private patchRecipeGridOnly(context: InventoryContext): void {
    const grid = this.modal?.querySelector('[data-recipe-grid]');
    if (grid) grid.innerHTML = this.recipeButtonsHtml(context);
  }

  private isRecipeBookOpen(kind: InventoryContext['kind']): boolean {
    if (kind === 'furnace') return this.recipeBookOpen.furnace;
    return this.recipeBookOpen.crafting;
  }

  private toggleRecipeBook(kind: InventoryContext['kind']): void {
    if (kind === 'furnace') this.recipeBookOpen.furnace = !this.recipeBookOpen.furnace;
    else this.recipeBookOpen.crafting = !this.recipeBookOpen.crafting;
  }

  private containerBodyHtml(context: InventoryContext): string {
    if (context.kind === 'chest') {
      const slots = context.chest?.slots ?? Array.from({ length: 27 }, () => null);
      return `<div class="mc-label">${CONTAINER_STRINGS.chest}</div>
        <div class="mc-grid mc-grid-9">${slots.map((slot, index) => this.slotHtml(slot, `container-${index}`)).join('')}</div>`;
    }
    if (context.kind === 'furnace') return this.furnaceHtml(context.furnace!);
    return this.craftingHtml(context);
  }

  private craftingHtml(context: InventoryContext): string {
    const size = context.kind === 'crafting-table' ? 3 : 2;
    const match = matchCraftingRecipe(this.craftSlots, size, size);
    const label = context.kind === 'crafting-table' ? CONTAINER_STRINGS.crafting : CONTAINER_STRINGS.inventory;
    const armor = context.kind === 'inventory'
      ? `<div class="mc-armor">${this.slotHtml(context.inventory.armor.head, 'armor-head')}${this.slotHtml(context.inventory.armor.chest, 'armor-chest')}${this.slotHtml(context.inventory.armor.legs, 'armor-legs')}${this.slotHtml(context.inventory.armor.feet, 'armor-feet')}${this.slotHtml(context.inventory.offhand, 'offhand')}</div>`
      : '';
    return `<div class="mc-label">${label}</div>
      <div class="mc-craft-row">
        ${armor}
        <div class="mc-grid mc-grid-${size}">${this.craftSlots.map((slot, index) => this.craftSlotHtml(slot, index)).join('')}</div>
        <div class="mc-arrow" aria-hidden="true"></div>
        ${this.slotHtml(match?.output ?? null, 'result')}
      </div>`;
  }

  private craftSlotHtml(stack: ItemStack | null, index: number): string {
    if (stack) return this.slotHtml(stack, `craft-${index}`);
    const ghost = this.ghostCraft?.cells[index];
    if (!ghost) return this.slotHtml(null, `craft-${index}`);
    const missing = this.ghostCraft?.missing[index] === true;
    return `<button class="slot mc-slot ghost${missing ? ' missing' : ''}" data-slot="craft-${index}" data-ghost="1" title="${this.escape(getItemDefinition(ghost.itemId).name)}"><img src="${this.itemIcon(ghost.itemId)}" alt="" /></button>`;
  }

  private playerInventoryHtml(context: InventoryContext, labeled = false): string {
    const mainSlots = context.inventory.slots.slice(9, 36);
    const hotbar = context.inventory.slots.slice(0, 9);
    const label = labeled ? `<div class="mc-label">${CONTAINER_STRINGS.inventory}</div>` : '<h3>Инвентарь</h3>';
    return `${label}<div class="mc-grid mc-grid-9 inventory-grid">${mainSlots.map((slot, index) => this.slotHtml(slot, `inventory-${index + 9}`)).join('')}</div>
      <div class="mc-grid mc-grid-9 inventory-grid hotbar-grid">${hotbar.map((slot, index) => this.slotHtml(slot, `inventory-${index}`)).join('')}</div>`;
  }

  private recipeBookHtml(context: InventoryContext): string {
    if (!this.isRecipeBookOpen(context.kind)) return '';
    const kind: RecipeBookKind = context.kind === 'furnace' ? 'smelting' : 'crafting';
    const tabs = visibleRecipeBookTabs(kind);
    return `<aside class="mc-recipe-book" data-recipe-book>
      <div class="mc-recipe-toolbar">
        <input data-recipe-search type="search" placeholder="${CONTAINER_STRINGS.search}" value="${this.escape(this.recipeBookSearch)}" />
        <button type="button" data-recipe-craftable class="${this.recipeBookCraftableOnly ? 'active' : ''}">${this.recipeBookCraftableOnly ? CONTAINER_STRINGS.showCraftable : CONTAINER_STRINGS.showAll}</button>
      </div>
      <div class="mc-recipe-tabs">${tabs.map((tab) => `<button type="button" data-recipe-tab="${tab}" class="${this.recipeBookCategory === tab ? 'active' : ''}">${this.tabLabel(tab)}</button>`).join('')}</div>
      <div class="mc-recipe-grid" data-recipe-grid>${this.recipeButtonsHtml(context)}</div>
      <div class="mc-recipe-pager"><button type="button" data-recipe-prev>‹</button><button type="button" data-recipe-next>›</button></div>
    </aside>`;
  }

  private recipeGridHtml(context: InventoryContext): string {
    return this.recipeButtonsHtml(context);
  }

  private recipeButtonsHtml(context: InventoryContext): string {
    const kind: RecipeBookKind = context.kind === 'furnace' ? 'smelting' : 'crafting';
    const gridSize = context.kind === 'crafting-table' ? 3 : 2;
    const counts = inventoryItemCounts(context.inventory);
    const filtered = queryRecipeBook({
      kind,
      gridSize,
      category: this.recipeBookCategory,
      search: this.recipeBookSearch,
      craftableOnly: this.recipeBookCraftableOnly,
    }, counts);
    const page = paginateRecipeBook(filtered, this.recipeBookPage);
    this.recipeBookPage = page.page;
    return page.entries.map((entry) => {
      const craftable = recipeEntryCraftable(entry, counts);
      return `<button type="button" class="mc-recipe-btn${craftable ? '' : ' uncraftable'}" data-recipe-id="${this.escape(entry.id)}" title="${this.escape(getItemDefinition(entry.resultId).name)}">
        <img src="${this.itemIcon(entry.resultId)}" alt="" />
        ${entry.resultCount > 1 ? `<span class="count">${entry.resultCount}</span>` : ''}
      </button>`;
    }).join('');
  }

  private tabLabel(tab: RecipeBookCategory): string {
    if (tab === 'all') return CONTAINER_STRINGS.all;
    if (tab === 'equipment') return CONTAINER_STRINGS.equipment;
    if (tab === 'building') return CONTAINER_STRINGS.building;
    if (tab === 'food') return CONTAINER_STRINGS.food;
    if (tab === 'redstone') return CONTAINER_STRINGS.redstone;
    return CONTAINER_STRINGS.misc;
  }

  private handleRecipeClick(recipeId: string, right: boolean, shift: boolean): void {
    const context = this.inventoryContext;
    if (!context) return;
    if (context.kind === 'furnace') {
      const entry = this.smeltingEntry(recipeId);
      if (!entry?.smelting) return;
      const placed = placeSmeltingIngredient(entry.smelting, context.furnace?.slots[0] ?? null, context.inventory);
      if (placed.placed && context.furnace) {
        context.furnace.slots[0] = placed.input;
        this.ghostFurnaceItem = undefined;
      } else {
        this.ghostFurnaceItem = pickIngredientItem(entry.smelting.input, inventoryItemCounts(context.inventory));
      }
      context.onChanged();
      this.renderInventory();
      return;
    }
    const variants = allCraftingBookEntries().filter((entry) => {
      const current = allCraftingBookEntries().find((item) => item.id === recipeId);
      return current !== undefined && entry.resultId === current.resultId && (entry.gridSize ?? 3) <= (context.kind === 'crafting-table' ? 3 : 2);
    });
    let entry = variants.find((item) => item.id === recipeId) ?? variants[0];
    if (!entry?.recipe) return;
    if (right && variants.length > 1) {
      this.recipeVariantIndex = (this.recipeVariantIndex + 1) % variants.length;
      entry = variants[this.recipeVariantIndex]!;
    }
    const recipe = entry.recipe;
    if (!recipe) return;
    const counts = inventoryItemCounts(context.inventory);
    const gridSize = context.kind === 'crafting-table' ? 3 : 2;
    if (!recipeEntryCraftable(entry, counts)) {
      this.ghostCraft = ghostFromRecipe(recipe, gridSize, counts);
      this.renderInventory();
      return;
    }
    const placed = placeCraftingRecipe(recipe, this.craftSlots, context.inventory, gridSize, shift ? 64 : 1);
    if (placed.placed) {
      this.craftSlots = placed.grid;
      this.ghostCraft = undefined;
    } else this.ghostCraft = placed.ghost;
    context.onChanged();
    this.renderInventory();
  }

  private smeltingEntry(id: string): RecipeBookEntry | undefined {
    return queryRecipeBook({
      kind: 'smelting',
      gridSize: 3,
      category: 'all',
      search: '',
      craftableOnly: false,
    }, new Map()).find((entry) => entry.id === id);
  }

  private handleInventorySlot(key: string, button: 'left' | 'right', shift: boolean): void {
    const context = this.inventoryContext;
    if (!context || key === 'cursor') return;
    if (key.startsWith('inventory-')) {
      const index = Number(key.slice('inventory-'.length));
      if (shift && context.kind === 'chest' && context.chest) this.quickMoveInventoryToContainer(index, context.chest);
      else if (shift && context.kind === 'furnace' && context.furnace) this.shiftInventoryToFurnace(index);
      else this.cursorStack = context.inventory.clickSlot(index, this.cursorStack, button);
    } else if (key.startsWith('armor-')) {
      const slot = key.slice('armor-'.length) as 'head' | 'chest' | 'legs' | 'feet';
      this.cursorStack = context.inventory.clickSlot({ section: 'armor', slot }, this.cursorStack, button);
    } else if (key === 'offhand') this.cursorStack = context.inventory.clickSlot({ section: 'offhand' }, this.cursorStack, button);
    else if (key.startsWith('craft-')) {
      const index = Number(key.slice('craft-'.length));
      this.ghostCraft = undefined;
      const result = applySlotClick(this.craftSlots[index] ?? null, this.cursorStack, button);
      this.craftSlots[index] = result.slot;
      this.cursorStack = result.cursor;
    } else if (key === 'result') this.takeCraftResult(shift);
    else if (key.startsWith('container-')) this.clickContainer(Number(key.slice('container-'.length)), button, shift);
    else if (key.startsWith('furnace-')) this.clickFurnace(Number(key.slice('furnace-'.length)) as 0 | 1 | 2, button, shift);
    else if (key.startsWith('creative-')) {
      const definition = obtainableItems()[Number(key.slice('creative-'.length))];
      if (definition) this.cursorStack = createItemStack(definition.id, button === 'right' ? 1 : definition.maxStack);
    }
    context.onChanged();
    this.renderInventory();
  }

  private takeCraftResult(shift = false): void {
    const context = this.inventoryContext;
    if (!context) return;
    const size = context.kind === 'crafting-table' ? 3 : 2;
    const taken = takeCraftOutput(this.craftSlots, this.cursorStack, size, shift, context.inventory);
    this.craftSlots = taken.grid;
    this.cursorStack = taken.cursor;
    this.ghostCraft = undefined;
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

  private clickFurnace(index: 0 | 1 | 2, button: 'left' | 'right', shift: boolean): void {
    const context = this.inventoryContext;
    const furnace = context?.furnace;
    if (!context || !furnace) return;
    this.ghostFurnaceItem = undefined;
    const stack = furnace.slots[index];
    if (shift && stack) {
      const remainder = context.inventory.add(stack);
      furnace.slots[index] = remainder;
      return;
    }
    const clicked = clickFurnaceSlot(furnace.slots, index, this.cursorStack, button);
    furnace.slots = clicked.slots;
    this.cursorStack = clicked.cursor;
  }

  private shiftInventoryToFurnace(index: number): void {
    const context = this.inventoryContext;
    const furnace = context?.furnace;
    if (!context || !furnace) return;
    const moving = context.inventory.getSlot(index);
    if (!moving) return;
    const route = furnaceShiftRoute(moving, 'inventory');
    if (route === 'inventory') {
      context.inventory.quickMove(index);
      return;
    }
    const slotIndex = route === 'input' ? 0 : 1;
    const result = shiftMoveStack(moving, [furnace.slots[slotIndex]], (_slot, stack) => furnaceAccepts(slotIndex, stack));
    furnace.slots[slotIndex] = result.targets[0] ?? null;
    context.inventory.setSlot(index, result.remainder);
  }

  private quickMoveInventoryToContainer(index: number, container: ContainerAdapter): void {
    const inventory = this.inventoryContext!.inventory;
    const moving = inventory.getSlot(index);
    if (!moving) return;
    const moved = shiftMoveStack(moving, container.slots);
    container.slots.splice(0, container.slots.length, ...moved.targets);
    inventory.setSlot(index, moved.remainder);
  }

  private furnaceHtml(furnace: FurnaceState): string {
    const burn = furnace.burnTotal > 0 ? furnace.burnTime / furnace.burnTotal : 0;
    const cook = furnace.cookTime / 200;
    return `<div class="mc-label">${CONTAINER_STRINGS.furnace}</div>
      <div class="mc-furnace">
        <div class="mc-furnace-input">${this.furnaceInputHtml(furnace.slots[0])}</div>
        <div class="mc-flame" style="--p:${burn}"><span></span></div>
        <div class="mc-furnace-fuel">${this.slotHtml(furnace.slots[1], 'furnace-1')}</div>
        <div class="mc-arrow mc-arrow-progress"><span style="width:${Math.max(0, Math.min(1, cook)) * 100}%"></span></div>
        <div class="mc-furnace-output">${this.slotHtml(furnace.slots[2], 'furnace-2')}</div>
      </div>`;
  }

  private furnaceInputHtml(stack: ItemStack | null): string {
    if (stack) return this.slotHtml(stack, 'furnace-0');
    if (!this.ghostFurnaceItem) return this.slotHtml(null, 'furnace-0');
    return `<button class="slot mc-slot ghost missing" data-slot="furnace-0" data-ghost="1" title="${this.escape(getItemDefinition(this.ghostFurnaceItem).name)}"><img src="${this.itemIcon(this.ghostFurnaceItem)}" alt="" /></button>`;
  }

  private slotHtml(stack: ItemStack | null, key: string, selected = false): string {
    if (!stack) return `<button class="slot mc-slot${selected ? ' selected' : ''}" data-slot="${key}" data-index="${key.startsWith('hotbar-') ? key.slice(7) : ''}"></button>`;
    const definition = getItemDefinition(stack.itemId);
    const maxDurability = 'durability' in definition ? definition.durability : undefined;
    const durability = maxDurability && stack.durability !== undefined
      ? `<div class="durability"><span style="width:${Math.max(0, stack.durability / maxDurability) * 100}%"></span></div>`
      : '';
    return `<button class="slot mc-slot${selected ? ' selected' : ''}" data-slot="${key}" data-index="${key.startsWith('hotbar-') ? key.slice(7) : ''}" title="${this.escape(definition.name)}"><img src="${this.itemIcon(stack.itemId)}" alt="" />${stack.count > 1 ? `<span class="count">${stack.count}</span>` : ''}${durability}</button>`;
  }

  private itemIcon(itemId: string): string {
    return this.itemIconResolver?.(itemId) ?? TextureAtlas.url(getItemDefinition(itemId).texture);
  }

  private pips(symbol: string, filled: number, total: number): string {
    return Array.from({ length: total }, (_value, index) => `<span class="${index < filled ? '' : 'empty'}">${symbol}</span>`).join('');
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
