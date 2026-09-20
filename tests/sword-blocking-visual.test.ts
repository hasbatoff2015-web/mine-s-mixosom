import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CombatSystem } from '../src/combat/CombatSystem';
import { FIRST_PERSON_SPRITE_POSE, ITEMS, isSwordItem } from '../src/items';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/player/appearance/PlayerAppearance';
import { FirstPersonRenderer, type FirstPersonFrameState } from '../src/rendering/FirstPersonRenderer';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { MinecraftSkinRegistry } from '../src/rendering/player/MinecraftSkin';
import { PlayerSkinGeometryCache } from '../src/rendering/player/PlayerSkinGeometry';
import { PlayerVisual, type PlayerVisualFrameState } from '../src/rendering/player/PlayerVisual';
import { PlayerVisualAnimator } from '../src/rendering/player/PlayerVisualAnimator';
import {
  FIRST_PERSON_SWORD_BLOCKING_OFFSET,
  SWORD_BLOCKING_TRANSITION_SECONDS,
  THIRD_PERSON_SWORD_BLOCKING_OFFSET,
  advanceSwordBlockingProgress,
} from '../src/rendering/player/swordBlockingVisual';
import {
  THIRD_PERSON_HELD_ITEM_DEFAULTS,
  cloneThirdPersonHeldItemTransform,
  defaultThirdPersonHeldItemTransformForItem,
  thirdPersonHeldTransformsClose,
} from '../src/rendering/player/thirdPersonHeldItem';
import { IDLE_PLAYER_PRESENTATION } from '../shared/playerPresentation';
import { RemotePlayerView } from '../src/net/RemotePlayerView';
import type { VoxelWorld } from '../src/world/World';
import { BlockId } from '../src/blocks';

const SWORD_IDS = ITEMS.filter((item) => isSwordItem(item)).map((item) => item.id);

const idleAnimator = {
  viewYaw: 0,
  viewPitch: 0,
  movementSpeed: 0,
  onGround: true,
  sneaking: false,
  sprinting: false,
  verticalVelocity: 0,
  mining: false,
  bowCharge: 0,
  swordBlocking: false,
  foodUseProgress: 0,
};

const fpIdle: FirstPersonFrameState = {
  visible: true, movementSpeed: 0, onGround: true, sprinting: false,
  mining: false, foodUseProgress: 0, bowCharge: 0,
};

const visualIdle: PlayerVisualFrameState = {
  ...idleAnimator,
  invisible: false,
  hurtFlash: 0,
};

function createVisual() {
  const skins = new MinecraftSkinRegistry();
  const geometries = new PlayerSkinGeometryCache();
  const items = new ItemVisualFactory();
  const visual = new PlayerVisual(skins, geometries, items, DEFAULT_PLAYER_APPEARANCE);
  return {
    visual,
    dispose() {
      visual.dispose();
      geometries.dispose();
      items.dispose();
      skins.dispose();
    },
  };
}

describe('sword item classification', () => {
  it('treats every registered sword as a sword and rejects tools and other items', () => {
    expect(SWORD_IDS).toEqual([
      'wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword', 'ruby_sword', 'titanium_sword',
    ]);
    for (const id of SWORD_IDS) expect(isSwordItem(id)).toBe(true);
    for (const id of ['iron_axe', 'iron_pickaxe', 'iron_shovel', 'golden_hoe', 'bow', 'apple', 'stone']) {
      expect(isSwordItem(id)).toBe(false);
    }
    expect(isSwordItem(undefined)).toBe(false);
    expect(isSwordItem(null)).toBe(false);
  });
});

describe('combat sword blocking state', () => {
  it('turns on only while using a sword, and clears on release, non-sword, or item switch', () => {
    const combat = new CombatSystem({ heldItemId: 'diamond_sword' });
    combat.updateUse(true, true, true);
    expect(combat.swordBlocking).toBe(true);
    combat.updateUse(false, true, true);
    expect(combat.swordBlocking).toBe(false);
    combat.updateUse(true, true, true);
    combat.setHeldItem('iron_pickaxe');
    expect(combat.swordBlocking).toBe(false);
    combat.updateUse(true, true, true);
    expect(combat.swordBlocking).toBe(false);
    combat.setHeldItem('wooden_sword');
    combat.updateUse(true, true, true);
    expect(combat.swordBlocking).toBe(true);
    combat.setHeldItem('stone_sword');
    expect(combat.swordBlocking).toBe(false);
    combat.updateUse(true, true, true);
    expect(combat.swordBlocking).toBe(true);
  });
});

