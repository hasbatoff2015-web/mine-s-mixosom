/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER_APPEARANCE,
  createPlayerAppearance,
  type PlayerAppearance,
} from '../src/player/appearance/PlayerAppearance';
import { REWARDED_SKIN_AVAILABILITY } from '../src/player/appearance/skinActionState';
import {
  COMMON_SKIN_IDS,
  EPIC_SKIN_IDS,
  LEGENDARY_SKIN_IDS,
  RARE_SKIN_IDS,
} from '../src/player/appearance/skinStoreCatalog';
import {
  REWARDED_SKIN_COPY,
  RewardedSkinFlow,
  type RewardedFlowClock,
  type RewardedVideoCallbacks,
  type RewardedVideoPort,
} from '../src/player/appearance/rewardedSkinFlow';
import { SkinRewardController } from '../src/player/appearance/skinRewardController';
import { GameUI, type SkinSelectorActions } from '../src/ui/GameUI';

const COMMON_ID = COMMON_SKIN_IDS[1];
const OTHER_COMMON_ID = COMMON_SKIN_IDS[2];
const RARE_ID = RARE_SKIN_IDS[0];
const EPIC_ID = EPIC_SKIN_IDS[0];
const LEGENDARY_ID = LEGENDARY_SKIN_IDS[0];

class ManualAds implements RewardedVideoPort {
  available: boolean;
  readonly calls: RewardedVideoCallbacks[] = [];
  constructor(available = true) {
    this.available = available;
  }

  throwOnShow = false;

  showRewardedVideo(callbacks: RewardedVideoCallbacks): void {
    this.calls.push(callbacks);
    if (this.throwOnShow) throw new Error('blocked');
  }
}

class FakeClock implements RewardedFlowClock {
  private now = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  set(fn: () => void, ms: number): number {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  }

  clear(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(ms: number): void {
    this.now += ms;
    const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= this.now);
    for (const [id, timer] of due) {
      if (!this.timers.has(id)) continue;
      this.timers.delete(id);
      timer.fn();
    }
  }
}

function mount(options: {
  appearance?: PlayerAppearance;
  equippedSkinId?: string;
  advertisementReady?: boolean;
  available?: boolean;
} = {}) {
  const appearance = options.appearance ?? DEFAULT_PLAYER_APPEARANCE;
  const root = document.createElement('div');
  document.body.append(root);
  const ui = new GameUI(root);
  const ads = new ManualAds(options.available ?? options.advertisementReady !== false);
  const clock = new FakeClock();
  let seq = 0;
  const applied: PlayerAppearance[] = [];
  const holds: string[] = [];
  let current = appearance;
  let open = true;
  let manualRecoveryAllowed = true;
  let confirmed = 0;
  let cancelled = 0;
  const previews: string[] = [];
  const flow = new RewardedSkinFlow(ads, {
    clock,
    createRequestId: () => {
      seq += 1;
      return `reward-${seq}`;
    },
  });
  const controller = new SkinRewardController(ads, {
    present: (phase) => ui.presentSkinReward(phase),
    acceptEquipped: (skinId, detail) => ui.acceptRewardedSkin(skinId, detail),
  }, {
    beginPresentation: () => holds.push('begin'),
    endPresentation: () => holds.push('end'),
    apply: (next) => {
      applied.push(next);
      current = next;
    },
    currentAppearance: () => current,
    stillOpen: () => open,
    canRecoverManually: () => manualRecoveryAllowed,
  }, flow);
  const actions: SkinSelectorActions = {
    preview: (skinId) => { previews.push(skinId); },
    confirm: () => { confirmed += 1; },
    cancel: () => { cancelled += 1; },
    rotatePreview: () => undefined,
    setPreviewRotationActive: () => undefined,
    equippedSkinId: options.equippedSkinId ?? appearance.skinId,
    monetizationAvailability: REWARDED_SKIN_AVAILABILITY,
    advertisementReady: options.advertisementReady !== false && ads.available,
    requestRewarded: (skinId) => controller.request(skinId),
    rewardOperationActive: () => controller.isOperationActive(),
    continueRewardRecovery: () => controller.continueFromRecovery(),
  };
  ui.showSkinSelector(appearance, actions);
  return {
    root,
    ui,
    ads,
    clock,
    flow,
    controller,
    applied,
    holds,
    previews,
    get confirmed() { return confirmed; },
    get cancelled() { return cancelled; },
    button: () => root.querySelector<HTMLButtonElement>('[data-action="confirm"]')!,
    cancelButton: () => root.querySelector<HTMLButtonElement>('[data-action="cancel"]')!,
    note: () => root.querySelector<HTMLElement>('[data-skin-action-note]')!,
    card: (skinId: string) => root.querySelector<HTMLButtonElement>(`[data-skin-id="${skinId}"]`)!,
    allowRecovery(allowed: boolean) {
      manualRecoveryAllowed = allowed;
    },
    close() {
      open = false;
      controller.dispose();
      ui.showMainMenu({
        singleplayer: () => undefined,
        online: () => undefined,
        settings: () => undefined,
        selectSkin: () => undefined,
      });
      root.remove();
    },
  };
}

