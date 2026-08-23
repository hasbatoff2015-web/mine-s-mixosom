# Chunk streaming inspector (diagnostic only)

Date: 2026-08-23  
Branch: `cursor/performance-world-loading-mob-smoothing`  
HEAD before this pass: `eb39159d076b5228327529aa8a007e859c9d3f5f`  
PR: #4 remains draft. **main was not merged.**

## Goal

After lighting simplification, freezes and lighting spikes dropped, but a different symptom is visible: flying/running into the world can put the player next to an empty region, and the nearest chunk may appear only after many seconds. One local screenshot showed FPS ~155, low frame/p95/p99, `waitM ~370`, `light jobs ~100`, while the nearby area was still missing.

This pass does **not** fix streaming. It adds a DEV-only inspector so a screenshot during a 10–20 s hole can show *where* the time went.

## Result

**DIAGNOSTIC ONLY.** Scheduler, budgets, priorities, ready radius, lighting, chunk lifecycle, and job cancellation are unchanged.

No claim that backlog is proven or streaming is solved.

## How to capture a slow missing chunk

1. Launch with `?perf=1&chunks=1` (or `?perf=1` then F8).
2. Creative fly / sprint until a hole appears in front of the player.
3. Press **F9** immediately (`FREEZE INSPECTED CHUNK`) so FRONT CHUNK stays selected after it finally appears.
4. Wait until the chunk shows; screenshot the perf HUD (PLAYER CHUNK, FRONT CHUNK, HALO, GEN/LIGHT/MESH ready vs blocked, `queuedObsolete`, LAST SLOW VISIBLE CHUNK, PLAYER-VISIBLE WANTED→VISIBLE, LAST SPIKE age). Do not treat prefetch `lit→meshStart` of tens of seconds as a player-visible stall.
5. Optional: if F9 was missed, `LAST SLOW VISIBLE CHUNK` still keeps the last 8 stalls that stayed non-visible for > 2 s **while inside mesh wanted radius**.

## Hotkeys

| Key | Action |
| --- | --- |
| F7 | Cycle light debug: off → SKY → BLOCK → FINAL (unchanged) |
| F8 | Toggle chunk boundary overlay (now colored by state). Also `?chunks=1` |
| F9 | Freeze / unfreeze the current FRONT missing chunk as the inspect target |
| F3 | Existing debug HUD (unchanged) |

## Overlay colors

F8 tiles are 16×16 outlines. Legend is in the perf HUD.

| Color | Category | Meaning |
| --- | --- | --- |
| GRAY | `ABSENT` | not requested / not generated |
| BLUE | `WAIT_GEN` | requested, waiting generation |
| CYAN | `WAIT_LIGHT` | generated, waiting light |
| YELLOW | `LIGHTING` | lighting job active (cursor / flood owner) |
| ORANGE | `WAITING_MESH` | lit (or halo), waiting mesh / outside activation |
| PURPLE | `MESHING` | mesh rebuild this frame |
| GREEN | `VISIBLE` | renderer has the chunk and light version matches |
| RED | `BLOCKED` | stale mesh version, or in mesh radius but neighbor light context not ready |

White inset: player chunk. Magenta inset: frozen / front target.

## HUD fields (`?perf=1`)

Existing PERF/TICK/JOBS/LIGHT/CHUNK/ENT lines remain. Added:

