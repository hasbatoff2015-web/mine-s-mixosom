import type { MoveInput } from '../input/InputManager';
import type { LifecycleState } from './Lifecycle';

/** Player-facing container overlays. Recipe Book is a panel inside these, not a pause. */
export type GameplayModalKind = 'inventory' | 'crafting-table' | 'chest' | 'furnace';

export const BLOCKED_MOVE_INPUT: MoveInput = Object.freeze({
  forward: 0,
  right: 0,
  jump: false,
  sprint: false,
  sneak: false,
  descend: false,
  flySprint: false,
});

/** World tick runs only in PLAYING. Container GUIs stay PLAYING. LOADING_WORLD prepares chunks without gameplay. */
export function worldSimulationActive(lifecycle: LifecycleState): boolean {
  return lifecycle === 'PLAYING';
}

/** WASD / look / attack / use / flight — blocked by container or chat overlay, not by staying PLAYING. */
export function playerGameplayAllowed(lifecycle: LifecycleState, overlayOpen: boolean): boolean {
  return lifecycle === 'PLAYING' && !overlayOpen;
}

export function resolvePlayerMoveInput(overlayOpen: boolean, live: MoveInput): MoveInput {
  return overlayOpen ? BLOCKED_MOVE_INPUT : live;
}

export function openingContainerPausesSimulation(_kind: GameplayModalKind): boolean {
  return false;
}

export function openingPauseMenuPausesSimulation(): boolean {
  return true;
}

/** Recipe Book is part of the current container screen. */
export function recipeBookAffectsSimulation(): boolean {
  return false;
}
