import { describe, expect, it } from 'vitest';
import {
  DESKTOP_CONTROL_SECTIONS,
  formatPlayTime,
  formatSettingValue,
  MENU_SERVER_ENTRIES,
} from '../src/ui/menuModel';

describe('menu model', () => {
  it('lists the three local server modes', () => {
    expect(MENU_SERVER_ENTRIES.map((server) => server.id)).toEqual(['anarchy', 'survival', 'peaceful']);
    expect(MENU_SERVER_ENTRIES.map((server) => server.name)).toEqual(['Анархия PvP', 'Выживание PvP', 'Мирный']);
    expect(MENU_SERVER_ENTRIES.map((server) => server.description)).toEqual([
      'Свободное выживание без защиты территорий',
      'Классическое выживание и честные сражения',
      'Выживание без PvP и взрывов',
    ]);
  });

  it('documents the real desktop bindings including chat', () => {
    const bindings = DESKTOP_CONTROL_SECTIONS.flatMap((section) => section.bindings);
    expect(bindings).toContainEqual({ action: 'Присесть', key: 'Shift' });
    expect(bindings).toContainEqual({ action: 'Камера (1-е / 3-е лицо)', key: 'C' });
    expect(bindings.some((binding) => binding.action === 'Бег')).toBe(false);
    expect(bindings).toContainEqual({ action: 'Меню', key: 'M' });
    expect(bindings).toContainEqual({ action: 'Чат', key: 'T' });
    expect(bindings).toContainEqual({ action: 'Команда', key: '/' });
    expect(bindings).toContainEqual({ action: 'Пауза / назад', key: 'Tab / Esc' });
    expect(bindings.some((binding) => binding.action === 'Ускорить полёт')).toBe(false);
  });

  it('formats play time and setting values for the menu', () => {
    expect(formatPlayTime(0)).toBe('меньше минуты');
    expect(formatPlayTime(125)).toBe('2 мин');
    expect(formatPlayTime(3_720)).toBe('1 ч 2 мин');
    expect(formatSettingValue('volume', 0.7)).toBe('70%');
    expect(formatSettingValue('fov', 75)).toBe('75°');
  });
});