- **GEN / LIGHT / MESH** pending, ready, blocked, oldest age, head key/state
- **HEAD policy:** lighting **stops** on a blocked flood-owner head; mesh **skips** (`continue`) blocked unlit / missing-halo jobs
- **FRAME** gen attempted/completed/skippedBlocked, light attempted/completed/yielded/blocked, mesh attempted/completed/skippedBlocked, plus `skipMesh(gen-frame)` and `lighting-only budget` flags
- **MOVE** horizontal speed (blocks/s), 8-way heading, Creative flying
- **HORIZON** render radius, requested (= mesh+1 halo), furthest requested/missing, `wantedNow` (mesh-radius square), `missingWanted`, `queuedObsolete` (jobs whose chunk is outside the current mesh-radius wanted set)
- **PLAYER CHUNK** and **FRONT CHUNK**: flags, versions, distance-only priority, queue ranks (`not queued` if absent), `blockedBy`, **CURRENT STATE** (`wantedNow`, `wantedSince`, `readyWhileWanted`, meshStarted, visible), **PREFETCH HISTORY** (generated/lit ages, `lit N s before becoming wanted`), **PLAYER-VISIBLE WAIT** (`WANTED AGE`, `READY-WANTED WAIT`, wanted→ready, readyWanted→meshStart, mesh duration, `WANTED→VISIBLE`). Prefetch `lit→meshStart` is still shown, labeled prefetch, never as READY MESH WAIT. Cardinal HALO, last ~12 events
- **LAST SLOW VISIBLE CHUNK** from the ring buffer (wanted→visible, wanted→ready, READY-WANTED→MESH, maxDistanceWhileWanted, ranks/blocker while wanted)
- **READY MESH STARVATION** if a wanted ready-to-mesh chunk waited > 500 ms to start mesh (`readyToMeshWhileWantedAt`, not `litAt`)
- **PLAYER-VISIBLE LATENCY** rolling p50/p95/max for `WANTED→VISIBLE` and `READY-WANTED→MESH` (only chunks that entered mesh wanted radius)
- **PREFETCH HISTORY** rolling `lit→meshStart` / request→visible (not the player-visible stall metric)
- **LAST SPIKE** `39.5 ms (37.8s ago)` — spike detection still `frameMs >= 33`; only the label gained age
- **LEGEND** + F7/F8/F9 reminder

Inspector text updates ~8 Hz (125 ms), overlay paint already 200 ms. Wanted timestamps sync on that refresh and on player chunk-cross while profiler is on — not every render frame. Production path without `?perf=1` / F8 does not walk queues for ranks.

## Chunk states (real flags)

Derived from `world.chunks`, `lightingReady`, `skyFillCursor` / `blockScanCursor` / `lightingFloodOwner()`, `pendingMesh`, `dirty` / `lightMeshStale`, `lightContextReady` (cardinal neighbors in generation halo), `WorldRenderer.hasChunk`, `lightVersion` vs `meshedLightVersion`. No parallel fake state machine. `Chunk.generated` is unused in gameplay; inspector treats “generated” as present in `world.chunks`.

Priority today is **distanceSq only** (same sort as generate/light/mesh). No visibility or movement-ahead term.

## Queue ranks

Read-only snapshot of the same order the scheduler already uses:

- GEN: missing coords in generate radius, sorted by distanceSq
- LIGHT: loaded `!lightingReady`, sorted by distanceSq
- MESH: `dirty \|\| lightMeshStale \|\| pendingMesh` inside mesh radius, sorted by distanceSq

Rank is the index. Inspector never mutates those lists.

## Blockers (`describeChunkBlocker`)

Taken from actual skip/return conditions:

- waiting generation
- lighting job pending / lighting job active
- waiting neighbor light context / `neighbor (cx,cz) missing` / `neighbor (cx,cz) not lit`
- waiting generation-frame separation (PLAYING generated this frame → mesh skipped)
- waiting mesh budget (adaptive budget 0 → lighting only, or ready-but-unbuilt)
- mesh queued
- mesh version stale
- outside activation rule (lit halo, outside mesh radius)
- none

HALO shows N/S/E/W only (diagonals are not required by `lightContextReady`).

## Slow chunk capture

**LAST SLOW VISIBLE CHUNK** fires only when the chunk is inside the **current** mesh wanted radius, is not visible, and continuous **wanted→visible** (open wanted age if still missing) ≥ 2 s. Prefetch/request/`litAt` age must not trigger it. Halo chunks that never entered mesh wanted radius are excluded.

**READY MESH STARVATION** (> 500 ms) is a separate warning: wanted + generated + lit + lightContextReady + mesh not started + `now - readyToMeshWhileWantedAt` > 500 ms. It does **not** use `litAt`.

## Prefetch lifetime vs player-visible latency

These are different clocks. Mixing them is how a healthy fly-over looked like a 40 s stall.

