import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { ItemId } from '../src/items';
import { PlayerController } from '../src/player';
import type { VoxelWorld } from '../src/world/World';
import { blockCollisionBoxes } from '../src/world/collision';
import {
  heldPointerEffect,
  centerCrosshairRelease,
  mobileAutoJumpArmed,
  resolveMobileTouchIntent,
  shouldFollowHoldAim,
  shouldRotateCameraDuringHold,
  type MobileTouchFacts,
} from '../src/input/mobileTouch';
import {
  JUMP_DOUBLE_TAP_MS,
  JUMP_LOCK_IDLE,
  JUMP_TAP_MAX_MS,
  MOBILE_LOOK_MULTIPLIER,
  TOUCH_LOOK_BASELINE,
  TOUCH_LOOK_SCALE,
  jumpInputActive,
  jumpLockAfterRelease,
  type JumpLockState,
} from '../src/input/touchGesture';
import { captureBowRelease, resolveBowReleaseCommandSeq } from '../src/net/actionIntent';
import {
  CLOUD_DRIFT_BASELINE_BLOCKS_PER_SECOND,
  CLOUD_DRIFT_BLOCKS_PER_SECOND,
  CLOUD_DRIFT_SPEED_MULTIPLIER,
  CLOUD_WORLD_PER_TEXEL,
  CloudLayer,
  cloudWorldSample,
} from '../src/rendering/CloudLayer';
import { CLOUD_MASK_SIZE } from '../src/rendering/cloudMask';
import {
  CELESTIAL_ALPHA_TEST,
  CELESTIAL_RENDER_ORDER,
  createMoonMesh,
  createSunMesh,
} from '../src/rendering/SkyDome';
import {
  MC_CREATIVE_HEIGHT,
  MC_CREATIVE_WIDTH,
  MC_SLOT_PITCH,
  containerUiScaleWithClose,
  cursorStackClientPosition,
} from '../src/ui/containerTheme';
import { bindBrowserZoomLock, shouldBlockGestureZoom, shouldBlockTouchZoom } from '../src/ui/browserZoom';
import * as THREE from 'three';

const style = readFileSync('src/style.css', 'utf8');
const html = readFileSync('index.html', 'utf8');
const inputSource = readFileSync('src/input/InputManager.ts', 'utf8');
const gameSource = readFileSync('src/core/Game.ts', 'utf8');
const gameUi = readFileSync('src/ui/GameUI.ts', 'utf8');

function facts(partial: Partial<MobileTouchFacts> & Pick<MobileTouchFacts, 'phase'>): MobileTouchFacts {
  return {
    attackEntity: false,
    useEntity: false,
    interactiveBlock: false,
    hasBlockTarget: false,
    breakableBlock: false,
    tapUseItem: false,
    priorityHeldUse: false,
    continuousUse: false,
    ...partial,
  };
}

class TestWorld {
  readonly blocks = new Map<string, BlockId>();
  readonly states = new Map<string, { slabType?: 'bottom' | 'top' | 'double' }>();

  set(x: number, y: number, z: number, block: BlockId): void {
    this.blocks.set(`${x},${y},${z}`, block);
  }

  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0) return BlockId.Bedrock;
    return this.blocks.get(`${x},${y},${z}`) ?? BlockId.Air;
  }

  getBlockState(x: number, y: number, z: number) {
    return this.states.get(`${x},${y},${z}`);
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.getBlock(x, y, z) !== BlockId.Air && this.getBlock(x, y, z) !== BlockId.Bedrock
      ? true
      : y < 0;
  }
}

function floor(world: TestWorld, x0 = -2, x1 = 4): void {
  for (let z = -2; z <= 2; z += 1) {
    for (let x = x0; x <= x1; x += 1) world.set(x, 0, z, BlockId.Stone);
  }
}

