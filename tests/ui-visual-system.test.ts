import { describe, expect, it } from 'vitest';
import { Inventory } from '../src/inventory';
import { containerStageSize, containerUiScaleWithClose, MC_CLOSE_HIT_MIN_PX } from '../src/ui/containerTheme';
import { absorptionHudIcons, heartHudIcons } from '../src/ui/heartHud';
import { HUNGER_HUD_ICON_COUNT, hungerHudIcons } from '../src/ui/hungerHud';

describe('responsive HUD visual model', () => {
  it('keeps nine hotbar slots and the canonical health/absorption presentation', () => {
    expect(Inventory.HOTBAR_SIZE).toBe(9);
    expect(heartHudIcons(20).icons).toHaveLength(10);
    expect(heartHudIcons(1).icons[0]).toBe('half');
    expect(absorptionHudIcons(4).icons).toEqual(['full', 'full']);
  });

  it('maps hunger 0–20 to stable full, half and empty drumsticks', () => {
    expect(HUNGER_HUD_ICON_COUNT).toBe(10);
    expect(hungerHudIcons(20).icons).toEqual(Array.from({ length: 10 }, () => 'full'));
    expect(hungerHudIcons(19).icons.at(-1)).toBe('half');
    expect(hungerHudIcons(1).icons).toEqual(['half', ...Array.from({ length: 9 }, () => 'empty')]);
    expect(hungerHudIcons(0).icons).toEqual(Array.from({ length: 10 }, () => 'empty'));
    expect(hungerHudIcons(Number.NaN).hunger).toBe(0);
    expect(hungerHudIcons(30).hunger).toBe(20);
  });
});

describe('compact Creative composition', () => {
  it('fits the panel and the same >=44px close target at every small landscape target', () => {
    expect(MC_CLOSE_HIT_MIN_PX).toBe(44);
    const stage = containerStageSize('creative', false);
    expect(stage).toEqual({ width: 195, height: 166 });
    for (const [width, height] of [[932, 430], [896, 414], [844, 390], [740, 360]] as const) {
      const scale = containerUiScaleWithClose(width, height, stage.width, stage.height);
      expect(stage.width * scale + MC_CLOSE_HIT_MIN_PX).toBeLessThanOrEqual(width - 24);
      expect(stage.height * scale).toBeLessThanOrEqual(height - 24);
    }
  });
});
