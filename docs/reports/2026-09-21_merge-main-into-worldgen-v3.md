# Merge origin/main into Worldgen V3

Date: 2026-09-21
Branch: `cursor/worldgen-v3-water-gourds-border-74e7`
PR: #100
Feature HEAD before sync: `ec6143fccd05152f53399ea5c7a6943ba686512b`
Main HEAD before sync: `d2d45e6b19942425d166009dbe63d596e64e55a8` (sword blocking PR #99)

## Goal

Synchronize current `main` into the Worldgen V3 feature with a normal `--no-ff` merge, keep both Worldgen V3 and current-main sword-blocking, then merge PR #100 into `main` with a normal merge commit.

## Result

`origin/main` was merged into the feature. `Game.ts` auto-merged with both families. Documentation conflicts were resolved by keeping both Worldgen V3 and sword-blocking sections. Owner manual QA recorded only for generation and gourd density 0.25.

## Implemented

- `git merge --no-ff origin/main` on the feature branch (no rebase).
- Semantic docs combination (`PROJECT_STATE`, `ROADMAP`, `TESTING`, `ARCHITECTURE`).
- Owner QA notes limited to what the owner actually confirmed.

## Conflict resolution

Changed in both:

- `src/core/Game.ts` — Git auto-merged. Verified both:
  - from main: `syncLocalCombatUse`, `combat.updateUse`, `combat.swordBlocking` on SP `tickPlayers` and Anarchy `tickOnline`, first-person and third-person presentation;
  - from Worldgen V3: `WorldBorderRenderer`, `gameplayMayMutateBlock`, `isPlayerCenterInsidePlayableWorld`, `relocateStandingPoseInsidePlayableWorld`, mining/spawn/place/mount guards, border renderer updates.
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/TESTING.md` — kept both feature families plus a sync note.
- `docs/ARCHITECTURE.md` — auto-merged; added a short sync heading.

Did **not** take whole files from `--ours` or `--theirs`.

## Architecture decisions

This is a merge, not a refactor. Client still owns intent; server still owns result. `VoxelWorld.setBlock` stays unguarded so scenery outside ±10000 can generate. Transient world-event overlays stay out of `world.modifications`.

## Tests

Targeted worldgen/border and sword/combat suites, then the full merge gate. Results are recorded in the merge-task report after the commands run.

## Visual QA

OWNER MANUAL QA (owner, before this sync):

- Worldgen V3 world generation checked in-game;
- latest reduced pumpkin/melon density checked in-game;
- owner reports the result looks good.

Not claimed: two-client Anarchy border QA, underwater floors, fade curve, or other border edge cases.

## Known issues / deferred

Unclaimed live QA remains: underwater floors, border fade/collision on Anarchy.

## Next work

After validation: push the feature, mark PR #100 ready, merge with a normal merge commit.

## Git

See the feature merge commit after this pass completes.