/** Same order as Game.tick: sample jump, clear the arm, move, then arm the next sample. */
function runMobileSteps(options: {
  readonly world: TestWorld;
  readonly touchLayout: boolean;
  readonly sneak?: boolean;
  readonly creativeFlight?: boolean;
  readonly flying?: boolean;
  readonly ticks: number;
}): { jumped: number; jumpSamples: number; maxY: number; flying: boolean } {
  const player = new PlayerController({ position: [0.5, 1, 0.5] });
  player.creativeFlightAllowed = options.creativeFlight === true;
  player.isFlying = options.flying === true;
  let armed = false;
  let jumped = 0;
  let jumpSamples = 0;
  let maxY = player.position.y;
  for (let tick = 0; tick < options.ticks; tick += 1) {
    const jump = jumpInputActive({
      space: false,
      pressed: false,
      locked: false,
      autoJump: armed,
    });
    armed = false;
    if (jump) jumpSamples += 1;
    const result = player.tick(options.world as unknown as VoxelWorld, {
      yaw: -Math.PI / 2,
      pitch: 0,
      movement: () => ({
        forward: 1,
        right: 0,
        jump,
        manualJump: false,
        sprint: false,
        sneak: options.sneak === true,
      }),
    }, 0.05);
    if (result.jumped) jumped += 1;
    maxY = Math.max(maxY, player.position.y);
    armed = mobileAutoJumpArmed({
      touchLayout: options.touchLayout,
      onGround: player.onGround,
      sneaking: player.sneaking,
      flying: player.isFlying,
      inWater: player.inWater,
      inLava: player.inLava,
      onLadder: player.onLadder,
      yaw: player.yaw,
      forward: 1,
      right: 0,
      feetX: player.position.x,
      feetY: player.position.y,
      feetZ: player.position.z,
      boxesAt: (x, y, z) => blockCollisionBoxes(options.world as unknown as VoxelWorld, x, y, z),
    });
  }
  return { jumped, jumpSamples, maxY, flying: player.isFlying };
}

describe('cloud drift is four times the previous contract', () => {
  it('moves the world-locked mask on X only, at 0.16 × 4', () => {
    expect(CLOUD_DRIFT_BASELINE_BLOCKS_PER_SECOND).toBeCloseTo(0.16, 8);
    expect(CLOUD_DRIFT_SPEED_MULTIPLIER).toBe(4);
    expect(CLOUD_DRIFT_BLOCKS_PER_SECOND / CLOUD_DRIFT_BASELINE_BLOCKS_PER_SECOND).toBe(4);
    const span = CLOUD_MASK_SIZE * CLOUD_WORLD_PER_TEXEL;
    expect(CLOUD_MASK_SIZE).toBe(512);
    const still = cloudWorldSample(40, -15, 0, 0, 0, span);
    const translated = cloudWorldSample(40, -15, 80, -50, 0, span);
    expect(translated.u).toBeCloseTo(still.u, 6);
    expect(translated.v).toBeCloseTo(still.v, 6);
    const later = cloudWorldSample(40, -15, 80, -50, 2.5, span);
    const baselineShift = (2.5 * CLOUD_DRIFT_BASELINE_BLOCKS_PER_SECOND) / span;
    expect(later.u - still.u).toBeCloseTo(baselineShift * 4, 6);
    expect(later.v).toBeCloseTo(still.v, 6);
  });
});

describe('celestial alpha cutout', () => {
  it('keeps sun and moon out of the transparent pass and behind clouds', () => {
    const sun = createSunMesh().material as THREE.MeshBasicMaterial;
    const moon = createMoonMesh().material as THREE.MeshBasicMaterial;
    for (const material of [sun, moon]) {
      expect(material.transparent).toBe(false);
      expect(material.alphaTest).toBe(CELESTIAL_ALPHA_TEST);
      expect(material.depthWrite).toBe(false);
      expect(material.depthTest).toBe(true);
      expect(material.blending).toBe(THREE.NormalBlending);
    }
    const sunTex = sun.map!.image.data as Uint8Array;
    expect(sunTex[3]).toBe(0);
    expect(sunTex[(8 * 16 + 8) * 4 + 3]).toBe(255);
    const clouds = new CloudLayer();
    expect(clouds.object.renderOrder).toBeGreaterThan(CELESTIAL_RENDER_ORDER);
    expect((clouds.object.material as THREE.ShaderMaterial).transparent).toBe(true);
    expect(createSunMesh().renderOrder).toBe(CELESTIAL_RENDER_ORDER);
  });
});

