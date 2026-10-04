import { LOCAL_SERVER_PRESETS, type LocalServerName } from '../../shared/config';

export type MenuServerCaptionTone = 'danger' | 'warning' | 'positive' | 'info' | 'accent';

export interface MenuServerCaption {
  text: string;
  tone: MenuServerCaptionTone;
}

export interface MenuServerEntry {
  id: LocalServerName;
  name: string;
  captions: readonly MenuServerCaption[];
  signal: number;
}

export interface MenuServerLiveStatus {
  reachable: boolean;
  online: number;
  maxPlayers: number;
}

export interface MenuServerRow extends MenuServerEntry {
  selected: boolean;
  reachable: boolean;
  label: string;
}

export interface ControlBinding {
  action: string;
  key: string;
  note?: string;
}

export interface ControlSection {
  title: string;
  bindings: readonly ControlBinding[];
}

export interface MobileControlItem {
  action: string;
  control: string;
  note?: string;
}

const MENU_SERVER_COPY: Record<LocalServerName, Omit<MenuServerEntry, 'id'>> = {
  anarchy: {
    name: 'Анархия PvP',
    captions: [
      { text: 'приваты взрываются', tone: 'warning' },
      { text: 'гриф разрешён', tone: 'danger' },
      { text: 'полная свобода и хаос', tone: 'accent' },
    ],
    signal: 4,
  },
  survival: {
    name: 'Выживание PvP',
    captions: [
      { text: 'приват — твоя защита', tone: 'warning' },
      { text: 'честное выживание с PvP', tone: 'danger' },
      { text: 'строй базу и сражайся', tone: 'info' },
    ],
    signal: 4,
  },
  peaceful: {
    name: 'Мирный',
    captions: [
      { text: 'PvP только на арене', tone: 'warning' },
      { text: 'спокойное выживание и строительство', tone: 'positive' },
      { text: 'без сражений в открытом мире', tone: 'info' },
    ],
    signal: 4,
  },
};

/** Display rows for the online menu. Endpoints stay in LOCAL_SERVER_PRESETS. */
export const MENU_SERVER_ENTRIES: readonly MenuServerEntry[] = (
  Object.keys(LOCAL_SERVER_PRESETS) as LocalServerName[]
).map((id) => ({ id, ...MENU_SERVER_COPY[id] }));

export function isMenuServerId(id: string): id is LocalServerName {
  return Object.prototype.hasOwnProperty.call(LOCAL_SERVER_PRESETS, id);
}

export function onlineServerRows(
  statuses: Partial<Record<LocalServerName, MenuServerLiveStatus>> | undefined,
  selectedId: LocalServerName,
): readonly MenuServerRow[] {
  return MENU_SERVER_ENTRIES.map((server) => {
    const live = statuses?.[server.id];
    const reachable = live?.reachable === true;
    return {
      ...server,
      selected: server.id === selectedId,
      reachable,
      signal: live && !reachable ? 0 : server.signal,
      label: !live ? '…' : reachable ? `${live.online} / ${live.maxPlayers}` : 'оффлайн',
    };
  });
}

