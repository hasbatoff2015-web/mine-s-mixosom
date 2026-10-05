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

const SERVER_LOGO_SRC: Record<LocalServerName, string> = {
  anarchy: '/ui/server-logos/anarchy_logo.png',
  survival: '/ui/server-logos/survival_pvp_logo.png',
  peaceful: '/ui/server-logos/peaceful_logo.png',
};

function serverIconHtml(id: LocalServerName): string {
  return `<img class="server-icon-image" src="${SERVER_LOGO_SRC[id]}" alt="" aria-hidden="true" />`;
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
        <span class="server-icon server-icon--${server.id}">${serverIconHtml(server.id)}</span>
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
