/**
 * Server snapshots may refresh a form while a player is typing.
 * The focused field stays the same DOM node (so the mobile keyboard stays up).
 * Its unsent draft is kept. Every other node takes the server state.
 */

export interface FieldEcho {
  echo: string;
  pending: string | null;
}

export interface FieldPlan {
  readonly value: string;
  readonly lastEcho: string;
  readonly pendingSent: string | null;
}

const ECHO_FIELD_ATTRIBUTES = [
  'data-menu-home-name',
  'data-menu-friend-name',
  'data-menu-claim-name',
  'data-menu-claim-member',
  'data-menu-trade-name',
  'data-ah-price',
  'data-ah-search',
  'data-clan-invite-name',
  'data-clan-search',
  'data-clan-name',
  'data-clan-announce-text',
  'data-buyer-name',
  'data-buyer-price',
  'data-trade-money',
] as const;

export function echoFieldKey(element: Element): string | null {
  for (const attr of ECHO_FIELD_ATTRIBUTES) {
    if (element.hasAttribute(attr)) return attr;
  }
  return null;
}

export function isTextField(node: EventTarget | null): node is HTMLInputElement | HTMLTextAreaElement {
  return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement;
}

/** IME owns the field between compositionstart and compositionend. Do not rewrite it. */
export function watchFieldComposition(field: HTMLElement): void {
  if (field.dataset.compositionWatch === '1') return;
  field.dataset.compositionWatch = '1';
  field.addEventListener('compositionstart', () => {
    field.dataset.composing = '1';
  });
  field.addEventListener('compositionend', () => {
    delete field.dataset.composing;
  });
}

export function fieldIsComposing(field: HTMLElement): boolean {
  return field.dataset.composing === '1';
}

/**
 * Focused draft wins over a stale echo.
 * An empty server value replaces the draft only after that exact draft was sent
 * (the server accepted the action and cleared the field).
 * `rejectedPending` replaces the draft when the server refused the value we sent
 * and returned a different authoritative one (trade money, prices).
 */
export function planAuthoritativeField(input: {
  focused: boolean;
  composing: boolean;
  current: string;
  server: string;
  lastEcho: string;
  pendingSent: string | null;
  rejectedPending?: boolean;
}): FieldPlan {
  const { current, server } = input;
  let { lastEcho, pendingSent } = input;
  if (input.composing) return { value: current, lastEcho, pendingSent };
  if (!input.focused || current === server || current === lastEcho) {
    return { value: server, lastEcho: server, pendingSent: null };
  }
  if (pendingSent !== null && server === pendingSent) {
    return {
      value: current,
      lastEcho: server,
      pendingSent: current === pendingSent ? null : pendingSent,
    };
  }
  // Clear only after the server has already echoed this exact draft, then emptied it.
  // An earlier empty snapshot must not wipe a newer unsent name.
  const serverClearedSentDraft = pendingSent !== null
    && pendingSent !== ''
    && current === pendingSent
    && server === ''
    && lastEcho === pendingSent;
  const serverRejectedSentDraft = input.rejectedPending === true
    && pendingSent !== null
    && current === pendingSent
    && server !== pendingSent;
  if (serverClearedSentDraft || serverRejectedSentDraft) {
    return { value: server, lastEcho: server, pendingSent: null };
  }
  return { value: current, lastEcho, pendingSent };
}

export function stampScreenContext(html: string, attr: string, value: string, token: string): string {
  if (!html.includes(token) || html.includes(`${attr}=`)) return html;
  const safe = value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
  return html.replace(token, `${attr}="${safe}" ${token}`);
}

export function parseMarkup(html: string): HTMLElement {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  const node = template.content.firstElementChild;
  if (!(node instanceof HTMLElement)) throw new Error('markup has no element');
  return node;
}

