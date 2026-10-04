import { GameUI } from '../ui/GameUI';
import { Inventory } from '../inventory';
import {
  formatHudEditorValues,
  hudEditorPairGap,
  hudEditorReadout,
  type HudEditorBox,
  type HudEditorOrigin,
} from './hudEditorMetrics';

const EDITOR_STYLE = `
#hud-editor-root {
  position: fixed;
  z-index: 80;
  left: 12px;
  top: 12px;
  width: min(360px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: auto;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(8, 14, 18, 0.92);
  color: #f4f7f8;
  font: 13px/1.35 ui-monospace, monospace;
  pointer-events: auto;
}
#hud-editor-root h2 {
  margin: 0 0 8px;
  font: 700 14px/1.2 var(--font-ui, sans-serif);
}
#hud-editor-root .hud-editor-card {
  margin: 0 0 8px;
  padding: 8px;
  border: 1px solid rgba(255, 80, 80, 0.55);
}
#hud-editor-root .hud-editor-card h3 {
  margin: 0 0 4px;
  color: #ffb4b4;
}
#hud-editor-root p { margin: 0 0 8px; }
#hud-editor-root button {
  margin: 0 6px 6px 0;
  padding: 6px 8px;
  border: 1px solid #d7e2e6;
  background: #1b272d;
  color: #fff;
  cursor: pointer;
}
#hud-editor-root button[aria-pressed="true"] {
  background: #8a2a2a;
}
#hud-editor-root textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 180px;
  margin-top: 6px;
  color: #e8fff0;
  background: #070c0f;
  border: 1px solid #345;
}
#hud-editor-guides {
  position: fixed;
  inset: 0;
  z-index: 35;
  pointer-events: none;
}
#hud-editor-guides .hud-editor-right-edge {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 1px;
  background: #ff4d4d;
}
#chat-send.hud-editor-fixed {
  outline: 1px solid rgba(255, 255, 255, 0.45);
}
#chat-close.hud-editor-target,
#chat-visibility.hud-editor-target {
  outline: 1px dashed #ff4d4d;
  outline-offset: 0;
  cursor: grab;
  z-index: 40;
}
#chat-close.hud-editor-target::after,
#chat-visibility.hud-editor-target::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 8px;
  height: 8px;
  background: #ff4d4d;
  pointer-events: none;
}
body.hud-editor-locked #chat-close.hud-editor-target,
body.hud-editor-locked #chat-visibility.hud-editor-target {
  cursor: default;
}
`;

interface DragState {
  readonly id: 'tab' | 'chatOn';
  readonly pointerId: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export function startHudEditorHarness(canvas: HTMLCanvasElement, uiRoot: HTMLElement): () => void {
  canvas.style.background = `linear-gradient(rgba(4, 11, 10, 0.28), rgba(4, 11, 10, 0.48)), url('${import.meta.env.BASE_URL}ui/frontier-menu-background.png') center / cover`;
  const style = document.createElement('style');
  style.id = 'hud-editor-style';
  style.textContent = EDITOR_STYLE;
  document.head.append(style);

  const ui = new GameUI(uiRoot);
  ui.enterGame();
  ui.updateHud({
    inventory: new Inventory(),
    selectedSlot: 0,
    health: 20,
    hunger: 20,
    armor: 0,
    absorption: 0,
    miningProgress: 0,
  });
  ui.appendChat({ id: 'hud-editor-1', kind: 'system', text: 'HUD editor. Перетащите TAB и CHAT ON.', createdAtMs: Date.now() });
  ui.openChat();

  const tabEl = document.querySelector<HTMLElement>('#chat-close')!;
  const chatOnEl = document.querySelector<HTMLElement>('#chat-visibility')!;
  const enterEl = document.querySelector<HTMLElement>('#chat-send')!;
  const initial = {
    tab: pinToViewport(tabEl),
    chatOn: pinToViewport(chatOnEl),
  };
  enterEl.classList.add('hud-editor-fixed');
  tabEl.classList.add('hud-editor-target');
  chatOnEl.classList.add('hud-editor-target');

  const guides = document.createElement('div');
  guides.id = 'hud-editor-guides';
  guides.innerHTML = '<div class="hud-editor-right-edge"></div>';
  document.body.append(guides);

  const panel = document.createElement('aside');
  panel.id = 'hud-editor-root';
  panel.innerHTML = `
    <h2>HUD editor</h2>
    <p>Тащите TAB и CHAT ON. ENTER не двигается. Размеры кнопок фиксированы.</p>
    <div>
      <button type="button" id="hud-editor-origin" aria-pressed="true">Координаты: RIGHT / TOP</button>
      <button type="button" id="hud-editor-lock" aria-pressed="false">LOCK</button>
      <button type="button" id="hud-editor-reset">RESET</button>
      <button type="button" id="hud-editor-copy">COPY VALUES</button>
    </div>
    <section class="hud-editor-card" id="hud-editor-tab"></section>
    <section class="hud-editor-card" id="hud-editor-chat-on"></section>
    <p id="hud-editor-gap"></p>
    <textarea id="hud-editor-output" readonly aria-label="Координаты кнопок"></textarea>
  `;
  document.body.append(panel);

  let origin: HudEditorOrigin = 'right-top';
  let locked = false;
  let drag: DragState | undefined;

  const boxes = (): { tab: HudEditorBox; chatOn: HudEditorBox } => ({
    tab: readBox(tabEl),
    chatOn: readBox(chatOnEl),
  });

  const render = (): void => {
    const current = boxes();
    const tab = hudEditorReadout(current.tab, window.innerWidth);
    const chatOn = hudEditorReadout(current.chatOn, window.innerWidth);
    const gap = hudEditorPairGap(current.tab, current.chatOn);
    panel.querySelector('#hud-editor-tab')!.innerHTML = cardHtml('TAB', tab);
    panel.querySelector('#hud-editor-chat-on')!.innerHTML = cardHtml('CHAT ON', chatOn);
    panel.querySelector('#hud-editor-gap')!.textContent = `Между TAB и CHAT ON: vertical ${gap.vertical}px, right delta ${gap.rightDelta}px`;
    const text = formatHudEditorValues({
      origin,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      tab: current.tab,
      chatOn: current.chatOn,
    });
    (panel.querySelector('#hud-editor-output') as HTMLTextAreaElement).value = text;
  };

  const place = (element: HTMLElement, left: number, top: number): void => {
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    render();
  };

  const onPointerDown = (id: 'tab' | 'chatOn', element: HTMLElement) => (event: PointerEvent): void => {
    if (locked || event.button !== 0) return;
    const box = readBox(element);
    drag = { id, pointerId: event.pointerId, offsetX: event.clientX - box.left, offsetY: event.clientY - box.top };
    try { element.setPointerCapture(event.pointerId); } catch { /* Synthetic editor probes have no pointer. */ }
    event.preventDefault();
    event.stopPropagation();
  };
  const onPointerMove = (element: HTMLElement) => (event: PointerEvent): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    place(element, event.clientX - drag.offsetX, event.clientY - drag.offsetY);
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = undefined;
    render();
  };

