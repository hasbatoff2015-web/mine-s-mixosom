import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIREWORK_BURST_COLORS, FireworkVisuals, chooseFireworkBurstColor } from '../src/rendering/FireworkVisuals';

afterEach(() => vi.restoreAllMocks());

describe('firework burst presentation', () => {
  it('chooses a saturated palette color once per burst and shares one non-additive material', () => {
    expect(chooseFireworkBurstColor(() => 0)).toBe(FIREWORK_BURST_COLORS[0]);
    expect(chooseFireworkBurstColor(() => 0.999)).toBe(FIREWORK_BURST_COLORS.at(-1));
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockReturnValue(new THREE.Texture());
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5);
    const visuals = new FireworkVisuals();
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
    for (let index = 1; index < 88; index += 1) expect(color(index)).toEqual(color(0));
    for (let index = 89; index < 176; index += 1) expect(color(index)).toEqual(color(88));
    expect(color(0)).not.toEqual(color(88));
    visuals.dispose();
  });
});
