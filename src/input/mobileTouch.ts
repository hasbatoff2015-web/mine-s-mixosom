import { ItemId, tryGetItemDefinition } from '../items';
import { desiredHorizontalWish } from '../player/ladderMotion';

/**
 * Stick deflection that sets the existing `movement.sprint` flag.
 * Speed stays `PLAYER_MOVE_SPEED`; this is the same pose/crit flag the old
 * sprint button toggled, and only while the stick is pushed forward.
 */
export const MOBILE_SPRINT_STICK_THRESHOLD = 0.82;
/** Blocks ahead of the feet that are taller than the shared 0.6 step. */
export const MOBILE_AUTO_JUMP_AHEAD = 0.52;
export const MOBILE_AUTO_JUMP_MIN_WISH = 0.35;
export const MOBILE_AUTO_JUMP_STEP = 0.6;
/**
 * Full stick deflection stays near the old 92px thumb travel (~31px).
 * A larger hit target must not make sprint a longer push.
 */
export const TOUCH_STICK_TRAVEL_CAP = 36;

export function touchStickRadius(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return Math.min(width * 0.34, TOUCH_STICK_TRAVEL_CAP);
}

export type MobileTouchIntent = 'attack' | 'use' | 'use-hold' | 'bow-hold' | 'mine' | 'none';

export interface MobileTouchFacts {
  readonly phase: 'tap' | 'hold';
  /** Player or hostile mob closer than the block. Same reach as desktop melee. */
  readonly attackEntity: boolean;
  /** Pet or rideable cart. Maps to the existing use intent, not a wider hit. */
  readonly useEntity: boolean;
  readonly interactiveBlock: boolean;
  /** Any selected block, including bedrock and other unbreakable surfaces. */
  readonly hasBlockTarget: boolean;
  readonly breakableBlock: boolean;
  /** Block item, hoe, empty bucket, flint, minecart — one use. Milk is not in this set. */
  readonly tapUseItem: boolean;
  /** Bow or food, including milk. Hold draws or eats even when a block is under the finger. */
  readonly priorityHeldUse: boolean;
  /** Bow draw is a camera look, not a finger ray. Absent means not a bow. */
  readonly bow?: boolean;
  /** Sword block on empty space. Checked after a breakable block so a sword can still mine. */
  readonly continuousUse: boolean;
}

export interface MobileTouchDecision {
  readonly yaw: number;
  readonly pitch: number;
  readonly intent: MobileTouchIntent;
}

export interface MobileAutoJumpProbe {
  readonly touchLayout: boolean;
  readonly onGround: boolean;
  readonly sneaking: boolean;
  readonly flying: boolean;
  readonly inWater: boolean;
  readonly inLava: boolean;
  readonly onLadder: boolean;
  readonly moving: boolean;
  readonly obstacle: boolean;
  readonly landingClear: boolean;
}

export function sprintFromStick(right: number, forward: number): boolean {
  return Math.hypot(right, forward) >= MOBILE_SPRINT_STICK_THRESHOLD && forward > 0.05;
}

export function toggleCrouch(active: boolean): boolean {
  return !active;
}

/** Ground crouch latches. Creative Flight holds the same button only while the finger is down. */
export type MobileSneakMode = 'toggle' | 'flight-hold';

export interface MobileSneakState {
  readonly pressed: boolean;
  readonly latched: boolean;
  readonly mode: MobileSneakMode;
  readonly pointerId: number | undefined;
}

export const MOBILE_SNEAK_IDLE: MobileSneakState = {
  pressed: false,
  latched: false,
  mode: 'toggle',
  pointerId: undefined,
};

/** Flight-hold is actual flight, not merely creative gamemode. A grounded creative player still toggles. */
export function mobileSneakFlightHold(gamemode: string | undefined, isFlying: boolean): boolean {
  return gamemode === 'creative' && isFlying;
}

/** Gold button: the latch on the ground, the finger while flying. */
export function sneakButtonActive(state: MobileSneakState): boolean {
  return state.mode === 'flight-hold' ? state.pressed : state.latched;
}

/**
 * Latched crouch never feeds descend. A stale ground latch cannot fly the player down
 * even if the flight-hold mode arrives a tick late.
 */
