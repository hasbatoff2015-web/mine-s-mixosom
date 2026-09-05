# Remote player action presentation v2

## Goal

Deliver server-authoritative remote mining, held item, hand actions, crack stages and existing bow/use poses on top of networking v2. Work started 2026-09-05 and finished 2026-09-06 local time. No main merge or movement rewrite.

## Result

The missing server → protocol → remote visual path is implemented. Deterministic tests and a two-WebSocket wire test pass. Full suite adds **26 passing tests with exactly the same 16 failed test names and failed extractor suite as the measured baseline**. Complete manual two-interactive-client acceptance remains open; see Visual QA.

## Root cause

- `ServerPlayer` already owned normalized mining and use timers, but `remoteInfo()` only exposed position/look.
- `PlayerSnapshot` had no grouped presentation payload or authoritative selected held-item identity.
- `RemotePlayerView` supplied `mining: false`, `bowCharge: 0`, `foodUseProgress: 0`, `swordBlocking: false` to the existing animator.
- `WorldRenderer` owned one local crack mesh. There was no remote breaker ownership or shared-target arbitration.
- Ingress `lastActionSeq` is advanced before final gameplay validation. It cannot safely act as a successful presentation event counter.

## Implemented

### Protocol and authoritative sources

`PlayerPresentationState` is optional on both `RemotePlayerInfo` and `PlayerSnapshot`; new servers always publish it. Additive server output keeps `PROTOCOL_VERSION = 3`. Missing state has an explicit neutral fallback.

| Field | Authoritative source |
|---|---|
| `mining` or null | `ServerPlayer.miningTarget`, connected/alive state |
| `mining.x/y/z/blockId` | Validated `beginMining()` hit; block ID captured with target |
| `mining.progress` | Existing `miningProgress` accumulator; `miningProgressPerTick(block hardness, held tool)` |
| `heldItemId` or null | Authoritative `inventory.getSlot(selectedSlot)?.itemId` |
| `bowCharge` | Existing `combat.bowCharge(bowUseTicks).power`, gated by selected bow |
| `foodUseProgress` | `foodUseTicks / 32`, clamped and gated by selected food |
| `swordBlocking` | Server `CombatSystem.swordBlocking`, gated by connected/alive |
| `swingSeq` | Separate private server counter, incremented by accepted gameplay effects |

No inventory contents, animation frames, action history, textures or client-reported mining progress are replicated. Existing player snapshots carry the new payload.

### One-shot semantics

- Accepted attack attempts swing, including a valid miss, damage immunity or later cancelled damage. This is an attempt animation, not a hit-success claim. Dead/disconnected attacks do not animate.
- Successful placement and interactive use reuse existing `UseHostEffects.swing`; successful container open, bed use and ignition have explicit hooks. Failed/no-op use and plugin-cancelled placement do not increment the counter merely because `useHeld()` returns `ok`.
- Successful block break (including instant Creative) and actual authoritative arrow spawn increment once. Rejected draw/release/ammo paths do not.
- Observer sees a greater `swingSeq` → one `PlayerVisual.swing()` call. Same counter, repeated tick and late ticks produce none. Join/reset establishes a baseline rather than replaying previous actions. Counter survives live resume on the server.
- Multiple actions between snapshots coalesce visually to one swing when the newer counter arrives. There is no historical replay queue.

### Remote avatar and cracks

Latest received action state has its own tick guard and arrival timestamp in `RemotePlayerView`; discrete fields never enter spatial lerp. Existing `PlayerVisual.setHeldItem`, `swing`, and animator state receive the authoritative values. No second animator.

`WorldRenderer.remoteBreaking` owns breaker-ID entries; render-frame reconciliation groups by target XYZ and takes maximum progress. Each visible loaded target has one canonical `BlockBreakingOverlay`, sharing the existing stage textures. The overlay uses the existing stage mapping; active progress zero maps to stage 0 using a minimal positive presentation value. Local stage mapping remains unchanged.