describe('mobile bow releases through the center crosshair', () => {
  it('rotates while drawing and fires the live camera, not the finger ray', () => {
    expect(resolveMobileTouchIntent(facts({
      phase: 'hold',
      bow: true,
      priorityHeldUse: true,
      breakableBlock: true,
      attackEntity: true,
    }))).toBe('bow-hold');
    expect(shouldRotateCameraDuringHold('bow-hold')).toBe(true);
    expect(shouldFollowHoldAim('bow-hold')).toBe(false);
    const stale = { yaw: 1.4, pitch: -0.6 };
    const camera = { yaw: 0.25, pitch: -0.12 };
    const still = heldPointerEffect({
      intent: 'bow-hold',
      lastX: 80,
      lastY: 140,
      x: 80,
      y: 140,
      fingerAim: stale,
      interactionAim: stale,
    });
    expect(still.lookDx).toBe(0);
    expect(still.lookDy).toBe(0);
    expect(still.interactionAim).toBeNull();
    expect(centerCrosshairRelease(still.interactionAim, camera)).toEqual(camera);

    const dragged = heldPointerEffect({
      intent: 'bow-hold',
      lastX: 80,
      lastY: 140,
      x: 120,
      y: 100,
      fingerAim: stale,
      interactionAim: null,
    });
    expect(dragged.interactionAim).toBeNull();
    const sensitivity = 0.0022;
    const yaw = camera.yaw - dragged.lookDx * TOUCH_LOOK_SCALE * sensitivity;
    const pitch = camera.pitch - dragged.lookDy * TOUCH_LOOK_SCALE * sensitivity;
    expect(yaw - camera.yaw).toBeCloseTo(-40 * TOUCH_LOOK_BASELINE * 2 * sensitivity, 8);
    expect(pitch - camera.pitch).toBeCloseTo(40 * TOUCH_LOOK_BASELINE * 2 * sensitivity, 8);
    expect(Math.abs(yaw - camera.yaw)).not.toBeCloseTo(40 * TOUCH_LOOK_SCALE * 2 * sensitivity, 5);

    const boundary = resolveBowReleaseCommandSeq({
      currentInputSeq: 4,
      lastSentInputSeq: 4,
      lastSentUse: true,
    });
    const source = { actionSeq: 2, inputSeq: 4, selectedSlot: 0 };
    const action = captureBowRelease(source, centerCrosshairRelease(dragged.interactionAim, { yaw, pitch }), 18, boundary.commandSeq);
    expect(boundary).toEqual({ commandSeq: 5, mode: 'next-after-use-true' });
    expect(action.yaw).toBeCloseTo(yaw, 8);
    expect(action.pitch).toBeCloseTo(pitch, 8);
    expect(action.commandSeq).toBe(5);
    expect(action.actionSeq).toBe(3);
    expect(action.kind).toBe('bow_release');
    const next = centerCrosshairRelease(null, { yaw: -0.2, pitch: 0.05 });
    expect(next).toEqual({ yaw: -0.2, pitch: 0.05 });
    expect(next).not.toEqual(stale);
  });

  it('keeps mining and food on the finger without turning the camera', () => {
    expect(resolveMobileTouchIntent(facts({
      phase: 'hold',
      breakableBlock: true,
      hasBlockTarget: true,
    }))).toBe('mine');
    expect(resolveMobileTouchIntent(facts({
      phase: 'hold',
      priorityHeldUse: true,
      bow: false,
      breakableBlock: true,
    }))).toBe('use-hold');
    const finger = { yaw: 0.7, pitch: 0.2 };
    for (const intent of ['mine', 'use-hold'] as const) {
      const effect = heldPointerEffect({
        intent,
        lastX: 10,
        lastY: 10,
        x: 90,
        y: 40,
        fingerAim: finger,
        interactionAim: null,
      });
      expect(effect.lookDx).toBe(0);
      expect(effect.lookDy).toBe(0);
      expect(effect.interactionAim).toEqual(finger);
      expect(centerCrosshairRelease(effect.interactionAim, { yaw: 0, pitch: 0 })).toEqual(finger);
    }
    expect(ItemId.Bow).toBe('bow');
  });
});

