import { describe, expect, it } from 'vitest';
import {
  DESKTOP_CONTROL_SECTIONS,
  formatPlayTime,
  formatSettingValue,
  MENU_SERVER_ENTRIES,
} from '../src/ui/menuModel';

describe('menu model', () => {
  it('keeps the requested online mock entries', () => {
    expect(MENU_SERVER_ENTRIES.map((server) => server.name)).toEqual(['Анархия PvP', 'Выживание PvP']);
    expect(MENU_SERVER_ENTRIES.every((server) => server.online === '0 / 300')).toBe(true);
    expect(MENU_SERVER_ENTRIES[0]?.connectable).toBe(true);
    expect(MENU_SERVER_ENTRIES[1]?.connectable).toBeFalsy();
  });

  it('documents the real desktop bindings including chat', () => {
    const bindings = DESKTOP_CONTROL_SECTIONS.flatMap((section) => section.bindings);
    expect(bindings).toContainEqual({ action: 'Бег', key: 'Shift' });
    expect(bindings).toContainEqual({ action: 'Присесть', key: 'C' });
    expect(bindings).toContainEqual({ action: 'Чат', key: 'T' });
    expect(bindings).toContainEqual({ action: 'Команда', key: '/' });
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