describe('rewarded skin selector', () => {
  it('shows the watch button for a common skin and does not equip it on click', () => {
    const view = mount();
    view.card(COMMON_ID).click();
    const button = view.button();
    expect(button.textContent).toBe('Смотреть рекламу');
    expect(button.disabled).toBe(false);
    expect(button.classList.contains('primary')).toBe(true);
    expect(view.note().textContent).toContain('Одна реклама');
    button.click();
    expect(view.confirmed).toBe(0);
    expect(view.ads.calls).toHaveLength(1);
    expect(view.applied).toHaveLength(0);
    expect(view.holds).toEqual(['begin']);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe(REWARDED_SKIN_COPY.loading);
    expect(button.dataset.actionState).toBe('reward_pending');
    button.click();
    view.controller.request(COMMON_ID);
    expect(view.ads.calls).toHaveLength(1);
    view.close();
  });

  it('applies the captured skin once after reward and close', () => {
    const view = mount();
    view.card(COMMON_ID).click();
    view.button().click();
    view.card(OTHER_COMMON_ID).click();
    expect(view.previews).toEqual([COMMON_ID, OTHER_COMMON_ID]);
    const callbacks = view.ads.calls[0];
    callbacks?.onOpen?.();
    expect(view.applied).toHaveLength(0);
    expect(view.note().textContent).toBe(REWARDED_SKIN_COPY.opened);
    callbacks?.onRewarded?.();
    expect(view.applied).toHaveLength(0);
    callbacks?.onRewarded?.();
    callbacks?.onClose?.(true);
    callbacks?.onClose?.(true);
    expect(view.applied.map((appearance) => appearance.skinId)).toEqual([COMMON_ID]);
    expect(view.previews.at(-1)).toBe(COMMON_ID);
    expect(view.card(COMMON_ID).classList.contains('selected')).toBe(true);
    expect(view.button().textContent).toBe('Уже выбран');
    expect(view.note().textContent).toContain('Скин применён');
    expect(view.holds).toEqual(['begin', 'end']);
    view.button().click();
    expect(view.confirmed).toBe(1);
    expect(view.ads.calls).toHaveLength(1);
    view.close();
  });

  it('keeps the old skin after cancel or an SDK error and lets the player try again', () => {
    const view = mount();
    view.card(COMMON_ID).click();
    view.button().click();
    view.ads.calls[0]?.onOpen?.();
    view.ads.calls[0]?.onClose?.(true);
    expect(view.applied).toHaveLength(0);
    expect(view.note().textContent).toContain('Скин не изменён');
    expect(view.button().disabled).toBe(false);
    expect(view.button().textContent).toBe('Смотреть рекламу');
    view.button().click();
    view.ads.calls[1]?.onError?.(new Error('no fill'));
    expect(view.applied).toHaveLength(0);
    expect(view.note().textContent).toContain('Реклама сейчас недоступна');
    expect(view.button().disabled).toBe(false);
    view.close();
  });

  it('does not equip a skin when the SDK cannot show an ad', () => {
    const view = mount({ advertisementReady: false, available: false });
    view.card(COMMON_ID).click();
    const button = view.button();
    expect(button.textContent).toBe('Смотреть рекламу');
    expect(button.disabled).toBe(true);
    expect(button.tabIndex).toBe(-1);
    expect(view.note().textContent).toContain('Попробуйте позже');
    button.click();
    view.controller.request(COMMON_ID);
    expect(view.ads.calls).toHaveLength(0);
    expect(view.applied).toHaveLength(0);
    expect(view.confirmed).toBe(0);
    view.close();
  });

  it('leaves rare, epic, and legendary skins off the rewarded path', () => {
    const view = mount();
    view.card(RARE_ID).click();
    expect(view.button().textContent).toBe('Покупки скоро');
    expect(view.button().disabled).toBe(true);
    view.button().click();
    view.card(EPIC_ID).click();
    expect(view.button().textContent).toBe('Покупки скоро');
    view.button().click();
    view.card(LEGENDARY_ID).click();
    expect(view.button().textContent).toBe('Недоступно');
    view.button().click();
    expect(view.ads.calls).toHaveLength(0);
    expect(view.confirmed).toBe(0);
    view.card('frontier_explorer').click();
    expect(view.button().textContent).toBe('Уже выбран');
    view.close();
  });

  it('confirms the free starter without a video and does not replay a reward when reopened', () => {
    const view = mount({
      appearance: createPlayerAppearance({ skinId: COMMON_ID }),
      equippedSkinId: COMMON_ID,
    });
    view.card('frontier_explorer').click();
    expect(view.button().textContent).toBe('Подтвердить');
    view.button().click();
    expect(view.confirmed).toBe(1);
    expect(view.ads.calls).toHaveLength(0);
    view.close();

    const again = mount({ equippedSkinId: 'frontier_explorer' });
    again.card(COMMON_ID).click();
    expect(again.button().textContent).toBe('Смотреть рекламу');
    expect(again.applied).toHaveLength(0);
    expect(again.ads.calls).toHaveLength(0);
    again.close();
  });

  it('ignores a callback after the selector is disposed', () => {
    const view = mount();
    view.card(COMMON_ID).click();
    view.button().click();
    const callbacks = view.ads.calls[0];
    view.close();
    callbacks?.onRewarded?.();
    callbacks?.onClose?.(true);
    expect(view.applied).toHaveLength(0);
    expect(view.cancelled).toBe(0);
  });

  it('keeps the action note from pushing Confirm off Cancel\'s row', () => {
    const view = mount();
    view.card(COMMON_ID).click();
    const footer = view.root.querySelector('.skin-selector-footer');
    const children = [...footer?.children ?? []];
    expect(children.map((node) => node.tagName)).toEqual(['P', 'BUTTON', 'BUTTON']);
    expect(children[0]).toBe(view.note());
    expect(children[1]).toBe(view.cancelButton());
    expect(children[2]).toBe(view.button());
    view.note().textContent = 'Реклама сейчас недоступна. Попробуйте позже. Одна реклама — одна смена скина.';
    expect(view.button().parentElement).toBe(footer);
    expect(view.cancelButton().parentElement).toBe(footer);
    const css = readFileSync('src/style.css', 'utf8');
    const footerCss = css.slice(css.indexOf('.menu-footer.skin-selector-footer'), css.indexOf('.skin-card-preview'));
    expect(footerCss).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)');
    expect(footerCss).toContain('grid-column: 2');
    expect(footerCss).toContain('grid-row: 2');
    expect(footerCss).toContain('[data-action="cancel"]');
    expect(footerCss).toContain('[data-action="confirm"]');
    view.close();
  });

  it('does not swallow Enter on cards, cancel, or the rewarded button', () => {
    const view = mount();
    const card = view.card(COMMON_ID);
    card.focus();
    const onCard = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    card.dispatchEvent(onCard);
    expect(onCard.defaultPrevented).toBe(false);
    card.click();
    expect(view.button().textContent).toBe('Смотреть рекламу');

    const cancel = view.cancelButton();
    cancel.focus();
    const onCancel = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    cancel.dispatchEvent(onCancel);
    expect(onCancel.defaultPrevented).toBe(false);
    expect(view.cancelled).toBe(0);
    expect(view.ads.calls).toHaveLength(0);

    const button = view.button();
    button.focus();
    const onWatch = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    button.dispatchEvent(onWatch);
    expect(onWatch.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(button);
    button.click();
    expect(view.ads.calls).toHaveLength(1);
    expect(view.confirmed).toBe(0);

    const disabled = view.button();
    expect(disabled.disabled).toBe(true);
    expect(disabled.tabIndex).toBe(-1);
    const onDisabled = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    disabled.dispatchEvent(onDisabled);
    expect(onDisabled.defaultPrevented).toBe(false);
    expect(view.ads.calls).toHaveLength(1);
    view.close();
  });

  it('recovers the button when the SDK throws before a callback', () => {
    const view = mount();
    view.card(COMMON_ID).click();
    view.ads.throwOnShow = true;
    view.button().click();
    expect(view.applied).toHaveLength(0);
    expect(view.button().disabled).toBe(false);
    expect(view.button().textContent).toBe('Смотреть рекламу');
    expect(view.note().textContent).toContain('Реклама сейчас недоступна');
    view.close();
  });

  function pressEscape(): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  }

  function clickCancel(view: ReturnType<typeof mount>): void {
    const cancel = view.cancelButton();
    cancel.disabled = false;
    cancel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  it('keeps the rewarded flow when Cancel or Escape is pressed during the ad', () => {
    const view = mount();
    view.card(COMMON_ID).click();
    view.button().click();
    expect(view.button().textContent).toBe(REWARDED_SKIN_COPY.loading);
    clickCancel(view);
    pressEscape();
    expect(view.cancelled).toBe(0);
    expect(view.root.querySelector('.skin-selector-window')).toBeTruthy();
    expect(view.controller.isOperationActive()).toBe(true);
    view.ads.calls[0]?.onOpen?.();
    view.ads.calls[0]?.onRewarded?.();
    view.ads.calls[0]?.onClose?.(true);
    expect(view.applied.map((appearance) => appearance.skinId)).toEqual([COMMON_ID]);
    expect(view.controller.isOperationActive()).toBe(false);
    clickCancel(view);
    expect(view.cancelled).toBe(1);
    view.close();
  });

  it('restores Escape after the ad closes and after a cancel without a reward', () => {
    const rewarded = mount();
    rewarded.card(COMMON_ID).click();
    rewarded.button().click();
    pressEscape();
    expect(rewarded.cancelled).toBe(0);
    rewarded.ads.calls[0]?.onOpen?.();
    rewarded.ads.calls[0]?.onRewarded?.();
    rewarded.ads.calls[0]?.onClose?.(true);
    pressEscape();
    expect(rewarded.cancelled).toBe(1);
    rewarded.close();

    const cancelled = mount();
    cancelled.card(COMMON_ID).click();
    cancelled.button().click();
    cancelled.ads.calls[0]?.onOpen?.();
    cancelled.ads.calls[0]?.onClose?.(true);
    expect(cancelled.applied).toHaveLength(0);
    expect(cancelled.controller.isOperationActive()).toBe(false);
    pressEscape();
    expect(cancelled.cancelled).toBe(1);
    clickCancel(cancelled);
    expect(cancelled.cancelled).toBe(2);
    cancelled.close();
  });

  it('keeps a counted view through recovery and applies it once', () => {
    const view = mount();
    view.card(COMMON_ID).click();
    view.button().click();
    view.card(OTHER_COMMON_ID).click();
    view.ads.calls[0]?.onOpen?.();
    view.ads.calls[0]?.onRewarded?.();
    expect(view.button().textContent).toBe(REWARDED_SKIN_COPY.closing);
    expect(view.note().textContent).toContain('Просмотр засчитан');
    expect(view.applied).toHaveLength(0);
    view.clock.advance(8_000);
    expect(view.applied).toHaveLength(0);
    expect(view.holds).toEqual(['begin']);
    expect(view.button().textContent).toBe(REWARDED_SKIN_COPY.continue);
    expect(view.note().textContent).toContain('Если реклама уже закрылась');
    const cancelBox = view.cancelButton().getBoundingClientRect();
    const actionBox = view.button().getBoundingClientRect();
    expect(Math.abs(cancelBox.top - actionBox.top)).toBeLessThan(2);
    clickCancel(view);
    pressEscape();
    expect(view.cancelled).toBe(0);
    expect(view.controller.isOperationActive()).toBe(true);
    view.button().click();
    view.button().click();
    expect(view.applied.map((appearance) => appearance.skinId)).toEqual([COMMON_ID]);
    expect(view.holds).toEqual(['begin', 'end']);
    expect(view.ads.calls).toHaveLength(1);
    pressEscape();
    expect(view.cancelled).toBe(1);
    view.close();
  });

  it('does not apply a skin when recovery is continued without a counted view', () => {
    const view = mount();
    view.card(COMMON_ID).click();
    view.button().click();
    view.ads.calls[0]?.onOpen?.();
    view.clock.advance(120_000);
    expect(view.button().textContent).toBe(REWARDED_SKIN_COPY.continue);
    view.allowRecovery(false);
    view.button().click();
    expect(view.applied).toHaveLength(0);
    expect(view.controller.isOperationActive()).toBe(true);
    view.allowRecovery(true);
    view.button().click();
    expect(view.applied).toHaveLength(0);
    expect(view.controller.isOperationActive()).toBe(false);
    expect(view.note().textContent).toContain('Реклама сейчас недоступна');
    clickCancel(view);
    expect(view.cancelled).toBe(1);
    view.close();
  });
});
