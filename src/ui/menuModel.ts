export interface MenuServerEntry {
  id: string;
  name: string;
  description: string;
  online: string;
  signal: number;
  connectable?: boolean;
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

export const MENU_SERVER_ENTRIES: readonly MenuServerEntry[] = [
  {
    id: 'anarchy-pvp',
    name: 'Анархия PvP',
    description: 'Свободное выживание без защиты территорий',
    online: '0 / 300',
    signal: 4,
    connectable: true,
  },
  {
    id: 'survival-pvp',
    name: 'Выживание PvP',
    description: 'Классическое выживание и честные сражения',
    online: '0 / 300',
    signal: 3,
    connectable: false,
  },
] as const;

export const DESKTOP_CONTROL_SECTIONS: readonly ControlSection[] = [
  {
    title: 'Движение',
    bindings: [
      { action: 'Вперёд', key: 'W' },
      { action: 'Назад', key: 'S' },
      { action: 'Влево', key: 'A' },
      { action: 'Вправо', key: 'D' },
      { action: 'Прыжок', key: 'Пробел' },
      { action: 'Бег', key: 'Shift' },
      { action: 'Присесть', key: 'C' },
      { action: 'Полёт', key: 'Двойной пробел', note: 'Творческий режим' },
      { action: 'Снизиться в полёте', key: 'Shift', note: 'Творческий режим' },
    ],
  },
  {
    title: 'Игровой процесс',
    bindings: [
      { action: 'Обзор', key: 'Мышь' },
      { action: 'Атаковать / разрушить', key: 'ЛКМ' },
      { action: 'Использовать / установить', key: 'ПКМ' },
      { action: 'Инвентарь', key: 'E' },
      { action: 'Чат', key: 'T' },
      { action: 'Команда', key: '/' },
      { action: 'Выбросить предмет', key: 'Q' },
      { action: 'Выбрать слот', key: '1–9 / колесо' },
      { action: 'Пауза / назад', key: 'Esc' },
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
