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

export function itemHoverAttributeString(
  name: string,
  itemId: string,
  escapeHtml: (value: string) => string,
  hint?: string,
  layout?: 'auction',
): string {
  const label = escapeHtml(name);
  const hintText = hint?.trim() ? escapeHtml(hint.trim()) : '';
  const hintAttr = hintText ? ` data-item-tooltip-hint="${hintText}"` : '';
  const layoutAttr = layout === 'auction' ? ' data-item-tooltip-layout="auction"' : '';
  const aria = hintText ? `${label}. ${hintText}` : label;
  return ` data-item-tooltip="${label}" data-item-id="${escapeHtml(itemId)}" aria-label="${aria}"${hintAttr}${layoutAttr}`;
}

export function splitAuctionTooltip(text: string): { name: string; price: string; meta: string[] } {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  const name = lines[0] ?? '';
  const priceIndex = lines.findIndex((line) => line.startsWith('Цена:'));
  const price = priceIndex >= 0 ? lines[priceIndex]! : '';
  const meta = lines.filter((_line, index) => index !== 0 && index !== priceIndex);
  return { name, price, meta };
}

export function fillItemTooltipNode(node: HTMLElement, text: string, hint = '', layout?: string): void {
  const auction = layout === 'auction';
  node.classList.toggle('is-auction', auction);
  if (auction) {
    const parts = splitAuctionTooltip(text);
    const children: HTMLElement[] = [];
    const title = document.createElement('div');
    title.className = 'mc-item-tooltip-title';
    title.textContent = parts.name;
    children.push(title);
    if (parts.price) {
      const price = document.createElement('div');
      price.className = 'mc-item-tooltip-price';
      price.textContent = parts.price;
      children.push(price);
    }
    if (parts.meta.length > 0) {
      const meta = document.createElement('div');
      meta.className = 'mc-item-tooltip-meta';
      meta.textContent = parts.meta.join('\n');
      children.push(meta);
    }
    if (hint.trim()) {
      const hintNode = document.createElement('div');
      hintNode.className = 'mc-item-tooltip-hint';
      hintNode.textContent = hint.trim();
      children.push(hintNode);
    }
    node.replaceChildren(...children);
    return;
  }
  if (hint.trim()) {
    const body = document.createElement('div');
    body.className = 'mc-item-tooltip-body';
    body.textContent = text;
    const hintNode = document.createElement('div');
    hintNode.className = 'mc-item-tooltip-hint';
    hintNode.textContent = hint.trim();
    node.replaceChildren(body, hintNode);
    return;
  }
  node.textContent = text;
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
  if (incoming.dataset.itemTooltipHint) current.dataset.itemTooltipHint = incoming.dataset.itemTooltipHint;
  else delete current.dataset.itemTooltipHint;
  if (incoming.dataset.itemTooltipLayout) current.dataset.itemTooltipLayout = incoming.dataset.itemTooltipLayout;
  else delete current.dataset.itemTooltipLayout;
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
    node.classList.remove('is-visible', 'is-auction');
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
    const hint = target?.dataset.itemTooltipHint?.trim() ?? '';
    fillItemTooltipNode(node, text, hint, target?.dataset.itemTooltipLayout);
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
