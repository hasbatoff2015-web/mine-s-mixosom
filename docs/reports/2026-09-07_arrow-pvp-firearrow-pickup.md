# Online arrow PvP attribution and FireArrow pickup

## Goal

Fix authoritative Online Anarchy player-arrow damage routing and preserve FireArrow identity through embedded projectile pickup on current `main`, without changing protocol 3, client authority, captured bow aim, remote presentation, mining, or Claims architecture.

## Base

- Branch: `codex/fix-arrow-pvp-firearrow`.
- Starting local branch/HEAD before fetch: `main` at `aa0ee07403874fc72e483f53c2b1db176d33b649`; worktree clean and 43 commits behind.
- Fetched `origin/main`: `bb203aebc0568fe2f46f8dc36e63bd7b5463f63b` (merge PR #63), matching the supplied audit reference.
- Working branch created directly from that fetched `origin/main`.
- No commit or push performed.

## Result

Player-created arrows retain their shooter identity through authoritative swept collision and both plugin damage events. Claims now evaluates those arrows as PvP. Ownerless mob projectile events are unchanged and remain governed by `mob-damage`. Embedded flaming arrows return `FireArrow`; normal arrows return `Arrow`; Creative/full-inventory/exactly-once semantics are preserved.

## PvP reproduction

### No claim

Before the fix, an actual server bow release from Survival A hit Survival B and reduced B's health. This proved target filtering, authoritative AABB, swept collision, callback execution, `hurtPlayer`, and `SurvivalSystem.damage` were functional. The regression failed because both `playerDamage.attackerId` and `playerDamaged.attackerId` were absent.

### Claims routing

Before the fix:

- `pvp=true`, `mob-damage=false`, `player-damage=true`: player arrow damage was cancelled.
- `pvp=false`, `mob-damage=true`, `player-damage=true`: player arrow damage was accepted.

After the fix both outcomes reverse to the intended player-PvP semantics. A separate ownerless projectile event still follows `mob-damage`, proving the change does not classify all projectiles as PvP.

## PvP root cause

- File: `src/combat/PlayerArrowManager.ts`, `PlayerArrowManager.tick` player collision branch.
- File: `server/gameplay.ts`, `ServerGameplay.tick` projectile callback.
- Old behavior: `PlayerArrow.ownerId` existed and bow spawn set it, but `onPlayerHit` exposed only victim, damage, flaming state, and position. `hurtPlayer` therefore received no `attackerId`.
- Why damage was rejected: Claims treats an incoming melee/arrow/projectile without `attackerId` as mob damage. A player arrow in `pvp=true + mob-damage=false` was cancelled as if fired by a mob; the inverse configuration could incorrectly allow it.
- New behavior: `onPlayerHit` carries optional `attackerId=arrow.ownerId`; server passes it to the existing `hurtPlayer` extras. `playerDamage` and `playerDamaged` both retain the shooter id.
- The lost-`attackerId` hypothesis was confirmed. No-claim health damage already worked; Claims classification and plugin attribution were the broken layer.

## FireArrow root cause

- File/function: `src/combat/PlayerArrowManager.ts`, `PlayerArrowManager.tryCollect`.
- Old: every successful Survival pickup called `addItem(ItemId.Arrow, 1)`.
- New: `arrow.flaming ? ItemId.FireArrow : ItemId.Arrow` is passed to the same `addItem` callback.
- `flaming` remains the single authoritative projectile identity. No ammo field, UI counter, or network packet was added.

## Implemented

- Extended existing `ArrowTickOptions.onPlayerHit` with optional player attacker id.
- Forwarded each colliding arrow's existing `ownerId`.
- Passed that id to the existing `ServerGameplay.hurtPlayer` call.
- Selected pickup item from the existing `flaming` bit.
- Preserved `presentSwing()`, captured yaw/pitch, command/action sequencing, target list, collision ordering, hurt resistance, armor, Creative immunity, Claims cancellation and authoritative inventory sync.

## Changed files

- `src/combat/PlayerArrowManager.ts`
- `server/gameplay.ts`
- `tests/fire-arrow-and-fire.test.ts`
- `tests/server/anarchy-gameplay.test.ts`
- `tests/server/anarchy-plugins.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/reports/2026-09-07_arrow-pvp-firearrow-pickup.md`

## Tests added

- Actual server bow shot damages a Survival player outside Claims and emits matching shooter id in `playerDamage`/`playerDamaged` exactly once.
- Shooter exclusion plus off-axis miss.
- Wall before player blocks damage and embeds the projectile.
- Player before wall takes damage and removes the projectile.
- Creative victim is absent from server projectile targets.
- FireArrow deals direct damage, ignites, and retains shooter attribution.
- End-to-end FireArrow: ammo consumption → flaming server projectile → wall embed → FireArrow pickup → authoritative inventory packet; Arrow stays unchanged.
- Claims `pvp=true + mob-damage=false` allows a player arrow.
- Claims `pvp=false + mob-damage=true` cancels a player arrow.
- Ownerless projectile follows `mob-damage`, not `pvp`.
- Normal/Fire arrow pickup identity, full FireArrow inventory retention, exactly-once pickup, and Creative removal-only.

## Commands run

- `git status`, `git branch --show-current`, `git rev-parse HEAD`.
- `git fetch origin --prune`, `git rev-parse origin/main`, `git log origin/main --oneline -15`.
- Pre-fix targeted Vitest runs for the added pickup, gameplay, and Claims cases.
- Post-fix targeted added cases: 13/13 PASS.
- `npx vitest run tests/arrow-physics.test.ts tests/fire-arrow-and-fire.test.ts tests/classic-combat-integration.test.ts tests/server/anarchy-gameplay.test.ts tests/server/anarchy-plugins.test.ts tests/server/claims.test.ts --maxWorkers=2`: 6 files, 96/96 PASS.
- `npx vitest run tests/online-networking-v2-contract.test.ts tests/remote-breaking-overlays.test.ts tests/remote-action-presentation.test.ts tests/remote-player-interpolation.test.ts tests/remote-player-view.test.ts --maxWorkers=2`: 5 files, 64/64 PASS.
- `npm run typecheck`: PASS.
- `npm run typecheck:sim`: PASS.
- `npm run typecheck:client`: PASS.
- `npm run typecheck:server`: PASS.
- `npm run check:boundaries`: PASS.
- `npm run build`: PASS; 227 modules, existing `/sdk.js` and chunk-size warnings only.
- `npm run test:server -- --maxWorkers=2`: 23/24 files and 238/239 tests PASS; `tick-load-flight` failed its max-latency threshold.
- `npx vitest run tests/server/tick-load-flight.test.ts --maxWorkers=1 --reporter=verbose`: 2/3 PASS; the same max-latency case failed all retries at 106–112 ms vs 80 ms.
- `git diff --check`.

## Visual QA

Manual two-client browser QA: not performed.

Automated tests used two authoritative `ServerPlayer` instances and real server ticks, including a real bow release, plugin-enabled Claims, authoritative block/player collision ordering, FireArrow ignition, pickup, and inventory packets. This is not represented as manual visual acceptance.

## Performance

Production change adds only one optional callback argument and one pickup item-id branch. No meshing, world generation, tick scheduling, protocol, interpolation, or networking loop changed.

The full server run exposed the known environment-sensitive `tick-load-flight` threshold failure. It reproduced in isolation and is unrelated to the changed combat/pickup files; no threshold was relaxed.

## Known issues / remaining risks

- Manual two-client QA remains: wilderness Arrow/FireArrow, wall occlusion, visible fire, FireArrow counter, and both Claims flag combinations.
- `tick-load-flight` max-latency threshold currently fails on this machine; it is not fixed or hidden in this task.
- No full `npm test` / `npm run check` was claimed; required focused suites, all typechecks, boundaries, full server gate, remote-presentation contracts, and build were run.

## Deferred

- Native two-desktop visual/gameplay acceptance.
- Any performance investigation of `tick-load-flight`; out of scope for this localized projectile fix.

## Next work

Owner two-client QA, then review/commit/push only if explicitly requested.

## Git

- Branch: `codex/fix-arrow-pvp-firearrow`.
- Base: `bb203aebc0568fe2f46f8dc36e63bd7b5463f63b`.
- Commit: none (not requested).
- Push/PR: none (not requested).