export function mobileSneakIntent(
  state: MobileSneakState,
  desktopSneak: boolean,
): { readonly sneak: boolean; readonly descend: boolean } {
  return {
    sneak: desktopSneak || (state.mode === 'toggle' && state.latched),
    descend: desktopSneak || state.pressed,
  };
}

export function mobileSneakAfterPointer(
  state: MobileSneakState,
  event: { readonly type: 'down' | 'up'; readonly pointerId: number },
): MobileSneakState {
  if (event.type === 'down') {
    if (state.pointerId !== undefined && state.pointerId !== event.pointerId) return state;
    if (state.pointerId === event.pointerId && state.pressed) return state;
    return {
      ...state,
      pressed: true,
      pointerId: event.pointerId,
      latched: state.mode === 'toggle' ? toggleCrouch(state.latched) : state.latched,
    };
  }
  if (state.pointerId !== undefined && state.pointerId !== event.pointerId) return state;
  return { ...state, pressed: false, pointerId: undefined };
}

/** Entering or leaving flight drops the ground latch. A held finger stays a press, not a new toggle. */
export function mobileSneakAfterFlight(state: MobileSneakState, flying: boolean): MobileSneakState {
  const mode: MobileSneakMode = flying ? 'flight-hold' : 'toggle';
  if (mode === state.mode) return state;
  return { ...state, mode, latched: false };
}

/** Overlay, pause, blur, and session teardown drop both the finger and the latch. */
export function mobileSneakRelease(state: MobileSneakState): MobileSneakState {
  if (!state.pressed && !state.latched && state.pointerId === undefined) return state;
  return { ...state, pressed: false, latched: false, pointerId: undefined };
}

export function isTapUseItem(itemId: string | undefined): boolean {
  if (!itemId) return false;
  const item = tryGetItemDefinition(itemId);
  if (!item) return false;
  if (item.placesBlockId !== undefined) return true;
  if (item.kind === 'tool' && item.tool === 'hoe') return true;
  return itemId === ItemId.Bucket
    || itemId === ItemId.FlintAndSteel
    || itemId === ItemId.Minecart;
}

/** Bow draw and food/milk. These win a hold over mining and over a melee tap-target. */
export function isPriorityHeldUseItem(itemId: string | undefined): boolean {
  if (!itemId) return false;
  if (itemId === ItemId.Bow) return true;
  return tryGetItemDefinition(itemId)?.kind === 'food';
}

export function isContinuousUseItem(itemId: string | undefined): boolean {
  if (isPriorityHeldUseItem(itemId)) return true;
  const item = itemId ? tryGetItemDefinition(itemId) : undefined;
  return item?.kind === 'weapon';
}

/** Mining and food/milk keep the finger ray. A bow draw does not. */
export function shouldFollowHoldAim(intent: MobileTouchIntent): boolean {
  return intent === 'mine' || intent === 'use-hold';
}

/** Only a drawn bow turns the same finger into camera look. */
export function shouldRotateCameraDuringHold(intent: MobileTouchIntent): boolean {
  return intent === 'bow-hold';
}

/**
 * While a hold is active, either the camera moves or the finger aim updates.
 * Bow clears the stored ray so release falls through to the center crosshair.
 */
export function heldPointerEffect(input: {
  readonly intent: MobileTouchIntent | null;
  readonly lastX: number;
  readonly lastY: number;
  readonly x: number;
  readonly y: number;
  readonly fingerAim: { readonly yaw: number; readonly pitch: number } | null;
  readonly interactionAim: { readonly yaw: number; readonly pitch: number } | null;
}): {
  readonly lookDx: number;
  readonly lookDy: number;
  readonly interactionAim: { readonly yaw: number; readonly pitch: number } | null;
} {
  if (input.intent && shouldRotateCameraDuringHold(input.intent)) {
    return {
      lookDx: input.x - input.lastX,
      lookDy: input.y - input.lastY,
      interactionAim: null,
    };
  }
  if (input.intent && shouldFollowHoldAim(input.intent)) {
    return {
      lookDx: 0,
      lookDy: 0,
      interactionAim: input.fingerAim ?? input.interactionAim,
    };
  }
  return {
    lookDx: 0,
    lookDy: 0,
    interactionAim: input.interactionAim,
  };
}

