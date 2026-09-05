import { describe, expect, it } from 'vitest';
import { sampleSurfaceVertexLight, type SurfaceLight } from '../src/world/lightSampling';
import { sampleCubeFace3x3 } from '../src/rendering/meshResearch';

describe('3x3 cube-face AO prototype', () => {
  it('matches per-vertex sampleSurfaceVertexLight on an open and sealed corner', () => {
    const open = (): number => 15;
    const mixed = (x: number, _y: number, z: number): number => (x === 1 && z === 1 ? 256 : 15);
    const faces = [
      { normal: [0, 1, 0] as const, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] as const },
    ];
    for (const read of [open, mixed]) {
      const current: SurfaceLight[] = [
        { sky: 0, block: 0, ao: 1 },
        { sky: 0, block: 0, ao: 1 },
        { sky: 0, block: 0, ao: 1 },
        { sky: 0, block: 0, ao: 1 },
      ];
      const alt: SurfaceLight[] = [
        { sky: 0, block: 0, ao: 1 },
        { sky: 0, block: 0, ao: 1 },
        { sky: 0, block: 0, ao: 1 },
        { sky: 0, block: 0, ao: 1 },
      ];
      const face = faces[0]!;
      for (let c = 0; c < 4; c += 1) {
        const corner = face.corners[c]!;
        sampleSurfaceVertexLight(
          read, corner[0], corner[1], corner[2],
          face.normal[0], face.normal[1], face.normal[2],
          0, 0, 0, current[c]!,
        );
      }
      sampleCubeFace3x3(read, 0, 0, 0, face.normal, face.corners, alt);
      for (let c = 0; c < 4; c += 1) {
        expect(alt[c]!.sky).toBeCloseTo(current[c]!.sky, 9);
        expect(alt[c]!.block).toBeCloseTo(current[c]!.block, 9);
        expect(alt[c]!.ao).toBeCloseTo(current[c]!.ao, 9);
      }
    }
  });
});
