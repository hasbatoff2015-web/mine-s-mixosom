import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ItemId } from '../src/items';
import {
  MOBILE_AUTO_JUMP_STEP,
  isContinuousUseItem,
  isFullHeightObstacle,
  isTapUseItem,
  readCloudSetting,
  resolveMobileTouchIntent,
  shouldArmMobileAutoJump,
  sprintFromStick,
  toggleCrouch,
} from '../src/input/mobileTouch';
import {
  TOUCH_HOLD_MS,
  TOUCH_SWIPE_THRESHOLD_PX,
  advanceTouchTrack,
  beginTouchTrack,
  finishTouchTrack,
  swipeLookDelta,
} from '../src/input/touchGesture';
import { lookFromDirection, viewDirectionFromLook } from '../src/player/localAim';
import { skySample } from '../src/rendering/skyPalette';
import { floorCoord, formatPlayInfo } from '../src/ui/playInfoHud';

const style = readFileSync('src/style.css', 'utf8');
const inputSource = readFileSync('src/input/InputManager.ts', 'utf8');
const gameUi = readFileSync('src/ui/GameUI.ts', 'utf8');

const idleProbe = {
  touchLayout: true,
  onGround: true,
  sneaking: false,
  flying: false,
  creative: false,
  inWater: false,
  inLava: false,
  onLadder: false,
  moving: true,
  obstacle: true,
  landingClear: true,
};

describe('touch classification', () => {
  it('keeps a short still press as a tap and does not look', () => {
    const started = beginTouchTrack(40, 50, 1_000);
    const moved = advanceTouchTrack(started, 44, 53, 1_080);
    expect(moved.phase).toBe('pending');
    expect(swipeLookDelta(started, 44, 53)).toBeUndefined();
    expect(finishTouchTrack(moved, 1_080)).toBe('tap');
  });

  it('classifies a fast move as camera-only and never turns that finger into an attack', () => {
    const started = beginTouchTrack(10, 10, 0);
    const swiped = advanceTouchTrack(started, 10 + TOUCH_SWIPE_THRESHOLD_PX, 12, 40);
    expect(swiped.phase).toBe('swipe');
    expect(finishTouchTrack(swiped, 90)).toBe('swipe');
    const later = advanceTouchTrack(swiped, 80, 40, TOUCH_HOLD_MS + 20);
    expect(later.phase).toBe('swipe');
    expect(swipeLookDelta(swiped, 80, 40)).toEqual({ dx: 80 - swiped.lastX, dy: 40 - swiped.lastY });
  });

  it('classifies a still hold and then refuses camera deltas from that finger', () => {
    const started = beginTouchTrack(8, 8, 0);
    const held = advanceTouchTrack(started, 12, 9, TOUCH_HOLD_MS);
    expect(held.phase).toBe('hold');
    expect(swipeLookDelta(started, 12, 9)).toBeUndefined();
    const drifted = advanceTouchTrack(held, 40, 30, TOUCH_HOLD_MS + 80);
    expect(drifted.phase).toBe('hold');
    expect(swipeLookDelta(held, 40, 30)).toBeUndefined();
    expect(finishTouchTrack(drifted, TOUCH_HOLD_MS + 80)).toBe('hold-end');
  });

  it('maps tap and hold onto the same attack, use and mine intents', () => {
    expect(resolveMobileTouchIntent({
      phase: 'tap',
      attackEntity: true,
      useEntity: false,
      interactiveBlock: false,
      breakableBlock: true,
      tapUseItem: false,
      continuousUse: false,
    })).toBe('attack');
    expect(resolveMobileTouchIntent({
      phase: 'tap',
      attackEntity: false,
      useEntity: true,
      interactiveBlock: false,
      breakableBlock: true,
      tapUseItem: true,
      continuousUse: true,
    })).toBe('use');
    expect(resolveMobileTouchIntent({
      phase: 'tap',
      attackEntity: false,
      useEntity: false,
      interactiveBlock: true,
      breakableBlock: true,
      tapUseItem: false,
      continuousUse: false,
    })).toBe('use');
    expect(resolveMobileTouchIntent({
      phase: 'tap',
      attackEntity: false,
      useEntity: false,
      interactiveBlock: false,
      breakableBlock: true,
      tapUseItem: true,
      continuousUse: false,
    })).toBe('use');
    expect(resolveMobileTouchIntent({
      phase: 'tap',
      attackEntity: false,
      useEntity: false,
      interactiveBlock: false,
      breakableBlock: true,
      tapUseItem: false,
      continuousUse: true,
    })).toBe('attack');
    expect(resolveMobileTouchIntent({
      phase: 'hold',
      attackEntity: false,
      useEntity: false,
      interactiveBlock: false,
      breakableBlock: true,
      tapUseItem: true,
      continuousUse: true,
    })).toBe('mine');
    expect(resolveMobileTouchIntent({
      phase: 'hold',
      attackEntity: false,
      useEntity: false,
      interactiveBlock: false,
      breakableBlock: false,
      tapUseItem: false,
      continuousUse: true,
    })).toBe('use-hold');
    expect(resolveMobileTouchIntent({
      phase: 'hold',
      attackEntity: true,
      useEntity: false,
      interactiveBlock: false,
      breakableBlock: false,
      tapUseItem: false,
      continuousUse: true,
    })).toBe('attack');
    expect(resolveMobileTouchIntent({
      phase: 'tap',
      attackEntity: false,
      useEntity: false,
      interactiveBlock: false,
      breakableBlock: false,
      tapUseItem: false,
      continuousUse: true,
    })).toBe('none');
  });
});