| Clock | Meaning | Typical healthy fly-over |
| --- | --- | --- |
| **PREFETCH AGE** / `lit→meshStart` | Time since generation/light (often halo/prefetch, before the player needed the mesh) | 40 s if the chunk was lit far ahead |
| **WANTED AGE** | Time since this continuous stay inside mesh/visible radius. Resets on leave; new stamp on re-enter | ~100 ms if the chunk appeared as you arrived |
| **READY-WANTED WAIT** | `meshStartedAt - readyToMeshWhileWantedAt` (or open `now - ready…` while still waiting). `readyToMeshWhileWantedAt` is set only while wanted **and** ready to mesh; if lit 40 s earlier, this stamp is approximately enter-wanted time, not old `litAt` | tens of ms |
| **WANTED→VISIBLE** | `visibleAt - enteredMeshWantedAt` — full user delay from “needed” to “appeared” | ~50–150 ms when streaming is healthy |

Healthy prefetched chunk:

```
PREFETCH: generated 41s ago, lit 40s ago
WANTED: entered 120ms ago
readyWanted 120ms ago, meshStart 80ms ago, visible 65ms ago
wanted→visible 55ms, ready→meshStart 40ms
```

That is **HEALTHY**. Do not call `lit→meshStart ~40s` READY MESH WAIT.

Real stall:

```
WANTED: entered 3.4s ago
READY: 3.3s ago
meshStart: not started
readyWantedWait: 3.3s
visible: no
blockedBy: waiting mesh budget
```

F9 still freezes the inspect target. If that chunk is later distance 27 / outside request radius, HUD shows **CURRENTLY NOT WANTED**. Live wanted / ready-wanted timers stop. **LAST WANTED PERIOD** keeps `lastWantedDuration` / `lastWanted→visible`. CURRENT STATE and LAST WANTED PERIOD are separate so an old far chunk does not look like it is stalling right now.

Rolling p50/p95/max **WANTED→VISIBLE** and **READY-WANTED→MESH** include only chunks that actually entered mesh wanted radius. Prefetch-only halo is excluded.

This follow-up does **not** change streaming behavior (no scheduler / budget / priority / lighting / meshing logic). It only makes the clocks honest so the next local fly QA can tell whether a real stall remains.

## Architecture notes (observations only)

These are facts the inspector can now show. They are **not** fixes:

- PLAYING still generates at most 1 chunk/frame and skips **all** mesh if that generate ran.
- Lighting processes nearest unlit and **breaks** if another chunk owns the flood.
- Mesh **continues** past unlit / `!lightContextReady`.
- `waitM` is `pendingMesh.size`. Halo chunks stay dirty until meshed, and `pruneChunks` does not clear `pendingMesh` for removed keys. Count `queuedObsolete` before assuming the head job is the hole in front of the player.

## Tests

Unit tests cover category/color mapping, blocker strings, read-only ranks, obsolete counts, durations (including open lit→meshStart **as prefetch history**), F9 freeze, slow-chunk threshold on **wanted→visible**, LAST SPIKE age, ready vs blocked head, front-target selection, 40 s prefetch vs small READY-WANTED wait, wanted enter/leave/re-enter, READY MESH STARVATION from readyWanted not litAt, frozen CURRENTLY NOT WANTED, and rolling stats excluding never-wanted halo. They do **not** diagnose a runtime bottleneck.

Existing performance/lighting tests must stay green.

`npm run check` on the player-visible latency follow-up: 349 tests / 43 files, production 100 modules, 1.08 MiB / 167 files. Inspector tests: 26.

## Changed files

- `src/debug/chunkStreamingInspector.ts` (new)
- `src/debug/chunkStreamingTrace.ts` (new)
- `src/debug/chunkStreamingRuntime.ts` (new)
- `src/core/Game.ts`, `src/core/devProfiler.ts`
- `src/rendering/ChunkGridOverlay.ts`, `src/rendering/WorldRenderer.ts`
- `src/world/World.ts` (optional lighting counters only)
- `src/style.css`
- `tests/chunk-streaming-inspector.test.ts` (new), `tests/perf-profiler.test.ts`
- docs: PROJECT_STATE, ARCHITECTURE, ROADMAP, TESTING, this report, performance report appendix

## Deferred

Actual streaming fix (fair mesh vs generation, obsolete pending cleanup) is in `docs/reports/2026-08-23_chunk-streaming-starvation-fix.md`. This inspector remains the capture tool (`?perf=1&chunks=1`, F9, LAST SLOW VISIBLE CHUNK). Player-visible vs prefetch clocks are documented above.

## Git

Feature branch only. No merge to main. No force push.
