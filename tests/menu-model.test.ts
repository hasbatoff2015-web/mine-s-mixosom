import { describe, expect, it } from 'vitest';
import gameSource from '../src/core/Game.ts?raw';
import {
  DESKTOP_CONTROL_SECTIONS,
  MOBILE_CONTROL_FOOTNOTE,
  MOBILE_CONTROL_ITEMS,
  ONLINE_NICKNAME_HINT,
  ONLINE_NICKNAME_SAVED,
  formatPlayTime,
  formatSettingValue,
  MENU_SERVER_ENTRIES,
  onlineNicknameMessage,
  renderOnlineServerRows,
} from '../src/ui/menuModel';

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

  it('renders inline icons and cycling captions without an FC mark', () => {
    const html = renderOnlineServerRows(undefined, 'anarchy');
    expect(html.match(/<svg /g)).toHaveLength(3);
    expect(html).toContain('server-icon--anarchy');
    expect(html).toContain('server-icon--survival');
    expect(html).toContain('server-icon--peaceful');
    expect(html).not.toContain('>FC<');
    expect(html).toContain('server-caption-cycle');
    expect(html.match(/class="server-caption /g)).toHaveLength(9);
    expect(html).toContain('aria-label="приваты взрываются. гриф разрешён. полная свобода и хаос"');
    expect(html).toContain('aria-hidden="true"');
  });

  it('documents the real desktop bindings and hides developer diagnostics', () => {
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
    expect(bindings.some((binding) => binding.key === 'F3' || binding.key === 'F7' || binding.key === 'F8' || binding.key === 'F9')).toBe(false);
    expect(DESKTOP_CONTROL_SECTIONS.some((section) => section.title === 'Диагностика')).toBe(false);
    expect(gameSource).toContain("event.code === 'F3'");
    expect(gameSource).toContain("event.code === 'F7'");
    expect(gameSource).toContain("event.code === 'F8'");
    expect(gameSource).toContain("event.code === 'F9'");
  });

  it('lists the actual mobile controls separately from desktop', () => {
    expect(MOBILE_CONTROL_ITEMS.map((item) => item.action)).toEqual([
      'Движение',
      'Обзор',
      'Прыжок',
      'Полёт',
      'Присесть / снизиться',
      'Инвентарь',
      'Атака / действие',
      'Ломать / использовать',
      'Лук',
      'Автопрыжок',
    ]);
    expect(MOBILE_CONTROL_ITEMS.find((item) => item.action === 'Движение')?.note).toMatch(/бег/);
    expect(MOBILE_CONTROL_ITEMS.find((item) => item.action === 'Прыжок')?.note).toMatch(/двойное касание/);
    expect(MOBILE_CONTROL_ITEMS.find((item) => item.action === 'Полёт')).toMatchObject({
      control: 'Двойное касание прыжка',
      note: 'В творческом режиме.',
    });
    expect(MOBILE_CONTROL_ITEMS.find((item) => item.action === 'Присесть / снизиться')?.note).toMatch(/удерживайте для снижения/);
    expect(MOBILE_CONTROL_ITEMS.find((item) => item.action === 'Автопрыжок')?.note).toMatch(/препятствие/);
    expect(MOBILE_CONTROL_ITEMS.find((item) => item.action === 'Ломать / использовать')?.control).toBe('Удержание');
    expect(MOBILE_CONTROL_FOOTNOTE).toMatch(/альбомная ориентация/);
  });

  it('keeps nickname errors hidden until submit and disables an unchanged draft', () => {
    expect(onlineNicknameMessage({ draft: '', saved: undefined })).toEqual({
      text: ONLINE_NICKNAME_HINT,
      tone: 'help',
      canSave: false,
    });
    expect(onlineNicknameMessage({ draft: 'Misha', saved: 'Misha' }).canSave).toBe(false);
    expect(onlineNicknameMessage({ draft: 'Misha2', saved: 'Misha' })).toMatchObject({
      tone: 'help',
      canSave: true,
    });
    expect(onlineNicknameMessage({ draft: 'Миша', submitError: 'Только английские буквы и цифры.' })).toMatchObject({
      text: 'Только английские буквы и цифры.',
      tone: 'error',
      canSave: false,
    });
    expect(onlineNicknameMessage({ draft: 'Misha', saved: 'Misha', savedFlash: true })).toEqual({
      text: ONLINE_NICKNAME_SAVED,
      tone: 'saved',
      canSave: false,
    });
  });

  it('formats play time and setting values for the menu', () => {
    expect(formatPlayTime(0)).toBe('меньше минуты');
    expect(formatPlayTime(125)).toBe('2 мин');
    expect(formatPlayTime(3_720)).toBe('1 ч 2 мин');
    expect(formatSettingValue('volume', 0.7)).toBe('70%');
    expect(formatSettingValue('fov', 75)).toBe('75°');
  });
});
