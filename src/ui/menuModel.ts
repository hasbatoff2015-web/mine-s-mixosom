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
      <polygon points="5,3 34,3 34,24 18,45 5,26" fill="#07140c"/>
      <polygon points="7,5 32,5 32,22 18,41 7,24" fill="#2ea04a"/>
      <polygon points="7,5 17,5 17,20 13,30 7,24" fill="#67d36c"/>
      <polygon points="21,7 32,7 32,22 18,39 18,20" fill="#176832"/>
      <polygon points="2,38 14,46 46,10 34,2" fill="#12161a"/>
      <polygon points="5,38 12,44 43,12 36,6" fill="#f4f7fa"/>
      <polygon points="9,40 12,44 43,12 40,14" fill="#c5d0d8"/>
      <polygon points="1,28 18,28 22,40 5,40" fill="#6a4010"/>
      <polygon points="3,30 16,30 20,38 7,38" fill="#f0c14a"/>
      <polygon points="3,38 12,38 10,46 1,46" fill="#c48a2a"/>
    `);
  }
  if (id === 'peaceful') {
    return svg(`
      <polygon points="2,24 24,4 46,24" fill="#3a2010"/>
      <polygon points="5,22 24,7 43,22" fill="#b8743c"/>
      <polygon points="5,22 24,7 24,22" fill="#e2b15e"/>
      <polygon points="24,9 43,22 24,22" fill="#7a4524"/>
      <rect x="7" y="21" width="34" height="24" fill="#5a3820"/>
      <rect x="9" y="21" width="30" height="22" fill="#f2d7ae"/>
      <rect x="29" y="21" width="10" height="22" fill="#d2b184"/>
      <rect x="12" y="26" width="8" height="8" fill="#16343c"/>
      <rect x="14" y="28" width="4" height="4" fill="#5ed4ea"/>
      <rect x="20" y="30" width="8" height="13" fill="#3a2414"/>
      <polygon points="33,1 46,4 43,14 31,9" fill="#145c28"/>
      <polygon points="35,3 44,5 41,12 33,8" fill="#4ad864"/>
      <polygon points="38,6 44,8 41,12 36,9" fill="#1c8a38"/>
    `);
  }
  return svg(`
    <polygon points="24,1 33,13 47,13 37,24 47,35 33,35 24,47 15,35 1,35 11,24 1,13 15,13" fill="#ff6a28"/>
    <polygon points="24,9 30,17 39,17 32,24 39,31 30,31 24,39 18,31 9,31 16,24 9,17 18,17" fill="#ffd15a"/>
    <polygon points="6,8 23,8 22,18 20,30 14,43 6,26" fill="#3a1016"/>
    <polygon points="8,10 21,10 20,18 18,28 14,39 8,24" fill="#c43240"/>
    <polygon points="8,10 14,10 14,20 11,28 8,22" fill="#e86870"/>
    <polygon points="26,8 42,8 42,26 34,43 28,30 27,18" fill="#4a120c"/>
    <polygon points="28,10 40,10 40,24 34,39 30,30 29,18" fill="#f05a30"/>
    <polygon points="34,12 40,12 40,24 35,34 34,22" fill="#c43a22"/>
    <rect x="20" y="8" width="6" height="6" fill="#ffe14a"/>
    <rect x="18" y="14" width="6" height="6" fill="#ffe14a"/>
    <rect x="22" y="20" width="6" height="6" fill="#ffe14a"/>
    <rect x="18" y="26" width="6" height="6" fill="#ffe14a"/>
    <rect x="21" y="32" width="6" height="8" fill="#ffe14a"/>
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
