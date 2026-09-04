import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAY_TICKS } from '../src/core/constants';
import {
  GAMEPLAY_KERNEL_STEPS,
  daylightFactor,
  formatGameplayKernelTrace,
  tickGameplayKernel,
  type GameplayKernelHost,
} from '../src/gameplay';
import { daylightFactor as serverDaylightFactor } from '../server/gameplay';
import { SUNLIGHT_DAYLIGHT_MIN, isSunHighEnough } from '../src/combat/fireSources';

function recordingHost(
  overrides: Partial<GameplayKernelHost> = {},
): { host: GameplayKernelHost; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  const bump = (step: string): void => {
    counts[step] = (counts[step] ?? 0) + 1;
  };
  const host: GameplayKernelHost = {
    tickWorld: () => bump('world'),
    tickFarming: () => bump('farming'),
    tickFalling: () => bump('falling'),
    tickPlayers: () => { bump('players'); },
    tickPlayerActions: () => { bump('playerActions'); },
    tickProjectiles: () => bump('projectiles'),
    tickVehicles: () => bump('vehicles'),
    tickMobs: () => bump('mobs'),
    handleMobEvents: () => { bump('mobEvents'); },
    tickPreDropSupport: () => bump('preDropSupport'),
    tickDrops: () => bump('drops'),
    tickRedstone: () => bump('redstone'),
    processExplosions: () => { bump('explosions'); },
    ...overrides,
  };
  return { host, counts };
}

describe('GameplayKernel', () => {
  it('runs every simulation step exactly once in a stable order', () => {
    const { host, counts } = recordingHost();
    const trace: string[] = [];
    expect(tickGameplayKernel(host, trace)).toBe(false);
    expect(trace).toEqual([...GAMEPLAY_KERNEL_STEPS]);
    expect(formatGameplayKernelTrace(trace)).toBe(GAMEPLAY_KERNEL_STEPS.join('>'));
    for (const step of GAMEPLAY_KERNEL_STEPS) {
      expect(counts[step], step).toBe(1);
    }
  });

  it('does not allocate a trace when the host omits one', () => {
    const { host, counts } = recordingHost();
    tickGameplayKernel(host);
    expect(Object.keys(counts)).toHaveLength(GAMEPLAY_KERNEL_STEPS.length);
  });

  it('aborts after player physics and does not tick later systems', () => {
    const { host, counts } = recordingHost({
      tickPlayers: () => {
        counts.players = (counts.players ?? 0) + 1;
        return 'abort';
      },
    });
    const trace: string[] = [];
    expect(tickGameplayKernel(host, trace)).toBe(true);
    expect(trace).toEqual(['world', 'farming', 'falling', 'players']);
    expect(counts.world).toBe(1);
    expect(counts.farming).toBe(1);
    expect(counts.falling).toBe(1);
    expect(counts.players).toBe(1);
    expect(counts.projectiles).toBeUndefined();
    expect(counts.mobs).toBeUndefined();
    expect(counts.drops).toBeUndefined();
    expect(counts.redstone).toBeUndefined();
    expect(counts.explosions).toBeUndefined();
  });

  it('does not double-tick fluids/mobs/minecarts/projectiles when the host is well-behaved', () => {
    const { host, counts } = recordingHost();
    tickGameplayKernel(host);
    tickGameplayKernel(host);
    expect(counts.world).toBe(2);
    expect(counts.mobs).toBe(2);
    expect(counts.vehicles).toBe(2);
    expect(counts.projectiles).toBe(2);
    expect(counts.drops).toBe(2);
    expect(counts.redstone).toBe(2);
  });

  it('uses one daylight factor for sky, mobs, and sunlight at the same world time', () => {
    const noon = daylightFactor(6000);
    const dusk = daylightFactor(13000);
    const midnight = daylightFactor(18000);
    expect(noon).toBeGreaterThan(SUNLIGHT_DAYLIGHT_MIN);
    expect(isSunHighEnough(noon)).toBe(true);
    expect(isSunHighEnough(midnight)).toBe(false);
    expect(dusk).toBeLessThan(noon);
    expect(serverDaylightFactor(6000)).toBe(noon);
    expect(serverDaylightFactor(18000)).toBe(midnight);
    for (let time = 0; time < DAY_TICKS; time += 500) {
      expect(serverDaylightFactor(time)).toBe(daylightFactor(time));
    }
  });

  it('is the simulation entry used by singleplayer Game and the Anarchy server', () => {
    const root = process.cwd();
    const game = readFileSync(join(root, 'src/core/Game.ts'), 'utf8');
    const server = readFileSync(join(root, 'server/gameplay.ts'), 'utf8');
    const instance = readFileSync(join(root, 'server/WorldInstance.ts'), 'utf8');
    expect(game).toContain('tickGameplayKernel');
    expect(game).toContain('daylightFactor');
    expect(server).toContain('tickGameplayKernel');
    expect(server).toContain('daylightFactor');
    expect(instance).toContain('tickConnectedPlayers');
    expect(instance).toContain('tickPlayers:');
  });
});
