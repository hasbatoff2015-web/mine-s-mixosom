# Multiplayer smoothness regression — investigation

## Goal

Prove the exact cause of Anarchy movement stutter after “Networking V2 + Farming” landed on the owner’s mental timeline. Do **not** patch Networking V2 or roll back Farming until the cause is measured. `Unknown block id: 150` when checking out PR #42 against a Farming save is a **save-schema** mismatch, not the stutter root cause.

## Result

**Networking V2 was never merged to `main`.** Current `origin/main` is the pre-V2 Anarchy stack (`PROTOCOL_VERSION = 1`, latest-input, `setInterval` 20 Hz, local chase/snap, wall-clock remote interpolation) **plus** Farming V1 (PR #43).

The perceived regression is: testers ran **PR #42** (smooth FIFO + prediction + server-tick interpolation), then ran **current `main` after Farming merged**. Those are two different movement implementations. Farming did not overwrite V2 — V2 was never on `main`.

Farming is a **secondary** hitch risk on dense hydrated farms (pulse + `setBlockState` remesh + `block_update`). It is **not** capable of explaining fresh-world MP rubber-banding: online clients do not tick farming, and an empty-world farming tick is ~0.01 ms.

## Timeline (proven SHAs)

| Label | SHA | Fact |
|---|---|---|
| Old `main` (merge-base of PR #42) | `4d803e5de22e551e3f71941c0abb03c91e78cf4c` | Merge PR #22 UI. `PROTOCOL_VERSION = 1`. No FIFO, no `ackCommandSeq`, no `tickScheduler`. |
| PR #42 HEAD (working smoothness) | `e5c77f334fa46b726372fb7d7d27283f213ea184` | Branch `cursor/online-networking-v2-integrated-3ff8`. GitHub: **OPEN draft**, `mergedAt: null`, `mergeCommit: null`. `PROTOCOL_VERSION = 3`. |
| Farming V1 commit | `07b0c4927c7b1a6824a6e878e8cb110c6e46a6d7` | Branch `codex/farming-core`. Parent is `4d803e5`. |
| Farming merge = **current `origin/main`** | `aa0ee07403874fc72e483f53c2b1db176d33b649` | Merge PR **#43** `feat: add Farming V1`, 2026-09-04T16:19:09Z. `PROTOCOL_VERSION = 1`. |

```
PR #42  e5c77f3  ──NOT MERGED──►  (never an ancestor of main)
4d803e5 (old main) ──PR #43──► aa0ee07 (current main = old net + Farming)
```

`git merge-base --is-ancestor e5c77f3 origin/main` → **false**.
`git merge-base e5c77f3 origin/main` → `4d803e5`.

**TEST B (main immediately after merge #42) does not exist.** Nothing on GitHub merged #42. Open drafts still: #36 Radmin, #37 prediction, #38 remote interp, #39 local aim, #40 FIFO V2, #41 donor, **#42 integration**.

## Evidence that V2 is absent on `main`

Files present on `e5c77f3` and **absent** on both `4d803e5` and `aa0ee07`:

- `shared/playerCommand.ts`
- `server/playerCommandQueue.ts`
- `server/tickScheduler.ts`
- `src/net/localPlayerPrediction.ts`
- `src/net/remotePlayerInterpolation.ts`
- `src/player/localAim.ts`

`git diff --exit-code 4d803e5 aa0ee07 -- src/net/` → **empty** (Farming did not touch the client net stack).

`git log origin/main --grep=ackCommandSeq` → empty.

Protocol: `shared/config.ts` is `PROTOCOL_VERSION = 1` on `main`, `3` on PR #42.

## What was smooth in PR #42 (`e5c77f3`)

| Subsystem | Behavior |
|---|---|
| Server tick | `gameplayTicksDue` + `setTimeout` slot + `tickCatchUp` (N physics ticks, **one** `player_state`) |
| Movement authority | FIFO `PlayerCommandQueue`, one command / 20 TPS tick, sticky last if empty |
| ACK | `ackCommandSeq` + `history[ack]` compare; accepted ACK does not mutate live pose |
| Local client | `predictLocalMove` every sim tick; reconcile from pending snapshot |
| Remote | `RemoteInterpolationBuffer` keyed by **serverTick**, 12 samples, delay 100 ms until underflow, then 80–180 ms |
| Look | RAF `applyImmediateRenderLook`; physics look stays on the tick |
| Protocol | 3 |

That stack is what removed rubber-banding / 20 Hz pose writes / latest-input 2-vs-1 rewind.

## What changed after “merge #42”

**Nothing, because there was no merge.** The movement files on `main` at `4d803e5` are the same movement files on `aa0ee07`.

## What changed after Farming (PR #43)

Only Farming-related wiring. Movement / interpolation / prediction files were not rewritten.

Kernel: insert `farming` after `world`, before `falling` / `players`.

Protocol: `NetworkBlockState.hydrated` + `age` on existing `block_update` / `block_batch`. **No protocol bump.** Snapshot frequency of `player_state` is unchanged (once per server tick).

`Game.ts` / `server/gameplay.ts`: construct `FarmingSystem`, `tickFarming()`, farming drops. Online client still takes `shouldRunClientWorldSimulation(true) === false` and **never** calls `tickFarming`.

`setBlockState` still `markMeshDirty` — hydration/age writes remesh. That matters only when farmland exists.

## Main-loop classification (current `main`)

```
render frame
  → advanceFixedStep 20 TPS
  → if online: tickOnline() only  (send latest input, NO local physics, NO farming)
  → every frame: stepOnlineAuthority(rawElapsed)
        ingestAuthoritativePosition on snapshot
        stepTowardTarget chase + previousPosition = position  (kills local interp)
  → remotes: sampleRemotePose(samples timestamped with performance.now(), delay 80 ms)
  → render
```

Server (`WorldInstance.startLoops`):

```
setInterval(() => this.tick(), 50)
  → GameplayKernel: world → farming → falling → players (lastInput, not FIFO)
  → broadcast player_state every tick
```

### A–E answers

| Question | Verdict on current `main` vs PR #42 |
|---|---|
| A. Server sends jumpy poses? | **Yes, by construction.** Latest-input + naive `setInterval` skips seqs; one tick applies only `lastInput`. Same 2-vs-1 walk-step error V2 was built to kill. Not “random corruption”. |
| B. Client interpolates remotes wrong? | **Yes relative to V2.** Samples are arrival-time `now`, buffer max 8, fixed 80 ms. Packet jitter becomes visual jitter. V2 uses `serverTick`. |
| C. Render thread blocked? | **Not on a fresh world.** Empty farming ~0.01 ms/tick. Meshing/lighting can still hitch independently (pre-existing). |
| D. Prediction corrections? | **There is no V2 prediction on `main`.** Local motion is chase/snap (`LOCAL_SNAP_DISTANCE = 6`, `LOCAL_APPROACH_PER_SECOND = 18`). That *feels* like rubber-band. |
| E. Chunk/farming blocks main thread? | **Only with real farmland pulses + state writes.** Online client farming tick is skipped. Server pulse at 1024 cells ~1–6 ms; 4096 ~4–14 ms — inside a 50 ms slot unless remesh/light pile on. |

## Farming cost (measured on `aa0ee07`, this VM)

Official `scripts/benchmark-farming.ts`: 1024 cells **2.46 ms**, 4096 **5.89 ms** (hydration pulse, dry, no state writes). Farming’s own report: 6.07 / 13.91 ms on their machine.

Extra `scripts/measure-farming-cost.ts` (not committed; run in a main worktree):

| Case | avg |
|---|---|
| Empty world, non-pulse, 200 ticks | **0.009 ms** |
| Empty hydration pulse | 2.2 ms (25 loaded chunks, zero farmland — still iterates scanned maps) |
| 1024 non-pulse | 0.039 ms |
| 1024 hydration pulse | 1.10 ms |
| 4096 hydration pulse | 3.78 ms |
| First water full-chunk index + hydration | 1.28 ms |
| Second water pulse (indexed) | 0.03 ms |

`ensureWaterIndex` can full-scan `y=0..scanMaxY` × 16 × 16 **once per chunk** the first time nearby farmland hydrates. After that it is indexed. Between pulses `tick()` only `syncLoadedChunks()` then returns.

**TEST D prediction (disable `tickFarming`, keep block IDs):** online movement on a **new world** stays stuttery, because the client never ran farming in MP and `src/net/` is bit-identical to pre-Farming `main`. That is the controlled experiment without needing a live two-client session: the farming function is not on the online client tick path.

## Suspicious diffs (ranked)

| File | Commit | Change | Why it could affect smoothness | Strength | How verified |
|---|---|---|---|---|---|
| *(none of `src/net/*`)* | #43 | **no diff vs 4d803e5** | V2 not present | **Proven** | `git diff --exit-code 4d803e5 aa0ee07 -- src/net/` |
| `server/WorldInstance.ts` | pre-#42 `main` | `setInterval(tick, 50)` + `lastInput` | Missed ticks; latest-input 2-vs-1 | **Proven** (code) | vs `e5c77f3` `tickScheduler` + FIFO |
| `src/core/Game.ts` | pre-#42 `main` | `stepTowardTarget` every frame; no `predictLocalMove` | Rubber-band / 20 Hz chase | **Proven** | vs `e5c77f3` prediction |
| `src/net/RemotePlayerView.ts` | pre-#42 `main` | `poseSample(..., now)` wall clock | Jittery remotes | **Proven** | vs `remotePlayerInterpolation.ts` serverTick |
| `src/gameplay/GameplayKernel.ts` | `07b0c49` / #43 | `tickFarming` before players | Extra work **before** physics on SP/server | Weak on empty world; medium on huge farms | measured 0.009 ms empty; pulse 1–6 ms |
| `src/world/World.ts` `setBlockState` | existing + farming writes | remesh on `hydrated`/`age` | Client hitch when many crops change | Medium **if** farms exist | code: `markMeshDirty` |
| `shared/protocol.ts` | #43 | `hydrated`/`age` on block state | Larger block packets, **not** player snapshots | Weak for movement stutter | player_state schema unchanged |
| Block IDs 150–157 | #43 | unknown on #42 checkout | Save incompatibility only | **Not** stutter | user already noted |

## Root cause

1. **Primary (explains “#42 was smooth, current main is not”):** testers left the unmerged V2 branch and ran `main`, which still implements the old latest-input + chase/snap + arrival-time interpolation stack. Farming merge did not delete V2; V2 never landed.
2. **Secondary (can hitch later, not the empty-world MP regression):** Farming hydration/growth pulses + `setBlockState` remesh/`block_update` on populated farmland. Budget is usually < one 20 TPS slot; a first-time water full-scan and a 4096-cell pulse are the worst in-sim costs measured.

## Recommended fix (do not do in this investigation commit)

Keep Farming V1. Integrate PR #42 **onto** current `main` (`aa0ee07`), do not roll either back.

Must preserve from Farming:

- Kernel `tickFarming` after `world`
- Block IDs 150–157, items, mesher, `hydrated`/`age` protocol fields
- Server/SP `FarmingSystem` hosts

Must preserve from V2:

- FIFO + `ackCommandSeq` + prediction history
- `tickScheduler` / `tickCatchUp`
- serverTick remote interpolation
- `PROTOCOL_VERSION = 3` (and a join-gate story for old clients)
- `localAim.ts`

Conflict hotspots: `GameplayKernel.ts`, `src/core/Game.ts`, `server/gameplay.ts`, `server/WorldInstance.ts`, `shared/protocol.ts`, `shared/config.ts`, `src/world/World.ts`. Resolve by **union**, not by picking one side’s whole file.

Do **not** treat `Unknown block id: 150` as a reason to drop Farming; add the IDs to the V2 tree (they already exist on `main`).

## Risk

A careless merge could drop FIFO (if Game.ts is taken from Farming) or drop `tickFarming` (if kernel is taken from V2). Protocol 3 without Farming state parsers would break crop sync. Protocol 1 with V2 clients would fail join.

## Tests added in this pass

- `tests/anarchy-movement-stack-identity.test.ts` — characterizes **current `main`**: protocol 1, V2 files absent, remote samples use arrival time, online local motion still chases. **Replace this file when V2 is actually merged.**
- `tests/farming-tick-budget.test.ts` — empty non-pulse and 1024-cell pulse must stay well under one 50 ms tick.

## Tests to add after V2+Farming integration

- `PROTOCOL_VERSION === 3` and V2 modules exist.
- FIFO: two queued commands in one interval → two physics ticks, `ackCommandSeq` matches history, accepted ACK `corr = 0`.
- Remote buffer samples keyed by `serverTick`, not `performance.now()`.
- Kernel order still `world > farming > falling > players`.
- Farming empty-tick budget + pulse budget (keep).
- Online client still does not call `tickFarming`.

## Git

Investigation branch: `cursor/mp-smoothness-regression-3ff8` from `origin/main` `aa0ee07`. No gameplay logic change.