describe('blocking progress interpolation', () => {
  it('moves 0→1 and 1→0 over the transition window without snapping on a short tap', () => {
    expect(advanceSwordBlockingProgress(0, true, 0.01)).toBeCloseTo(0.1);
    expect(advanceSwordBlockingProgress(0, true, SWORD_BLOCKING_TRANSITION_SECONDS)).toBe(1);
    expect(advanceSwordBlockingProgress(1, false, 0.01)).toBeCloseTo(0.9);
    expect(advanceSwordBlockingProgress(1, false, SWORD_BLOCKING_TRANSITION_SECONDS)).toBe(0);
    expect(advanceSwordBlockingProgress(0.4, true, 0.01)).toBeCloseTo(0.5);
  });
});

describe('first-person sword blocking overlay', () => {
  it('lerps the held sword on top of the idle calibration and restores it', () => {
    const visuals = new ItemVisualFactory();
    const fp = new FirstPersonRenderer(visuals, { freezeIdleMotion: true });
    fp.setHeldItems('diamond_sword');
    fp.update(0.05, fpIdle);
    const idle = fp.captureHeldItemMatrixDebug()!.itemLocal.clone();
    const idlePos = new THREE.Vector3().setFromMatrixPosition(idle);

    fp.update(0.01, { ...fpIdle, swordBlocking: true });
    expect(fp.swordBlockingProgress).toBeCloseTo(0.1);
    const mid = fp.captureHeldItemMatrixDebug()!.itemLocal;
    expect(mid.equals(idle)).toBe(false);
    expect(fp.swordBlockingProgress).toBeGreaterThan(0);
    expect(fp.swordBlockingProgress).toBeLessThan(1);

    fp.update(SWORD_BLOCKING_TRANSITION_SECONDS, { ...fpIdle, swordBlocking: true });
    expect(fp.swordBlockingProgress).toBe(1);
    const blockedPos = new THREE.Vector3().setFromMatrixPosition(fp.captureHeldItemMatrixDebug()!.itemLocal);
    expect(blockedPos.x).toBeCloseTo(idlePos.x + FIRST_PERSON_SWORD_BLOCKING_OFFSET.position.x);
    expect(blockedPos.y).toBeCloseTo(idlePos.y + FIRST_PERSON_SWORD_BLOCKING_OFFSET.position.y);
    expect(blockedPos.z).toBeCloseTo(idlePos.z + FIRST_PERSON_SWORD_BLOCKING_OFFSET.position.z);
    expect(fp.captureHeldItemMatrixDebug()!.itemLocal.equals(idle)).toBe(false);

    fp.update(SWORD_BLOCKING_TRANSITION_SECONDS, fpIdle);
    expect(fp.swordBlockingProgress).toBe(0);
    expect(fp.captureHeldItemMatrixDebug()!.itemLocal.equals(idle)).toBe(true);

    fp.update(SWORD_BLOCKING_TRANSITION_SECONDS, { ...fpIdle, swordBlocking: true });
    fp.setHeldItems('iron_pickaxe');
    fp.update(0.05, { ...fpIdle, swordBlocking: true });
    expect(fp.swordBlockingProgress).toBe(0);

    fp.dispose();
    visuals.dispose();
  });

  it('does not apply a sword-block overlay to a pickaxe while use is held', () => {
    const visuals = new ItemVisualFactory();
    const fp = new FirstPersonRenderer(visuals, { freezeIdleMotion: true });
    fp.setHeldItems('iron_pickaxe');
    fp.update(0.05, fpIdle);
    const idle = fp.captureHeldItemMatrixDebug()!.itemLocal.clone();
    fp.update(SWORD_BLOCKING_TRANSITION_SECONDS, { ...fpIdle, swordBlocking: true });
    expect(fp.swordBlockingProgress).toBe(0);
    expect(fp.captureHeldItemMatrixDebug()!.itemLocal.equals(idle)).toBe(true);
    fp.dispose();
    visuals.dispose();
  });
});