describe('mobile movement helpers', () => {
  it('toggles crouch and highlights only while it is on', () => {
    expect(toggleCrouch(false)).toBe(true);
    expect(toggleCrouch(true)).toBe(false);
    expect(inputSource).toContain('button.classList.toggle(\'is-active\', this.touchSneak)');
    expect(inputSource).toContain('aria-pressed');
  });

  it('keeps jump momentary and leaves attack, use and sprint off the touch chrome', () => {
    expect(inputSource).toContain('data-action="jump"');
    expect(inputSource).toContain('data-action="sneak"');
    expect(inputSource).toContain('data-action="inventory"');
    expect(inputSource).toContain('if (action === \'jump\') this.touchJump = true');
    expect(inputSource).toContain('if (action === \'jump\') this.touchJump = false');
    expect(inputSource).not.toContain('data-action="mine"');
    expect(inputSource).not.toContain('data-action="use"');
    expect(inputSource).not.toContain('data-action="sprint"');
    expect(inputSource).not.toContain('data-action="pause"');
    expect(sprintFromStick(0, 0.9)).toBe(true);
    expect(sprintFromStick(0.2, 0.2)).toBe(false);
    expect(sprintFromStick(0, -0.95)).toBe(false);
  });

  it('arms auto-jump only for a grounded mobile step and not for creative flight', () => {
    expect(shouldArmMobileAutoJump(idleProbe)).toBe(true);
    expect(shouldArmMobileAutoJump({ ...idleProbe, touchLayout: false })).toBe(false);
    expect(shouldArmMobileAutoJump({ ...idleProbe, creative: true })).toBe(false);
    expect(shouldArmMobileAutoJump({ ...idleProbe, sneaking: true })).toBe(false);
    expect(shouldArmMobileAutoJump({ ...idleProbe, landingClear: false })).toBe(false);
    const feet = 10;
    expect(isFullHeightObstacle([{ minY: feet, maxY: feet + 1 }], feet)).toBe(true);
    expect(isFullHeightObstacle([{ minY: feet, maxY: feet + 0.5 }], feet, MOBILE_AUTO_JUMP_STEP)).toBe(false);
  });

  it('treats placeables as a tap use and food or a bow as a held use', () => {
    expect(isTapUseItem(ItemId.WaterBucket)).toBe(true);
    expect(isTapUseItem(ItemId.WoodenHoe)).toBe(true);
    expect(isTapUseItem(ItemId.Bucket)).toBe(true);
    expect(isTapUseItem(ItemId.Bow)).toBe(false);
    expect(isContinuousUseItem(ItemId.Bow)).toBe(true);
    expect(isContinuousUseItem(ItemId.Bread)).toBe(true);
    expect(isContinuousUseItem(ItemId.Stick)).toBe(false);
  });
});

