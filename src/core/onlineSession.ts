import type { LifecycleState } from './Lifecycle';
import { playerGameplayAllowed, worldSimulationActive } from './gameplayModal';

/**
 * A new AnarchyClient always starts `inputSeq` at 0. A resumed server player
 * that still holds the previous connection's lastInputSeq will reject every
 * WASD packet as stale. Mouse look and chat do not use this sequence.
 */
export function inputSeqAfterNewClientSession(): number {
  return 0;
}

/** Server lastInputSeq after disconnect or resume, so client seq 1 is accepted. */
export function inputSeqAfterReconnect(): number {
  return -1;
}

export function shouldAcceptInputSequence(lastSeq: number, nextSeq: number): boolean {
  return nextSeq > lastSeq;
}

export function shouldHandleOnlineClientEvent(
  activeClient: object | undefined | null,
  sourceClient: object,
): boolean {
  return activeClient === sourceClient;
}

export function isLiveSocketGeneration(current: number, eventGeneration: number): boolean {
  return current === eventGeneration;
}

/**
 * World enter (SP or online) always goes through LOADING_WORLD → enterPlaying.
 * Leftover BACKGROUND/DEAD from a previous session must not survive.
 */
export function lifecycleAfterWorldSessionEnter(_state: LifecycleState): LifecycleState {
  return 'PLAYING';
}

export function sessionEnterAllowsTickOnline(
  state: LifecycleState,
  overlayOpen: boolean,
): boolean {
  const playing = lifecycleAfterWorldSessionEnter(state);
  return worldSimulationActive(playing) && playerGameplayAllowed(playing, overlayOpen);
}