describe('third-person sword blocking overlay', () => {
  it('raises the held sword on top of production calibration and restores it', () => {
    const { visual, dispose } = createVisual();
    visual.setHeldItem('diamond_sword');
    const base = defaultThirdPersonHeldItemTransformForItem('diamond_sword');
    expect(thirdPersonHeldTransformsClose(visual.readHeldItemTransform()!, base)).toBe(true);
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.sword).toEqual({
      position: { x: 0, y: 0.225, z: -0.245 },
      rotation: { x: -0.1232, y: 1.4668, z: -0.1232 },
      scale: { x: 0.55, y: 0.55, z: 0.55 },
    });
    expect(FIRST_PERSON_SPRITE_POSE).toEqual({
      position: [0.67, -0.29, -0.70], rotationDeg: [1, -90, 34], scale: 0.60,
    });

    visual.update(0.05, visualIdle);
    expect(thirdPersonHeldTransformsClose(visual.readHeldItemTransform()!, base)).toBe(true);

    visual.update(0.01, { ...visualIdle, swordBlocking: true });
    expect(visual.heldItemBlockingProgress).toBeCloseTo(0.1);
    const mid = visual.readHeldItemTransform()!;
    expect(thirdPersonHeldTransformsClose(mid, base)).toBe(false);
    expect(mid.position.y).toBeGreaterThan(base.position.y);

    visual.update(SWORD_BLOCKING_TRANSITION_SECONDS, { ...visualIdle, swordBlocking: true });
    expect(visual.heldItemBlockingProgress).toBe(1);
    const blocked = visual.readHeldItemTransform()!;
    expect(blocked.position.x).toBeCloseTo(base.position.x + THIRD_PERSON_SWORD_BLOCKING_OFFSET.position.x);
    expect(blocked.position.y).toBeCloseTo(base.position.y + THIRD_PERSON_SWORD_BLOCKING_OFFSET.position.y);
    expect(blocked.position.z).toBeCloseTo(base.position.z + THIRD_PERSON_SWORD_BLOCKING_OFFSET.position.z);
    expect(blocked.scale).toEqual(base.scale);

    visual.update(SWORD_BLOCKING_TRANSITION_SECONDS, visualIdle);
    expect(visual.heldItemBlockingProgress).toBe(0);
    expect(thirdPersonHeldTransformsClose(visual.readHeldItemTransform()!, base)).toBe(true);
    dispose();
  });

  it('keeps a live /moveitems calibration as the idle base after blocking', () => {
    const { visual, dispose } = createVisual();
    visual.setHeldItem('iron_sword');
    const live = cloneThirdPersonHeldItemTransform(visual.readHeldItemTransform()!);
    live.position.x = 0.12;
    live.position.y = 0.30;
    live.rotation.z = -0.4;
    visual.applyHeldItemCalibration(live);
    visual.update(SWORD_BLOCKING_TRANSITION_SECONDS, { ...visualIdle, swordBlocking: true });
    expect(visual.readHeldItemTransform()!.position.x).not.toBeCloseTo(0.12);
    visual.update(SWORD_BLOCKING_TRANSITION_SECONDS, visualIdle);
    expect(visual.readHeldItemTransform()!.position.x).toBeCloseTo(0.12);
    expect(visual.readHeldItemTransform()!.position.y).toBeCloseTo(0.30);
    expect(visual.readHeldItemTransform()!.rotation.z).toBeCloseTo(-0.4);
    expect(THIRD_PERSON_HELD_ITEM_DEFAULTS.sword.position.y).toBe(0.225);
    dispose();
  });

  it('does not block a non-sword and snaps back when swapping off a sword', () => {
    const { visual, dispose } = createVisual();
    visual.setHeldItem('iron_pickaxe');
    const pickaxe = defaultThirdPersonHeldItemTransformForItem('iron_pickaxe');
    visual.update(SWORD_BLOCKING_TRANSITION_SECONDS, { ...visualIdle, swordBlocking: true });
    expect(visual.heldItemBlockingProgress).toBe(0);
    expect(thirdPersonHeldTransformsClose(visual.readHeldItemTransform()!, pickaxe)).toBe(true);

    visual.setHeldItem('diamond_sword');
    visual.update(SWORD_BLOCKING_TRANSITION_SECONDS, { ...visualIdle, swordBlocking: true });
    expect(visual.heldItemBlockingProgress).toBe(1);
    visual.setHeldItem('iron_axe');
    expect(visual.heldItemBlockingProgress).toBe(0);
    expect(thirdPersonHeldTransformsClose(
      visual.readHeldItemTransform()!,
      defaultThirdPersonHeldItemTransformForItem('iron_axe'),
    )).toBe(true);
    visual.update(0.05, { ...visualIdle, swordBlocking: true });
    expect(visual.heldItemBlockingProgress).toBe(0);
    dispose();
  });

  it('snaps the sword back to idle when the player dies', () => {
    const { visual, dispose } = createVisual();
    visual.setHeldItem('diamond_sword');
    visual.update(SWORD_BLOCKING_TRANSITION_SECONDS, { ...visualIdle, swordBlocking: true });
    expect(visual.heldItemBlockingProgress).toBe(1);
    visual.update(1 / 60, { ...visualIdle, swordBlocking: true, deathProgress: 0.4 });
    expect(visual.heldItemBlockingProgress).toBe(0);
    expect(thirdPersonHeldTransformsClose(
      visual.readHeldItemTransform()!,
      defaultThirdPersonHeldItemTransformForItem('diamond_sword'),
    )).toBe(true);
    dispose();
  });
});

