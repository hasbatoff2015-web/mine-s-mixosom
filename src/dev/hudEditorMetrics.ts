/** Viewport readouts for the temporary HUD editor. Pure so tests can lock the CSS numbers. */

export type HudEditorOrigin = 'left-top' | 'right-top';

export interface HudEditorBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface HudEditorReadout {
  readonly x: number;
  readonly y: number;
  readonly right: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function roundHudEditorPx(value: number): number {
  return Math.round(value * 100) / 100;
}

export function hudEditorReadout(
  box: HudEditorBox,
  viewportWidth: number,
): HudEditorReadout {
  return {
    x: roundHudEditorPx(box.left),
    y: roundHudEditorPx(box.top),
    right: roundHudEditorPx(viewportWidth - (box.left + box.width)),
    top: roundHudEditorPx(box.top),
    width: roundHudEditorPx(box.width),
    height: roundHudEditorPx(box.height),
  };
}

/** Positive when CHAT ON starts below TAB. Unchanged by moving both boxes by the same delta. */
export function hudEditorPairGap(tab: HudEditorBox, chatOn: HudEditorBox): {
  readonly vertical: number;
  readonly rightDelta: number;
} {
  return {
    vertical: roundHudEditorPx(chatOn.top - (tab.top + tab.height)),
    rightDelta: roundHudEditorPx((tab.left + tab.width) - (chatOn.left + chatOn.width)),
  };
}

export function formatHudEditorValues(input: {
  readonly origin: HudEditorOrigin;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly tab: HudEditorBox;
  readonly chatOn: HudEditorBox;
}): string {
  const tab = hudEditorReadout(input.tab, input.viewportWidth);
  const chatOn = hudEditorReadout(input.chatOn, input.viewportWidth);
  const gap = hudEditorPairGap(input.tab, input.chatOn);
  const anchor = input.origin === 'right-top' ? 'right / top' : 'left / top';
  const css = (label: string, readout: HudEditorReadout): string => input.origin === 'right-top'
    ? [
      label,
      `right: ${readout.right}px;`,
      `top: ${readout.top}px;`,
      `width: ${readout.width}px;`,
      `height: ${readout.height}px;`,
    ].join('\n')
    : [
      label,
      `left: ${readout.x}px;`,
      `top: ${readout.top}px;`,
      `width: ${readout.width}px;`,
      `height: ${readout.height}px;`,
    ].join('\n');
  return [
    `origin: ${anchor}`,
    `viewport: ${roundHudEditorPx(input.viewportWidth)} x ${roundHudEditorPx(input.viewportHeight)}`,
    '',
    'TAB',
    `X: ${tab.x}`,
    `Y: ${tab.y}`,
    `RIGHT: ${tab.right}`,
    `TOP: ${tab.top}`,
    `WIDTH: ${tab.width}`,
    `HEIGHT: ${tab.height}`,
    '',
    'CHAT ON',
    `X: ${chatOn.x}`,
    `Y: ${chatOn.y}`,
    `RIGHT: ${chatOn.right}`,
    `TOP: ${chatOn.top}`,
    `WIDTH: ${chatOn.width}`,
    `HEIGHT: ${chatOn.height}`,
    '',
    `GAP vertical: ${gap.vertical}`,
    `GAP right delta: ${gap.rightDelta}`,
    '',
    css('/* TAB */', tab),
    '',
    css('/* CHAT ON */', chatOn),
  ].join('\n');
}
