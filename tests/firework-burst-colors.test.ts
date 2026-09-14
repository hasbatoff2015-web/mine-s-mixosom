import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIREWORK_BURST_COLORS, FireworkVisuals, chooseFireworkBurstColor } from '../src/rendering/FireworkVisuals';
import { TextureAtlas } from '../src/rendering/TextureAtlas';

afterEach(() => vi.restoreAllMocks());

describe('firework burst presentation', () => {
  it('mixes 70 white and 18 evenly spaced particles of one palette accent per burst', () => {
    expect(chooseFireworkBurstColor(() => 0)).toBe(FIREWORK_BURST_COLORS[0]);
    expect(chooseFireworkBurstColor(() => 0.999)).toBe(FIREWORK_BURST_COLORS.at(-1));
    const load = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockReturnValue(new THREE.Texture());
    const visuals = new FireworkVisuals();
    expect(load).toHaveBeenCalledWith(TextureAtlas.url('item/firework_rocket'));
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5);
    visuals.sync([
      { id: 'red', x: 0, y: 0, z: 0, state: 'burst' },
      { id: 'green', x: 3, y: 0, z: 0, state: 'burst' },
    ]);
    visuals.update(0);
    const points = visuals.group.children.find((child): child is THREE.Points => child instanceof THREE.Points)!;
    const colors = points.geometry.getAttribute('color');
    expect(points.geometry.drawRange.count).toBe(176);
    expect((points.material as THREE.PointsMaterial).blending).toBe(THREE.NormalBlending);
    const color = (index: number) => [colors.getX(index), colors.getY(index), colors.getZ(index)];
    for (const start of [0, 88]) {
      const white = Array.from({ length: 88 }, (_, index) => index)
        .filter((index) => color(start + index).every((channel) => channel === 1));
      const accent = Array.from({ length: 88 }, (_, index) => index)
        .filter((index) => !white.includes(index));
      expect(white).toHaveLength(70);
      expect(accent).toEqual(Array.from({ length: 18 }, (_, index) => index * 5));
      const expected = new THREE.Color(start === 0 ? FIREWORK_BURST_COLORS[0] : FIREWORK_BURST_COLORS[3]).toArray();
      for (const index of accent) {
        color(start + index).forEach((channel, component) => expect(channel).toBeCloseTo(expected[component]!, 6));
      }
    }
    visuals.dispose();
  });
});
