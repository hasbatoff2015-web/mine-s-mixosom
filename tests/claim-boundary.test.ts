import { describe, expect, it } from 'vitest';
import { claimBoundaryEdgePositions } from '../src/rendering/ClaimBoundaryRenderer';

describe('claim boundary wireframe', () => {
  it('builds 12 cube edges from an inclusive block AABB', () => {
    const positions = claimBoundaryEdgePositions(0, 10, 20, 2, 11, 21);
    expect(positions).toHaveLength(72);
    expect(Array.from(positions.slice(0, 6))).toEqual([0, 10, 20, 3, 10, 20]);
    expect(Array.from(positions.slice(24, 30))).toEqual([0, 12, 20, 3, 12, 20]);
  });
});
