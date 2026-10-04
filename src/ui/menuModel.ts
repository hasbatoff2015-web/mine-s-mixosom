import { LOCAL_SERVER_PRESETS, type LocalServerName } from '../../shared/config';
import { playerNicknameError } from '../../shared/playerName';

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

export const ONLINE_NICKNAME_HINT = '2–20 символов · только A–Z и 0–9';
export const ONLINE_NICKNAME_SAVED = 'Сохранено';

export interface OnlineNicknameMessage {
  text: string;
  tone: 'help' | 'error' | 'saved';
  canSave: boolean;
}

/** Button and helper state for the online nickname strip. Errors stay hidden until submit. */
export function onlineNicknameMessage(input: {
  draft: string;
  saved?: string;
  submitError?: string;
  savedFlash?: boolean;
}): OnlineNicknameMessage {
  const error = playerNicknameError(input.draft);
  const canSave = error === undefined && input.draft !== (input.saved ?? '');
  if (input.savedFlash) return { text: ONLINE_NICKNAME_SAVED, tone: 'saved', canSave: false };
  if (input.submitError) return { text: input.submitError, tone: 'error', canSave };
  return { text: ONLINE_NICKNAME_HINT, tone: 'help', canSave };
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

function escapeMenuText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character
  ));
}

function serverIconSvg(id: LocalServerName): string {
  if (id === 'survival') {
    return `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false" stroke-linecap="square" stroke-linejoin="miter">
      <path d="M8 10h18v14L17 38 8 24z" fill="#3c8a4e" stroke="#102216" stroke-width="2.4"/>
      <path d="M12 14h10v9l-5 8-5-8z" fill="#2c6840"/>
      <polygon points="16,42 22,42 40,20 34,14" fill="#e7eef3" stroke="#1b2228" stroke-width="1.6"/>
      <polygon points="12,34 20,42 25,37 17,29" fill="#e2b14a" stroke="#3a2a0c" stroke-width="1.5"/>
      <polygon points="10,40 16,40 20,36 14,36" fill="#c48a2a" stroke="#3a2a0c" stroke-width="1.4"/>
    </svg>`;
  }
  if (id === 'peaceful') {
    return `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false" stroke-linecap="square" stroke-linejoin="miter">
      <polygon points="6,22 24,7 42,22" fill="#d7c7a4" stroke="#1c1610" stroke-width="2.4"/>
      <rect x="11" y="22" width="26" height="18" fill="#6b5340" stroke="#1a140e" stroke-width="2.2"/>
      <rect x="21" y="28" width="7" height="12" fill="#241c14"/>
      <polygon points="30,1 46,6 42,18 27,12" fill="#46b15f" stroke="#14341e" stroke-width="2"/>
      <polyline points="32,8 40,11" fill="none" stroke="#14341e" stroke-width="1.8"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false" stroke-linecap="square" stroke-linejoin="miter">
    <g fill="none" stroke="#ff7a32" stroke-width="2.6">
      <line x1="24" y1="15" x2="24" y2="3"/>
      <line x1="33" y1="18" x2="42" y2="8"/>
      <line x1="36" y1="26" x2="45" y2="26"/>
      <line x1="33" y1="34" x2="41" y2="43"/>
      <line x1="24" y1="35" x2="24" y2="45"/>
      <line x1="15" y1="34" x2="7" y2="43"/>
      <line x1="12" y1="26" x2="3" y2="26"/>
      <line x1="15" y1="18" x2="6" y2="8"/>
    </g>
    <polygon points="7,12 21,12 19,21 22,28 14,39 7,26" fill="#9a3434" stroke="#2a1010" stroke-width="2"/>
    <polygon points="27,14 41,14 41,28 33,40 26,30 29,21" fill="#c4512e" stroke="#2a1010" stroke-width="2"/>
    <polyline points="22,11 17,18 24,22 16,29 23,37" fill="none" stroke="#ffd36a" stroke-width="2.2"/>
  </svg>`;
}

function serverCaptionsHtml(server: MenuServerRow): string {
  const label = server.captions.map((caption) => caption.text).join('. ');
  const lines = server.captions.map((caption, index) => `
        <small class="server-caption tone-${caption.tone}" style="--caption-index:${index}" aria-hidden="true">${escapeMenuText(caption.text)}</small>`).join('');
  return `<span class="server-caption-cycle" aria-label="${escapeMenuText(label)}">${lines}
      </span>`;
}

export function renderOnlineServerRows(
  statuses: Partial<Record<LocalServerName, MenuServerLiveStatus>> | undefined,
  selectedId: LocalServerName,
): string {
  return onlineServerRows(statuses, selectedId).map((server) => `
      <button class="server-row${server.selected ? ' selected' : ''}${server.label === 'оффлайн' ? ' is-offline' : ''}" data-server-id="${server.id}" aria-pressed="${server.selected}">
        <span class="server-icon server-icon--${server.id}" aria-hidden="true">${serverIconSvg(server.id)}</span>
        <span class="server-copy"><strong>${escapeMenuText(server.name)}</strong>${serverCaptionsHtml(server)}</span>
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
  {
    action: 'Движение',
    control: 'Левый стик',
    note: 'Сильное отклонение вперёд включает бег.',
  },
  { action: 'Обзор', control: 'Свайп по экрану' },
  {
    action: 'Прыжок',
    control: 'Кнопка прыжка',
    note: 'В выживании двойное касание включает или выключает непрерывные прыжки.',
  },
  { action: 'Полёт', control: 'Двойное касание прыжка', note: 'В творческом режиме.' },
  {
    action: 'Присесть / снизиться',
    control: 'Кнопка приседания',
    note: 'На земле — переключатель. В полёте удерживайте для снижения.',
  },
  { action: 'Инвентарь', control: 'Кнопка рюкзака' },
  {
    action: 'Атака / действие',
    control: 'Короткое касание',
    note: 'Действие выбирается по цели и предмету.',
  },
  {
    action: 'Ломать / использовать',
    control: 'Удержание',
    note: 'Удерживайте для добычи блока, еды или натягивания лука.',
  },
  {
    action: 'Лук',
    control: 'Удержание + свайп',
    note: 'Во время натяжения камера продолжает вращаться; выстрел идёт по центру при отпускании.',
  },
  { action: 'Автопрыжок', control: 'Автоматически', note: 'На земле при движении в препятствие.' },
] as const;

export const MOBILE_CONTROL_FOOTNOTE = 'На телефоне рекомендуется альбомная ориентация.';

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
