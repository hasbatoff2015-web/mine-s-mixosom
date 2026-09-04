import { describe, expect, it } from 'vitest';
import {
  ENTITY_INTERP_DELAY_MS,
  EntityInterpolationBuffer,
  sampleEntityPose,
} from '../src/net/entitySnapshotInterpolation';
import { packEntitySnapshots } from '../server/gameplay';
import type { EntitySnapshot } from '../shared/protocol';

function pose(x: number, tick: number, at: number, yaw = 0) {
  return { x, y: 70, z: 0, yaw, vx: 0, vy: 0, vz: 0, tick, at };
}

describe('remote entity snapshot interpolation', () => {
  it('interpolates between two snapshots at delayed render time', () => {
    const samples = [pose(0, 1, 1_000), pose(2, 2, 1_050)];
    const mid = sampleEntityPose(samples, 1_105, ENTITY_INTERP_DELAY_MS);
    expect(mid).toBeDefined();
    expect(mid!.x).toBeCloseTo(1, 5);
    expect(mid!.spawned).toBe(false);
    expect(mid!.snapped).toBe(false);
  });

  it('does not change the sampled pose when sampled more often (FPS-independent)', () => {
    const samples = [pose(0, 10, 1_000), pose(4, 11, 1_050)];
    const now = 1_105;
    const a = sampleEntityPose(samples, now, ENTITY_INTERP_DELAY_MS)!;
    for (let step = 0; step < 12; step += 1) {
      const b = sampleEntityPose(samples, now, ENTITY_INTERP_DELAY_MS)!;
      expect(b.x).toBe(a.x);
      expect(b.y).toBe(a.y);
      expect(b.z).toBe(a.z);
      expect(b.yaw).toBe(a.yaw);
    }
  });

  it('ignores stale and out-of-order snapshot ticks', () => {
    const buffer = new EntityInterpolationBuffer();
    expect(buffer.acceptPacketTick(10)).toBe(true);
    expect(buffer.ingest('mob-1', { x: 0, y: 70, z: 0 }, 10, 1_000).accepted).toBe(true);
    expect(buffer.acceptPacketTick(10)).toBe(false);
    expect(buffer.acceptPacketTick(9)).toBe(false);
    expect(buffer.ingest('mob-1', { x: 99, y: 70, z: 0 }, 9, 1_010).accepted).toBe(false);
    const held = buffer.sample('mob-1', 1_000)!;
    expect(held.x).toBe(0);
  });

  it('snaps when the correction exceeds the teleport threshold', () => {
    const samples = [pose(0, 1, 1_000), pose(20, 2, 1_050)];
    const sampled = sampleEntityPose(samples, 1_105, ENTITY_INTERP_DELAY_MS)!;
    expect(sampled.snapped).toBe(true);
    expect(sampled.x).toBe(20);
  });

  it('interpolates yaw along the shortest angle', () => {
    const from = Math.PI * 2 - 0.2;
    const samples = [pose(0, 1, 1_000, from), pose(0, 2, 1_050, 0.2)];
    const mid = sampleEntityPose(samples, 1_105, ENTITY_INTERP_DELAY_MS)!;
    const delta = Math.abs(((mid.yaw - from + Math.PI) % (Math.PI * 2)) - Math.PI);
    expect(delta).toBeLessThan(Math.PI / 2);
    expect(Math.abs(mid.yaw) < 1 || Math.abs(mid.yaw - Math.PI * 2) < 1).toBe(true);
  });

  it('places a newly spawned entity immediately', () => {
    const buffer = new EntityInterpolationBuffer();
    buffer.acceptPacketTick(1);
    const result = buffer.ingest('arrow-1', { x: 3, y: 70, z: 8 }, 1, 500);
    expect(result.spawned).toBe(true);
    const sampled = buffer.sample('arrow-1', 500)!;
    expect(sampled.x).toBe(3);
    expect(sampled.spawned).toBe(true);
  });

  it('remove drops history so the last pose cannot lerp after despawn', () => {
    const buffer = new EntityInterpolationBuffer();
    buffer.acceptPacketTick(1);
    buffer.ingest('mob-1', { x: 0, y: 70, z: 0 }, 1, 1_000);
    buffer.acceptPacketTick(2);
    buffer.ingest('mob-1', { x: 2, y: 70, z: 0 }, 2, 1_050);
    expect(buffer.retain(new Set())).toEqual(['mob-1']);
    expect(buffer.sample('mob-1', 1_105)).toBeUndefined();
  });

  it('smoothly interpolates mob travel on the delayed entity timeline', () => {
    const entity = [pose(0, 1, 1_000), pose(2, 2, 1_050)];
    const mob = sampleEntityPose(entity, 1_105)!;
    expect(mob.x).toBeCloseTo(1, 5);
  });

  it('does not jump to the newest entity sample the instant it arrives', () => {
    const samples = [pose(0, 1, 50), pose(4, 2, 100)];
    expect(sampleEntityPose(samples, 100)!.x).toBeCloseTo(0, 5);
  });

  it('packs arrows before mobs so projectiles are not starved by the snapshot cap', () => {
    const arrow: EntitySnapshot = { id: 'arrow-1', kind: 'arrow', x: 1, y: 70, z: 1 };
    const mobs = Array.from({ length: 96 }, (_, index) => ({
      id: `mob-${index}`,
      kind: 'mob' as const,
      x: index,
      y: 70,
      z: 0,
    }));
    const packed = packEntitySnapshots({ arrows: [arrow], mobs });
    expect(packed[0]?.id).toBe('arrow-1');
    expect(packed).toHaveLength(96);
    expect(packed.some((entry) => entry.kind === 'arrow')).toBe(true);
  });
});
