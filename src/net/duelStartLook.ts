/** One-shot duel teleport look. Ordinary snapshots do not call this. */
export function applyDuelStartLook(state: {
  input: { adoptAuthoritativeLook(yaw: number, pitch: number): void };
  player?: { yaw: number; pitch: number };
  clearCachedAim(): void;
}, yaw: number, pitch: number): void {
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
  state.input.adoptAuthoritativeLook(yaw, pitch);
  if (state.player) {
    state.player.yaw = yaw;
    state.player.pitch = pitch;
  }
  state.clearCachedAim();
}
