/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_APPEARANCE, createPlayerAppearance } from '../src/player/appearance/PlayerAppearance';
import { PRODUCTION_PLAYER_SKINS } from '../src/player/appearance/builtinSkins';
import { orderedSkinIds } from '../src/player/appearance/skinStoreCatalog';
import { GameUI, type SkinSelectorActions } from '../src/ui/GameUI';

describe('skin selector menu', () => {
  it('lists every production skin, previews a discovered skin, and cancel leaves the committed id', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const ui = new GameUI(root);
    const previews: string[] = [];
    let confirmed = 0;
    let cancelled = 0;
    ui.showSkinSelector(DEFAULT_PLAYER_APPEARANCE, {
      preview: (skinId) => { previews.push(skinId); },
      confirm: () => { confirmed += 1; },
      cancel: () => { cancelled += 1; },
      rotatePreview: () => {},
      setPreviewRotationActive: () => {},
    });
    const cards = [...root.querySelectorAll<HTMLButtonElement>('[data-skin-id]')];
    expect(cards.map((card) => card.dataset.skinId)).toEqual([...orderedSkinIds()]);
    expect(new Set(cards.map((card) => card.dataset.skinId))).toEqual(new Set(PRODUCTION_PLAYER_SKINS.map((skin) => skin.id)));
    expect(root.querySelector('[data-skin-id="buyer_merchant"]')).toBeNull();
    expect(root.querySelector('[data-skin-id="player_uv_test"]')).toBeNull();
    const slim = root.querySelector<HTMLButtonElement>('[data-skin-id="14fcedd090af47a4"]');
    const classic = root.querySelector<HTMLButtonElement>('[data-skin-id="5a90d9efb3029994"]');
    expect(slim?.querySelector('[data-skin-model]')?.getAttribute('data-skin-model')).toBe('slim');
    expect(classic?.querySelector('[data-skin-model]')?.getAttribute('data-skin-model')).toBe('classic');
    expect(slim?.querySelector('canvas')?.getAttribute('width')).toBe('64');
    slim?.click();
    expect(previews).toEqual(['14fcedd090af47a4']);
    expect(slim?.classList.contains('selected')).toBe(true);
    root.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.click();
    expect(cancelled).toBe(1);
    expect(confirmed).toBe(0);
    const grid = root.querySelector('.skin-card-grid');
    expect(grid).toBeTruthy();
    expect(cards.length).toBe(PRODUCTION_PLAYER_SKINS.length);
    expect(cards.length).toBeGreaterThan(45);
    root.remove();
  });
});

const RARE_ID = '00f6338deb336a6e';
const EPIC_ID = '211085684a03470a';
const LEGENDARY_ID = 'ae1fddb72664eaf2';
const OTHER_LEGENDARY_ID = 'e126128225dccc51';
const COMMON_ID = '14fcedd090af47a4';

function mountSelector(
  appearance = DEFAULT_PLAYER_APPEARANCE,
  extra: Partial<SkinSelectorActions> = {},
) {
  const root = document.createElement('div');
  document.body.append(root);
  const ui = new GameUI(root);
  const previews: string[] = [];
  let confirmed = 0;
  let cancelled = 0;
  ui.showSkinSelector(appearance, {
    preview: (skinId) => { previews.push(skinId); },
    confirm: () => { confirmed += 1; },
    cancel: () => { cancelled += 1; },
    rotatePreview: () => {},
    setPreviewRotationActive: () => {},
    ...extra,
  });
  return {
    root,
    previews,
    get confirmed() { return confirmed; },
    get cancelled() { return cancelled; },
    confirmButton: () => root.querySelector<HTMLButtonElement>('[data-action="confirm"]')!,
    card: (skinId: string) => root.querySelector<HTMLButtonElement>(`[data-skin-id="${skinId}"]`)!,
    close() { root.remove(); },
  };
}

