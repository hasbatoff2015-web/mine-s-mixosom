import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ItemId } from '../src/items';
import {
  MOBILE_AUTO_JUMP_STEP,
  isContinuousUseItem,
  isFullHeightObstacle,
  isPriorityHeldUseItem,
  isTapUseItem,
  readCloudSetting,
  resolveMobileTouchIntent,
  shouldArmMobileAutoJump,
  shouldFollowHoldAim,
  sprintFromStick,
  toggleCrouch,
  type MobileTouchFacts,
} from '../src/input/mobileTouch';
import { TOUCH_LAYOUT_QUERY } from '../src/input/touchLayout';
import {
  TOUCH_HOLD_MS,
  TOUCH_SWIPE_THRESHOLD_PX,
  advanceTouchTrack,
  beginTouchTrack,
  finishTouchTrack,
  moveHeldTouch,
  resolvePointerEnd,
  swipeLookDelta,
} from '../src/input/touchGesture';
import { lookFromDirection, viewDirectionFromLook } from '../src/player/localAim';
import { resolveOnlineMiningTick } from '../src/net/onlineMining';
import { CloudLayer, CLOUD_WORLD_PER_TEXEL, cloudAltitude, cloudWorldSample } from '../src/rendering/CloudLayer';
import { CLOUD_MASK_SIZE, cloudCoverage, cloudMaskAlpha } from '../src/rendering/cloudMask';
import { skySample } from '../src/rendering/skyPalette';
import { floorCoord, formatPlayInfo } from '../src/ui/playInfoHud';

