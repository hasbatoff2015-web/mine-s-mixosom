import {
  HELD_ITEM_POSE_CANDIDATES,
  HELD_ITEM_POSE_COMPARE_ITEMS,
  HELD_ITEM_QA_FIELD_ORDER,
  HELD_ITEM_QA_FIELDS,
  formatHeldItemCopyQuery,
  formatHeldItemPoseBlock,
  formatHeldItemPoseTs,
  formatHeldItemQaScalar,
  keyboardNudgeMultiplier,
  matchingHeldItemPoseCandidate,
  type HeldItemQaField,
  type HeldItemQaLiveState,
  type HeldItemQaValues,
} from '../rendering/heldItemQa';

export interface HeldItemPosePanelOptions {
  readonly live: HeldItemQaLiveState;
  readonly production: HeldItemQaValues;
  readonly getItemId: () => string | undefined;
  readonly onChange: (values: HeldItemQaValues) => void;
  readonly onSelectItem: (itemId: string) => void;
  readonly canvas?: HTMLCanvasElement;
}

export interface HeldItemPosePanel {
  readonly element: HTMLElement;
  sync(): void;
  dispose(): void;
}

const PANEL_STYLE = [
  'position:fixed',
  'top:12px',
  'right:12px',
  'width:min(320px, calc(100vw - 24px))',
  'max-height:calc(100vh - 24px)',
  'overflow:auto',
  'z-index:8',
  'pointer-events:auto',
  'user-select:text',
  'touch-action:auto',
  'padding:10px 12px',
  'background:rgba(10,16,22,0.92)',
  'color:#f4f7fb',
  'font:11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  'border:1px solid rgba(255,255,255,0.14)',
  'border-radius:8px',
  'box-shadow:0 10px 32px rgba(0,0,0,0.4)',
].join(';');

