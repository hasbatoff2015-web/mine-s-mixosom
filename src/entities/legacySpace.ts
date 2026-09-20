export const LEGACY_MODEL_UNITS_PER_BLOCK = 16;
export const LEGACY_MODEL_GROUND_Y = 24;

export type LegacyVector = readonly [x: number, y: number, z: number];

/** Legacy X/right, Y/down, Z/back point mapped into Three X/right, Y/up, Z/back. */
export function legacyRotationPointToWorld(
  point: LegacyVector,
  groundY = LEGACY_MODEL_GROUND_Y,
): LegacyVector {
  return [
    point[0] / LEGACY_MODEL_UNITS_PER_BLOCK,
    (groundY - point[1]) / LEGACY_MODEL_UNITS_PER_BLOCK,
    point[2] / LEGACY_MODEL_UNITS_PER_BLOCK,
  ];
}

/** addBox center mapped relative to its pivot; this is deliberately not the pivot itself. */
export function legacyBoxCenterToLocal(box: {
  readonly origin: LegacyVector;
  readonly size: LegacyVector;
}): LegacyVector {
  return [
    (box.origin[0] + box.size[0] / 2) / LEGACY_MODEL_UNITS_PER_BLOCK,
    -(box.origin[1] + box.size[1] / 2) / LEGACY_MODEL_UNITS_PER_BLOCK,
    (box.origin[2] + box.size[2] / 2) / LEGACY_MODEL_UNITS_PER_BLOCK,
  ];
}

/** Reflection of legacy Y-down coordinates changes X/Z rotation signs. */
export function legacyRotationToThree(rotation: LegacyVector): LegacyVector {
  return [-rotation[0], rotation[1], -rotation[2]];
}