function serverIconSvg(id: LocalServerName): string {
  if (id === 'survival') {
    return `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#2f6b38" stroke="#102014" stroke-width="2.4" stroke-linejoin="miter" d="M8 8h18v13L17 33 8 21z"/>
      <path fill="#63a85a" d="M12 12h10v7l-5 7-5-7z"/>
      <path fill="#e7eef4" stroke="#1b242c" stroke-width="1.8" stroke-linejoin="miter" d="M19 38 24 43 44 17 39 12z"/>
      <path fill="#e2b34a" stroke="#5a3c10" stroke-width="1.6" stroke-linejoin="miter" d="M13 32 23 38 19 43 9 37z"/>
      <path fill="#8d5a2c" stroke="#3a2412" stroke-width="1.5" stroke-linejoin="miter" d="M11 39 17 45 14 47 8 41z"/>
    </svg>`;
  }
  if (id === 'peaceful') {
    return `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#e4d2ae" stroke="#2a2014" stroke-width="2.2" stroke-linejoin="miter" d="M12 22h24v16H12z"/>
      <path fill="#c46832" stroke="#3a1c10" stroke-width="2.2" stroke-linejoin="miter" d="M7 24 24 8l17 16H7z"/>
      <path fill="#6b442c" stroke="#24160e" stroke-width="1.6" d="M21 28h8v10h-8z"/>
      <path fill="#3eae5c" stroke="#14381c" stroke-width="1.7" stroke-linejoin="miter" d="M33 4h11l-2 9H34z"/>
      <path fill="none" stroke="#1d4c28" stroke-width="1.6" stroke-linecap="square" d="M34 12 43 5"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <g fill="none" stroke="#ff7a32" stroke-width="2.5" stroke-linecap="square">
      <path d="M24 2v7M24 39v7M2 24h7M39 24h7M8 8l5 5M35 35l5 5M40 8l-5 5M13 35l-5 5"/>
    </g>
    <path fill="#d24540" stroke="#3a1014" stroke-width="2" stroke-linejoin="miter" d="M7 12h13l-1 9-6 12-6-11z"/>
    <path fill="#e15c34" stroke="#3a1014" stroke-width="2" stroke-linejoin="miter" d="M27 11h14v11l-7 13-8-11z"/>
    <path fill="none" stroke="#ffd36a" stroke-width="2.2" stroke-linejoin="miter" stroke-linecap="square" d="M21 12 17 17 24 21 16 27 22 34"/>
  </svg>`;
}

function serverCaptions(server: MenuServerRow): string {
  const label = server.captions.map((caption) => caption.text).join('. ');
  const lines = server.captions.map((caption, index) => `
        <small class="server-caption tone-${caption.tone}" style="--caption-index:${index}" aria-hidden="true">${caption.text}</small>`).join('');
  return `<span class="server-caption-cycle" aria-label="${label}">${lines}
      </span>`;
}

export function renderOnlineServerRows(
  statuses: Partial<Record<LocalServerName, MenuServerLiveStatus>> | undefined,
  selectedId: LocalServerName,
): string {
  return onlineServerRows(statuses, selectedId).map((server) => `
      <button class="server-row${server.selected ? ' selected' : ''}${server.label === 'оффлайн' ? ' is-offline' : ''}" data-server-id="${server.id}" aria-pressed="${server.selected}">
        <span class="server-icon server-icon--${server.id}" aria-hidden="true">${serverIconSvg(server.id)}</span>
        <span class="server-copy"><strong>${server.name}</strong>${serverCaptions(server)}</span>
        <span class="server-status"><span class="server-online">${server.label}</span><span class="signal-bars" aria-label="Уровень соединения ${server.signal} из 5">${Array.from({ length: 5 }, (_, bar) => `<i class="${bar < server.signal ? 'on' : ''}"></i>`).join('')}</span></span>
      </button>`).join('');
}

export const DESKTOP_CONTROL_SECTIONS: readonly ControlSection[] = [
  {
    title: 'Движение',
    bindings: [
      { action: 'Движение', key: 'WASD' },
      { action: 'Обзор', key: 'Мышь' },
      { action: 'Прыжок', key: 'Space' },
      { action: 'Присесть', key: 'Shift' },
      { action: 'Полёт', key: 'Двойной Space', note: 'Творческий режим' },
      { action: 'Снизиться в полёте', key: 'Shift', note: 'Творческий режим' },
      { action: 'Ускорить полёт', key: 'Ctrl', note: 'Творческий режим' },
    ],
  },
  {
    title: 'Игровой процесс',
    bindings: [
      { action: 'Атака / ломать блок', key: 'ЛКМ' },
      { action: 'Использовать / поставить блок', key: 'ПКМ' },
      { action: 'Инвентарь', key: 'E' },
      { action: 'Камера', key: 'C' },
      { action: 'Меню', key: 'M' },
      { action: 'Чат', key: 'T' },
      { action: 'Команда', key: '/' },
      { action: 'Выбросить предмет', key: 'Q' },
      { action: 'Выбрать слот', key: '1–9 / колесо' },
      { action: 'Пауза / назад', key: 'Tab / Esc' },
    ],
  },
] as const;

export const MOBILE_CONTROL_ITEMS: readonly MobileControlItem[] = [
  { action: 'Движение', control: 'Левый стик', note: 'Сильное отклонение вперёд включает бег.' },
  { action: 'Обзор', control: 'Свайп по экрану' },
  { action: 'Прыжок', control: 'Кнопка прыжка', note: 'В выживании двойное касание включает или выключает непрерывные прыжки.' },
  { action: 'Полёт', control: 'Двойное касание прыжка', note: 'В творческом режиме.' },
  { action: 'Присесть / снизиться', control: 'Кнопка приседания', note: 'На земле — переключатель. В полёте удерживайте для снижения.' },
  { action: 'Инвентарь', control: 'Кнопка рюкзака' },
  { action: 'Атака / действие', control: 'Короткое касание', note: 'Действие выбирается по цели и предмету.' },
  { action: 'Ломать / использовать', control: 'Удержание', note: 'Удерживайте для добычи блока, еды или натягивания лука.' },
  { action: 'Лук', control: 'Удержание + свайп', note: 'Во время натяжения камера продолжает вращаться; выстрел идёт по центру при отпускании.' },
  { action: 'Автопрыжок', control: 'Автоматически', note: 'На земле при движении в препятствие.' },
] as const;

export function formatPlayTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (minutes > 0) return `${minutes} мин`;
  return 'меньше минуты';
}

export function formatSettingValue(name: string, value: number): string {
  if (name === 'volume') return `${Math.round(value * 100)}%`;
  if (name === 'sensitivity') return value.toFixed(4);
  if (name === 'renderDistance') return `${Math.round(value)} чанка`;
  if (name === 'fov') return `${Math.round(value)}°`;
  return String(value);
}
