# Melee PvP receive-time rewind regression

Date: 2026-09-09

## Goal

Fix the melee PvP lag-compensation regression where a receive-time-valid target render tick became stale only because its sequenced attack waited several server ticks for the attacker's authoritative `commandSeq`. Keep bow behavior, reach, hitboxes, damage authority and the five-tick rewind security window unchanged.

## Result

Root cause was reproduced and fixed. Before the change, both stationary and moving-target backlog regressions left victim health at 20 because `rewindCombatPose(..., this.tickNumber)` ran only after FIFO dequeue and counted queue wait against `MAX_PVP_REWIND_TICKS`. After the change, target history is validated and frozen at packet receipt; a four-tick attacker command backlog produces a server-authoritative hit.

## Implemented

- Added server-owned `PendingMeleeAttack` envelopes containing the immutable client action, `receivedServerTick` and an optional resolved target record.
- At packet receipt, paired `targetId + targetRenderTick` is resolved through the server player map and `rewindCombatPose` relative to `receivedServerTick`.
- Future ticks, ticks older than five at receipt, unavailable history, self/dead/disconnected/non-survival targets and dead historical poses are rejected before entering pending state.
- The envelope stores `RewoundCombatPose`; no client AABB, distance or hit result is accepted.
- Execution resolves the attacker only from the exact authoritative command-boundary and reuses the saved target pose without a second rewind.
- Execution rechecks current attacker pose/slot and current target existence, connection, death and survival mode before entering the existing server raycast/reach/LOS/claims/damage path.
- Added independent `MAX_PENDING_MELEE_TICKS = 8`; attacks waiting longer return `pending_timeout`. The existing queue count cap remains 32.
- Added `receivedServerTick` and `pendingTicks` to combat diagnostics and the F3 melee line.

## Changed files

- `server/WorldInstance.ts`
- `server/combatPoseHistory.ts`
- `shared/playerActions.ts`
- `src/core/Game.ts`
- `tests/server/melee-lag-compensation.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`
- `docs/reports/2026-09-09_melee-pvp-receive-time-rewind.md`

## Architecture decisions

- Target validation time and attacker resolution time are deliberately separate. `MAX_PVP_REWIND_TICKS = 5` is consumed only by visual/history age at receipt, never by server FIFO delay.
- Pending lifetime is a separate availability bound, not an expansion or reinterpretation of lag compensation.
- Historical AABB ownership stays server-side. The saved pose is already cloned/interpolated from bounded authoritative history, so history eviction during command wait cannot mutate it.
- Reach remains 3 blocks, current-world voxel LOS is checked at execution, and all Claims/plugin/damage/HurtResistance behavior stays on the existing path.

## Tests

Red/green proof:

- Added stationary and moving-target queue-backlog regressions first; both failed before the implementation because health remained 20.
- The same regressions pass after receive-time capture, including a four-tick pending delay and a current moving-target AABB that the authoritative attack ray does not intersect.

Focused:

```text
npx vitest run tests/melee-action-intent.test.ts tests/remote-action-presentation.test.ts tests/combat-pose-history.test.ts tests/server/melee-lag-compensation.test.ts --maxWorkers=2
```

Result: 4 files, 27 tests PASS.

Broad melee/network/prediction/claims selection: 23 files, 362 tests PASS. Coverage includes gameplay combat, Anarchy/plugin melee, action protocol, claims and anchors, remote interpolation, command queues, local prediction and network recovery.

A filename audit then found five additional network/claim regression files (`claim-anchor-textures`, farming networking, player armor networking, entity visual events and block-state respawn): 5 files, 28 tests PASS.

A content audit found melee assertions inside six general presentation/entity/UI suites, including `server/remote-presentation`: 6 files, 82 tests PASS. Across the focused, broad and audited selections, 38 unique files and 499 tests PASS.

```text
npm run test:sim -- --maxWorkers=2
```

Result: 9 files, 42 tests PASS.

All four TypeScript checks PASS:

- `npm run typecheck`
- `npm run typecheck:sim`
- `npm run typecheck:client`
- `npm run typecheck:server`

Also PASS:

- `npm run check:boundaries`
- `npm run build`
- `git diff --check`

## Visual QA

No browser visual change was required. F3 output was extended to show `recv=<server tick>` and `pending=<ticks>` beside the existing melee classification. Owner two-client live QA remains the final external check.

## Performance

Each hinted melee attempt performs the same bounded history lookup earlier and retains one small cloned/interpolated AABB only while pending. Memory is bounded by 32 pending attacks per player and the independent eight-tick lifetime. No per-render-frame or bow path was changed.

## Known issues

- Automated regressions reproduce the reported timing, but owner live two-client QA has not yet been performed after this patch.
- `pending_timeout` uses the existing action reject reason `stale` at the protocol level; the combat diagnostic carries the precise classification.

## Deferred

- Bow work is explicitly out of scope and unchanged.
- No rewind expansion, hitbox inflation, reach increase or client-authoritative hit logic was added.

## Next work

Run two Anarchy clients: repeat stationary sword hits, then test a moving target and an induced input backlog. Use F3 `receivedServerTick`/`pendingTicks` to distinguish hits, immunity, stale receive data and pending timeouts. Do not begin bow changes as part of this task.

## Git

- Branch: `codex/pvp-hit-registration-v2`
- Base HEAD: `93eff65 fix: align melee pvp hits with client timeline`
- Changes intentionally remain uncommitted and unpushed per user request.
