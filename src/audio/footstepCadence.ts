/** Horizontal metres between restrained walking footfalls (~0.5 s at 4.3 b/s). */
export const WALK_STRIDE_BLOCKS = 2.15;
/** Sprint is slightly faster, not a machine-gun. */
export const SPRINT_STRIDE_BLOCKS = 1.55;
/** Ignore tiny shuffles / look-only movement. */
export const MIN_FOOTSTEP_DISTANCE = 0.04;

export interface FootstepState {
  accumulator: number;
}

export function createFootstepState(): FootstepState {
  return { accumulator: 0 };
}

export function resetFootsteps(state: FootstepState): void {
  state.accumulator = 0;
}

export function advanceFootsteps(
  state: FootstepState,
  args: {
    grounded: boolean;
    flying: boolean;
    inWater?: boolean;
    sprinting: boolean;
    horizontalDistance: number;
  },
): boolean {
  if (!args.grounded || args.flying || args.inWater) {
    resetFootsteps(state);
    return false;
  }
  const distance = args.horizontalDistance;
  if (!(distance >= MIN_FOOTSTEP_DISTANCE)) return false;
  state.accumulator += distance;
  const stride = args.sprinting ? SPRINT_STRIDE_BLOCKS : WALK_STRIDE_BLOCKS;
  if (state.accumulator < stride) return false;
  state.accumulator -= stride;
  if (state.accumulator > stride) state.accumulator %= stride;
  return true;
}

export function blockUnderFeet(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return {
    x: Math.floor(x),
    y: Math.floor(y - 0.05),
    z: Math.floor(z),
  };
}
