# Bow PvP client timeline

## Goal

Align multiplayer bow release and player collision with the remote presentation timeline while retaining complete server authority over origin, draw, inventory, projectile physics, collision and damage.

## Result

Online bow release now carries captured live aim and an optional already-rendered remote server tick. The server validates that tick at receipt, resolves an exact authoritative attacker command boundary, freezes server draw state independently from FIFO wait, and performs bounded step-by-step projectile catch-up. Compensated arrows raycast server historical player AABBs; uncompensated arrows retain current-AABB behavior.

## Implemented

- Direct-under-crosshair `lastRenderTick` selection with median active-remote fallback; no interpolation re-sampling and no bow target hint.
- `PendingBowRelease` with `receivedServerTick`, receive-time validated timeline, 32-entry cap and eight-tick timeout.
- Release boundary history containing exact post-physics eye/pose/slot and server-owned Bow/draw state. Both action-before-boundary and action-after-boundary paths are supported; render-frame release between two input ticks uses only the latest current authoritative boundary.
- Captured yaw/pitch controls direction. Boundary eye plus the existing `0.35` muzzle controls origin. Inventory, Bow identity, charge and ammo remain server-owned; dedupe precedes spawning and consumption.
- Optional arrow `playerTimelineTick`, one-step advancement shared by normal tick and catch-up, and a server-layer historical AABB resolver. Blocks remain current.
- DEV action diagnostics for receive/boundary/pending/rewind/catch-up/slot/draw/charge/aim/origin/spawn/rejection.

## Changed files

Client intent/protocol: `src/core/Game.ts`, `src/net/actionIntent.ts`, `src/net/onlineActionMessages.ts`, `shared/playerActions.ts`, `shared/protocol.ts`.

Server authority: `server/AnarchyServer.ts`, `server/WorldInstance.ts`, `server/gameplay.ts`, `server/combatPoseHistory.ts`.

Projectile kernel: `src/combat/PlayerArrowManager.ts`.

Tests: `tests/bow-release-intent.test.ts`, `tests/bow-player-timeline.test.ts`, `tests/server/bow-pvp-timeline.test.ts`.

## Architecture decisions

- `MAX_PVP_REWIND_TICKS` remains 5. `MAX_PENDING_BOW_TICKS` is a separate 8-tick command-wait budget. `COMBAT_HISTORY_TICKS` is storage-only and increased from 12 to 20.
- Client presentation time is a scalar tick only. Client AABB, origin, target, damage and hit decisions are neither represented nor accepted.
- Historical AABB changes only player collision. Current voxels conservatively block catch-up projectiles.
- Existing arrow constants and the existing projectile damage/Claims/HurtResistance pipeline are unchanged.

## Tests

- Final expanded bow/arrow/melee/network/server/Claims regression suite: 13 files, 183 tests PASS.
- Focused prediction/combat/Claims compatibility suite: 11 files, 166 tests PASS.
- Shared-simulation suite: 9 files, 42 tests PASS.
- `typecheck`, `typecheck:sim`, `typecheck:client` and `typecheck:server`: PASS.
- Import boundaries: PASS.
- Production build: PASS (the existing `/sdk.js` and chunk-size Vite warnings remain).
- Full repository suite audit before the final boundary-state guard correction: 1,909/1,938 tests passed. The run exposed one bow regression in `remote-presentation`; it was corrected and the affected suite plus the final 183-test regression set pass. The other failures were the existing resource-sensitive/parser classes (reference extractor, load/latency thresholds, long fluid/server filesystem timeouts), not bow assertion failures. Isolated tick latency passed; the known flight-load threshold remained over budget.
- `git diff --check`: PASS.

## Visual QA

No browser or two-client visual QA was performed in this automated pass. Required owner scenarios remain in `docs/TESTING.md` and `docs/ROADMAP.md`.

## Performance

Catch-up is bounded to eight steps and only advances the newly spawned arrow. History is capped at 20 samples per player and pending bow actions at 32 per player.

## Known issues

Live feel under real browser/network jitter is not established by deterministic tests. Bow diagnostics are action-level; optional per-projectile console hit diagnostics were deferred to avoid production noise.

## Deferred

Two-client live QA at several latency levels. No bow tuning, aim assist, hitbox growth, block history, headshots, enchantments or new weapons were added.

## Next work

Run the live QA matrix and use F3 receive/boundary/pending/rewind/catch-up fields to classify any remaining misses before considering any balance change.

## Git

Branch: `codex/bow-pvp-timeline-v2`. Commit and push are performed only after final validation. No merge is part of this task.