describe('remote players receive authoritative sword blocking', () => {
  it('forwards snapshot swordBlocking into PlayerVisual and animates the held sword', () => {
    const { visual, dispose } = createVisual();
    vi.spyOn(visual, 'applyWorldLight').mockImplementation(() => {});
    const world = { getBlock: () => BlockId.Air };
    const view = new RemotePlayerView(
      {
        id: 'actor',
        name: 'Actor',
        x: 0,
        y: 70,
        z: 0,
        yaw: 0,
        pitch: 0,
        presentation: { ...IDLE_PLAYER_PRESENTATION, heldItemId: 'iron_sword' },
      },
      { visual, world: world as unknown as VoxelWorld },
      100,
    );
    expect(visual.heldItem).toBe('iron_sword');
    view.applySnapshot({
      id: 'actor',
      name: 'Actor',
      x: 0,
      y: 70,
      z: 0,
      yaw: 0,
      pitch: 0,
      presentation: { ...IDLE_PLAYER_PRESENTATION, heldItemId: 'iron_sword', swordBlocking: true },
    }, 150, 1);
    view.interpolate(150, SWORD_BLOCKING_TRANSITION_SECONDS);
    expect(visual.heldItemBlockingProgress).toBe(1);
    expect(thirdPersonHeldTransformsClose(
      visual.readHeldItemTransform()!,
      defaultThirdPersonHeldItemTransformForItem('iron_sword'),
    )).toBe(false);

    view.applySnapshot({
      id: 'actor',
      name: 'Actor',
      x: 0,
      y: 70,
      z: 0,
      yaw: 0,
      pitch: 0,
      presentation: { ...IDLE_PLAYER_PRESENTATION, heldItemId: 'iron_sword', swordBlocking: false },
    }, 200, 2);
    view.interpolate(200, SWORD_BLOCKING_TRANSITION_SECONDS);
    expect(visual.heldItemBlockingProgress).toBe(0);
    expect(thirdPersonHeldTransformsClose(
      visual.readHeldItemTransform()!,
      defaultThirdPersonHeldItemTransformForItem('iron_sword'),
    )).toBe(true);
    view.dispose();
    dispose();
  });
});

describe('third-person arm blocking interpolation', () => {
  it('blends the right arm toward the blocking pose instead of teleporting', () => {
    const animator = new PlayerVisualAnimator();
    const idle = animator.advance(0, idleAnimator);
    const mid = animator.advance(0.05, { ...idleAnimator, swordBlocking: true });
    expect(mid.blockingProgress).toBeCloseTo(0.5);
    expect(mid.rightArmY).toBeCloseTo((idle.rightArmY + -0.62) / 2);
    const full = animator.advance(0.1, { ...idleAnimator, swordBlocking: true });
    expect(full.blockingProgress).toBe(1);
    expect(full.rightArmX).toBeCloseTo(0.86);
    expect(full.rightArmY).toBeCloseTo(-0.62);
    expect(full.rightArmZ).toBeCloseTo(0.42);
    const released = animator.advance(0.1, idleAnimator);
    expect(released.blockingProgress).toBe(0);
    expect(released.rightArmY).toBeCloseTo(idle.rightArmY);
  });
});