export function mountHeldItemPosePanel(options: HeldItemPosePanelOptions): HeldItemPosePanel {
  const { live, production, getItemId, onChange, onSelectItem, canvas } = options;
  const root = document.createElement('div');
  root.id = 'held-pose-qa-panel';
  root.style.cssText = PANEL_STYLE;
  root.replaceChildren();

  const title = document.createElement('div');
  title.textContent = 'Held pose QA';
  title.style.cssText = 'font-weight:700;margin-bottom:8px;letter-spacing:0.02em';
  root.append(title);

  const hint = document.createElement('div');
  hint.style.cssText = 'opacity:0.75;margin-bottom:8px;white-space:pre-wrap';
  root.append(hint);

  const status = document.createElement('div');
  status.style.cssText = 'min-height:1.2em;margin:6px 0 8px;color:#9fe7c0';
  root.append(status);

  let activeField: HeldItemQaField = 'yaw';
  const sliders = new Map<HeldItemQaField, HTMLInputElement>();
  const numbers = new Map<HeldItemQaField, HTMLInputElement>();
  let dragging: 'rotate' | 'move' | undefined;
  let lastPointer = { x: 0, y: 0 };

  const emit = (values: HeldItemQaValues): void => {
    onChange(values);
    refreshControls(values);
  };

  const refreshControls = (values: HeldItemQaValues): void => {
    for (const field of HELD_ITEM_QA_FIELD_ORDER) {
      const slider = sliders.get(field);
      const input = numbers.get(field);
      if (slider && document.activeElement !== slider) slider.value = String(values[field]);
      if (input && document.activeElement !== input) {
        const step = HELD_ITEM_QA_FIELDS[field].step;
        input.value = formatHeldItemQaScalar(values[field], step < 1 ? 4 : 2);
      }
    }
    const preset = matchingHeldItemPoseCandidate(values);
    hint.textContent = [
      'arrows ±step  Shift×10  Alt×0.1',
      'Alt-drag rotate  Shift-drag XY',
      'wheel scale  Ctrl-wheel Z',
      preset ? `preset ${preset}` : 'live custom',
    ].join('\n');
  };

  const applyField = (field: HeldItemQaField, raw: string): void => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    emit(live.setField(field, value));
  };

  for (const field of HELD_ITEM_QA_FIELD_ORDER) {
    const spec = HELD_ITEM_QA_FIELDS[field];
    const row = document.createElement('label');
    row.style.cssText = [
      'display:grid',
      'grid-template-columns:52px 1fr 64px',
      'gap:6px',
      'align-items:center',
      'margin:0 0 6px',
      'cursor:pointer',
    ].join(';');

    const name = document.createElement('span');
    name.textContent = spec.label;
    name.dataset.field = field;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(spec.min);
    slider.max = String(spec.max);
    slider.step = String(spec.step);
    slider.style.cssText = 'width:100%;margin:0';
    slider.addEventListener('pointerdown', () => { activeField = field; });
    slider.addEventListener('focus', () => { activeField = field; });
    slider.addEventListener('input', () => applyField(field, slider.value));
    sliders.set(field, slider);

    const number = document.createElement('input');
    number.type = 'number';
    number.min = String(spec.min);
    number.max = String(spec.max);
    number.step = String(spec.step);
    number.style.cssText = 'width:64px;background:#111a;color:inherit;border:1px solid rgba(255,255,255,0.18);border-radius:4px;padding:2px 4px;user-select:text';
    number.addEventListener('focus', () => { activeField = field; number.select(); });
    number.addEventListener('input', () => {
      const raw = number.value.trim();
      if (raw === '' || raw === '-' || raw === '.' || raw === '-.' || raw.endsWith('.')) return;
      applyField(field, raw);
    });
    number.addEventListener('change', () => applyField(field, number.value));
    numbers.set(field, number);

    row.append(name, slider, number);
    root.append(row);
  }

  const buttonRow = (buttons: Array<{ label: string; onClick: () => void }>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:8px 0 0';
    for (const button of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = button.label;
      el.style.cssText = 'pointer-events:auto;cursor:pointer;background:#1d2a33;color:inherit;border:1px solid rgba(255,255,255,0.16);border-radius:4px;padding:4px 6px;font:inherit';
      el.addEventListener('click', button.onClick);
      wrap.append(el);
    }
    return wrap;
  };

  const flash = (message: string): void => {
    status.textContent = message;
  };

  const copyText = async (label: string, text: string): Promise<void> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.cssText = 'position:fixed;left:-9999px';
        document.body.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      flash(`copied ${label}`);
    } catch (error) {
      flash(`copy failed: ${String(error instanceof Error ? error.message : error)}`);
    }
  };

  root.append(buttonRow([
    { label: 'RESET PRODUCTION', onClick: () => emit(live.set(production)) },
    { label: 'RESET SUBTLE', onClick: () => emit(live.set(HELD_ITEM_POSE_CANDIDATES.subtle)) },
    { label: 'RESET BALANCED', onClick: () => emit(live.set(HELD_ITEM_POSE_CANDIDATES.balanced)) },
    { label: 'RESET STRONGER', onClick: () => emit(live.set(HELD_ITEM_POSE_CANDIDATES.stronger)) },
  ]));

  root.append(buttonRow([
    {
      label: 'COPY POSE',
      onClick: () => { void copyText('pose', formatHeldItemPoseBlock(live.get())); },
    },
    {
      label: 'COPY QUERY',
      onClick: () => {
        void copyText('query', formatHeldItemCopyQuery(getItemId() ?? 'iron_pickaxe', live.get()));
      },
    },
    {
      label: 'COPY TS',
      onClick: () => { void copyText('ts', formatHeldItemPoseTs(live.get())); },
    },
  ]));

  const items = document.createElement('div');
  items.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:8px';
  HELD_ITEM_POSE_COMPARE_ITEMS.forEach((itemId, index) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = `${index + 1} ${itemId}`;
    el.style.cssText = 'pointer-events:auto;cursor:pointer;background:#152028;color:inherit;border:1px solid rgba(255,255,255,0.14);border-radius:4px;padding:3px 5px;font:inherit';
    el.addEventListener('click', () => onSelectItem(itemId));
    items.append(el);
  });
  root.append(items);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight' && event.code !== 'ArrowUp' && event.code !== 'ArrowDown') {
      return;
    }
    const direction: -1 | 1 = event.code === 'ArrowLeft' || event.code === 'ArrowDown' ? -1 : 1;
    event.preventDefault();
    emit(live.nudge(activeField, direction, keyboardNudgeMultiplier(event.shiftKey, event.altKey)));
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (event.altKey) dragging = 'rotate';
    else if (event.shiftKey) dragging = 'move';
    else return;
    lastPointer = { x: event.clientX, y: event.clientY };
    canvas?.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const dx = event.clientX - lastPointer.x;
    const dy = event.clientY - lastPointer.y;
    lastPointer = { x: event.clientX, y: event.clientY };
    const current = live.get();
    if (dragging === 'rotate') {
      emit(live.set({
        ...current,
        yaw: current.yaw + dx * 0.25,
        pitch: current.pitch + -dy * 0.25,
      }));
    } else {
      emit(live.set({
        ...current,
        x: current.x + dx * 0.002,
        y: current.y + -dy * 0.002,
      }));
    }
    event.preventDefault();
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = undefined;
    try {
      canvas?.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const direction: -1 | 1 = event.deltaY > 0 ? -1 : 1;
    const field: HeldItemQaField = event.ctrlKey || event.metaKey ? 'z' : 'scale';
    activeField = field;
    emit(live.nudge(field, direction, keyboardNudgeMultiplier(event.shiftKey, event.altKey)));
  };

  addEventListener('keydown', onKeyDown);
  canvas?.addEventListener('pointerdown', onPointerDown);
  canvas?.addEventListener('pointermove', onPointerMove);
  canvas?.addEventListener('pointerup', onPointerUp);
  canvas?.addEventListener('pointercancel', onPointerUp);
  canvas?.addEventListener('wheel', onWheel, { passive: false });

  refreshControls(live.get());

  return {
    element: root,
    sync: () => refreshControls(live.get()),
    dispose: () => {
      removeEventListener('keydown', onKeyDown);
      canvas?.removeEventListener('pointerdown', onPointerDown);
      canvas?.removeEventListener('pointermove', onPointerMove);
      canvas?.removeEventListener('pointerup', onPointerUp);
      canvas?.removeEventListener('pointercancel', onPointerUp);
      canvas?.removeEventListener('wheel', onWheel);
      root.remove();
    },
  };
}