describe('skin store selector', () => {
  it('orders cards by rarity and shows category headings', () => {
    const view = mountSelector();
    const cards = [...view.root.querySelectorAll<HTMLButtonElement>('[data-skin-id]')];
    expect(cards.map((card) => card.dataset.skinId)).toEqual([...orderedSkinIds()]);
    expect(cards[0]?.dataset.skinId).toBe('frontier_explorer');
    const headings = [...view.root.querySelectorAll('.skin-rarity-heading')].map((heading) => heading.textContent);
    expect(headings).toEqual(['ОБЫЧНЫЕ', 'РЕДКИЕ', 'ЭПИЧЕСКИЕ', 'ЛЕГЕНДАРНЫЕ']);
    expect(view.root.querySelector('.skin-pack-offer[data-pack-sku="skin_pack_all_rare"]')?.textContent).toContain('99 ₽');
    expect(view.root.querySelector('.skin-pack-offer[data-pack-sku="skin_pack_all_epic"]')?.textContent).toContain('299 ₽');
    expect(view.root.querySelector('[data-pack-sku="skin_pack_all_rare"] strong')?.textContent).toBe('Все редкие скины');
    expect(view.root.querySelector('[data-pack-sku="skin_pack_all_epic"] strong')?.textContent).toBe('Все эпические скины');
    view.close();
  });

  it('keeps a rarity frame when the yellow selection outline is applied', () => {
    const view = mountSelector();
    const legendary = view.card(LEGENDARY_ID);
    legendary.click();
    expect(legendary.classList.contains('selected')).toBe(true);
    expect(legendary.dataset.rarity).toBe('legendary');
    expect(legendary.classList.contains('rarity-legendary')).toBe(true);
    expect(legendary.getAttribute('aria-label')).toBe('Легендарный скин');
    expect(view.card(RARE_ID).dataset.rarity).toBe('rare');
    expect(view.card(EPIC_ID).dataset.rarity).toBe('epic');
    expect(view.card(COMMON_ID).dataset.rarity).toBe('common');
    expect(view.card('frontier_explorer').dataset.rarity).toBe('common');
    expect(view.card('frontier_explorer').dataset.acquisition).toBe('default');
    view.close();
  });

  it('previews a legendary skin and does not confirm it', () => {
    const view = mountSelector();
    const contexts: string[] = [];
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
      contexts.push(kind);
      return original.call(this, kind as '2d');
    } as HTMLCanvasElement['getContext'];
    view.card(LEGENDARY_ID).click();
    view.card(LEGENDARY_ID).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const button = view.confirmButton();
    expect(view.previews).toEqual([LEGENDARY_ID]);
    expect(button.textContent).toBe('Недоступно');
    expect(button.disabled).toBe(true);
    expect(button.tabIndex).toBe(-1);
    expect(button.classList.contains('primary')).toBe(false);
    button.click();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(view.confirmed).toBe(0);
    expect(view.root.querySelectorAll('canvas.character-preview-canvas')).toHaveLength(1);
    expect(view.root.querySelectorAll('canvas.skin-card-preview')).toHaveLength(orderedSkinIds().length);
    expect(contexts).not.toContain('webgl');
    expect(contexts).not.toContain('webgl2');
    HTMLCanvasElement.prototype.getContext = original;
    view.close();
  });

  it('does not equip a locked common, rare, or epic skin from the button', () => {
    const view = mountSelector();
    view.card(COMMON_ID).click();
    let button = view.confirmButton();
    expect(button.textContent).toBe('Реклама скоро');
    expect(button.disabled).toBe(true);
    button.click();
    view.card(RARE_ID).click();
    button = view.confirmButton();
    expect(button.textContent).toBe('Покупки скоро');
    expect(button.disabled).toBe(true);
    expect(view.root.querySelector('[data-skin-action-note]')?.textContent).toContain('29 ₽');
    expect(view.root.querySelector('[data-skin-action-note]')?.getAttribute('data-price-source')).toBe('target');
    button.click();
    view.card(EPIC_ID).click();
    button = view.confirmButton();
    expect(button.textContent).toBe('Покупки скоро');
    expect(view.root.querySelector('[data-skin-action-note]')?.textContent).toContain('149 ₽');
    for (let time = 0; time < 5; time += 1) button.click();
    expect(view.confirmed).toBe(0);
    view.root.querySelector<HTMLButtonElement>('[data-pack-action="skin_pack_all_rare"]')?.click();
    view.root.querySelector<HTMLButtonElement>('[data-pack-action="skin_pack_all_epic"]')?.click();
    expect(view.confirmed).toBe(0);
    view.close();
  });

  it('confirms the free starter when it is not the equipped skin', () => {
    const view = mountSelector(DEFAULT_PLAYER_APPEARANCE, { equippedSkinId: RARE_ID });
    expect(view.confirmButton().textContent).toBe('Подтвердить');
    expect(view.confirmButton().disabled).toBe(false);
    view.confirmButton().click();
    expect(view.confirmed).toBe(1);
    view.close();
  });

  it('does not ask for another ad when the equipped common skin stays selected', () => {
    const equipped = createPlayerAppearance({ skinId: COMMON_ID, model: 'slim' });
    const view = mountSelector(equipped, { equippedSkinId: COMMON_ID });
    const button = view.confirmButton();
    expect(button.textContent).toBe('Уже выбран');
    expect(button.dataset.actionState).toBe('already_equipped');
    expect(button.textContent).not.toBe('Реклама скоро');
    button.click();
    expect(view.confirmed).toBe(1);
    view.close();
  });

  it('keeps cancel from starting a reward or a purchase', () => {
    const view = mountSelector();
    view.card(RARE_ID).click();
    view.root.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.click();
    expect(view.cancelled).toBe(1);
    expect(view.confirmed).toBe(0);
    view.close();
  });

  it('keeps the same grid node and scroll offset while cards change', () => {
    const view = mountSelector();
    const grid = view.root.querySelector<HTMLElement>('.skin-card-grid')!;
    grid.scrollTop = 180;
    for (const skinId of [COMMON_ID, RARE_ID, EPIC_ID, LEGENDARY_ID, 'frontier_explorer']) {
      view.card(skinId).click();
      expect(view.root.querySelector('.skin-card-grid')).toBe(grid);
      expect(grid.scrollTop).toBe(180);
    }
    view.close();
  });

  it('does not turn a broken access snapshot into an equippable skin', () => {
    const view = mountSelector(DEFAULT_PLAYER_APPEARANCE, {
      accessSnapshot: { ownedSkinIds: [RARE_ID], isAdmin: true } as unknown as SkinSelectorActions['accessSnapshot'],
    });
    view.card(RARE_ID).click();
    expect(view.confirmButton().disabled).toBe(true);
    expect(view.confirmButton().textContent).toBe('Покупки скоро');
    view.card(LEGENDARY_ID).click();
    expect(view.confirmButton().textContent).toBe('Недоступно');
    view.confirmButton().click();
    expect(view.confirmed).toBe(0);
    view.close();
  });

  it('does not swallow Enter while a locked skin is selected', async () => {
    const view = mountSelector();
    view.card(RARE_ID).click();
    const confirm = view.confirmButton();
    const cancel = view.root.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const screen = view.root.querySelector('.screen')!;
    expect(confirm.disabled).toBe(true);
    expect(confirm.tabIndex).toBe(-1);
    confirm.click();
    expect(view.confirmed).toBe(0);

    const onScreen = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    screen.dispatchEvent(onScreen);
    expect(onScreen.defaultPrevented).toBe(false);
    expect(view.confirmed).toBe(0);

    cancel.focus();
    const onCancel = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    const reachedScreen = new Promise<boolean>((resolve) => {
      screen.addEventListener('keydown', (event) => resolve(event.defaultPrevented), { once: true });
    });
    cancel.dispatchEvent(onCancel);
    expect(onCancel.defaultPrevented).toBe(false);
    expect(await reachedScreen).toBe(false);
    view.close();
  });

  it('lets a focused skin card receive Enter while Confirm is disabled', () => {
    const view = mountSelector();
    view.card(LEGENDARY_ID).click();
    const confirm = view.confirmButton();
    expect(confirm.disabled).toBe(true);
    expect(confirm.textContent).toBe('Недоступно');
    const next = view.card(COMMON_ID);
    next.focus();
    const onCard = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    next.dispatchEvent(onCard);
    expect(onCard.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(next);
    next.click();
    expect(view.previews).toEqual([LEGENDARY_ID, COMMON_ID]);
    expect(next.classList.contains('selected')).toBe(true);
    expect(view.confirmButton().textContent).toBe('Реклама скоро');
    expect(view.confirmButton().disabled).toBe(true);
    expect(view.confirmed).toBe(0);

    const cancel = view.root.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    cancel.focus();
    const onCancel = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    cancel.dispatchEvent(onCancel);
    expect(onCancel.defaultPrevented).toBe(false);
    expect(view.confirmed).toBe(0);
    view.close();
  });

  it('leaves the free Confirm button activatable and skips a disabled one in Tab order', () => {
    const equippedRare = mountSelector(DEFAULT_PLAYER_APPEARANCE, { equippedSkinId: RARE_ID });
    const confirm = equippedRare.confirmButton();
    expect(confirm.textContent).toBe('Подтвердить');
    expect(confirm.disabled).toBe(false);
    expect(confirm.tabIndex).toBe(0);
    confirm.focus();
    const onConfirm = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    confirm.dispatchEvent(onConfirm);
    expect(onConfirm.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(confirm);
    confirm.click();
    expect(equippedRare.confirmed).toBe(1);
    equippedRare.close();

    const locked = mountSelector();
    locked.card(LEGENDARY_ID).click();
    const disabled = locked.confirmButton();
    const focusable = [...locked.root.querySelectorAll<HTMLButtonElement>('button')]
      .filter((button) => !button.disabled && button.tabIndex >= 0);
    expect(disabled.disabled).toBe(true);
    expect(disabled.tabIndex).toBe(-1);
    expect(focusable).not.toContain(disabled);
    expect(focusable.some((button) => button.dataset.action === 'cancel')).toBe(true);
    locked.close();
  });

  it('reflects a future owned or admin grant without treating the other legendary as free', () => {
    const owned = mountSelector(DEFAULT_PLAYER_APPEARANCE, {
      accessSnapshot: { ownedSkinIds: [RARE_ID], adminLegendarySkinIds: [LEGENDARY_ID] },
    });
    owned.card(RARE_ID).click();
    expect(owned.confirmButton().textContent).toBe('Подтвердить');
    expect(owned.confirmButton().dataset.actionState).toBe('confirm_owned');
    expect(owned.confirmButton().disabled).toBe(false);
    owned.card(LEGENDARY_ID).click();
    expect(owned.confirmButton().dataset.actionState).toBe('confirm_admin');
    owned.card(OTHER_LEGENDARY_ID).click();
    expect(owned.confirmButton().textContent).toBe('Недоступно');
    expect(owned.confirmButton().disabled).toBe(true);
    owned.close();
  });
});