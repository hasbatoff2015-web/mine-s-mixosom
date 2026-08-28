/** Java 1.8-style mining hits: one tap every 4 ticks while progress advances, not 20 TPS spam. */
export const MINING_HIT_INTERVAL_TICKS = 4;

export interface MiningSoundState {
  targetKey?: string;
  ticksOnTarget: number;
}

export type MiningSoundKind = 'hit' | 'break' | 'none';

export function createMiningSoundState(): MiningSoundState {
  return { targetKey: undefined, ticksOnTarget: 0 };
}

export function resetMiningSound(state?: MiningSoundState | null): void {
  if (!state) return;
  state.targetKey = undefined;
  state.ticksOnTarget = 0;
}

export function nextMiningSound(
  state: MiningSoundState | undefined,
  targetKey: string | undefined,
  progressBefore: number,
  delta: number,
): MiningSoundKind {
  if (!state || !targetKey || !(delta > 0)) {
    resetMiningSound(state);
    return 'none';
  }
  if (state.targetKey !== targetKey) {
    state.targetKey = targetKey;
    state.ticksOnTarget = 0;
  }
  const willBreak = progressBefore + delta >= 1;
  const advancing = progressBefore + delta > progressBefore;
  let kind: MiningSoundKind = 'none';
  if (willBreak) kind = 'break';
  else if (advancing && state.ticksOnTarget % MINING_HIT_INTERVAL_TICKS === 0) kind = 'hit';
  state.ticksOnTarget += 1;
  return kind;
}
