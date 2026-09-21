import { LOCAL_SERVER_PRESETS, type LocalServerName } from '../../shared/config';

export interface MenuServerEntry {
  id: LocalServerName;
  name: string;
  description: string;
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

const MENU_SERVER_COPY: Record<LocalServerName, Omit<MenuServerEntry, 'id'>> = {
  anarchy: {
    name: 'Анархия PvP',
    description: 'Свободное выживание без защиты территорий',
    signal: 4,
  },
  survival: {
    name: 'Выживание PvP',
    description: 'Классическое выживание и честные сражения',
    signal: 4,
  },
  peaceful: {
    name: 'Мирный',
    description: 'Выживание без PvP и взрывов',
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

export function renderOnlineServerRows(
  statuses: Partial<Record<LocalServerName, MenuServerLiveStatus>> | undefined,
  selectedId: LocalServerName,
): string {
  return onlineServerRows(statuses, selectedId).map((server) => `
      <button class="server-row${server.selected ? ' selected' : ''}${server.label === 'оффлайн' ? ' is-offline' : ''}" data-server-id="${server.id}" aria-pressed="${server.selected}">
        <span class="server-icon" aria-hidden="true">FC</span>
        <span class="server-copy"><strong>${server.name}</strong><small>${server.description}</small></span>
        <span class="server-status"><span class="server-online">${server.label}</span><span class="signal-bars" aria-label="Уровень соединения ${server.signal} из 5">${Array.from({ length: 5 }, (_, bar) => `<i class="${bar < server.signal ? 'on' : ''}"></i>`).join('')}</span></span>
      </button>`).join('');
}

export const DESKTOP_CONTROL_SECTIONS: readonly ControlSection[] = [
  {
    title: 'Движение',
    bindings: [
      { action: 'Вперёд', key: 'W' },
      { action: 'Назад', key: 'S' },
      { action: 'Влево', key: 'A' },
      { action: 'Вправо', key: 'D' },
      { action: 'Прыжок', key: 'Пробел' },
      { action: 'Присесть', key: 'Shift' },
      { action: 'Полёт', key: 'Двойной пробел', note: 'Творческий режим' },
      { action: 'Снизиться в полёте', key: 'Shift', note: 'Творческий режим' },
    ],
  },
  {
    title: 'Игровой процесс',
    bindings: [
      { action: 'Камера (1-е / 3-е лицо)', key: 'C' },
      { action: 'Обзор', key: 'Мышь' },
      { action: 'Атаковать / разрушить', key: 'ЛКМ' },
      { action: 'Использовать / установить', key: 'ПКМ' },
      { action: 'Инвентарь', key: 'E' },
      { action: 'Меню', key: 'M' },
      { action: 'Чат', key: 'T' },
      { action: 'Команда', key: '/' },
      { action: 'Выбросить предмет', key: 'Q' },
      { action: 'Выбрать слот', key: '1–9 / колесо' },
      { action: 'Пауза / назад', key: 'Tab / Esc' },
    ],
  },
  {
    title: 'Диагностика',
    bindings: [
      { action: 'Отладочная панель', key: 'F3' },
      { action: 'Режим освещения', key: 'F7', note: 'DEV' },
      { action: 'Границы чанков', key: 'F8', note: 'DEV' },
      { action: 'Инспектор стриминга', key: 'F9', note: 'DEV' },
    ],
  },
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