const style = readFileSync('src/style.css', 'utf8');
const inputSource = readFileSync('src/input/InputManager.ts', 'utf8');
const gameSource = readFileSync('src/core/Game.ts', 'utf8');
const playerSource = readFileSync('src/player/PlayerController.ts', 'utf8');
const skySource = readFileSync('src/rendering/SkyDome.ts', 'utf8');
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
    expect(resolveMobileTouchIntent(facts({
      phase: 'tap',
      attackEntity: true,
      breakableBlock: true,
    }))).toBe('attack');
    expect(resolveMobileTouchIntent(facts({
      phase: 'tap',
      useEntity: true,
      breakableBlock: true,
      tapUseItem: true,
      continuousUse: true,
    }))).toBe('use');
    expect(resolveMobileTouchIntent(facts({
      phase: 'tap',
      interactiveBlock: true,
      breakableBlock: true,
    }))).toBe('use');
    expect(resolveMobileTouchIntent(facts({
      phase: 'tap',
      hasBlockTarget: true,
      breakableBlock: true,
      tapUseItem: true,
    }))).toBe('use');
    expect(resolveMobileTouchIntent(facts({
      phase: 'tap',
      breakableBlock: true,
      continuousUse: true,
    }))).toBe('attack');
    expect(resolveMobileTouchIntent(facts({
      phase: 'hold',
      breakableBlock: true,
      tapUseItem: true,
      continuousUse: true,
    }))).toBe('mine');
    expect(resolveMobileTouchIntent(facts({
      phase: 'hold',
      continuousUse: true,
    }))).toBe('use-hold');
    expect(resolveMobileTouchIntent(facts({
      phase: 'hold',
      attackEntity: true,
      continuousUse: true,
    }))).toBe('attack');
    expect(resolveMobileTouchIntent(facts({
      phase: 'tap',
      continuousUse: true,
    }))).toBe('none');
  });

  it('does not turn pointercancel into a tap', () => {
    const pending = beginTouchTrack(20, 30, 0);
    expect(resolvePointerEnd(pending, 'cancel', 40)).toBe('ignore');
    expect(resolvePointerEnd(pending, 'up', 40)).toBe('tap');
    const swiped = advanceTouchTrack(pending, 20 + TOUCH_SWIPE_THRESHOLD_PX, 30, 50);
    expect(resolvePointerEnd(swiped, 'cancel', 80)).toBe('ignore');
    expect(resolvePointerEnd(swiped, 'up', 80)).toBe('swipe');
    const held = advanceTouchTrack(pending, 22, 31, TOUCH_HOLD_MS);
    expect(resolvePointerEnd(held, 'cancel', TOUCH_HOLD_MS + 10)).toBe('hold-end');
    expect(inputSource).toContain('this.finishWorldTouch(performance.now())');
    expect(inputSource).toContain('this.cancelWorldTouchGesture()');
    expect(inputSource).toContain("resolvePointerEnd(track, 'cancel'");
    expect(inputSource).toContain('if (this.mining) this.miningReleased = true');
    expect(inputSource).toContain('this.useReleased = true');
    expect(inputSource).toContain('this.releaseAimPending = true');
    const release = inputSource.slice(inputSource.indexOf('releaseActions()'), inputSource.indexOf('clearHeldKeys()'));
    expect(release).toContain('this.miningReleased = false');
    expect(release).toContain('this.useReleased = false');
  });

  it('keeps a mining hold on the finger without rotating the camera', () => {
    const started = beginTouchTrack(100, 80, 0);
    const held = advanceTouchTrack(started, 100, 80, TOUCH_HOLD_MS);
    const moved = moveHeldTouch(held, 180, 84, TOUCH_HOLD_MS + 40);
    expect(held.phase).toBe('hold');
    expect(moved.track.phase).toBe('hold');
    expect(moved.cameraDelta).toBeUndefined();
    expect(moved.aimX).toBe(180);
    expect(moved.aimY).toBe(84);
    expect(moved.track.x).toBe(180);
    expect(shouldFollowHoldAim('mine')).toBe(true);
    expect(shouldFollowHoldAim('use-hold')).toBe(true);
    expect(shouldFollowHoldAim('attack')).toBe(false);
    expect(shouldFollowHoldAim('use')).toBe(false);
    const follow = inputSource.slice(inputSource.indexOf('private followHoldAim'), inputSource.indexOf('private beginWorldHold'));
    expect(follow).toContain('aimAtClientPoint');
    expect(follow).toContain('this.interactionAim = aim');
    expect(follow).not.toContain('attackPressed');
    expect(follow).not.toContain('usePressed');
    expect(gameSource).toContain('aimAtClientPoint: (clientX, clientY) => this.aimAtClientPoint(clientX, clientY)');
    expect(gameSource).toContain('if (session.miningTarget !== targetKey)');
    const begin = inputSource.slice(inputSource.indexOf('private beginWorldHold'), inputSource.indexOf('private finishWorldTouch'));
    expect(begin).toContain('track.x, track.y');
    expect(begin).not.toContain('originX');
    expect(inputSource).toContain('refreshHoldAim');
    expect(inputSource).toContain('consumeReleaseAim');
    expect(inputSource).toContain('if (!this.touchLayout) return');
    expect(gameSource).toContain('this.refreshHeldTouchAim()');
    expect(gameSource).toContain('this.input.consumeReleaseAim()');
    expect(resolveOnlineMiningTick({
      buttonDown: true,
      targetKey: '2,64,0',
      miningTarget: '1,64,0',
    })).toEqual({ type: 'start', targetKey: '2,64,0' });
    expect(resolveOnlineMiningTick({
      buttonDown: true,
      targetKey: '2,64,0',
      miningTarget: '1,64,0',
      finishKey: '1,64,0',
      clientWaitFinish: false,
    })).toEqual({ type: 'abandon-start', targetKey: '2,64,0' });
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
    expect(isTapUseItem(ItemId.MilkBucket)).toBe(false);
    expect(isPriorityHeldUseItem(ItemId.Bow)).toBe(true);
    expect(isPriorityHeldUseItem(ItemId.Bread)).toBe(true);
    expect(isPriorityHeldUseItem(ItemId.MilkBucket)).toBe(true);
    expect(isPriorityHeldUseItem(ItemId.WoodenPickaxe)).toBe(false);
    expect(isContinuousUseItem(ItemId.Bow)).toBe(true);
    expect(isContinuousUseItem(ItemId.Bread)).toBe(true);
    expect(isContinuousUseItem(ItemId.MilkBucket)).toBe(true);
    expect(isContinuousUseItem(ItemId.Stick)).toBe(false);
  });

  it('draws a bow and eats on hold even when a block or player is under the finger', () => {
    for (const item of [ItemId.Bow, ItemId.Bread, ItemId.MilkBucket]) {
      expect(isPriorityHeldUseItem(item)).toBe(true);
      expect(resolveMobileTouchIntent(facts({
        phase: 'hold',
        priorityHeldUse: true,
        attackEntity: true,
        hasBlockTarget: true,
        breakableBlock: true,
      }))).toBe('use-hold');
      expect(resolveMobileTouchIntent(facts({
        phase: 'hold',
        priorityHeldUse: true,
      }))).toBe('use-hold');
    }
    expect(resolveMobileTouchIntent(facts({
      phase: 'tap',
      attackEntity: true,
      priorityHeldUse: true,
      hasBlockTarget: true,
      breakableBlock: true,
    }))).toBe('attack');
    expect(resolveMobileTouchIntent(facts({
      phase: 'hold',
      breakableBlock: true,
      hasBlockTarget: true,
    }))).toBe('mine');
  });

  it('places on any block face and refuses to mine an unbreakable surface', () => {
    expect(isTapUseItem('dirt')).toBe(true);
    expect(resolveMobileTouchIntent(facts({
      phase: 'tap',
      hasBlockTarget: true,
      breakableBlock: true,
      tapUseItem: true,
    }))).toBe('use');
    expect(resolveMobileTouchIntent(facts({
      phase: 'tap',
      hasBlockTarget: true,
      breakableBlock: false,
      tapUseItem: true,
    }))).toBe('use');
    expect(resolveMobileTouchIntent(facts({
      phase: 'hold',
      hasBlockTarget: true,
      breakableBlock: false,
    }))).toBe('none');
  });

  it('sends touch crouch as creative descend and keeps jump momentary', () => {
    expect(inputSource).toContain('descend: DESKTOP_SNEAK_CODES.some((code) => this.keys.has(code)) || this.touchSneak');
    expect(playerSource).toContain('if (this.isFlying) this.updateFlyVelocity(movement, stepDt)');
    const fly = playerSource.slice(playerSource.indexOf('private updateFlyVelocity'), playerSource.indexOf('private updateStance'));
    expect(fly).toContain('if (movement.descend) desiredY -= CREATIVE_VERTICAL_SPEED');
    expect(inputSource).toContain('if (action === \'jump\') this.touchJump = true');
    expect(inputSource).toContain('if (action === \'jump\') this.touchJump = false');
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
    expect(dusk.bandStrength).toBeGreaterThan(0.85);
    expect(dawn.bandStrength).toBeGreaterThan(0.85);
    expect(dusk.band.r).toBeGreaterThan(0.95);
    expect(dusk.band.g).toBeLessThan(0.35);
    expect(dusk.horizon.r - dusk.horizon.b).toBeGreaterThan(0.55);
    expect(dusk.zenith.b).toBeGreaterThan(dusk.zenith.r);
    expect(dusk.horizon.r).toBeGreaterThan(dusk.horizon.b);
    expect(dawn.horizon.r).toBeGreaterThan(noon.horizon.r);
    expect(midnight.starOpacity).toBeGreaterThan(0.9);
    expect(midnight.zenith.b).toBeLessThan(0.15);
    expect(dusk.starOpacity).toBeLessThan(0.2);
    expect(noon.fog.b).toBeGreaterThan(midnight.fog.b);
    expect(skySource).toContain('(dir.y - 0.035) * 8.6');
  });

  it('reads the clouds checkbox without treating a missing value as on', () => {
    expect(readCloudSetting('on')).toBe(true);
    expect(readCloudSetting('true')).toBe(true);
    expect(readCloudSetting('1')).toBe(true);
    expect(readCloudSetting(null)).toBe(false);
    expect(readCloudSetting('off')).toBe(false);
  });

  it('draws clouds on one plane and hides that plane when the checkbox is off', () => {
    const alpha = cloudMaskAlpha();
    const coverage = cloudCoverage(alpha);
    expect(coverage).toBeGreaterThan(0.04);
    expect(coverage).toBeLessThan(0.28);
    expect(skySource).not.toContain('uClouds');
    expect(skySource).toContain('uStarOpacity');
    const clouds = new CloudLayer();
    expect(clouds.object.visible).toBe(true);
    expect(clouds.isEnabled).toBe(true);
    clouds.setEnabled(false);
    expect(clouds.object.visible).toBe(false);
    expect(clouds.isEnabled).toBe(false);
    clouds.setEnabled(true);
    expect(clouds.object.visible).toBe(true);
    clouds.update(12, 66, -4, 3, 0);
    expect(clouds.object.position.y).toBe(cloudAltitude(66));
    expect(clouds.object.position.y).toBeGreaterThan(110);
    expect(clouds.object.position.x).toBe(12);
    expect(clouds.object.position.z).toBe(-4);
    expect(cloudAltitude(200)).toBeGreaterThan(250);
    const span = CLOUD_MASK_SIZE * CLOUD_WORLD_PER_TEXEL;
    const still = cloudWorldSample(40, -15, 0, 0, 0, span);
    const movedX = cloudWorldSample(40, -15, 120, 0, 0, span);
    const movedZ = cloudWorldSample(40, -15, 0, 80, 0, span);
    expect(movedX.u).toBeCloseTo(still.u, 5);
    expect(movedX.v).toBeCloseTo(still.v, 5);
    expect(movedZ.u).toBeCloseTo(still.u, 5);
    expect(movedZ.v).toBeCloseTo(still.v, 5);
    expect(cloudWorldSample(40, -15, 0, 0, 10, span).u).not.toBeCloseTo(still.u, 3);
    expect(gameSource).toContain('this.clouds.setEnabled(settings.clouds)');
    expect(gameSource).toContain('this.clouds.update(');
  });
});

