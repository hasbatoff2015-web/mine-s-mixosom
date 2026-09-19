import {
  formatThirdPersonHeldItemCopy,
  formatThirdPersonHeldItemCopyAll,
  formatThirdPersonHeldScalar,
  type ThirdPersonHeldItemTransform,
} from '../rendering/player/thirdPersonHeldItem';

export type MoveItemsAxis = 'x' | 'y' | 'z';
export type MoveItemsChannel = 'position' | 'rotation' | 'scale';
export type MoveItemsField = `${MoveItemsChannel}.${MoveItemsAxis}`;

export interface MoveItemsCatalogGroup {
  readonly label: string;
  readonly ids: readonly string[];
}

export interface MoveItemsPanelOptions {
  readonly catalog: readonly MoveItemsCatalogGroup[];
  readonly getItemId: () => string;
  readonly getTransform: () => ThirdPersonHeldItemTransform;
  readonly getCategory: () => string;
  readonly onSelectItem: (itemId: string) => void;
  readonly onChange: (transform: ThirdPersonHeldItemTransform) => void;
  readonly onReset: () => void;
  readonly getCopyAllEntries: () => ReadonlyArray<{
    readonly itemId: string;
    readonly transform: ThirdPersonHeldItemTransform;
  }>;
}

export interface MoveItemsPanel {
  readonly element: HTMLElement;
  sync(): void;
  dispose(): void;
}

const PANEL_STYLE = [
  'position:fixed',
  'top:12px',
  'right:12px',
  'width:min(360px, calc(100vw - 24px))',
  'max-height:calc(100vh - 24px)',
  'overflow:auto',
  'z-index:20',
  'pointer-events:auto',
  'user-select:text',
  'touch-action:auto',
  'padding:12px',
  'background:rgba(10,16,22,0.94)',
  'color:#f4f7fb',
  'font:12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  'border:1px solid rgba(255,255,255,0.14)',
  'border-radius:8px',
  'box-shadow:0 10px 32px rgba(0,0,0,0.4)',
].join(';');