  tabEl.addEventListener('pointerdown', onPointerDown('tab', tabEl));
  chatOnEl.addEventListener('pointerdown', onPointerDown('chatOn', chatOnEl));
  tabEl.addEventListener('pointermove', onPointerMove(tabEl));
  chatOnEl.addEventListener('pointermove', onPointerMove(chatOnEl));
  tabEl.addEventListener('pointerup', onPointerUp);
  chatOnEl.addEventListener('pointerup', onPointerUp);
  tabEl.addEventListener('click', (event) => event.preventDefault());
  chatOnEl.addEventListener('click', (event) => event.preventDefault());

  panel.querySelector('#hud-editor-origin')!.addEventListener('click', () => {
    origin = origin === 'right-top' ? 'left-top' : 'right-top';
    const button = panel.querySelector('#hud-editor-origin')!;
    button.textContent = origin === 'right-top' ? 'Координаты: RIGHT / TOP' : 'Координаты: LEFT / TOP';
    button.setAttribute('aria-pressed', origin === 'right-top' ? 'true' : 'false');
    render();
  });
  panel.querySelector('#hud-editor-lock')!.addEventListener('click', () => {
    locked = !locked;
    document.body.classList.toggle('hud-editor-locked', locked);
    const button = panel.querySelector('#hud-editor-lock')!;
    button.setAttribute('aria-pressed', locked ? 'true' : 'false');
    button.textContent = locked ? 'LOCKED' : 'LOCK';
  });
  panel.querySelector('#hud-editor-reset')!.addEventListener('click', () => {
    place(tabEl, initial.tab.left, initial.tab.top);
    place(chatOnEl, initial.chatOn.left, initial.chatOn.top);
  });
  panel.querySelector('#hud-editor-copy')!.addEventListener('click', async () => {
    const text = (panel.querySelector('#hud-editor-output') as HTMLTextAreaElement).value;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* The textarea already holds the current values. */
    }
  });
  window.addEventListener('resize', render);
  render();

  return () => {
    style.remove();
    guides.remove();
    panel.remove();
    document.body.classList.remove('hud-editor-locked');
  };
}

function pinToViewport(element: HTMLElement): HudEditorBox {
  const box = readBox(element);
  element.style.position = 'fixed';
  element.style.margin = '0';
  element.style.right = 'auto';
  element.style.bottom = 'auto';
  element.style.left = `${box.left}px`;
  element.style.top = `${box.top}px`;
  element.style.width = `${box.width}px`;
  element.style.height = `${box.height}px`;
  return box;
}

function readBox(element: HTMLElement): HudEditorBox {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function cardHtml(title: string, readout: ReturnType<typeof hudEditorReadout>): string {
  return [
    `<h3>${title}</h3>`,
    `X: ${readout.x}`,
    `Y: ${readout.y}`,
    `RIGHT: ${readout.right}`,
    `TOP: ${readout.top}`,
    `WIDTH: ${readout.width}`,
    `HEIGHT: ${readout.height}`,
  ].join('<br>');
}
