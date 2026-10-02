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

export type MobileTouchIntent = 'attack' | 'use' | 'use-hold' | 'mine' | 'none';

export interface MobileTouchFacts {
  readonly phase: 'tap' | 'hold';
  /** Player or hostile mob closer than the block. Same reach as desktop melee. */
  readonly attackEntity: boolean;
  /** Pet or rideable cart. Maps to the existing use intent, not a wider hit. */
  readonly useEntity: boolean;
  readonly interactiveBlock: boolean;
  readonly breakableBlock: boolean;
  /** Block item, hoe, bucket, flint, minecart — a single use, not sustained mining. */
  readonly tapUseItem: boolean;
  /** Food, bow, or sword. Sustained only when the finger is not on a breakable block. */
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
    || itemId === ItemId.MilkBucket
    || itemId === ItemId.FlintAndSteel
    || itemId === ItemId.Minecart;
}

export function isContinuousUseItem(itemId: string | undefined): boolean {
  if (!itemId) return false;
  if (itemId === ItemId.Bow) return true;
  const item = tryGetItemDefinition(itemId);
  if (!item) return false;
  return item.kind === 'food' || item.kind === 'weapon';
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
    if (facts.breakableBlock && facts.tapUseItem) return 'use';
    if (facts.breakableBlock) return 'attack';
    return 'none';
  }
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