describe('play info and hotbar layout', () => {
  it('floors coordinates and prints the online count', () => {
    expect(floorCoord(4.9)).toBe(4);
    expect(floorCoord(-1.2)).toBe(-2);
    expect(floorCoord(Number.NaN)).toBe(0);
    expect(formatPlayInfo(3, 10.8, 64.2, -3.1)).toBe('Игроков: 3\nX: 10  Y: 64  Z: -4');
    expect(formatPlayInfo(1, -1.2, 68, 25.9)).toBe('Игроков: 1\nX: -2  Y: 68  Z: 25');
  });

  it('keeps gameplay chrome from selecting and leaves chat and text fields editable', () => {
    expect(style).toContain('-webkit-user-select: none');
    expect(style).toContain('-webkit-touch-callout: none');
    expect(style).toContain('-webkit-user-drag: none');
    expect(style).toContain('#chat-input');
    const chat = style.slice(style.indexOf('#chat-input {'), style.indexOf('#chat-input:disabled'));
    expect(chat).toContain('user-select: text');
    expect(chat).toContain('-webkit-user-select: text');
    expect(style).toContain('[contenteditable="true"]');
    expect(style).toContain('left: calc(50% + var(--hud-hotbar-half-width) + 20px)');
    expect(style).toContain('--app-height');
    expect(style).toContain('100dvh');
    expect(style).not.toContain('"inventory ."');
    expect(style).not.toContain('min-height: calc(100vh - 12px)');
    expect(style).not.toContain('min-height: calc(100vh - 24px)');
    expect(style).not.toContain('grid-template-columns: repeat(2, minmax(0, 1fr));\n    width: 100%');
    expect(style).not.toContain('position: fixed;\n    top: max(10px, env(safe-area-inset-top));\n    right: calc(max(10px, env(safe-area-inset-right)) + 84px)');
    expect(style).toContain('bottom: max(10px, env(safe-area-inset-bottom))');
    expect(inputSource).toContain("target.closest('input, textarea, [contenteditable=\"true\"]')");
    expect(inputSource).toContain("addEventListener('selectstart'");
    expect(TOUCH_LAYOUT_QUERY).toBe('(pointer: coarse)');
    expect(style).toContain(`@media ${TOUCH_LAYOUT_QUERY}`);
    expect(inputSource).toContain('TOUCH_LAYOUT_QUERY');
    expect(style).not.toContain('@media (max-width: 900px)');
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
