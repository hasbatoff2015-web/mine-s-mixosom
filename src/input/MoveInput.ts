/**
 * Neutral locomotion sample. Shared simulation and the server consume this;
 * KeyboardEvent / MouseEvent stay in InputManager (client).
 */
export interface MoveInput {
  forward: number;
  right: number;
  jump: boolean;
  /**
   * Physical Space or jump-button level. Creative Flight's double-tap reads
   * only this edge. Auto-jump and the survival jump latch set `jump` and
   * leave this false. Omitted means "same as jump" for older commands.
   */
  manualJump?: boolean;
  sprint: boolean;
  sneak: boolean;
  /** Shift while flying: descend. Optional so older tests stay valid. */
  descend?: boolean;
  /** Ctrl while flying: faster horizontal flight. */
  flySprint?: boolean;
}
