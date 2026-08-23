# Chunk streaming starvation fix

Date: 2026-08-23  
Branch: `cursor/performance-world-loading-mob-smoothing`  
Previous HEAD: `0fe00ac2a4bc7d7e6d2f88bda6191b50d30f4ac1` (`dev: add chunk streaming diagnostics`)  
PR: #4 remains draft. **main was not merged.**

## Goal

Keep the current low p95/p99 frame pacing, but stop a nearby wanted/visible chunk from waiting seconds to *start* meshing after generation and lighting are already done.

## Slow chunk evidence (local QA, before this pass)

LAST SLOW CHUNK ≈ `(-72, 153)`, age ~3.27 s.

| Stage | Time |
| --- | --- |
| lit → meshStart | **≈ 3.02 s** |
| mesh queue rank | **~8** (not ~300th) |
| inspector blocker on the snapshot | `waiting mesh budget` |
| queuedObsolete | **≈ 604** (`g0 / l0 / m604`) |
| GEN / LIGHT / MESH pending on the same HUD | 0 / 0 / 0 |
| LAST SPIKE | ~41 ms, SIM ~39 ms, LIGHT ~0.1 ms, age ~13 s (stale, not the current hitch) |

The player did not notice a hole at that exact instant; the inspector still captured a real multi-second ready-to-mesh stall.

## Slow Chunk Root Cause

Proven from `Game.processWorldJobs` **before** this pass, not a guess.

PLAYING generated **one** chunk per frame whenever `missingChunkCoords` was non-empty (generation radius = renderDistance+1). After lighting, the function did:

```ts
if (!loading && generated > 0) {
  // skip every mesh job this frame
  return;
}
```

Creative flight continuously opens new gen-radius chunks, so **generation ran every frame** and **mesh never ran** while flying.

That matches the capture:

- Chunk was requested, generated, lit, light context ready.
- It sat dirty/ready with mesh rank ~8: eight closer dirty jobs also never started.
- Rank 8 is “eight starved neighbors”, not “300th in a huge live queue”.
- Inspector `waiting mesh budget` can appear on a *later* snapshot (`adaptiveJobBudgetMs` → 0 / lighting-only). The multi-second gap itself is **generation-frame mesh skip** (`waiting generation-frame separation`).

`WorldRenderer.rebuildDirty` already `continue`s past an unlit/blocked head. Distance sort is recomputed each mesh pass. Those were **not** the 3.02 s cause.

Continuous generation starving mesh is reproduced by `tests/streaming-scheduler.test.ts`: legacy skip-on-gen → **0** meshes in 40 generate-every-frame steps; fair policy still meshes.

## Obsolete 604

**Real bookkeeping leak + inspector over-count**, not 604 live head-of-queue mesh jobs.

1. `getChunk` → `markMeshDirty` (self + cardinal neighbors) → `pendingMesh` Set.
2. Halo chunks (outside mesh/visible radius) stay `dirty` but `rebuildDirty` never meshes them.
3. **`pruneChunks` deleted `world.chunks` and did not `pendingMesh.delete(key)`** → keys accumulated for the whole flight (~604 unique generated-then-pruned chunks).
4. Inspector `queuedObsolete` used `meshAllKeys` = entire `pendingMesh` **plus all dirty/stale chunks**. In-radius mesh pending could be 0 while the Set still held hundreds of orphans. HUD `waitM` was `pendingMesh.size`.

GEN/LIGHT pending 0 with MESH pending 0 is consistent: wanted in-radius work was empty; the 604 were stale keys / halo dirty, not a 604-job mesh lane.

After this pass:

- `pruneChunks` deletes the pending key.
- `discardObsoletePendingMesh` drops pending keys outside wanted mesh radius or whose chunk is gone, then re-syncs in-radius dirty/stale into `pendingMesh`. Generated voxel data and `dirty` stay so a later re-entry remeshes.
- Inspector obsolete mesh uses **`pendingMesh` only**, and lighting halo is wanted for GEN/LIGHT lanes. Dirty-only halo is not a mesh queue entry.

CPU flight/reverse/zigzag: **peak obsolete mesh = 0**, peak in-radius pending **9** (working set), not hundreds.

## Generation vs Mesh Fairness

Budgets **unchanged**: `WORLD_JOB_BUDGET_MS = 4`, `WORLD_LIGHT_BUDGET_MS = 2`. No 4→20.

Policy in `src/world/streamingScheduler.ts`, used by `Game.processWorldJobs`:

- LOADING_WORLD: still meshes (up to 4); ready gate unchanged.
- PLAYING, no generation this frame: default mesh limit (1–2).
- PLAYING, generation this frame:
  - if a ready mesh is urgent (chebyshev ≤ 2 **or** wait ≥ 150 ms) and headroom allows → **meshLimit = 1**, `starvationAvoided`;
  - else if generation has skipped mesh ≥ 1 consecutive frame → **meshLimit = 1** (fairness);
  - else skip mesh this frame only.
- First mesh in `rebuildDirty` still ignores the leftover ms budget so one job can start; further meshes stay budgeted.

This is fairness, not “mesh every gen frame with no headroom”.

## Queue Cleanup

Wanted sets:

- mesh / visible = `meshRadius` (render distance)
- generate / light halo = `meshRadius + 1`

Pending mesh **outside** the mesh wanted set is dropped from `pendingMesh`. Halo remains generated and dirty; it does not consume mesh budget until it enters the visible radius. Ongoing rebuild is not cancelled (there is no worker).

## Reprioritization

`meshJobSortScore` is recomputed every mesh pass from the **current** player chunk (not insert-order):

1. player chunk
2. immediate neighbors (chebyshev 1)
3. ring ≤ 2
4. rest of visible radius

