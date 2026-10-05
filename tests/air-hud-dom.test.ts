/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { Inventory } from '../src/inventory';
import { GameUI } from '../src/ui/GameUI';

function show(ui: GameUI, inventory: Inventory, airTicks: number, airVisible: boolean, armor = 0): void {
  ui.updateHud({
    inventory,
    selectedSlot: 0,
    health: 20,
    hunger: 14,
    armor,
    miningProgress: 0,
    airTicks,
    airVisible,
  });
}

describe('air HUD DOM', () => {
  it('places bubbles above hunger and keeps the hunger row', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inventory = new Inventory();
    const ui = new GameUI(root);
    show(ui, inventory, 300, false);
    const right = root.querySelector('.status-right');
    const air = root.querySelector('.air');
    const hunger = root.querySelector('.hunger');
    expect(right).toBeTruthy();
    expect(air).toBeTruthy();
    expect(hunger).toBeTruthy();
    expect(right?.children[0]).toBe(air);
    expect(right?.children[1]).toBe(hunger);
    expect(root.querySelector('.status-left .hearts')).toBeTruthy();
    expect(root.querySelector('.status-left .armor')?.classList.contains('hidden')).toBe(true);
    expect(air?.classList.contains('hidden')).toBe(true);
    expect(air?.getAttribute('aria-live')).toBeNull();
    expect(hunger?.querySelectorAll('.hunger-icon')).toHaveLength(10);
    expect(air?.querySelectorAll('.air-icon')).toHaveLength(10);

    show(ui, inventory, 300, true);
    const shown = root.querySelector('.air');
    expect(shown?.classList.contains('hidden')).toBe(false);
    const full = shown?.querySelectorAll('.air-icon') ?? [];
    expect(full).toHaveLength(10);
    expect(full[0]?.getAttribute('src')).toContain('textures/gui/air_full.svg');
    expect(shown?.getAttribute('aria-label')).toBe('Воздух: 10 из 10');
    expect(root.querySelectorAll('.hunger-icon')).toHaveLength(10);

    show(ui, inventory, 272, true, 20);
    const partial = [...(root.querySelectorAll('.air .air-icon') ?? [])];
    expect(partial).toHaveLength(10);
    expect(partial[0]?.getAttribute('src')).toContain('textures/gui/air_bursting.svg');
    expect(partial.slice(1).every((icon) => icon.getAttribute('src')?.includes('textures/gui/air_full.svg'))).toBe(true);
    expect(root.querySelector('.air')?.getAttribute('aria-label')).toBe('Воздух: 10 из 10');
    expect(root.querySelector('.armor')?.classList.contains('hidden')).toBe(false);
    expect(root.querySelectorAll('.hunger-icon')).toHaveLength(10);

    show(ui, inventory, 0, true);
    expect(root.querySelector('.air')?.classList.contains('hidden')).toBe(false);
    expect(root.querySelectorAll('.air-icon')).toHaveLength(0);
    expect(root.querySelector('.air')?.getAttribute('aria-label')).toBe('Воздух: 0 из 10');
    expect(root.querySelectorAll('.hunger-icon')).toHaveLength(10);

    show(ui, inventory, 40, false);
    expect(root.querySelector('.air')?.classList.contains('hidden')).toBe(true);
    expect(root.querySelectorAll('.hunger-icon')).toHaveLength(10);
    root.remove();
  });
});