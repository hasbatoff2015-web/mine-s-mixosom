import { describe, expect, it } from 'vitest';
import { GAMEPLAY_KERNEL_STEPS, tickGameplayKernel } from '../src/gameplay/GameplayKernel';
import { resolveUseIntent } from '../src/gameplay/useInteraction';
import { defaultSlabType, stairLocalBoxes } from '../src/world/blockGeometry';
import { SYSTEM_RANDOM } from '../src/gameplay/random';
import { IGNORE_SIMULATION_EVENTS, SIMULATION_EVENT_KINDS } from '../src/gameplay/simulationEvents';
import { WORLD_SCHEMA_VERSION } from '../src/save/types';
import { HeadlessEntityHost } from '../src/entities/EntityHost';
import { Vec3 } from '../src/math/vec3';

describe('Phase 7 shared simulation Node smoke', () => {
  it('loads kernel, interaction, geometry, snapshot types, RNG and headless entities', () => {
    expect(GAMEPLAY_KERNEL_STEPS.length).toBeGreaterThanOrEqual(8);
    expect(typeof tickGameplayKernel).toBe('function');
    expect(typeof resolveUseIntent).toBe('function');
    expect(typeof defaultSlabType).toBe('function');
    expect(typeof stairLocalBoxes).toBe('function');
    expect(SYSTEM_RANDOM.next()).toBeGreaterThanOrEqual(0);
    expect(WORLD_SCHEMA_VERSION).toBe(1);
    expect(SIMULATION_EVENT_KINDS.length).toBeGreaterThan(8);
    expect(IGNORE_SIMULATION_EVENTS.emitPre('block-break', {})).toBe(true);
    expect(new HeadlessEntityHost().hasVisuals).toBe(false);
    expect(new Vec3(1, 0, 0).length()).toBeCloseTo(1, 6);
  });
});
