import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_AIR_TICKS } from '../src/survival';
import { AIR_HUD_ICON_COUNT, airHudIcons, type AirHudState } from '../src/ui/airHud';
import { HUD_STATUS_ICON_COUNT } from '../src/ui/hudStatusLayout';

function counts(state: AirHudState): { full: number; bursting: number } {
  return {
    full: state.icons.filter((icon) => icon === 'full').length,
    bursting: state.icons.filter((icon) => icon === 'bursting').length,
  };
}

describe('air HUD bubbles', () => {
  it('uses the same ten-icon row as hearts and hunger', () => {
    expect(MAX_AIR_TICKS).toBe(300);
    expect(AIR_HUD_ICON_COUNT).toBe(10);
    expect(AIR_HUD_ICON_COUNT).toBe(HUD_STATUS_ICON_COUNT);
  });

  it('maps submerged air with the vanilla ceiling thresholds', () => {
    expect(counts(airHudIcons(300, true))).toEqual({ full: 10, bursting: 0 });
    expect(airHudIcons(300, true).visible).toBe(true);
    expect(counts(airHudIcons(299, true))).toEqual({ full: 10, bursting: 0 });
    const partial = airHudIcons(272, true);
    expect(counts(partial)).toEqual({ full: 9, bursting: 1 });
    expect(partial.icons[0]).toBe('bursting');
    expect(partial.icons.slice(1).every((icon) => icon === 'full')).toBe(true);
    expect(counts(airHudIcons(270, true))).toEqual({ full: 9, bursting: 0 });
    expect(airHudIcons(30, true).icons).toEqual(['full']);
    expect(airHudIcons(2, true).icons).toEqual(['bursting']);
    expect(airHudIcons(0, true).icons).toEqual([]);
    expect(airHudIcons(0, true).visible).toBe(true);
  });

  it('hides the row above water and clamps bad inputs', () => {
    const surfaced = airHudIcons(120, false);
    expect(surfaced.visible).toBe(false);
    expect(surfaced.airTicks).toBe(120);
    expect(surfaced.icons.length).toBeGreaterThan(0);

    expect(airHudIcons(-8, true)).toMatchObject({ airTicks: 0, icons: [], visible: true });
    expect(airHudIcons(300.9, true).airTicks).toBe(300);
    expect(airHudIcons(480, true).icons).toHaveLength(10);
    expect(airHudIcons(Number.NaN, true)).toMatchObject({ airTicks: 0, icons: [], visible: true });
    expect(airHudIcons(Number.POSITIVE_INFINITY, false)).toMatchObject({
      airTicks: 0,
      visible: false,
      icons: [],
    });
  });

  it('keeps the bubble row right-aligned above hunger in the status CSS', () => {
    const css = readFileSync('src/style.css', 'utf8');
    expect(css).toContain('.status-right {');
    expect(css).toContain('align-items: flex-end;');
    expect(css).toContain('justify-content: flex-end;');
    expect(css).toContain('width: calc(10 * var(--hud-status-icon-size) + 9 * var(--hud-status-icon-gap));');
    expect(css).toContain('.air-icon');
    const game = readFileSync('src/core/Game.ts', 'utf8');
    expect(game).toContain('airTicks: session.survival.airTicks');
    expect(game).toContain("session.summary.mode === 'survival'");
    expect(game).toContain('session.player.headSubmerged');
    expect(game).toContain('session.player.inWater');
    expect(game).toContain('!session.player.inLava');
    expect(game).not.toContain('airTicks < MAX_AIR_TICKS');
  });
});
