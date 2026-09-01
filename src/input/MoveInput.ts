/**
 * Neutral locomotion sample. Shared simulation and the server consume this;
 * KeyboardEvent / MouseEvent stay in InputManager (client).
 */
export interface MoveInput {
  forward: number;
  right: number;
  jump: boolean;
  sprint: boolean;
  sneak: boolean;
  /** Shift while flying: descend. Optional so older tests stay valid. */
  descend?: boolean;
  /** Ctrl while flying: faster horizontal flight. */
  flySprint?: boolean;
}
