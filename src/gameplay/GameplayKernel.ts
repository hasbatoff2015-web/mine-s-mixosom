/**
 * Shared gameplay simulation order for singleplayer (`Game`) and the Anarchy
 * server (`ServerGameplay` / `WorldInstance`).
 *
 * This is orchestration only: hosts pass existing manager methods. The kernel
 * does not implement physics, fluids, combat, or networking.
 *
 * `VoxelWorld.tick` already runs time, scheduled ticks, the fluid queue,
 * support integrity, and furnaces. Do not call those systems again from a host
 * hook except the explicit post-explosion `preDropSupport` pass that singleplayer
 * already had.
 */

export const GAMEPLAY_KERNEL_STEPS = [
  'world',
  'farming',
  'falling',
  'players',
  'playerActions',
  'projectiles',
  'vehicles',
  'mobs',
  'mobEvents',
  'preDropSupport',
  'drops',
  'redstone',
  'explosions',
] as const;

export type GameplayKernelStep = (typeof GAMEPLAY_KERNEL_STEPS)[number];

/** Host hook result: `'abort'` skips the remaining kernel steps (SP death). */
export type GameplayKernelContinue = void | 'abort';

export interface GameplayKernelHost {
  /** `VoxelWorld.tick` — once. Fluids/time/furnaces live here, not in later steps. */
  tickWorld(): void;
  /** Sparse loaded-chunk farming pulses after the world's tick counter advances. */
  tickFarming(): void;
  /** Spawn falling blocks from the world queue, then `falling.update`. */
  tickFalling(): void;
  /** Player physics + survival. Server also keeps mining/use hold next to physics. */
  tickPlayers(): GameplayKernelContinue;
  /** SP targeting/mining/use overlay. Server no-op (mining is in `tickPlayers`). */
  tickPlayerActions(): GameplayKernelContinue;
  /** Player arrows / projectiles. */
  tickProjectiles(): void;
  /** Minecarts (not riding/network). */
  tickVehicles(): void;
  /** Mob AI/physics. Pass shared `daylightFactor(world.timeOfDay)`. */
  tickMobs(): void;
  /** Consume mob drops/damage/explosions. SP may process the explosion queue here. */
  handleMobEvents(): GameplayKernelContinue;
  /** SP extra support + detached after mid-tick explosions. Server no-op. */
  tickPreDropSupport(): void;
  /** Dropped-item physics. Pickup stays in the host hook if it already did. */
  tickDrops(): void;
  /** Pressure plates + `redstone.update`. Do not process the explosion queue here. */
  tickRedstone(): void;
  /** Drain the explosion queue once at the end of the tick. */
  processExplosions(): GameplayKernelContinue;
}

/**
 * Run one simulation tick in the canonical order.
 * Returns `true` when a host aborted (remaining systems must not run).
 *
 * `trace` is optional and caller-owned. Production hosts pass nothing, or reuse
 * one array (`trace.length = 0` then pass it) when `?debugTick=1` / `FC_DEBUG_TICK=1`.
 */
export function tickGameplayKernel(host: GameplayKernelHost, trace?: string[]): boolean {
  const record = (step: GameplayKernelStep): void => {
    trace?.push(step);
  };

  record('world');
  host.tickWorld();

  record('farming');
  host.tickFarming();

  record('falling');
  host.tickFalling();

  record('players');
  if (host.tickPlayers() === 'abort') return true;

  record('playerActions');
  if (host.tickPlayerActions() === 'abort') return true;

  record('projectiles');
  host.tickProjectiles();

  record('vehicles');
  host.tickVehicles();

  record('mobs');
  host.tickMobs();

  record('mobEvents');
  if (host.handleMobEvents() === 'abort') return true;

  record('preDropSupport');
  host.tickPreDropSupport();

  record('drops');
  host.tickDrops();

  record('redstone');
  host.tickRedstone();

  record('explosions');
  if (host.processExplosions() === 'abort') return true;

  return false;
}

export function formatGameplayKernelTrace(trace: readonly string[]): string {
  return trace.join('>');
}
