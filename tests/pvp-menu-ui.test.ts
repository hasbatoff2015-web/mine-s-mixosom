/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GameUI } from '../src/ui/GameUI';
import { TELEPORT_COOLDOWN_MESSAGE } from '../shared/playerRules';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PvP badge and spawn menu notice', () => {
  it('updates the same badge and shows the russian cooldown in the open spawn menu', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const ui = new GameUI(root);
    const badge = root.querySelector('#pvp-badge');
    expect(badge).toBeInstanceOf(HTMLElement);
    const plate = badge as HTMLElement;
    expect(plate.hidden).toBe(true);

    ui.setPvpDeadline(Date.now() + 10_000);
    expect(plate.hidden).toBe(false);
    expect(plate.textContent).toBe('Режим ПВП - 10 секунд');
    expect(root.querySelectorAll('#pvp-badge')).toHaveLength(1);

    ui.syncPvpBadge(Date.now() + 1_500);
    expect(root.querySelector('#pvp-badge')).toBe(plate);
    expect(plate.textContent).toMatch(/^Режим ПВП - [89] секунд$/);

    ui.setPvpDeadline(Date.now() - 1);
    expect(plate.hidden).toBe(true);
    expect(plate.textContent).toBe('');

    const actions = { send: () => undefined, close: () => undefined };
    ui.openGameMenu({
      type: 'menu', screen: 'root', title: 'Меню', balance: 0, balanceLabel: '0',
    }, actions);
    ui.openGameMenu({
      type: 'menu',
      screen: 'root',
      title: 'Меню',
      balance: 0,
      balanceLabel: '0',
      message: TELEPORT_COOLDOWN_MESSAGE,
    }, actions);
    const note = root.querySelector('[data-menu-message]');
    expect(note).toBeInstanceOf(HTMLElement);
    const line = note as HTMLElement;
    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe(TELEPORT_COOLDOWN_MESSAGE);
    expect(line.classList.contains('is-warn')).toBe(true);
    const spawn = root.querySelector('[data-menu-open="spawn"]');
    expect(spawn).toBeInstanceOf(HTMLButtonElement);
    expect((spawn as HTMLButtonElement).disabled).toBe(false);
  });
});
