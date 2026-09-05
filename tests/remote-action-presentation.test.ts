import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { IDLE_PLAYER_PRESENTATION, REMOTE_ACTION_STALE_MS } from '../shared/playerPresentation';
import type { PlayerPresentationState, RemotePlayerInfo } from '../shared/protocol';
import { BlockId } from '../src/blocks';
import { RemotePlayerView } from '../src/net/RemotePlayerView';
import type { PlayerVisual } from '../src/rendering/player/PlayerVisual';
import type { VoxelWorld } from '../src/world/World';

const mining = { x: 1, y: 70, z: 2, blockId: BlockId.Stone, progress: 0.45 };
const info: RemotePlayerInfo = { id: 'actor', name: 'Actor', x: 0, y: 70, z: 0, yaw: 0, pitch: 0 };
function harness(presentation?: PlayerPresentationState) {
  const visual = {
    root: new THREE.Group(), animator: { reset: vi.fn() },
    update: vi.fn(), setHeldItem: vi.fn(), swing: vi.fn(), applyWorldLight: vi.fn(), dispose: vi.fn(),
  };
  const onMining = vi.fn();
  const onRemove = vi.fn();
  const world = { getBlock: vi.fn(() => BlockId.Stone) };
  const view = new RemotePlayerView({ ...info, presentation }, {
    visual: visual as unknown as PlayerVisual, world: world as unknown as VoxelWorld, onMining, onRemove,
  }, 100);
  return { view, visual, world, onMining, onRemove };
}

describe('authoritative remote action presentation', () => {
  it('renders initial mining and held tool before any spatial snapshot, without replaying past swings', () => {
    const { view, visual, onMining } = harness({ ...IDLE_PLAYER_PRESENTATION, mining, heldItemId: 'iron_pickaxe', swingSeq: 9 });
    view.interpolate(100, 1 / 60);
    expect(visual.update).toHaveBeenLastCalledWith(1 / 60, expect.objectContaining({ mining: true }));
    expect(visual.setHeldItem).toHaveBeenLastCalledWith('iron_pickaxe');
    expect(onMining).toHaveBeenLastCalledWith('actor', mining, 100);
    expect(visual.swing).not.toHaveBeenCalled();
    view.dispose();
  });

  it('passes latest mining, bow, food and blocking state directly to the existing animator', () => {
    const { view, visual } = harness();
    view.applySnapshot({ ...info, presentation: {
      ...IDLE_PLAYER_PRESENTATION, mining, bowCharge: 0.8, foodUseProgress: 0.5, swordBlocking: true,
    } }, 150, 1);
    view.interpolate(150, 0.016);
    expect(visual.update).toHaveBeenLastCalledWith(0.016, expect.objectContaining({
      mining: true, bowCharge: 0.8, foodUseProgress: 0.5, swordBlocking: true,
    }));
    view.applySnapshot({ ...info, presentation: IDLE_PLAYER_PRESENTATION }, 200, 2);
    view.interpolate(200, 0.016);
    expect(visual.update).toHaveBeenLastCalledWith(0.016, expect.objectContaining({
      mining: false, bowCharge: 0, foodUseProgress: 0, swordBlocking: false,
    }));
    view.dispose();
  });

  it('deduplicates 10 → 10 → 11 and ignores late or repeated tick action state', () => {
    const { view, visual } = harness();
    const send = (seq: number, tick: number) => view.applySnapshot({
      ...info, presentation: { ...IDLE_PLAYER_PRESENTATION, swingSeq: seq },
    }, 100 + tick * 50, tick);
    send(10, 1);
    expect(visual.swing).toHaveBeenCalledTimes(1);
    send(10, 2);
    expect(visual.swing).toHaveBeenCalledTimes(1);
    send(11, 3);
    expect(visual.swing).toHaveBeenCalledTimes(2);
    send(12, 2);
    send(12, 3);
    expect(visual.swing).toHaveBeenCalledTimes(2);
    view.dispose();
  });

  it('expires continuous actions without advancing progress or replaying an event on recovery', () => {
    const state = { ...IDLE_PLAYER_PRESENTATION, mining, bowCharge: 0.7, swingSeq: 7 };
    const { view, visual } = harness(state);
    view.interpolate(101 + REMOTE_ACTION_STALE_MS, 0.016);
    expect(visual.update).toHaveBeenLastCalledWith(0.016, expect.objectContaining({ mining: false, bowCharge: 0 }));
    view.applySnapshot({ ...info, presentation: state }, 2000, 10);
    view.interpolate(2000, 0.016);
    expect(visual.update).toHaveBeenLastCalledWith(0.016, expect.objectContaining({ mining: true, bowCharge: 0.7 }));
    expect(visual.swing).not.toHaveBeenCalled();
    expect(state.mining.progress).toBe(0.45);
    view.dispose();
  });

  it('clears mining on block replacement, death, reset and removal; a new connection establishes a sequence baseline', () => {
    const { view, visual, world, onMining, onRemove } = harness({ ...IDLE_PLAYER_PRESENTATION, mining, swingSeq: 8 });
    world.getBlock.mockReturnValue(BlockId.Air);
    view.interpolate(100, 0.016);
    expect(visual.update).toHaveBeenLastCalledWith(0.016, expect.objectContaining({ mining: false }));
    view.applySnapshot({ ...info, dead: true, presentation: { ...IDLE_PLAYER_PRESENTATION, mining, swingSeq: 9 } } as never, 150, 1);
    expect(onMining).toHaveBeenLastCalledWith('actor', null, 150);
    expect(visual.swing).not.toHaveBeenCalled();
    view.reset({ ...info, presentation: { ...IDLE_PLAYER_PRESENTATION, swingSeq: 1 } }, 200);
    expect(onMining).toHaveBeenLastCalledWith('actor', null, 200);
    view.applySnapshot({ ...info, presentation: { ...IDLE_PLAYER_PRESENTATION, swingSeq: 2 } }, 250, 2);
    expect(visual.swing).toHaveBeenCalledTimes(1);
    view.dispose();
    expect(onRemove).toHaveBeenCalledWith('actor');
  });
});
