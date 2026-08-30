import { describe, expect, it } from 'vitest';
import { MAX_HEALTH } from '../src/survival';
import { ARMOR_HUD_ICON_COUNT } from '../src/ui/armorHud';
import { HEART_HUD_ICON_COUNT, absorptionHudIcons, heartHudIcons } from '../src/ui/heartHud';
import {
  HUD_COMPACT_LANDSCAPE_SCALE,
  HUD_DESKTOP_SCALE_MAX,
  HUD_HOTBAR_SLOT_SIZE_PX,
  HUD_STATUS_ICON_COUNT,
  HUD_STATUS_ICON_GAP_PX,
  HUD_STATUS_ICON_SIZE_PX,
} from '../src/ui/hudStatusLayout';

function iconCounts(health: number): { full: number; half: number; empty: number } {
  const hud = heartHudIcons(health);
  return {
    full: hud.icons.filter((icon) => icon === 'full').length,
    half: hud.icons.filter((icon) => icon === 'half').length,
    empty: hud.icons.filter((icon) => icon === 'empty').length,
  };
}

describe('health HUD hearts', () => {
  it('still represents 20 HP as 10 hearts', () => {
    expect(MAX_HEALTH).toBe(20);
    expect(HEART_HUD_ICON_COUNT).toBe(10);
    expect(heartHudIcons(20).icons).toHaveLength(10);
    expect(iconCounts(20)).toEqual({ full: 10, half: 0, empty: 0 });
    expect(iconCounts(0)).toEqual({ full: 0, half: 0, empty: 10 });
  });

  it('maps odd HP to a half heart without changing the 0–20 health scale', () => {
    expect(iconCounts(1)).toEqual({ full: 0, half: 1, empty: 9 });
    expect(iconCounts(11)).toEqual({ full: 5, half: 1, empty: 4 });
    expect(heartHudIcons(Number.NaN).health).toBe(0);
    expect(heartHudIcons(40).health).toBe(20);
  });

  it('aligns heart and armor bars through shared layout constants', () => {
    expect(HEART_HUD_ICON_COUNT).toBe(ARMOR_HUD_ICON_COUNT);
    expect(HEART_HUD_ICON_COUNT).toBe(HUD_STATUS_ICON_COUNT);
    expect(HUD_STATUS_ICON_SIZE_PX).toBe(18);
    expect(HUD_STATUS_ICON_GAP_PX).toBe(1);
    expect(HUD_HOTBAR_SLOT_SIZE_PX).toBe(50);
    expect(HUD_DESKTOP_SCALE_MAX).toBe(1.2);
    expect(HUD_COMPACT_LANDSCAPE_SCALE).toBe(0.7);
  });

  it('places absorption hearts as extra yellow icons, never over red hearts', () => {
    expect(absorptionHudIcons(0).icons).toEqual([]);
    expect(absorptionHudIcons(4).icons).toEqual(['full', 'full']);
    expect(absorptionHudIcons(3).icons).toEqual(['full', 'half']);
    expect(absorptionHudIcons(2).icons).toEqual(['full']);
    expect(absorptionHudIcons(1).icons).toEqual(['half']);
    expect(heartHudIcons(20).icons).toHaveLength(10);
    expect(absorptionHudIcons(4).icons).not.toContain('empty');
  });
});