function syncAttributes(live: HTMLElement, fresh: HTMLElement): void {
  const next = new Set(fresh.getAttributeNames());
  for (const name of [...live.getAttributeNames()]) {
    if (name === 'data-composing' || name === 'data-composition-watch') continue;
    if (!next.has(name)) live.removeAttribute(name);
  }
  for (const name of fresh.getAttributeNames()) {
    if (name === 'value') continue;
    const value = fresh.getAttribute(name);
    if (value !== null && live.getAttribute(name) !== value) live.setAttribute(name, value);
  }
  if ('disabled' in live && 'disabled' in fresh) {
    (live as HTMLButtonElement).disabled = (fresh as HTMLButtonElement).disabled;
  }
  live.hidden = fresh.hidden;
}

function patchChildren(
  live: HTMLElement,
  fresh: HTMLElement,
  active: EventTarget | null,
  syncField: (live: HTMLInputElement | HTMLTextAreaElement, fresh: HTMLInputElement | HTMLTextAreaElement) => void,
): void {
  const liveChildren = Array.from(live.childNodes);
  const freshChildren = Array.from(fresh.childNodes);
  const shared = Math.min(liveChildren.length, freshChildren.length);
  for (let index = 0; index < shared; index += 1) {
    const current = liveChildren[index]!;
    const incoming = freshChildren[index]!;
    if (current instanceof HTMLElement && incoming instanceof HTMLElement && current.tagName === incoming.tagName) {
      patchElement(current, incoming, active, syncField);
      continue;
    }
    if (current.nodeType === Node.TEXT_NODE && incoming.nodeType === Node.TEXT_NODE) {
      if (current.textContent !== incoming.textContent) current.textContent = incoming.textContent;
      continue;
    }
    if (active instanceof Node && (current === active || (current instanceof HTMLElement && current.contains(active)))) {
      continue;
    }
    current.replaceWith(incoming.cloneNode(true));
  }
  for (let index = shared; index < liveChildren.length; index += 1) {
    const current = liveChildren[index]!;
    if (active instanceof Node && (current === active || (current instanceof HTMLElement && current.contains(active)))) {
      continue;
    }
    current.remove();
  }
  for (let index = shared; index < freshChildren.length; index += 1) {
    live.appendChild(freshChildren[index]!.cloneNode(true));
  }
}

function patchElement(
  live: HTMLElement,
  fresh: HTMLElement,
  active: EventTarget | null,
  syncField: (live: HTMLInputElement | HTMLTextAreaElement, fresh: HTMLInputElement | HTMLTextAreaElement) => void,
): void {
  if (isTextField(live) && isTextField(fresh)) {
    if (fieldIsComposing(live)) return;
    syncField(live, fresh);
    return;
  }
  syncAttributes(live, fresh);
  if (isTextField(live)) return;
  patchChildren(live, fresh, active, syncField);
}

const SCROLL_SELECTOR = '.mc-menu-list, .mc-clan-list, .mc-friend-chat-log, .mc-grid, .mc-menu-body, .mc-ah-body';

/** Refresh `live` from `fresh` without moving the active text field. */
export function patchPreservingFocus(
  live: HTMLElement,
  fresh: HTMLElement,
  active: EventTarget | null,
  syncField: (live: HTMLInputElement | HTMLTextAreaElement, fresh: HTMLInputElement | HTMLTextAreaElement) => void,
): void {
  const scrolls: Array<{ element: HTMLElement; top: number }> = [];
  const seen = new Set<HTMLElement>();
  const remember = (element: HTMLElement | null): void => {
    if (!element || seen.has(element)) return;
    seen.add(element);
    scrolls.push({ element, top: element.scrollTop });
  };
  remember(live);
  for (const element of live.querySelectorAll<HTMLElement>(SCROLL_SELECTOR)) remember(element);
  patchElement(live, fresh, active, syncField);
  for (const entry of scrolls) {
    if (entry.element.isConnected) entry.element.scrollTop = entry.top;
  }
}
