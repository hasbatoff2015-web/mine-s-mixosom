export interface LocalFoodUseSnapshotBoundary {
  readonly actionBoundaryCommandSeq: number;
  readonly snapshotInputSeq: number | undefined;
  readonly authoritativeFoodUseProgress: number | undefined;
}

/**
 * A render-edge use action occurs after its last sent input command. The
 * snapshot for that boundary command therefore describes the pre-use state;
 * only a strictly newer command can authoritatively confirm or cancel it.
 */
export function shouldClearLocalFoodUseFromSnapshot(
  boundary: LocalFoodUseSnapshotBoundary,
): boolean {
  return boundary.snapshotInputSeq !== undefined
    && boundary.snapshotInputSeq > boundary.actionBoundaryCommandSeq
    && boundary.authoritativeFoodUseProgress === 0;
}
