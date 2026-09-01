/**
 * Isolated Node smoke: import shared simulation without Three/DOM/IndexedDB.
 * Combined with `npm run check:boundaries` this is the Phase 7 acceptance check.
 */
import { tickGameplayKernel, GAMEPLAY_KERNEL_STEPS } from '../src/gameplay/GameplayKernel';
import { performUseHeld, resolveUseIntent } from '../src/gameplay/useInteraction';
import { blockCollisionBoxes } from '../src/world/collision';
import { stairLocalBoxes, defaultSlabType } from '../src/world/blockGeometry';
import { SYSTEM_RANDOM, systemRandomFn } from '../src/gameplay/random';
import { IGNORE_SIMULATION_EVENTS } from '../src/gameplay/simulationEvents';
import { WORLD_SCHEMA_VERSION, type WorldSnapshot } from '../src/save/types';
import { HeadlessEntityHost } from '../src/entities/EntityHost';
import { MobManager } from '../src/entities/MobManager';
import { Vec3 } from '../src/math/vec3';

if (GAMEPLAY_KERNEL_STEPS.length < 8) throw new Error('GameplayKernel steps missing');
if (typeof tickGameplayKernel !== 'function') throw new Error('tickGameplayKernel missing');
if (typeof performUseHeld !== 'function' || typeof resolveUseIntent !== 'function') {
  throw new Error('useInteraction missing');
}
if (typeof blockCollisionBoxes !== 'function' || typeof stairLocalBoxes !== 'function') {
  throw new Error('block geometry missing');
}
if (typeof defaultSlabType !== 'function') throw new Error('blockGeometry defaults missing');
if (typeof systemRandomFn !== 'function' || typeof SYSTEM_RANDOM.next !== 'function') {
  throw new Error('RandomSource missing');
}
if (IGNORE_SIMULATION_EVENTS.emitPre('block-break', {}) !== true) {
  throw new Error('simulation event sink must no-op in shared sim');
}
if (WORLD_SCHEMA_VERSION !== 1) throw new Error('WorldSnapshot schema mismatch');
const snapshotOk: WorldSnapshot | undefined = undefined;
void snapshotOk;
const host = new HeadlessEntityHost();
if (host.hasVisuals) throw new Error('HeadlessEntityHost must not have visuals');
if (typeof MobManager !== 'function') throw new Error('MobManager missing');
const v = new Vec3(1, 2, 3);
if (v.distanceTo(new Vec3(1, 2, 3)) !== 0) throw new Error('Vec3 broken');

console.log('sim-node-smoke: GameplayKernel, useInteraction, blockGeometry, WorldSnapshot, RandomSource, EntityHost, Vec3 loaded.');
