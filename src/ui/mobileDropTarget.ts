/** Extra hit padding. The left edge never grows toward the inventory panel. */
export const MOBILE_DROP_HIT_RIGHT_LOGICAL = 10;
export const MOBILE_DROP_HIT_VERTICAL_LOGICAL = 4;

export interface CssRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Hit region around the painted drop control.
 * `scale` is `--mc-ui-scale`: extensions are logical pixels times that scale.
 * Left expansion is always 0, even when the visual box is already the 44px touch minimum.
 */
export function mobileDropHitRegion(visual: CssRect, scale: number): CssRect {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const right = MOBILE_DROP_HIT_RIGHT_LOGICAL * safeScale;
  const vertical = MOBILE_DROP_HIT_VERTICAL_LOGICAL * safeScale;
  return {
    left: visual.left,
    top: visual.top - vertical,
    right: visual.right + right,
    bottom: visual.bottom + vertical,
  };
}

export function mobileDropHitContains(visual: CssRect, x: number, y: number, scale: number): boolean {
  const hit = mobileDropHitRegion(visual, scale);
  return x >= hit.left && x <= hit.right && y >= hit.top && y <= hit.bottom;
}
