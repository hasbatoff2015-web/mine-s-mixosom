# Online Networking V2 Integration

**Date:** 2026-09-04  
**Status:** implementation complete; **draft until two-client live QA**  
**Integration branch:** `cursor/online-networking-v2-integrated-3ff8`  
**PR:** https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/42 (draft)

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
| `5de1a27` | Phase 2 bow lifecycle |
| `73490ad` | Phase 3 FIFO overflow compact continuous-state only; `queueCompacted` |
| `775f445` | Phase 4 live-state invariant tests |
| `b679882` | Phase 5 adaptive remote interpolation (no freeze-step on LAN) |
| `8b5d42c` | Phase 6 reconnect clears mining/bow hold |
| (this commit) | Phase 7–9 diagnostics HUD + architecture docs |

SHAs: `git log --oneline cursor/online-networking-v2-integrated-3ff8`.

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
| Buffer | max 8, delay 100 ms | max 12, delay = clamp(100+jitterP95, 80..180) | **hybrid**: 12 samples; delay stays 100 ms until underflow, then donor clamp |
| Extrap | ≤100 ms then freeze | ≤100 ms then hold | both |
| Recovery | none (hard) | blend ≤100 ms | **DONOR**, with clock re-anchor so recovery can actually rejoin |
| Jitter | arrival − 50 ms | actual arrival Δ − expected tick Δ | **DONOR** |

Donor immediate delay bumps during healthy interpolate are **rejected**: they freeze `renderTick` via the monotonic clock and add visual lag. BASE two-client smoothness is preserved on perfect 20 Hz (`delay=100`, visual step < 0.12). Teleport ≥6 blocks and dead→alive snap; `flying` stays on samples (donor `dead` is added only for respawn snap).

### Local aim

BASE `localAim.ts` / `localInteractionAim` **wins**. Donor does not have PR #39. Do not replace.

### Session / reconnect

BASE already: one live `connectionId`, `resetConnectionInput`, hidden-tab idle. Keep. Phase 6 also zeros bow/mining/food hold on reconnect (required after Phase 2 draw persistence).

## 5. What came from BASE

- PlayerCommand, commandSeq, clientTick, FIFO queue, ackCommandSeq
- history[ackCommandSeq] compare, accepted ACK = no live mutation
- Explicit sequenced actions (actionSeq ≠ commandSeq)
- localAim / localInteractionAim
- Mining locked to break_start target
- PROTOCOL_VERSION 3 join gate
- Persistence / one logical player / WebSocket
- Hidden-tab idle + snap; stale socket isolation

## 6. What came from DONOR

- `targetBlockId` + stale reject
- Hit-in-voxel, strict face, LOS+face
- 12-sample remote buffer, jitter = arrival Δ − expected tick Δ
- Bounded recovery blend after underflow
- Online captured-aim arrow `spread=0`
- Action validation tests (A vs B, stale ID, wrong face, invalid hit)
- DEV appliedSteps as scheduler trace only (already on BASE)

## 7. What was rejected from DONOR

- latest-input / appliedTicks as production ACK identity
- Replacing localAim
- Dropping FIFO
- Treating `lastInputSeq` as applied command
- Magic retry / auto-resend of bow_release
- Huge remote delay / infinite extrapolation
- Immediate delay = 100+jitterP95 on every jittery packet (freezes renderTick)

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

**Phase 3 implemented:** overflow runs `compactContinuousCommands` (WASD/look only). Jump/use/mining/slot/flight/vehicle edges stay. Dropped seqs are reported on `player_state.queueCompacted`. Client `discardCompactedPrediction` rebuilds live pose from the last checkpoint plus remaining pending. Last-resort drop of an uncompactable oldest command still reports the range. ACK identity unchanged. BASE silent `queue.shift()` is gone.

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

## 13. Remote interpolation (Phase 5)

One production implementation: `src/net/remotePlayerInterpolation.ts`. Entity buffers remain for mobs, not players.

- Timeline: `serverTick`, never packet arrival.
- Buffer max 12. xyz linear, pitch linear, yaw shortest path, booleans from timeline midpoint.
- Delay: 100 ms baseline. Target = clamp(100 + jitterP95, 80, 180). Current delay grows only after underflow; shrinks when healthy. Perfect 20 Hz stays at 100 ms.
- Underflow: ≤100 ms velocity extrap, then hold. No infinite glide.
- Recovery: after a new sample following extrap/capped, re-anchor renderTick and blend ≤100 ms (smoothstep). Teleport/respawn skip recovery.
- F3: delay, bufMs, jitter p50/p95, under/s, extrap, recovering, maxVisualStep.

## 14. Reconnect / session (Phase 6)

BASE already: one live `connectionId`, stale socket isolation, session resume, hidden-tab idle + snap.

Added: `resetConnectionInput` zeros `bowUseTicks`, mining, food hold, `lastUse`, `lastActionSeq`, idle `use:false`. Required because Phase 2 no longer cancels draw on movement `use:false`. After reconnect, client pending is empty and live equals the welcome checkpoint.

Hidden-tab: still one idle on hide, snap on resume, no catch-up storm. Invariant holds after resync.

## 15. Diagnostics

F3 answers:

- Movement: pred seq, ack seq, serverTick, pending, replayed, corr/s (BASE, unchanged).
- Block: target xyz/id/face, actionSeq, commandSeq, accept/reject (Phase 1 `id=`).
- Bow: press/draw/rel/sent/result/spawn + release vs server aim (Phase 2).
- Remote: tick, render, mode, buf, bufMs, delay, snap/s, jitter, under/s, extrap, rec, step (Phase 5).

No unbounded logs. `?remoteDiag=1` remains 1 Hz.

## 16. Tests

- `tests/block-action-intent.test.ts`, `tests/block-intent-motion.test.ts`, `tests/action-pose-history.test.ts`
- `tests/server/player-actions.test.ts` (20× bow, captured aim, FIFO use:false)
- `tests/fifo-backlog.test.ts`, `tests/player-command-queue.test.ts`
- `tests/prediction-invariant.test.ts` (accepted / correction / burst / compact / hidden-tab / reconnect)
- `tests/remote-player-interpolation.test.ts` (BASE A–K + adaptive delay / recovery / teleport / walk steps)
- `tests/server/anarchy-server.test.ts` (resume, stale socket, bow/mining clear)

Altering tests only to go green is forbidden. The old silent-drop queue test was replaced because it documented forbidden behavior.

## 17. Live QA

Not yet run in this cloud session. PR stays **draft** until two real clients:

- Local A: no false corrections, no 1–2 block teleports, corr/s usually 0
- Remote B: smooth, no freeze-step, no infinite glide
- Blocks: A or reject, never B
- Bow: release aim A survives camera B; ≥20 consecutive draw→release

## 18. Baseline failures

Phase 0 recorded BASE tests on `1f5aafe`. Pre-existing full-suite noise (authored ENOENT `bucket_empty.png`, minecart `getChunk` timeouts) is unchanged and not treated as integration regressions.

## 19. Remaining issues

- Two-client live QA not yet run (blocks ready-for-review).
- Attack/pickup still lack full captured-aim payloads (deferred; not silent B).
- Remote attack/mining/bow presentation flags still false/0 (animator, not simulation).
- Persistence `server/data/worlds/anarchy/` was not migrated or wiped.
- Singleplayer does not require Online action messages.

## 20. Git

Do not merge main. Do not force-push. Existing BASE/DONOR branches were not rewritten.