/** Stored finger aim wins. A cleared bow ray uses the live camera. */
export function centerCrosshairRelease(
  interactionAim: { readonly yaw: number; readonly pitch: number } | null,
  camera: { readonly yaw: number; readonly pitch: number },
): { readonly yaw: number; readonly pitch: number } {
  return interactionAim ?? camera;
}

/**
 * Tap and hold share one finger. They become the same attack/use/mine intents
 * desktop already sends. No reach change, no aim assist.
 */
export function resolveMobileTouchIntent(facts: MobileTouchFacts): MobileTouchIntent {
  if (facts.phase === 'tap') {
    if (facts.attackEntity) return 'attack';
    if (facts.useEntity) return 'use';
    if (facts.interactiveBlock) return 'use';
    if (facts.hasBlockTarget && facts.tapUseItem) return 'use';
    if (facts.breakableBlock) return 'attack';
    return 'none';
  }
  if (facts.bow) return 'bow-hold';
  if (facts.priorityHeldUse) return 'use-hold';
  if (facts.attackEntity) return 'attack';
  if (facts.useEntity) return 'use';
  if (facts.interactiveBlock) return 'use';
  if (facts.breakableBlock) return 'mine';
  if (facts.continuousUse) return 'use-hold';
  return 'none';
}

/**
 * A full block in the feet cell. Slabs and other boxes that stay within the
 * shared step height do not arm a jump; the controller already walks onto them.
 */
export function isFullHeightObstacle(
  boxes: readonly { readonly minY: number; readonly maxY: number }[],
  feetY: number,
  stepHeight = MOBILE_AUTO_JUMP_STEP,
): boolean {
  const limit = feetY + stepHeight + 0.05;
  return boxes.some((box) => box.maxY > limit && box.minY < feetY + 1.25);
}

/**
 * Mobile-only. Grounded creative jumps too. Actual flight, sneak, ladder and
 * fluids stay off so a wall cannot fight vertical flight.
 */
export function shouldArmMobileAutoJump(probe: MobileAutoJumpProbe): boolean {
  return probe.touchLayout
    && probe.onGround
    && !probe.sneaking
    && !probe.flying
    && !probe.inWater
    && !probe.inLava
    && !probe.onLadder
    && probe.moving
    && probe.obstacle
    && probe.landingClear;
}

export function mobileAutoJumpArmed(input: {
  readonly touchLayout: boolean;
  readonly onGround: boolean;
  readonly sneaking: boolean;
  readonly flying: boolean;
  readonly inWater: boolean;
  readonly inLava: boolean;
  readonly onLadder: boolean;
  readonly yaw: number;
  readonly forward: number;
  readonly right: number;
  readonly feetX: number;
  readonly feetY: number;
  readonly feetZ: number;
  readonly boxesAt: (x: number, y: number, z: number) => readonly { readonly minY: number; readonly maxY: number }[];
}): boolean {
  const wish = desiredHorizontalWish(input.yaw, input.forward, input.right);
  const moving = wish.length >= MOBILE_AUTO_JUMP_MIN_WISH;
  let obstacle = false;
  let landingClear = false;
  if (moving) {
    const len = Math.max(wish.length, 1e-6);
    const aheadX = input.feetX + (wish.x / len) * MOBILE_AUTO_JUMP_AHEAD;
    const aheadZ = input.feetZ + (wish.z / len) * MOBILE_AUTO_JUMP_AHEAD;
    const feet = input.feetY;
    const bx = Math.floor(aheadX);
    const by = Math.floor(feet + 0.001);
    const bz = Math.floor(aheadZ);
    obstacle = isFullHeightObstacle(input.boxesAt(bx, by, bz), feet);
    landingClear = input.boxesAt(bx, by + 1, bz).length === 0
      && input.boxesAt(bx, by + 2, bz).length === 0;
  }
  return shouldArmMobileAutoJump({
    touchLayout: input.touchLayout,
    onGround: input.onGround,
    sneaking: input.sneaking,
    flying: input.flying,
    inWater: input.inWater,
    inLava: input.inLava,
    onLadder: input.onLadder,
    moving,
    obstacle,
    landingClear,
  });
}

export function readCloudSetting(value: FormDataEntryValue | null | undefined): boolean {
  return value === 'on' || value === 'true' || value === '1';
}
