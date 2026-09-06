import { describe, expect, it, vi } from 'vitest';
import { REMOTE_ACTION_STALE_MS } from '../shared/playerPresentation';
import { BlockId } from '../src/blocks';
import { Vec3 } from '../src/math/vec3';
import { BlockBreakingOverlay } from '../src/rendering/BlockBreakingOverlay';
import { RemoteBreakingOverlays } from '../src/rendering/RemoteBreakingOverlays';
import type { VoxelWorld } from '../src/world/World';

function harness() {
  const blocks = new Map([['1,70,1', BlockId.Stone], ['2,70,1', BlockId.Stone]]);
  const world = {
    getBlock: vi.fn((x, y, z) => blocks.get(`${x},${y},${z}`) ?? BlockId.Air),
    skyLightAt: () => 15, blockLightAt: () => 0,
  } as unknown as VoxelWorld;
  const local = new BlockBreakingOverlay(world);
  const visible = vi.fn(() => true);
  const manager = new RemoteBreakingOverlays(world, local, undefined, visible);
  const target = (x = 1, progress = 0) => ({ x, y: 70, z: 1, blockId: BlockId.Stone, progress });
  const dispose = () => { manager.dispose(); local.dispose(); };
  return { manager, local, world, blocks, target, visible, dispose };
}

describe('multiple authoritative breaker overlays', () => {
  it('shows stages 0..9 using the same geometry and cached textures, then aborts', () => {
    const { manager, target, dispose } = harness();
    manager.setBreaker('a', target(), 0);
    const geometry = manager.snapshots()[0]!.geometry;
    for (let stage = 0; stage <= 9; stage++) {
      manager.setBreaker('a', target(1, (stage + 0.01) / 10), stage * 50);
      expect(manager.snapshots()[0]).toMatchObject({ visible: true, stage, geometry });
    }
    const materialDispose = vi.spyOn(manager.snapshots()[0]!.material, 'dispose');
    manager.setBreaker('a', null, 500);
    expect(manager.snapshots()).toHaveLength(0);
    expect(materialDispose).toHaveBeenCalledOnce();
    dispose();
  });

  it('switches targets immediately and keeps independent players visible', () => {
    const { manager, target, dispose } = harness();
    manager.setBreaker('a', target(1, 0.3), 0);
    manager.setBreaker('a', target(2, 0.5), 50);
    expect(manager.snapshots().map(s => s.x)).toEqual([2]);
    manager.setBreaker('b', target(1, 0.7), 50);
    expect(manager.snapshots().map(s => [s.x, s.stage]).sort()).toEqual([[1, 7], [2, 5]]);
    manager.removeBreaker('a');
    expect(manager.snapshots().map(s => s.x)).toEqual([1]);
    dispose();
  });

  it('uses max stage for a shared voxel, falls back when the leading player leaves, and never sums', () => {
    const { manager, target, dispose } = harness();
    manager.setBreaker('a', target(1, 0.3), 0);
    manager.setBreaker('b', target(1, 0.7), 0);
    expect(manager.snapshots()).toHaveLength(1);
    expect(manager.snapshots()[0]!.stage).toBe(7);
    manager.removeBreaker('b');
    expect(manager.snapshots()[0]!.stage).toBe(3);
    dispose();
  });

  it('preserves local progress and resolves local/remote same-target drawing to one mesh', () => {
    const { manager, local, target, dispose } = harness();
    local.setProgress({ ...target(), block: BlockId.Stone, normal: new Vec3(), point: new Vec3(), distance: 0 }, 0.4);
    manager.setBreaker('a', target(2, 0.7), 0);
    expect(local.snapshot()).toMatchObject({ visible: true, stage: 4 });
    expect(local.group.visible).toBe(true);
    manager.setBreaker('a', target(1, 0.7), 50);
    manager.update(50);
    expect(local.group.visible).toBe(false);
    expect(local.snapshot().stage).toBe(4);
    manager.setBreaker('a', target(1, 0.2), 100);
    manager.update(100);
    expect(local.group.visible).toBe(true);
    expect(manager.snapshots()).toHaveLength(0);
    dispose();
  });

  it.each(['finish', 'air', 'replacement', 'same-id-replacement', 'unload', 'disconnect', 'timeout', 'session'])(
    'cleans resources on %s', (cause) => {
      const { manager, target, blocks, dispose } = harness();
      manager.setBreaker('a', target(1, 0.7), 0);
      const release = vi.spyOn(manager.snapshots()[0]!.material, 'dispose');
      if (cause === 'finish') manager.setBreaker('a', target(1, 1), 50);
      if (cause === 'air' || cause === 'unload') blocks.delete('1,70,1');
      if (cause === 'replacement') blocks.set('1,70,1', BlockId.Dirt);
      if (cause === 'same-id-replacement') manager.invalidateBlock(1, 70, 1);
      if (cause === 'disconnect') manager.removeBreaker('a');
      if (cause === 'session') manager.dispose();
      manager.update(cause === 'timeout' ? REMOTE_ACTION_STALE_MS + 1 : 50);
      expect(manager.snapshots()).toHaveLength(0);
      expect(release).toHaveBeenCalledOnce();
      dispose();
    },
  );

  it('allocates meshes only for loaded visible targets and resumes only fresh state after timeout', () => {
    const { manager, target, visible, dispose } = harness();
    visible.mockReturnValue(false);
    manager.setBreaker('a', target(), 0);
    expect(manager.snapshots()).toHaveLength(0);
    visible.mockReturnValue(true);
    manager.update(50);
    expect(manager.snapshots()).toHaveLength(1);
    manager.update(REMOTE_ACTION_STALE_MS + 1);
    manager.update(REMOTE_ACTION_STALE_MS + 2);
    expect(manager.snapshots()).toHaveLength(0);
    dispose();
  });
});
