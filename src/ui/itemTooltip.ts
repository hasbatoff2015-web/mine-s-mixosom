export const ITEM_TOOLTIP_OFFSET_X = 12;
export const ITEM_TOOLTIP_OFFSET_Y = 16;
export const ITEM_TOOLTIP_CURSOR_OFFSET_X = 24;
export const ITEM_TOOLTIP_CURSOR_OFFSET_Y = 28;
const VIEWPORT_PAD = 8;

export interface TooltipPoint {
  readonly x: number;
  readonly y: number;
}

export interface ItemTooltipHandle {
  hide(): void;
  dispose(): void;
}

export function itemHoverAttributeString(name: string, itemId: string, escapeHtml: (value: string) => string): string {
  const label = escapeHtml(name);
  return ` data-item-tooltip="${label}" data-item-id="${escapeHtml(itemId)}" aria-label="${label}"`;
}

export function clampTooltipPosition(
  pointerX: number,
  pointerY: number,
  tooltipWidth: number,
  tooltipHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  offsetX = ITEM_TOOLTIP_OFFSET_X,
  offsetY = ITEM_TOOLTIP_OFFSET_Y,
  pad = VIEWPORT_PAD,
): TooltipPoint {
  const width = Math.max(0, tooltipWidth);
  const height = Math.max(0, tooltipHeight);
  const maxX = Math.max(pad, viewportWidth - pad - width);
  const maxY = Math.max(pad, viewportHeight - pad - height);
  let x = pointerX + offsetX;
  let y = pointerY + offsetY;
  if (x + width > viewportWidth - pad) x = pointerX - offsetX - width;
  if (y + height > viewportHeight - pad) y = pointerY - offsetY - height;
  return {
    x: Math.min(maxX, Math.max(pad, x)),
    y: Math.min(maxY, Math.max(pad, y)),
  };
}

export function copyItemHoverAttributes(current: HTMLElement, incoming: HTMLElement): void {
  current.removeAttribute('title');
  if (incoming.dataset.itemTooltip) current.dataset.itemTooltip = incoming.dataset.itemTooltip;
  else delete current.dataset.itemTooltip;
  if (incoming.dataset.itemId) current.dataset.itemId = incoming.dataset.itemId;
  else delete current.dataset.itemId;
  const aria = incoming.getAttribute('aria-label');
  if (aria) current.setAttribute('aria-label', aria);
  else current.removeAttribute('aria-label');
}

export function attachItemTooltip(
  root: HTMLElement,
  options: { cursorStackPresent?: () => boolean } = {},
): ItemTooltipHandle {
  let node = root.querySelector<HTMLElement>('.mc-item-tooltip');
  if (!node) {
    node = document.createElement('div');
    node.className = 'mc-item-tooltip';
    (root.querySelector('.mc-stage') ?? root).append(node);
  }

  const hide = (): void => {
    node.classList.remove('is-visible');
    node.textContent = '';
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') {
      hide();
      return;
    }
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-item-tooltip]');
    const text = target?.dataset.itemTooltip ?? '';
    if (!text || target?.closest('[hidden]')) {
      hide();
      return;
    }
    node.textContent = text;
    node.classList.add('is-visible');
    const rect = node.getBoundingClientRect();
    const holding = options.cursorStackPresent?.() === true;
    const position = clampTooltipPosition(
      event.clientX,
      event.clientY,
      rect.width,
      rect.height,
      window.innerWidth,
      window.innerHeight,
      holding ? ITEM_TOOLTIP_CURSOR_OFFSET_X : ITEM_TOOLTIP_OFFSET_X,
      holding ? ITEM_TOOLTIP_CURSOR_OFFSET_Y : ITEM_TOOLTIP_OFFSET_Y,
    );
    node.style.left = `${position.x}px`;
    node.style.top = `${position.y}px`;
  };

  const onPointerLeave = (event: PointerEvent): void => {
    if (event.currentTarget === root) hide();
  };

  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerleave', onPointerLeave);
  root.addEventListener('pointerdown', hide);
  hide();

  return {
    hide,
    dispose() {
      hide();
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerleave', onPointerLeave);
      root.removeEventListener('pointerdown', hide);
    },
  };
}
