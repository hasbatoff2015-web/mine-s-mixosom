import { LOCAL_SERVER_PRESETS, MAX_PLAYER_NAME_LENGTH, MIN_PLAYER_NAME_LENGTH, type LocalServerName } from '../../shared/config';
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

export const ONLINE_NICKNAME_HINT = `${MIN_PLAYER_NAME_LENGTH}–${MAX_PLAYER_NAME_LENGTH} символов · только A–Z и 0–9`;
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
  const svg = (body: string): string => `<svg viewBox="0 0 48 48" width="48" height="48" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${body}</svg>`;
  if (id === 'survival') {
    return svg(`
      <polygon points="4,4 32,4 32,24 18,44 4,26" fill="#0e2414"/>
      <polygon points="6,6 30,6 30,22 18,40 6,24" fill="#2f9a48"/>
      <polygon points="6,6 16,6 16,22 12,32 6,24" fill="#58c86a"/>
      <polygon points="20,8 30,8 30,22 18,38 18,22" fill="#1c6b34"/>
      <polygon points="8,44 20,44 44,8 32,8" fill="#1a1e22"/>
      <polygon points="10,42 18,42 42,10 34,10" fill="#f4f7fa"/>
      <polygon points="14,40 18,42 42,10 38,12" fill="#c5d0d8"/>
      <polygon points="4,32 16,32 22,44 10,44" fill="#8a5a18"/>
      <polygon points="6,34 14,34 20,42 12,42" fill="#f0c14a"/>
      <polygon points="6,40 12,40 10,46 4,46" fill="#c48a2a"/>
    `);
  }
  if (id === 'peaceful') {
    return svg(`
      <polygon points="4,24 24,4 44,24" fill="#5c3418"/>
      <polygon points="6,22 24,6 42,22" fill="#a56b3c"/>
      <polygon points="6,22 24,6 24,22" fill="#d7a15a"/>
      <polygon points="24,8 42,22 24,22" fill="#7a4a28"/>
      <rect x="10" y="22" width="28" height="20" fill="#6a4a2c"/>
      <rect x="12" y="22" width="24" height="20" fill="#f0d7b0"/>
      <rect x="28" y="22" width="8" height="20" fill="#c9a67a"/>
      <rect x="13" y="26" width="6" height="6" fill="#16343c"/>
      <rect x="14" y="27" width="4" height="4" fill="#5ed4ea"/>
      <rect x="21" y="30" width="8" height="12" fill="#3a2414"/>
      <polygon points="32,2 46,6 42,16 30,10" fill="#145c28"/>
      <polygon points="34,4 44,7 40,14 32,9" fill="#46d464"/>
      <polygon points="36,8 44,10 40,14 34,11" fill="#1f8a38"/>
    `);
  }
  return svg(`
    <polygon points="24,1 29,12 46,8 35,20 47,28 33,30 38,46 24,35 10,46 15,30 1,28 13,20 2,8 19,12" fill="#ff6a28"/>
    <polygon points="24,10 27,17 36,15 31,23 36,30 27,30 30,38 24,31 18,38 21,30 12,30 17,23 12,15 21,17" fill="#ffd15a"/>
    <polygon points="2,8 22,8 21,18 23,28 14,44 2,26" fill="#3a1016"/>
    <polygon points="4,10 20,10 19,18 21,28 14,40 4,26" fill="#b42838"/>
    <polygon points="4,10 12,10 12,22 8,30 4,24" fill="#e05058"/>
    <polygon points="26,10 46,10 46,28 34,46 25,30 27,18" fill="#5a140e"/>
    <polygon points="28,12 44,12 44,28 34,42 27,30 29,18" fill="#f05a30"/>
    <polygon points="36,14 44,14 44,28 36,38 34,26" fill="#c43a22"/>
    <rect x="20" y="8" width="4" height="6" fill="#ffe14a"/>
    <rect x="17" y="14" width="4" height="6" fill="#ffe14a"/>
    <rect x="21" y="20" width="4" height="6" fill="#ffe14a"/>
    <rect x="16" y="26" width="4" height="6" fill="#ffe14a"/>
    <rect x="20" y="32" width="4" height="8" fill="#ffe14a"/>
  `);
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