Plus a small age boost after 150 ms and a cheap movement-ahead tie-break. No trajectory predictor. No full array rebuild every render frame beyond the existing dirty scan (working set).

## Flight

Creative flight speed is unchanged. Scheduler now meshes on generation frames instead of falling seconds behind once chunks are lit.

CPU isolated scheduler (instant light, so lighting is not the bottleneck):

| Scenario | Fair lit→mesh p95 / max | Fair max ready age | Legacy skip-on-gen p95 / max | Player chunk miss | Obsolete peak |
| --- | --- | --- | --- | --- | --- |
| Walk 12 chunks | 200 / 200 ms | 200 ms | 250 / 250 ms | 0 | 0 |
| Fly sprint 24 chunks | 200 / 200 ms | 200 ms | 250 / 250 ms | 0 | 0 |
| Reverse 8 east + 8 west | 200 / 200 ms | 200 ms | 250 / 250 ms | 0 | 0 |
| Zigzag | 200 / 200 ms | 200 ms | — | 0 | 0 |

Fair `starvationAvoided` 72–144 frames; legacy skipped mesh on 132–264 generate frames. Continuous-generation unit test is the strong “legacy = 0 meshes” proof; after warmup, generate is not every frame, so legacy still eventually meshes on quiet frames — that is why local flight with **unbroken** generate-every-frame produced 3.02 s.

Sliced lighting (`WORLD_LIGHT_BUDGET_MS = 2`) during sprint fly can still leave the player chunk unmeshed for seconds because **lighting/context** is not ready. That is not the 3.02 s skip-mesh bug and is **not** hidden with fog. Documented as remaining throughput, not a fake pass.

## SIM Spike

LAST SPIKE ~41 ms / SIM ~39 ms / LIGHT ~0.1 ms, ~13 s old.

`MAX_CATCH_UP_TICKS = 4` caps a hitch at 4×50 ms simulation. Four ticks at ~10 ms each ≈ 39 ms in one frame. Lighting was not the spike.

DEV `?perf=1` now splits SIM (only while profiler is on):

`player | mobs | world | combat | entities | other` plus `ticks` in that frame.

If `ticks === 4` on a spike, it is catch-up after a stall, not a new 39 ms world-tick hot path. No simulation rewrite in this pass.

## Mesh cost outliers

CPU `ChunkMesher.build` samples this environment (not GPU):

| Sample | biome | mesh ms | faces |
| --- | --- | --- | --- |
| plains-ish seed | desert | ~30 | 3744 |
| offset-a | plains | ~19–26 | 4130 |
| offset-b | forest | ~23–26 | 4995 |
| cave-probe | plains | ~17 | 3887 |

Max still **> 16 ms**. Rare/common enough to note; greedy/worker remains a follow-up. Fairness launches **at most one** extra mesh on a generation frame so it should not turn 30 ms mesh into every-other-frame spikes. Local GPU p95 is **not** claimed in this environment.

Rapid break regression (CPU): 30 interior edits → **1** pending mesh / **1** dirty chunk. Lighting maxSlice still ~2 ms.

## Frame pacing

Not changed:

- lighting model (vertical sky, incremental 2 ms slices, halo, block light, lightVersion, F7)
- mob interpolation
- block-break pipeline
- Creative flight speed
- `WORLD_JOB_BUDGET_MS` / `WORLD_LIGHT_BUDGET_MS`
- Loading World ready gate

## Tests

`npm test`: **43 files, 337 tests, all passed** (was 42 / 323). `npm run check` green: production **100 modules**, **1.07 MiB / 167 files**.

New: `tests/streaming-scheduler.test.ts` (11). Inspector tests extended for halo-vs-obsolete and 500 ms ready-mesh warn.

## Manual QA

GPU smoothness is **not** claimed here. Please fly with `?perf=1&chunks=1`:

1. Creative fly straight — judge **WANTED→VISIBLE** / **READY-WANTED WAIT**, not prefetch `lit→meshStart`. A chunk lit 40 s ahead that appears as you arrive is healthy. READY MESH STARVATION > 500 ms should fire only when the chunk is wanted, ready, and mesh has not started. LAST SLOW VISIBLE CHUNK requires wanted→visible > 2 s inside mesh radius.
2. Reverse direction — old east pending should not outrank new west neighbors; `queuedObsolete` should stay near the working set, not hundreds.
3. Caves / torch — lighting views unchanged (F7).
4. Rapid Creative break — still one dirty/pending job class, no 0–10 FPS return.
5. Mobs still interpolate.
6. Loading World still reaches a meshed floor before PLAYING.
7. Confirm LAST SPIKE age so an old SIM 39 ms is not read as the current frame.
8. F9 freeze then fly away — HUD must say CURRENTLY NOT WANTED; live wanted timers must not keep growing.

## Prefetch lifetime vs player-visible latency

The starvation fix made nearby mesh start while flying. After that, local QA could still show `lit→meshStart = 42 s` / old `READY MESH WAIT = 43 s` even when the hole in front of the player filled immediately.

That number was **prefetch lifetime**: the chunk was generated/lit as halo far ahead, sat ready, then entered mesh radius and meshed in ~100 ms. The inspector used `litAt` / `readyToMeshAt` (set at light time) / request age, so it labeled prefetch as player-visible stall.

**Player-visible clocks** (inspector follow-up, diagnostics only, no scheduler change):

- `WANTED→VISIBLE` = time from entering mesh wanted radius to appearing
- `READY-WANTED WAIT` = time from “wanted + fully ready to mesh” to mesh start

Use those to decide if a remaining streaming stall exists. Keep `lit→meshStart` as PREFETCH HISTORY only. See `docs/reports/2026-08-23_chunk-streaming-inspector.md`.

## Git

Feature branch only. No merge to main. No force push.
