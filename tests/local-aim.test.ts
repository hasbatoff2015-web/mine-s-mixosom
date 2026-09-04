import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { PLAYER_REACH } from '../src/core/constants';
import { PlayerController } from '../src/player/PlayerController';
import {
  bowSpawnFromAim,
  faceNameFromNormal,
  formatLocalAimHud,
  isAimDiagQueryEnabled,
  localInteractionAim,
  viewDirectionFromLook,
} from '../src/player/localAim';
import { VoxelWorld } from '../src/world/World';

function stackedLogs(): { world: VoxelWorld; player: PlayerController } {
  const world = new VoxelWorld('local-aim');
  world.setBlock(8, 71, 7, BlockId.OakLog);
  world.setBlock(8, 72, 7, BlockId.OakLog);
  const player = new PlayerController({
    position: [8.5, 70, 10.5],
    yaw: 0,
    pitch: 0,
  });
  return { world, player };
}

describe('local interaction aim', () => {
  it('follows live look when PlayerController yaw/pitch are still on the last tick', () => {
    const { world, player } = stackedLogs();
    const tickLook = { yaw: 0, pitch: 0 };
    const liveLook = { yaw: 0, pitch: 0.42 };
    player.yaw = tickLook.yaw;
    player.pitch = tickLook.pitch;

    const staleHit = world.raycast(player.eyePosition(), player.viewDirection(), PLAYER_REACH);
    const liveAim = localInteractionAim(player, liveLook);
    const liveHit = world.raycast(liveAim.origin, liveAim.direction, PLAYER_REACH);

    expect(staleHit).toBeDefined();
    expect(liveHit).toBeDefined();
    expect(liveAim.origin.x).toBeCloseTo(player.eyePosition().x);
    expect(liveAim.origin.y).toBeCloseTo(player.eyePosition().y);
    expect(liveHit!.y).not.toBe(staleHit!.y);
    expect(liveHit!.y).toBe(72);
    expect(staleHit!.y).toBe(71);
  });

  it('uses the same origin and direction for selection and action', () => {
    const { world, player } = stackedLogs();
    const look = { yaw: 0.12, pitch: -0.08 };
    const selection = localInteractionAim(player, look);
    const action = localInteractionAim(player, look);
    const selected = world.raycast(selection.origin, selection.direction, PLAYER_REACH);
    const acted = world.raycast(action.origin, action.direction, PLAYER_REACH);
    expect(action.origin).toEqual(selection.origin);
    expect(action.direction).toEqual(selection.direction);
    expect(acted).toEqual(selected);
  });

  it('spawns the bow along live camera look, not the last fixed-tick viewDirection', () => {
    const player = new PlayerController({ position: [8.5, 70, 8.5], yaw: 0.4, pitch: -0.2 });
    const liveLook = { yaw: -0.55, pitch: 0.18 };
    const aim = localInteractionAim(player, liveLook);
    const spawned = bowSpawnFromAim(aim);
    const stale = player.viewDirection();
    const camera = viewDirectionFromLook(liveLook.yaw, liveLook.pitch);
    expect(spawned.direction.x).toBeCloseTo(camera.x);
    expect(spawned.direction.y).toBeCloseTo(camera.y);
    expect(spawned.direction.z).toBeCloseTo(camera.z);
    expect(Math.abs(spawned.direction.x - stale.x)).toBeGreaterThan(0.1);
  });

  it('matches PlayerController.viewDirection when look is unchanged', () => {
    const player = new PlayerController({ position: [3, 40, 3], yaw: 1.1, pitch: -0.33 });
    const aim = localInteractionAim(player, { yaw: player.yaw, pitch: player.pitch });
    const expected = player.viewDirection();
    expect(aim.direction.x).toBeCloseTo(expected.x);
    expect(aim.direction.y).toBeCloseTo(expected.y);
    expect(aim.direction.z).toBeCloseTo(expected.z);
    expect(aim.yaw).toBe(player.yaw);
    expect(aim.pitch).toBe(player.pitch);
  });

  it('names the targeted face from the hit normal', () => {
    expect(faceNameFromNormal({ x: 0, y: 1, z: 0 })).toBe('up');
    expect(faceNameFromNormal({ x: 0, y: -1, z: 0 })).toBe('down');
    expect(faceNameFromNormal({ x: 1, y: 0, z: 0 })).toBe('east');
  });

  it('formats F3 aim diagnostics and gates ?aimDiag=1 to DEV', () => {
    expect(isAimDiagQueryEnabled('?aimDiag=1', true)).toBe(true);
    expect(isAimDiagQueryEnabled('?aimDiag=1', false)).toBe(false);
    const line = formatLocalAimHud({
      cameraYaw: 0.12,
      cameraPitch: -0.04,
      playerYaw: 0.1,
      playerPitch: -0.04,
      aimYaw: 0.12,
      aimPitch: -0.04,
      targetX: 8,
      targetY: 71,
      targetZ: 7,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
    });
    expect(line).toContain('cam=0.120/-0.040');
    expect(line).toContain('ply=0.100/-0.040');
    expect(line).toContain('look=0.120/-0.040');
    expect(line).toContain('tgt=8,71,7');
    expect(line).toContain('up');
  });
});
