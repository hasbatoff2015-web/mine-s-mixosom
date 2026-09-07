# Six gameplay and Online regression fixes

## Goal

Fix six regressions on current `main`: cobweb jumping, missing Online TNT fuse pulse, stale fall distance after low-ceiling jumps, one-sided Claims PvP, missing Online bow-use slowdown, and broken Online food/potion lifecycle. Preserve protocol 3, fixed 20 TPS, authoritative Online gameplay, captured bow aim, player-arrow attribution/FireArrow pickup, FIFO/ACK/reconciliation, mining and remote presentation.

## Base

- Branch: `codex/fix-gameplay-bugs-2026-09-07`.
- Base and tracked `origin/main`: `bf2ed08d80fbdad315e13f9ca7051962ad0906fa`.
- No commit, push, PR, rebase or protocol bump.

## Result

All six requested behaviors are implemented in the existing systems. Each root was first represented by a failing focused regression, then fixed without parallel physics, damage, TNT, inventory or networking paths. The focused changed/neighbor suite passes 156/156. TypeScript client/server/shared boundaries pass. The only full-server failure is the pre-existing CPU-sensitive 80 ms `tick-load-flight` gate; the full repository suite also exposed unrelated timeout/transform failures described below rather than hiding them.

## Implemented

### 1. Cobweb jump

- `PlayerController` applies a strong vertical velocity multiplier while inside cobweb, outside flight/fluid handling.
- A grounded jump cannot install normal `JUMP_VELOCITY` while webbed.
- Existing horizontal cobweb slowdown remains the canonical path.
- Removing the web restores ordinary jump behavior.

### 2. Online TNT pulse

- `RedstoneSystem.interpolatePrimedTnt` now calls the existing host pulse function using authoritative fuse elapsed/urgency.
- Position and lighting continue through the existing render interpolation.
- Network-owned TNT is not locally ticked or detonated; snapshot disappearance still disposes the visual.

### 3. Low-ceiling fall distance

- Landing completion now follows final `onGround` support, including the support probe path, rather than requiring only the narrow `landed` collision edge.
- Supported ticks clear accumulated fall distance; a real accumulated fall still computes and reports damage before reset.

### 4. Claims attacker and victim PvP

- `player-damage` still applies on the victim claim first.
- When `attackerId` resolves to an actual server player, both attacker and victim claims must allow `pvp`.
- Wilderness on either side introduces no extra denial.
- Missing/unknown attackers for melee/arrow/projectile continue to use victim-side `mob-damage`.
- The rule is shared by actual melee, Arrow and FireArrow server damage events.

### 5. Online bow/sword movement

- Added Node-safe `movementDuringItemUse`, shared by SP, Online prediction and authoritative server simulation.
- Active bow/sword use scales horizontal movement to `0.2`, disables sprint and fly-sprint, and keeps the remaining movement flags stable.
- Online sends raw intent and applies the transform only for local prediction; the server independently applies it once from its authoritative selected item/use state.
- Release returns immediately to ordinary speed and sprint eligibility.

### 6. Online food and potions

- The server validates the action's selected hotbar slot against its command timeline and reads the item from server inventory.
- Use start records command sequence, slot and item identity. Older queued `use:false` packets cannot cancel that later action.
- A current release, slot switch, item replacement, death or reconnect cancels without consumption.
- At 32 ticks the server consumes exactly one captured item, applies nutrition/effects, sends inventory state and returns potion bottles. If no inventory space exists, the bottle becomes an authoritative world drop.
- The client starts local eat/drink presentation immediately but never changes inventory/effects. It cancels/reconciles from release, action reject, authoritative inventory/snapshot, slot switch and respawn.
- Bow release remains a separate captured action and is not destroyed by the input-release packet racing ahead of it.

## Changed files

- `src/player/PlayerController.ts`
- `src/redstone/RedstoneSystem.ts`
- `src/gameplay/useMovement.ts`
- `src/gameplay/index.ts`
- `src/core/Game.ts`
- `server/playerCommandQueue.ts`
- `server/AnarchyServer.ts`
- `server/WorldInstance.ts`
- `server/gameplay.ts`
- `server/builtin-plugins/claims.ts`
- focused tests under `tests/` and `tests/server/`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Tests

New/expanded regression coverage includes:

- webbed jump suppression, vertical damping and post-web recovery;
- repeated low-ceiling jumps, ground-support reset and preservation of real fall damage;
- Online TNT pulse, interpolation, authoritative fuse preservation, no client explosion and snapshot removal;
- full attacker/victim wilderness / `pvp=true` / `pvp=false` matrix;
- actual melee and actual Arrow/FireArrow safe-to-wilderness attacks plus mob projectile routing;
- exact Online prediction/server movement lockstep while drawing and after release;
- stale FIFO release immunity, current release and slot-switch cancel, captured slot validation;
- Apple, GoldenApple, regeneration and invisibility potions, effects, returned bottles and full-inventory overflow;
- death/reconnect cleanup and 20 repeated bow draw/release cycles.

Executed validation:

- focused changed and neighboring suites: 8 files, 156/156 PASS;
- `npm run typecheck`: PASS;
- `npm run typecheck:client`: PASS;
- `npm run typecheck:server`: PASS;
- `npm run typecheck:sim`: PASS;
- `npm run check:boundaries`: PASS;
- `npm run test:server -- --maxWorkers=2`: 259/260 PASS; only `tick-load-flight` failed the 80 ms maximum;
- isolated `tick-load-flight`: 2/3 PASS, same maximum-latency failure on all retries (roughly 108–151 ms);
- `npm test -- --maxWorkers=2`: 175 files passed, 5 failed; 1770 tests passed, 16 failed, plus one worker RPC timeout under a 342-second heavily loaded run;
- isolated updated `shield-removal`: 6/6 PASS;
- isolated `minecraft-reference-extractor.test.mjs`: still fails in Vitest with a line-6 parse error although `node --check` passes for the test and imported script.

The full-suite failures not owned by this change were not masked or converted to skips: the known tick latency gate; 5-second timeouts in `worldgen-terrain` and `fire-contact-sunlight-minecart`; and the reference-extractor Vitest parse failure. The shield source-contract assertion was legitimately updated for the new shared movement helper and passes in isolation.

## Visual QA

Manual two-client/browser QA was not performed. Automated server tests use real players, action queues, gameplay ticks, damage events, inventory mutation, projectile types and entity presentation hosts; they are not reported as visual acceptance.

## Performance

The fixes add constant-time checks per player/use tick and one existing pulse call per rendered TNT. No new scan, unbounded queue, remesh, world generation, protocol payload or simulation frequency was introduced. The environment-sensitive `tick-load-flight` failure reproduced outside the changed gameplay suites; its threshold was not relaxed.

## Known issues

- Owner-visible two-client acceptance remains open for the six scenarios.
- `tick-load-flight` does not meet 80 ms on this host.
- The repository-wide suite has unrelated slow-host 5-second timeouts and a Vitest parse issue in the Minecraft reference extractor.

## Deferred

- Performance investigation or test-infrastructure changes for the unrelated full-suite failures.
- Any new consumables, protocol revision, client-side authority, second input queue or expanded Claims system.

## Next work

Run the owner two-client checklist. If accepted, review and commit/push only on explicit request.

## Git

- Branch: `codex/fix-gameplay-bugs-2026-09-07`.
- Base: `bf2ed08d80fbdad315e13f9ca7051962ad0906fa`.
- Commit: none.
- Push/PR: none.
