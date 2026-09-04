# Online Networking V2 Integration

**Date:** 2026-09-04  
**Status:** in progress (Phase 2 complete)  
**Integration branch:** `cursor/online-networking-v2-integrated-3ff8`  
**PR:** TBD (draft until two-client QA)

## 1. Real SHAs used

| Role | Branch | SHA | Notes |
|---|---|---|---|
| BASE | `cursor/online-networking-v2-3ff8` | `1f5aafe93b699ee0e77fa4ecfa5eaed4c4070ed5` | Matches known audit SHA. HEAD unchanged. Draft PR #40. |
| DONOR | `codex/online-command-pipeline-v2` | `aa2ae9e625bacf704a7f0f64c2e5689966e1a3d4` | Matches known audit SHA. HEAD unchanged. |
| Merge-base | `cursor/remote-player-interpolation-86e1` | `ade7113122a9cdc5949ff34b10f19e17918285cb` | Donor sits on PR #38, **without** PR #39 live local aim. |
| Integration start | this branch | `1f5aafe` | Created from BASE HEAD. No main merge. |

BASE lineage: #39 local aim (`c5fba74`) → #38 remote interp (`ade7113`) → #37 prediction (`fd02b67`) → `main` `4d803e5`.

DONOR lineage: one commit `aa2ae9e` on `ade7113`. It does **not** contain FIFO, `ackCommandSeq` production identity, or `localAim.ts`.

## 2. Integration branch

`cursor/online-networking-v2-integrated-3ff8` off BASE `1f5aafe`. Existing BASE/DONOR branches are not rewritten.

## 3. Commits

| Commit | Phase |
|---|---|
| `d1effb6` | Phase 0 baseline / architecture comparison |
| `7a558f1` | Phase 1 strict block intent |
| Phase 2 | Bow lifecycle: explicit draw is not cancelled by stale `use:false` |

Later phases land as separate commits (bow, backlog, invariants, remote, session, diagnostics, regression).

## 4. Subsystem comparison

### Movement / ACK

| | BASE | DONOR | Winner |
|---|---|---|---|
| Command identity | `ackCommandSeq` = applied command | `appliedTicks[]` + latest-input sampling | **BASE** |
| Queue | FIFO one command / 20 TPS tick | Latest received packet each tick | **BASE** |
| Accepted ACK | no live mutation (`diffMotionFull === []`) | Replay extras from `appliedTicks` | **BASE** |
| `lastInputSeq` | highest received, not applied | mixed with applied identity | **BASE** |
| Burst / backlog | bound 32, silent `shift()` oldest | no FIFO backlog (latest-input) | BASE model + **new compaction** (Phase 3) |

Donor latest-input is **rejected** as production replacement. `appliedSteps` stay bounded DEV/scheduler trace (BASE already has max 4).

### Block intent

| | BASE | DONOR | Winner |
|---|---|---|---|
| Architecture | explicit A, never silent B | same | **BASE architecture** |
| `targetBlockId` | missing | required, stale reject | **DONOR validation** |
| Hit in voxel | not checked | `HIT_EPSILON=0.05` | **DONOR** |
| Face | numeric 0–5 | exact ±X/±Y/±Z unit axis | **DONOR** |
| LOS | first intercept vs XYZ | first intercept vs XYZ **and face** | **DONOR** |
| Action context vs commandSeq | monotonic actionSeq only | reject future/replay | **hybrid**: historical pose for commandSeq or reject (Phase 1) |

### Bow

| | BASE | DONOR | Winner |
|---|---|---|---|
| Aim capture | `localAim.ts` + `bow_release` yaw/pitch | captured look via `directionFromCapturedLook` | **BASE localAim** |
| Projectile spawn | `advanceUseHold` does not spawn on use-fall | same (explicit release) | both |
| Charge cancel | `use===false` **cancels draw** | same cancel path | **BUG in both** — Phase 2 |
| Spread | Online captured-aim still uses default spread | `spread=0` for captured-aim | **DONOR** for Online captured shots |
| Repeated shots | live QA: 1 fires, 2–6 miss, 7 fires | not proven better | **fix lifecycle**, do not assume donor |

Root cause of missing shots (BASE, confirmed in code): RAF `interact` can start `bowUseTicks` **before** FIFO applies `use:true`. Next physics tick may apply a **queued older command with `use:false`**, and `advanceUseHold` wipes charge. Later `bow_release` → `no-draw`.

### Remote interpolation