Two remote players on different blocks get independent meshes. Two on the same block get max stage, never a sum. Local/remote same-target overlap also draws one mesh: local wins ties; stronger remote progress temporarily hides the local group without overwriting local target/progress. Local resumes immediately when remote wins no longer apply.

### Cleanup and architecture decisions

- Authoritative committed voxel replacement clears all matching server mining targets. `advanceMining` additionally guards captured block ID. This prevents progressing on a replacement block and publishing stale progress.
- Client block updates/batches invalidate matching remote overlays, including replacement with the same ID; normal snapshot null removes abort/finish/death/respawn state.
- Target switch drops the old target on the next render before drawing; player removal/disconnect disposes owned resources; view reset and renderer disposal cover reconnect/session replacement.
- Missing/unloaded voxel removes a breaker; a loaded chunk without a rendered chunk mesh has no remote crack mesh. Safety timeout is **1500 ms**, never a progress timer. Continuous avatar actions also expire.
- Mesh/material/geometry are disposed when the last breaker leaves the target. Fixed a small existing initial empty-geometry leak in canonical `BlockBreakingOverlay` when assigning its first real shape.
- Snapshot ingest stores entries; grouping runs once per render frame, avoiding N² work across one multi-player snapshot.

## Changed files

- `shared/playerPresentation.ts`, `shared/protocol.ts` — grouped contract and fallback.
- `server/WorldInstance.ts`, `server/gameplay.ts` — authoritative publication, successful effects, target identity/cleanup.
- `src/net/RemotePlayerView.ts` — latest action state, held items, dedupe, stale fallback.
- `src/rendering/RemoteBreakingOverlays.ts`, `WorldRenderer.ts`, `BlockBreakingOverlay.ts` — ownership, arbitration, disposal.
- `src/core/Game.ts` — full remote info type, render ownership callbacks, block invalidation, actual join arrival time.
- Three new action/overlay/server suites and one live wire test in `tests/server/anarchy-server.test.ts`.
- `docs/PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `TESTING.md`, this report.

## Movement regression

No changes to `PlayerCommand`, `PlayerCommandQueue`, FIFO application, `commandSeq`, `ackCommandSeq`, prediction/reconciliation, `remotePlayerInterpolation.ts`, adaptive delay, local aim capture or bow projectile direction. `Game.ts` changes only wire presentation ownership/callbacks. Gameplay remains 20 TPS; animation remains render-frame driven. Singleplayer mining calculation and local crack progress contract are unchanged.

## Tests

| Command/check | Actual result |
|---|---|
| Baseline `npm test -- --maxWorkers=2` at exact base, before existing-code edits | 149/154 files passed; **1507 passed / 16 failed / 1523**; one worker RPC error; 296.35 s |
| Existing action/view/local overlay regression pack | **27/27**, 3 files |
| New server/client/overlay + existing wire suite | **53/53**, 4 files |
| `typecheck`, `typecheck:client`, `typecheck:server`, `typecheck:sim` | PASS |
| `check:boundaries` | PASS, shared sim and server stay Node-safe |
| `test:sim` | **42/42** |
| `test:server` default worker concurrency during browser QA | **118/121**, 3 timing failures (store 5s timeout, tick latency 53.94ms > 50, setView 256.08ms > 80) |
| `test:server -- --maxWorkers=2`, browsers/server stopped | **120/121**; existing setView budget 100.74ms > 80 |
| Final `npm test -- --maxWorkers=2` without live browser/server | 152/157 files passed; **1533 passed / 16 failed / 1549**; one worker RPC error; 271.20 s |
| `smoke:sim`, `smoke:server` | PASS |
| `build`, `check:size`, `check:archive` | PASS; **3.97 MiB / 284 files** |
| `git diff --check` | PASS |

Full-suite failed-name comparison (`Compare-Object`) is empty: all 16 failed test names match baseline exactly. Failures: 12 fire/sunlight/minecart 5s timeouts, 2 worldgen 5s timeouts, pre-existing GeneratedItemGeometry source fingerprint, server setView timing threshold. The separate `minecraft-reference-extractor.test.mjs` parse failure and Vitest `onTaskUpdate` RPC timeout also exist in both runs. No unrelated assertion, threshold or timeout was relaxed.

Networking suites in the full run cover prediction invariants, FIFO/ACK, adaptive interpolation, block intent/targetBlockId, captured bow aim, reconnect and hidden-tab behavior. All new tests pass in the full run as well.

## Visual QA

Two interactive in-app Chromium clients were opened on localhost and 127.0.0.1 with separate origin storage. Both joined Anarchy. Observer diagnostics showed approximately **180 FPS**, **20 snapshots/s**, `corr/s=0` while stationary and remote adaptive interpolation active. Movement to a controlled position via the ordinary `/tp` command was accepted. HMR interrupted that run; later those tabs became unavailable. This does **not** establish the full manual mining/bow checklist.

Additional automated live visual checks use a disposable server fixture and a real WebSocket actor sending normal input, validated mining intents and bow/use requests into the production server. Only fixture terrain/spawn/inventory are prepared administratively; mining progress is never injected. Observer uses the ordinary game client and renderer. Local-only fixture: `.local/remote-action-live-qa.ts`; screenshots: `.qa-screens/remote-action-v2/`. These are ignored QA artifacts, not shipped gameplay code.

Observed and saved in the real game renderer:

- `mining.png`: remote diamond pickaxe and cracks on the exact obsidian target; standard texture overlay is visible.
- `mining-second.png`: a subsequent mining cycle shows a raised arm/held-tool pose and cracks, compared with the idle arm in the other captures.
- `finished.png`: the authoritative target voxel and cracks are gone after completion; dropped item is present.
- `bow.png`: both arms in the drawn-bow pose; actor's received server snapshot records `heldItemId: bow`, `bowCharge: 1`.
- `bow-release.png`: arms return to idle with bow still held; server wire log confirms accepted `bow_release` with captured `yaw: 0`, `pitch: -0.06`.

These are **automated live actor + visually inspected browser observer**, not two humans holding controls. The complete continuous 0→9 stage sequence, exact one-shot count, abort timing, moving-miner, food, simultaneous breakers and disconnect visuals were not all independently accepted in this live pass. Deterministic tests cover their data/cleanup contracts. The attempted live abort landed after the fast diamond-pickaxe break had already completed; it is not reported as a passed abort test. The fixture primes the ordinary held-mining input before sending break-start so FIFO state is already active.

## Performance

No new WebSocket message types or per-frame network traffic. One small current presentation object per existing player snapshot. Mesh count is bounded by known active breakers with visible loaded targets and reduced by shared-target coalescing. Geometry and textures are reused across stages; no stage-driven chunk remesh. Stale/resource tests verify cleanup. No claim of a 300-player load benchmark.

## Known issues / Deferred

- Full manual two-interactive-client checklist remains an owner acceptance gate, especially mining while moving, repeated bow releases and exact one-shot visual timing.
- Existing full-suite failures above remain.
- Presentation uses the latest authoritative packet; it can lead the spatially delayed avatar by the interpolation delay. No crack prediction or extrapolated progress is introduced.
- Same-snapshot rapid one-shots coalesce to one visible swing; no action history queue.
- Default remote skin remains the existing appearance fallback; this task does not add skin replication.

## Next work

Run the manual checklist from the task on two desktop clients, then decide whether to merge this feature branch into its networking base. Do not merge main automatically.

## Git

- Initial checkout was clean `main`; `git fetch --all --prune` completed.
- Actual base branch: `origin/cursor/online-networking-v2-integrated-3ff8`.
- Actual base SHA: **`e5c77f334fa46b726372fb7d7d27283f213ea184`**, matching the requested audited SHA after fetch.
- Working branch: **`codex/remote-action-presentation-v2`**.
- No main merge, reset, history rewrite, forced push, source branch removal, or git configuration changes.
- Commit/push are explicitly authorized by task section 31; final commit SHA is returned in the delivery response (a commit cannot embed its own SHA).
