import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DESKTOP_CONTROL_SECTIONS,
  formatPlayTime,
  formatSettingValue,
  MENU_SERVER_ENTRIES,
  MOBILE_CONTROL_ITEMS,
  renderOnlineServerRows,
} from '../src/ui/menuModel';

const menuSource = readFileSync('src/ui/menuModel.ts', 'utf8');
const styleSource = readFileSync('src/style.css', 'utf8');

describe('menu model', () => {
  it('lists the three local server modes with three captions each', () => {
    expect(MENU_SERVER_ENTRIES.map((server) => server.id)).toEqual(['anarchy', 'survival', 'peaceful']);
    expect(MENU_SERVER_ENTRIES.map((server) => server.name)).toEqual(['Анархия PvP', 'Выживание PvP', 'Мирный']);
    expect(MENU_SERVER_ENTRIES.map((server) => server.captions)).toEqual([
      [
        { text: 'приваты взрываются', tone: 'warning' },
        { text: 'гриф разрешён', tone: 'danger' },
        { text: 'полная свобода и хаос', tone: 'accent' },
      ],
      [
        { text: 'приват — твоя защита', tone: 'warning' },
        { text: 'честное выживание с PvP', tone: 'danger' },
        { text: 'строй базу и сражайся', tone: 'info' },
      ],
      [
        { text: 'PvP только на арене', tone: 'warning' },
        { text: 'спокойное выживание и строительство', tone: 'positive' },
        { text: 'без сражений в открытом мире', tone: 'info' },
      ],
    ]);
  });

  it('renders inline icons and cycling captions without an FC mark or a timer', () => {
    const html = renderOnlineServerRows(undefined, 'anarchy');
    expect(html).toContain('server-icon--anarchy');
    expect(html).toContain('server-icon--survival');
    expect(html).toContain('server-icon--peaceful');
    expect(html).toContain('<svg');
    expect(html).toContain('server-caption-cycle');
    expect(html).toContain('tone-danger');
    expect(html).toContain('приваты взрываются');
    expect(html).not.toContain('>FC<');
    expect(menuSource).not.toContain('setInterval');
    expect(styleSource).toContain('@keyframes server-caption-cycle');
    expect(styleSource).toContain('animation-duration: 9s');
    expect(styleSource).toContain('prefers-reduced-motion: reduce');
    expect(styleSource).toMatch(/\.server-caption:not\(:first-child\) \{\s*display: none;/);
  });

  it('documents the real desktop bindings including creative flight acceleration', () => {
    expect(DESKTOP_CONTROL_SECTIONS.map((section) => section.title)).toEqual(['Движение', 'Игровой процесс']);
    const bindings = DESKTOP_CONTROL_SECTIONS.flatMap((section) => section.bindings);
    expect(bindings).toContainEqual({ action: 'Движение', key: 'WASD' });
    expect(bindings).toContainEqual({ action: 'Обзор', key: 'Мышь' });
    expect(bindings).toContainEqual({ action: 'Прыжок', key: 'Space' });
    expect(bindings).toContainEqual({ action: 'Присесть', key: 'Shift' });
    expect(bindings).toContainEqual({ action: 'Полёт', key: 'Двойной Space', note: 'Творческий режим' });
    expect(bindings).toContainEqual({ action: 'Снизиться в полёте', key: 'Shift', note: 'Творческий режим' });
    expect(bindings).toContainEqual({ action: 'Ускорить полёт', key: 'Ctrl', note: 'Творческий режим' });
    expect(bindings).toContainEqual({ action: 'Атака / ломать блок', key: 'ЛКМ' });
    expect(bindings).toContainEqual({ action: 'Использовать / поставить блок', key: 'ПКМ' });
    expect(bindings).toContainEqual({ action: 'Инвентарь', key: 'E' });
    expect(bindings).toContainEqual({ action: 'Камера', key: 'C' });
    expect(bindings).toContainEqual({ action: 'Меню', key: 'M' });
    expect(bindings).toContainEqual({ action: 'Чат', key: 'T' });
    expect(bindings).toContainEqual({ action: 'Команда', key: '/' });
    expect(bindings).toContainEqual({ action: 'Выбросить предмет', key: 'Q' });
    expect(bindings).toContainEqual({ action: 'Выбрать слот', key: '1–9 / колесо' });
    expect(bindings).toContainEqual({ action: 'Пауза / назад', key: 'Tab / Esc' });
    expect(bindings.some((binding) => binding.action === 'Бег')).toBe(false);
    const keys = bindings.map((binding) => binding.key);
    for (const key of ['F3', 'F7', 'F8', 'F9']) expect(keys).not.toContain(key);
  });

  it('documents structured mobile controls separately from desktop diagnostics', () => {
    const byAction = (action: string) => MOBILE_CONTROL_ITEMS.find((item) => item.action === action);
    expect(byAction('Движение')).toMatchObject({
      control: 'Левый стик',
      note: 'Сильное отклонение вперёд включает бег.',
    });
    expect(byAction('Прыжок')?.note).toBe('В выживании двойное касание включает или выключает непрерывные прыжки.');
    expect(byAction('Полёт')).toMatchObject({
      control: 'Двойное касание прыжка',
      note: 'В творческом режиме.',
    });
    expect(byAction('Присесть / снизиться')?.note).toBe('На земле — переключатель. В полёте удерживайте для снижения.');
    expect(byAction('Автопрыжок')).toMatchObject({
      control: 'Автоматически',
      note: 'На земле при движении в препятствие.',
    });
    expect(byAction('Ломать / использовать')?.note).toBe('Удерживайте для добычи блока, еды или натягивания лука.');
    expect(MOBILE_CONTROL_ITEMS.some((item) => /F3|F7|F8|F9|Диагностика/.test(`${item.action} ${item.control}`))).toBe(false);
  });

  it('formats play time and setting values for the menu', () => {
    expect(formatPlayTime(0)).toBe('меньше минуты');
    expect(formatPlayTime(125)).toBe('2 мин');
    expect(formatPlayTime(3_720)).toBe('1 ч 2 мин');
    expect(formatSettingValue('volume', 0.7)).toBe('70%');
    expect(formatSettingValue('fov', 75)).toBe('75°');
  });
});