describe('mobile auto-jump reaches the player tick', () => {
  it('jumps a grounded survival and creative player, and stays quiet otherwise', () => {
    const wall = new TestWorld();
    floor(wall);
    wall.set(1, 1, 0, BlockId.Stone);
    const survival = runMobileSteps({ world: wall, touchLayout: true, ticks: 24 });
    expect(survival.jumpSamples).toBeGreaterThan(0);
    expect(survival.jumped).toBeGreaterThan(0);
    expect(survival.maxY).toBeGreaterThan(1.4);

    const creative = runMobileSteps({
      world: wall,
      touchLayout: true,
      creativeFlight: true,
      ticks: 40,
    });
    expect(creative.jumpSamples).toBeGreaterThan(0);
    expect(creative.jumped).toBeGreaterThan(0);
    expect(creative.flying).toBe(false);

    const flying = runMobileSteps({
      world: wall,
      touchLayout: true,
      creativeFlight: true,
      flying: true,
      ticks: 20,
    });
    expect(flying.jumpSamples).toBe(0);
    expect(flying.jumped).toBe(0);
    expect(flying.flying).toBe(true);

    const sneaking = runMobileSteps({ world: wall, touchLayout: true, sneak: true, ticks: 20 });
    expect(sneaking.jumpSamples).toBe(0);
    expect(sneaking.jumped).toBe(0);

    const desktop = runMobileSteps({ world: wall, touchLayout: false, ticks: 20 });
    expect(desktop.jumpSamples).toBe(0);
    expect(desktop.jumped).toBe(0);
    expect(desktop.maxY).toBeLessThan(1.2);

    const slab = new TestWorld();
    floor(slab);
    slab.set(1, 1, 0, BlockId.StoneSlab);
    slab.states.set('1,1,0', { slabType: 'bottom' });
    const stepped = runMobileSteps({ world: slab, touchLayout: true, ticks: 30 });
    expect(stepped.jumped).toBe(0);
    expect(stepped.jumpSamples).toBe(0);
    expect(stepped.maxY).toBeGreaterThan(1.4);
    expect(stepped.maxY).toBeLessThan(2);
  });
});

describe('jump lock', () => {
  it('latches on a second tap, ignores cancel and a long hold, and clears with held actions', () => {
    const tap = (state: JumpLockState, down: number, up: number, cancelled = false) => (
      jumpLockAfterRelease(state, down, up, cancelled)
    );
    const first = tap(JUMP_LOCK_IDLE, 1_000, 1_080);
    expect(first.locked).toBe(false);
    expect(jumpInputActive({ space: false, pressed: true, locked: false, autoJump: false })).toBe(true);
    expect(jumpInputActive({ space: false, pressed: false, locked: first.locked, autoJump: false })).toBe(false);
    const locked = tap(first, 1_200, 1_260);
    expect(1_260 - first.lastTapAt).toBeLessThanOrEqual(JUMP_DOUBLE_TAP_MS);
    expect(locked).toEqual({ locked: true, lastTapAt: 0 });
    const afterRelease = tap(locked, 2_000, 2_100);
    expect(afterRelease.locked).toBe(true);
    expect(jumpInputActive({ space: false, pressed: false, locked: afterRelease.locked, autoJump: false })).toBe(true);
    const second = tap(afterRelease, 2_200, 2_280);
    const unlocked = tap(second, 2_400, 2_460);
    expect(unlocked.locked).toBe(false);

    const held = tap(JUMP_LOCK_IDLE, 0, JUMP_TAP_MAX_MS + 40);
    expect(held).toEqual({ locked: false, lastTapAt: 0 });
    const cancelled = tap({ locked: true, lastTapAt: 50 }, 100, 140, true);
    expect(cancelled).toEqual({ locked: true, lastTapAt: 50 });

    expect(jumpInputActive({ space: true, pressed: false, locked: false, autoJump: false })).toBe(true);
    expect(jumpInputActive({ space: false, pressed: false, locked: false, autoJump: true })).toBe(true);
    const release = inputSource.slice(inputSource.indexOf('releaseActions()'), inputSource.indexOf('clearHeldKeys()'));
    expect(release).toContain('this.jumpLock = JUMP_LOCK_IDLE');
    expect(release).toContain('this.syncJumpButton()');
    expect(inputSource).toContain("button.classList.toggle('is-active', this.jumpLock.locked)");
    expect(inputSource).toContain("button.setAttribute('aria-pressed', this.jumpLock.locked ? 'true' : 'false')");
    expect(gameSource).toContain('this.input.releaseActions()');
    expect(style).toContain('button[data-action="jump"].is-active');
    expect(style).toContain('button[data-action="sneak"].is-active');
  });
});

