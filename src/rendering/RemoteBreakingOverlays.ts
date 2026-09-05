import * as THREE from 'three';
import { REMOTE_ACTION_STALE_MS, type PlayerPresentationState } from '../../shared/playerPresentation';
import { Vec3 } from '../math/vec3';
import type { VoxelWorld } from '../world/World';
import { BlockBreakingOverlay, type BlockRenderStateResolver } from './BlockBreakingOverlay';

type Mining = NonNullable<PlayerPresentationState['mining']>;
const targetKey = (target: Pick<Mining, 'x' | 'y' | 'z'>): string => `${target.x},${target.y},${target.z}`;

/** Breaker ownership → maximum progress per voxel → canonical crack mesh. */
export class RemoteBreakingOverlays {
  readonly group = new THREE.Group();
  private readonly breakers = new Map<string, { mining: Mining; receivedAt: number }>();
  private readonly overlays = new Map<string, BlockBreakingOverlay>();

  constructor(
    private readonly world: VoxelWorld,
    private readonly local: BlockBreakingOverlay,
    private readonly resolveState: BlockRenderStateResolver = () => undefined,
    private readonly isVisibleTarget: (x: number, z: number) => boolean = () => true,
  ) {
    this.group.name = 'remote-breaking-overlays';
  }

  setBreaker(id: string, mining: PlayerPresentationState['mining'], now: number): void {
    if (mining && Number.isFinite(mining.progress) && mining.progress >= 0 && mining.progress < 1) {
      this.breakers.set(id, { mining, receivedAt: now });
    } else this.breakers.delete(id);
    // Reconcile all player snapshots together on the render frame (linear, not N²).
  }

  removeBreaker(id: string): void {
    this.breakers.delete(id);
    this.update();
  }

  /** Also invalidates same-ID replacements, before the next player snapshot. */
  invalidateBlock(x: number, y: number, z: number): void {
    const key = targetKey({ x, y, z });
    for (const [id, entry] of this.breakers) {
      if (targetKey(entry.mining) === key) this.breakers.delete(id);
    }
    this.update();
  }

  update(now?: number): void {
    const targets = new Map<string, Mining>();
    for (const [id, { mining, receivedAt }] of this.breakers) {
      if ((now !== undefined && now - receivedAt > REMOTE_ACTION_STALE_MS)
        || this.world.getBlock(mining.x, mining.y, mining.z, false) !== mining.blockId) {
        this.breakers.delete(id);
        continue;
      }
      if (!this.isVisibleTarget(mining.x, mining.z)) continue;
      const key = targetKey(mining);
      const previous = targets.get(key);
      if (!previous || mining.progress > previous.progress) targets.set(key, mining);
    }
    this.local.group.visible = true;
    const local = this.local.snapshot();
    for (const [key, mining] of targets) {
      // A single mesh per voxel, including when the local player mines it too.
      if (local.visible && key === targetKey(local)) {
        const stage = Math.min(9, Math.floor(mining.progress * 10));
        if (local.stage !== null && local.stage >= stage) {
          targets.delete(key);
          continue;
        }
        this.local.group.visible = false;
      }
      let overlay = this.overlays.get(key);
      if (!overlay) {
        overlay = new BlockBreakingOverlay(this.world, this.resolveState);
        this.overlays.set(key, overlay);
        this.group.add(overlay.group);
      }
      overlay.setProgress({
        x: mining.x, y: mining.y, z: mining.z, block: mining.blockId,
        normal: new Vec3(0, 1, 0), point: new Vec3(mining.x, mining.y, mining.z), distance: 0,
      }, Math.max(Number.EPSILON, mining.progress));
    }
    for (const [key, overlay] of this.overlays) {
      if (targets.has(key)) continue;
      overlay.group.removeFromParent();
      overlay.dispose();
      this.overlays.delete(key);
    }
  }

  snapshots() {
    this.update();
    return [...this.overlays.values()].map((overlay) => overlay.snapshot());
  }

  dispose(): void {
    this.breakers.clear();
    for (const overlay of this.overlays.values()) {
      overlay.group.removeFromParent();
      overlay.dispose();
    }
    this.overlays.clear();
    this.local.group.visible = true;
    this.group.removeFromParent();
  }
}