describe('sky palette', () => {
  it('keeps a blue day, a warm horizon at dusk and dawn, and stars only after the sun drops', () => {
    const noon = skySample(6_000);
    const dusk = skySample(12_000);
    const midnight = skySample(18_000);
    const dawn = skySample(0);
    expect(noon.starOpacity).toBe(0);
    expect(noon.sunHeight).toBeGreaterThan(0.9);
    expect(noon.zenith.b).toBeGreaterThan(noon.zenith.r);
    expect(dusk.rising).toBe(false);
    expect(dawn.rising).toBe(true);
    expect(dusk.bandStrength).toBeGreaterThan(0.5);
    expect(dawn.bandStrength).toBeGreaterThan(0.5);
    expect(dusk.horizon.r).toBeGreaterThan(dusk.horizon.b);
    expect(dawn.horizon.r).toBeGreaterThan(noon.horizon.r);
    expect(midnight.starOpacity).toBeGreaterThan(0.9);
    expect(midnight.zenith.b).toBeLessThan(0.15);
    expect(dusk.starOpacity).toBeLessThan(0.2);
    expect(noon.fog.b).toBeGreaterThan(midnight.fog.b);
  });

  it('reads the clouds checkbox without treating a missing value as on', () => {
    expect(readCloudSetting('on')).toBe(true);
    expect(readCloudSetting('true')).toBe(true);
    expect(readCloudSetting('1')).toBe(true);
    expect(readCloudSetting(null)).toBe(false);
    expect(readCloudSetting('off')).toBe(false);
  });
});

describe('play info and hotbar layout', () => {
  it('floors coordinates and prints the online count', () => {
    expect(floorCoord(4.9)).toBe(4);
    expect(floorCoord(-1.2)).toBe(-2);
    expect(floorCoord(Number.NaN)).toBe(0);
    expect(formatPlayInfo(3, 10.8, 64.2, -3.1)).toBe('Игроков: 3\nX: 10\nY: 64\nZ: -4');
  });

  it('locks the hotbar to a horizontal row and shows touch controls only for a coarse pointer', () => {
    expect(style).toContain('flex-wrap: nowrap');
    expect(style).toContain('flex-direction: row');
    expect(style).toContain('--hotbar-slot:');
    expect(style).toContain('aspect-ratio: auto');
    expect(style).not.toContain('repeat(9, var(--hud-slot-size))');
    expect(style).not.toContain('repeat(9, var(--hotbar-slot))');
    expect(style).not.toContain('calc(0.52 + 0.03vw)');
    expect(style).not.toContain('@media (pointer: coarse), (max-width: 900px)');
    expect(style).toContain('@media (pointer: coarse)');
    expect(style).toContain('--hud-scale: clamp(');
    expect(style).toContain('#play-info');
    expect(style).toContain('#touch-actions button[data-action="sneak"].is-active');
    const hidden = style.indexOf('#touch-look-zone,\n#touch-joystick,\n#touch-actions {\n  display: none;');
    const shown = style.indexOf('@media (pointer: coarse)');
    expect(hidden).toBeGreaterThanOrEqual(0);
    expect(shown).toBeGreaterThan(hidden);
    expect(gameUi).toContain('id="play-info"');
    expect(gameUi).toContain('name="clouds"');
    expect(gameUi).toContain('Свайп по экрану вращает камеру');
  });
});

describe('look direction', () => {
  it('round-trips the player view basis', () => {
    const direction = viewDirectionFromLook(0.4, -0.25);
    const look = lookFromDirection(direction.x, direction.y, direction.z);
    expect(look.yaw).toBeCloseTo(0.4, 5);
    expect(look.pitch).toBeCloseTo(-0.25, 5);
  });
});
