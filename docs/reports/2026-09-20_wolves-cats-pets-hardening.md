# Pet interaction and ownership hardening

## Goal

Fix five audited bugs in the already-shipped wolves/cats system without rewriting models, taming odds, sit poses, or per-player `pets.limit.N`.

## Starting HEAD

`2242d02a3f766e7b52b090eb47f24360157e2895` on `codex/wolves-cats-pets`.

## Result

Online RMB matches the visible pet, `entity_use` uses command-boundary look plus a bounded mob rewind, offline home recaptures at the latest owner loss, owned wolves do not civil-war, and tamed pets no longer consume the wild `maxMobs` budget.

## Implemented

- Client `raycastRendered` / `raycast(..., { pose: 'render' })` uses `networkRenderPose ?? position`.
- `SampledEntityPose.resolvedTick` is the interpolated server tick shown on screen; `captureEntityUse` sends it as `targetRenderTick`.
- Bounded `MobEntity.poseHistory` (16 samples). Server rewinds up to `MAX_MOB_REWIND_TICKS = 5`.
- `entity_use` pending until `combatPoseForCommand`; actual ray uses that pose's eye/yaw/pitch.
- `updateOwnedFollow` clears `petHomeX/Z`; first owner-unavailable tick captures a new home.
- `samePetOwner` guards assist, `setCombatTarget`, and chase validation.
- Wild `maxMobs` ignores tamed pets. `maxTamedPets` (`resolveMaxTamedPets(maxPlayers)`, clamp 64–160) is a safety ceiling. Restore keeps every tamed pet. New tames at the ceiling return `pet_capacity`.
- Successful pet teleport marks persistence dirty once.

## Changed files

Client/sim: `MobManager.ts`, `mobPoseHistory.ts`, `petTypes.ts`, `petTaming.ts`, `petLimit.ts`, `Game.ts`, `entitySnapshotInterpolation.ts`, `applyEntitySnapshots.ts`, `playerActions.ts`.

Server: `gameplay.ts`, `WorldInstance.ts`, `AnarchyServer.ts`.

Tests/docs: `pets.test.ts`, `pets-anarchy.test.ts`, `pets-performance.test.ts`, `entity-snapshot-interpolation.test.ts`, `mob-pose-history.test.ts`, `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`.

## Architecture decisions

- Simulation `MobManager.raycast()` stays on `position` so melee/physics do not change. Interaction has an explicit render path.
- Reuse `combatPoseHistory` for attacker look. Do not store client yaw as authority.
- Missing `targetRenderTick` validates the current authoritative pose (legacy/SP-safe). A present but out-of-window tick is `stale`, not a current-pose fallback.
- Global pet cap is a safety guard, not a second player-facing limit.

## Tests

Rendered raycast vs latest pose; command-boundary look forgery; moving-pet rewind; stale/future ticks; offline home A→B; same-owner no assist; wild vs tamed budgets; restore overflow; 20/48/80 pet tick cost.

## Visual QA

Automated interaction/combat/home tests. Live two-client QA was not run in this pass.

## Performance

`MAX_SEPARATION_PAIR_CHECKS` stays 1024. Benchmarks at 20, 48, and 80 (8 owners × 10) pets.

## Known issues

Ordinary follow movement still does not dirty the world every tick (same as other mobs). Teleport now dirties.

## Deferred

Breeding, names, dye, ocelot gameplay, save-system rewrite.

## Next work

Owner live two-client QA of moving-pet RMB, disconnect home, and same-owner melee.

## Git

Follow-up commit on `codex/wolves-cats-pets`. No merge to `main`.