| | BASE (PR #38) | DONOR | Winner |
|---|---|---|---|
| Timeline | `serverTick` | `serverTick` | both |
| Buffer | max 8, delay 100 ms | max 12, delay = clamp(100+jitterP95, 80..180) | **DONOR model**, constants subject to side-by-side vs BASE smoothness |
| Extrap | ≤100 ms then freeze | ≤100 ms then hold | both |
| Recovery | none (hard) | blend ≤100 ms | **DONOR**, watch freeze-step / laggy rotation |
| Jitter | arrival-based | actual arrival Δ − expected tick Δ | **DONOR** |

Must not regress last BASE two-client test (smooth walk, no freeze-step). If adaptive delay causes freeze/glide/laggy yaw, adjust constants.

### Local aim

BASE `localAim.ts` / `localInteractionAim` **wins**. Donor does not have PR #39. Do not replace.

### Session / reconnect

BASE already: one live `connectionId`, `resetConnectionInput`, hidden-tab idle. Keep. Harden in Phase 6 if tests show correction storms.

## 5. What came from BASE

- PlayerCommand, commandSeq, clientTick, FIFO queue, ackCommandSeq
- history[ackCommandSeq] compare, accepted ACK = no live mutation
- Explicit sequenced actions (actionSeq ≠ commandSeq)
- localAim / localInteractionAim
- Mining locked to break_start target
- PROTOCOL_VERSION 2 join gate (will bump if semantics change)
- Persistence / one logical player / WebSocket

## 6. What came from DONOR (planned)

- `targetBlockId` + stale reject
- Hit-in-voxel, strict face, LOS+face
- Adaptive remote buffer (Phase 5), after side-by-side
- Online captured-aim arrow `spread=0`
- Action validation tests (A vs B, stale ID, wrong face, invalid hit)
- DEV appliedSteps as scheduler trace only

## 7. What was rejected from DONOR

- latest-input / appliedTicks as production ACK identity
- Replacing localAim
- Dropping FIFO
- Treating `lastInputSeq` as applied command
- Magic retry / auto-resend of bow_release
- Huge remote delay / infinite extrapolation

## 8. Final movement contract (locked)

```
LIVE CLIENT STATE
  = AUTHORITATIVE SERVER CHECKPOINT at ackCommandSeq
  + TRULY PENDING CLIENT COMMANDS (seq > ack, not compacted/skipped)
```

- `ackCommandSeq` = command actually represented by server checkpoint.
- `lastInputSeq` = highest received packet, **not** applied.
- Accepted ACK: `diffMotionFull(before, after) === []`.
- Correction: restore snapshot + replay only truly pending.
- After resync/reconnect/compaction, invariant must hold again.

## 9. Backlog policy (Phase 3)

FIFO one command / server tick is correct. Burst creates backlog.

**Forbidden:** infinite queue, player speed-up, multiple normal physics ticks per world tick, silent drop, fake ACK.

**Allowed:** bounded compaction of **continuous-state only** (WASD/look). Must **not** drop jump edge, use press/release, mining lifecycle, selectedSlot, flight, vehicle.

If a range is skipped: protocol must say so (`queueCompacted` / `droppedCommandRange`). Client discards skipped, replays remaining.

Current BASE silent `queue.shift()` on overflow is **not** acceptable and will be replaced.

## 10. Reconciliation invariant

After every ACK:

**CASE A accepted:** checkpoint + pending == live PlayerController, and ACK itself mutates nothing.

**CASE B correction:** restore + replay pending == live predicted state.

`inspect.kind === 'accepted'` is **not** sufficient proof.

## 11. Block contract

Client sends: targetXYZ, **targetBlockId**, face, hit, actionSeq, commandSeq, selectedSlot.

Server: ACCEPT A or REJECT A. Never execute B.

If historical pose for `commandSeq` is unavailable: REJECT, do not substitute current look.

**Phase 1 implemented:** `PROTOCOL_VERSION = 3`. `BlockTargetIntent.targetBlockId` is required on captured targeted actions. Validation: exact ±X/±Y/±Z face, hit inside voxel (`HIT_EPSILON=0.05`), current block id match, LOS first intercept must match XYZ **and face**. Action eye comes from `actionPoseHistory[commandSeq]` (pending gap ≤ 32 uses current pose because later look is not yet simulated). Incomplete captured fields reject; intent-less `place_block`/`break_block` still use lookHit for legacy tests/SP-like paths. Mining finish reuses `miningIntent` from `break_start`. Movement / FIFO / ACK unchanged.

## 12. Bow lifecycle (Phase 2 target)

```
RMB press → usePressed → draw started (server)
→ RMB release → useReleased → bow_release sent
→ server receive → validate charge/ammo → spawn with release aim
→ client action_result
```

Once draw is started by explicit interact, **do not cancel** from stale movement `use:false`. Cancel on: bow_release, item/slot change, death, explicit abort.

**Phase 2 implemented:** `advanceUseHold` keeps charging while the held item is still a bow. Stale FIFO `use:false` no longer wipes an explicit interact draw. Captured-aim Online arrows spawn with spread 0. F3 bow line reports press/draw/release/sent/result/spawn. Tests cover 20 consecutive draw→release cycles, FIFO use:false after interact, captured aim after a look flick, no-draw/charge/duplicate/ammo.

No magic retry. Diagnostics must name the failed stage.

## 13–16. Remote / reconnect / diagnostics

See comparison above. F3 must answer movement/block/bow/remote questions without unbounded logs.

## 17. Tests

Baseline (this phase) records current BASE test results on the integration branch before any code change.

Required new tests (later phases): live-state invariant after ACK; burst 50/100/200/300 ms; A vs B / stale ID / wrong face; bow 20× draw-release; remote jitter/underflow/recovery.

## 18. Live QA

Not yet. PR stays draft until two-client QA:

- Local A: no false corrections, no 1–2 block teleports
- Remote B: smooth, no freeze-step, no infinite glide
- Blocks: A or reject, never B
- Bow: release aim A survives camera B; ≥20 consecutive draw→release

## 19. Baseline failures

Recorded in Phase 0 test run (next section of this file after `npm test` / targeted suites).

## 20. Remaining issues

- Bow missing-shots (code-confirmed, fix in Phase 2)
- Silent FIFO overflow drop (Phase 3)
- No live-state invariant test yet (Phase 4)
- Remote still max-8 / fixed 100 ms until Phase 5
- Attack/pickup still lack full captured-aim payloads (deferred unless blocking)
- Two-client live QA not yet run
