import { describe, expect, it } from 'vitest';
import {
  CLAIM_BOUNDARY_EDGE_WIDTH_PX,
  claimBoundaryEdgePositions,
  createClaimBoundaryMaterial,
} from '../src/rendering/ClaimBoundaryRenderer';

describe('claim boundary wireframe', () => {
  it('builds 12 cube edges from an inclusive block AABB', () => {
    const positions = claimBoundaryEdgePositions(0, 10, 20, 2, 11, 21);
    expect(positions).toHaveLength(72);
    expect(Array.from(positions.slice(0, 6))).toEqual([0, 10, 20, 3, 10, 20]);
    expect(Array.from(positions.slice(24, 30))).toEqual([0, 12, 20, 3, 12, 20]);
  });

  it('depth-tests like world geometry and is about half the previous screen width', () => {
    expect(CLAIM_BOUNDARY_EDGE_WIDTH_PX).toBe(3);
    const material = createClaimBoundaryMaterial();
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(material.linewidth).toBe(CLAIM_BOUNDARY_EDGE_WIDTH_PX);
    expect(material.transparent).toBe(false);
    material.dispose();
  });
});
