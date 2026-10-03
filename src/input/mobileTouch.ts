import { ItemId, tryGetItemDefinition } from '../items';

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

export type MobileTouchIntent = 'attack' | 'use' | 'use-hold' | 'mine' | 'none';

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
  readonly creative: boolean;
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

/** Mining and a drawn bow keep following the finger. The camera stays put. */
export function shouldFollowHoldAim(intent: MobileTouchIntent): boolean {
  return intent === 'mine' || intent === 'use-hold';
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

/** Mobile-only. Creative flight stays on the jump button so a wall cannot toggle fly. */
export function shouldArmMobileAutoJump(probe: MobileAutoJumpProbe): boolean {
  return probe.touchLayout
    && probe.onGround
    && !probe.sneaking
    && !probe.flying
    && !probe.creative
    && !probe.inWater
    && !probe.inLava
    && !probe.onLadder
    && probe.moving
    && probe.obstacle
    && probe.landingClear;
}

export function readCloudSetting(value: FormDataEntryValue | null | undefined): boolean {
  return value === 'on' || value === 'true' || value === '1';
}