const FIELD_SPECS: ReadonlyArray<{
  channel: MoveItemsChannel;
  axis: MoveItemsAxis;
  min: number;
  max: number;
  step: number;
}> = [
  { channel: 'position', axis: 'x', min: -2, max: 2, step: 0.005 },
  { channel: 'position', axis: 'y', min: -2, max: 2, step: 0.005 },
  { channel: 'position', axis: 'z', min: -2, max: 2, step: 0.005 },
  { channel: 'rotation', axis: 'x', min: -Math.PI * 2, max: Math.PI * 2, step: 0.01 },
  { channel: 'rotation', axis: 'y', min: -Math.PI * 2, max: Math.PI * 2, step: 0.01 },
  { channel: 'rotation', axis: 'z', min: -Math.PI * 2, max: Math.PI * 2, step: 0.01 },
  { channel: 'scale', axis: 'x', min: 0.05, max: 3, step: 0.01 },
  { channel: 'scale', axis: 'y', min: 0.05, max: 3, step: 0.01 },
  { channel: 'scale', axis: 'z', min: 0.05, max: 3, step: 0.01 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function setField(
  transform: ThirdPersonHeldItemTransform,
  channel: MoveItemsChannel,
  axis: MoveItemsAxis,
  value: number,
): ThirdPersonHeldItemTransform {
  return {
    position: { ...transform.position },
    rotation: { ...transform.rotation },
    scale: { ...transform.scale },
    [channel]: { ...transform[channel], [axis]: value },
  };
}

function buttonStyle(): string {
  return 'pointer-events:auto;cursor:pointer;background:#1d2a33;color:inherit;border:1px solid rgba(255,255,255,0.16);border-radius:4px;padding:4px 8px;font:inherit';
}

export function mountMoveItemsPanel(options: MoveItemsPanelOptions): MoveItemsPanel {
  const root = document.createElement('div');
  root.id = 'moveitems-panel';
  root.style.cssText = PANEL_STYLE;

  const title = document.createElement('div');
  title.textContent = 'Third-person held item calibrator';
  title.style.cssText = 'font-weight:700;margin-bottom:6px;letter-spacing:0.02em';
  root.append(title);

  const hint = document.createElement('div');
  hint.textContent = 'Drag canvas to orbit · wheel zoom · arrows nudge focused field';
  hint.style.cssText = 'opacity:0.72;margin-bottom:8px;white-space:pre-wrap';
  root.append(hint);

  const itemRow = document.createElement('div');
  itemRow.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:center;margin-bottom:8px';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.textContent = '◀';
  prev.style.cssText = buttonStyle();
  const select = document.createElement('select');
  select.style.cssText = 'width:100%;background:#111a;color:inherit;border:1px solid rgba(255,255,255,0.18);border-radius:4px;padding:4px';
  for (const group of options.catalog) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    for (const id of group.ids) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = id;
      optgroup.append(option);
    }
    select.append(optgroup);
  }
  const next = document.createElement('button');
  next.type = 'button';
  next.textContent = '▶';
  next.style.cssText = buttonStyle();
  itemRow.append(prev, select, next);
  root.append(itemRow);

  const meta = document.createElement('div');
  meta.style.cssText = 'opacity:0.8;margin-bottom:8px';
  root.append(meta);

  const sliders = new Map<MoveItemsField, HTMLInputElement>();
  const numbers = new Map<MoveItemsField, HTMLInputElement>();
  const degreeLabels = new Map<MoveItemsAxis, HTMLElement>();
  let activeField: MoveItemsField = 'position.x';

  const catalogIds = options.catalog.flatMap((group) => [...group.ids]);
  const selectRelative = (delta: number): void => {
    const current = options.getItemId();
    const index = catalogIds.indexOf(current);
    const nextIndex = (index + delta + catalogIds.length) % catalogIds.length;
    const itemId = catalogIds[nextIndex];
    if (itemId) options.onSelectItem(itemId);
  };

  const emitField = (channel: MoveItemsChannel, axis: MoveItemsAxis, raw: string): void => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const spec = FIELD_SPECS.find((entry) => entry.channel === channel && entry.axis === axis)!;
    options.onChange(setField(options.getTransform(), channel, axis, clamp(value, spec.min, spec.max)));
  };

  for (const spec of FIELD_SPECS) {
    const field: MoveItemsField = `${spec.channel}.${spec.axis}`;
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:78px auto 1fr 72px auto;gap:4px;align-items:center;margin:0 0 5px';

    const name = document.createElement('span');
    name.textContent = `${spec.channel[0]}${spec.axis}`;
    name.title = `${spec.channel} ${spec.axis}`;

    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '−';
    minus.style.cssText = buttonStyle();
    minus.addEventListener('click', () => {
      activeField = field;
      emitField(spec.channel, spec.axis, String(options.getTransform()[spec.channel][spec.axis] - spec.step));
    });

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(spec.min);
    slider.max = String(spec.max);
    slider.step = String(spec.step);
    slider.style.cssText = 'width:100%;margin:0';
    slider.addEventListener('pointerdown', () => { activeField = field; });
    slider.addEventListener('focus', () => { activeField = field; });
    slider.addEventListener('input', () => emitField(spec.channel, spec.axis, slider.value));
    sliders.set(field, slider);

    const number = document.createElement('input');
    number.type = 'number';
    number.min = String(spec.min);
    number.max = String(spec.max);
    number.step = String(spec.step);
    number.style.cssText = 'width:72px;background:#111a;color:inherit;border:1px solid rgba(255,255,255,0.18);border-radius:4px;padding:2px 4px;user-select:text';
    number.addEventListener('focus', () => { activeField = field; number.select(); });
    number.addEventListener('input', () => {
      const raw = number.value.trim();
      if (raw === '' || raw === '-' || raw === '.' || raw === '-.' || raw.endsWith('.')) return;
      emitField(spec.channel, spec.axis, raw);
    });
    number.addEventListener('change', () => emitField(spec.channel, spec.axis, number.value));
    numbers.set(field, number);

    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    plus.style.cssText = buttonStyle();
    plus.addEventListener('click', () => {
      activeField = field;
      emitField(spec.channel, spec.axis, String(options.getTransform()[spec.channel][spec.axis] + spec.step));
    });

    row.append(name, minus, slider, number, plus);
    root.append(row);

    if (spec.channel === 'rotation') {
      const deg = document.createElement('div');
      deg.style.cssText = 'grid-column:1 / -1;opacity:0.65;margin:-2px 0 4px 78px;font-size:11px';
      degreeLabels.set(spec.axis, deg);
      root.append(deg);
    }
  }

  const status = document.createElement('div');
  status.style.cssText = 'min-height:1.2em;margin:6px 0;color:#9fe7c0';
  root.append(status);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:8px 0';
  const makeButton = (label: string, onClick: () => void): HTMLButtonElement => {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.style.cssText = buttonStyle();
    el.addEventListener('click', onClick);
    return el;
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

  actions.append(
    makeButton('RESET', () => {
      options.onReset();
      flash('reset to production default');
    }),
    makeButton('COPY', () => {
      void copyText('item', formatThirdPersonHeldItemCopy(options.getItemId(), options.getTransform()));
    }),
    makeButton('COPY ALL', () => {
      const entries = options.getCopyAllEntries();
      void copyText('all', entries.length === 0
        ? formatThirdPersonHeldItemCopy(options.getItemId(), options.getTransform())
        : formatThirdPersonHeldItemCopyAll(entries));
    }),
  );
  root.append(actions);

  const preview = document.createElement('pre');
  preview.style.cssText = 'margin:8px 0 0;white-space:pre-wrap;background:#0006;padding:8px;border-radius:6px;max-height:28vh;overflow:auto';
  root.append(preview);

  const refresh = (): void => {
    const itemId = options.getItemId();
    if (document.activeElement !== select) select.value = itemId;
    meta.textContent = `${itemId} · category ${options.getCategory()} · rotation radians`;
    const transform = options.getTransform();
    for (const spec of FIELD_SPECS) {
      const field: MoveItemsField = `${spec.channel}.${spec.axis}`;
      const value = transform[spec.channel][spec.axis];
      const slider = sliders.get(field);
      const number = numbers.get(field);
      if (slider && document.activeElement !== slider) slider.value = String(value);
      if (number && document.activeElement !== number) {
        number.value = formatThirdPersonHeldScalar(value, spec.step < 0.01 ? 4 : 4);
      }
      if (spec.channel === 'rotation') {
        const deg = degreeLabels.get(spec.axis);
        if (deg) deg.textContent = `rotation ${spec.axis} = ${(value * 180 / Math.PI).toFixed(2)}°`;
      }
    }
    preview.textContent = formatThirdPersonHeldItemCopy(itemId, transform);
  };

  select.addEventListener('change', () => options.onSelectItem(select.value));
  prev.addEventListener('click', () => selectRelative(-1));
  next.addEventListener('click', () => selectRelative(1));

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'number') return;
    if (event.target instanceof HTMLSelectElement) return;
    if (event.code === 'BracketLeft' || event.code === 'Comma' || event.key === 'p') {
      event.preventDefault();
      selectRelative(-1);
      return;
    }
    if (event.code === 'BracketRight' || event.code === 'Period' || event.key === 'n') {
      event.preventDefault();
      selectRelative(1);
      return;
    }
    if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight' && event.code !== 'ArrowUp' && event.code !== 'ArrowDown') {
      return;
    }
    const [channel, axis] = activeField.split('.') as [MoveItemsChannel, MoveItemsAxis];
    const spec = FIELD_SPECS.find((entry) => entry.channel === channel && entry.axis === axis);
    if (!spec) return;
    event.preventDefault();
    const direction = event.code === 'ArrowLeft' || event.code === 'ArrowDown' ? -1 : 1;
    const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
    emitField(channel, axis, String(options.getTransform()[channel][axis] + spec.step * direction * multiplier));
  };
  addEventListener('keydown', onKeyDown);
  refresh();

  return {
    element: root,
    sync: refresh,
    dispose: () => {
      removeEventListener('keydown', onKeyDown);
      root.remove();
    },
  };
}