describe('mobile look is twice the old touch baseline', () => {
  it('scales touch and bow drag once, and leaves the mouse path and the slider alone', () => {
    expect(MOBILE_LOOK_MULTIPLIER).toBe(2);
    expect(TOUCH_LOOK_BASELINE).toBeCloseTo(1.35, 8);
    expect(TOUCH_LOOK_SCALE).toBeCloseTo(TOUCH_LOOK_BASELINE * 2, 8);
    const mouse = inputSource.slice(
      inputSource.indexOf("document.addEventListener('mousemove'"),
      inputSource.indexOf("this.canvas.addEventListener('mousedown'"),
    );
    expect(mouse).toContain('this.rotate(dx, dy)');
    expect(mouse).not.toContain('TOUCH_LOOK_SCALE');
    expect(inputSource).toContain('clamp(value, 0.0005, 0.006)');
    expect(gameUi).toContain("'sensitivity', 0.0007, 0.005, 0.0001");
    const bow = inputSource.slice(inputSource.indexOf('private applyHeldPointer'), inputSource.indexOf('private followHoldAim'));
    expect(bow).toContain('this.rotate(effect.lookDx * TOUCH_LOOK_SCALE, effect.lookDy * TOUCH_LOOK_SCALE)');
    expect(bow.match(/this\.rotate\(effect\.lookDx \* TOUCH_LOOK_SCALE/g)?.length).toBe(1);
  });
});

describe('inventory scale and cursor position', () => {
  it('uses one viewport scale and keeps creative slots readable', () => {
    expect(style).not.toContain('.mc-stage { zoom:');
    for (const [width, height] of [[844, 390], [800, 360], [960, 500]] as const) {
      const scale = containerUiScaleWithClose(width, height, MC_CREATIVE_WIDTH, MC_CREATIVE_HEIGHT);
      const slot = MC_SLOT_PITCH * scale;
      const panel = MC_CREATIVE_WIDTH * scale;
      expect(slot).toBeGreaterThanOrEqual(32);
      expect(panel).toBeLessThan(width - 24);
    }
    expect(gameUi).toContain('viewportMetrics()');
    expect(gameUi).not.toContain('containerUiScaleWithClose(window.innerWidth');
    expect(gameUi).not.toContain('menuUiScale(window.innerWidth');
  });

  it('places a touch cursor off the finger immediately and keeps the mouse on the pointer', () => {
    expect(cursorStackClientPosition(180, 220, 'touch')).toEqual({ left: 198, top: 184 });
    expect(cursorStackClientPosition(180, 220, 'pen')).toEqual({ left: 198, top: 184 });
    expect(cursorStackClientPosition(180, 220, 'mouse')).toEqual({ left: 180, top: 220 });
    expect(style).toContain('left: -9999px');
    expect(gameUi).toContain('this.rememberCursorPointer(event)');
    const down = gameUi.slice(gameUi.indexOf("addEventListener('pointerdown'"), gameUi.indexOf("addEventListener('contextmenu'"));
    expect(down.indexOf('this.rememberCursorPointer(event)')).toBeLessThan(down.indexOf('this.handleInventorySlot'));
    expect(gameUi).toContain('this.syncCursorStackElement()');
  });
});

describe('browser zoom lock', () => {
  it('blocks pinch and gesture zoom without swallowing a one-finger tap', () => {
    expect(html).toContain('width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
    expect(shouldBlockTouchZoom(1)).toBe(false);
    expect(shouldBlockTouchZoom(2)).toBe(true);
    expect(shouldBlockGestureZoom('gesturestart')).toBe(true);
    expect(shouldBlockGestureZoom('gesturechange')).toBe(true);
    expect(shouldBlockGestureZoom('pointerup')).toBe(false);
    const listeners = new Map<string, (event: Event) => void>();
    const target = {
      addEventListener: (type: string, fn: (event: Event) => void) => { listeners.set(type, fn); },
      removeEventListener: () => undefined,
    };
    bindBrowserZoomLock(target as unknown as Document);
    const one = { touches: [{}], preventDefault: () => { throw new Error('one finger was swallowed'); } };
    listeners.get('touchmove')?.(one as unknown as Event);
    let pinched = 0;
    listeners.get('touchmove')?.({ touches: [{}, {}], preventDefault: () => { pinched += 1; } } as unknown as Event);
    expect(pinched).toBe(1);
    let gestured = 0;
    listeners.get('gesturestart')?.({ type: 'gesturestart', preventDefault: () => { gestured += 1; } } as unknown as Event);
    expect(gestured).toBe(1);
    expect(style).toContain('touch-action: none');
    expect(style).toContain('touch-action: pan-y');
  });
});
