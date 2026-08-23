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
4. Wait until the chunk shows; screenshot the perf HUD (PLAYER CHUNK, FRONT CHUNK, HALO, GEN/LIGHT/MESH ready vs blocked, `queuedObsolete`, LAST SLOW CHUNK, LAST SPIKE age).
5. Optional: if F9 was missed, `LAST SLOW CHUNK` still keeps the last 8 stalls that stayed non-visible for > 2 s while inside mesh radius.

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
- **PLAYER CHUNK** and **FRONT CHUNK**: flags, versions, distance-only priority, queue ranks (`not queued` if absent), `blockedBy`, stage durations, cardinal HALO, last ~12 events
- **LAST SLOW CHUNK** from the ring buffer
- **LAST SPIKE** `39.5 ms (37.8s ago)` — spike detection still `frameMs >= 33`; only the label gained age
- **LEGEND** + F7/F8/F9 reminder

Inspector text updates ~8 Hz (125 ms), overlay paint already 200 ms. Production path without `?perf=1` / F8 does not walk queues for ranks.

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

Wanted (mesh radius) + not visible + age ≥ 2 s → one snapshot per stall into a ring of 8. No per-frame console. HUD shows LAST SLOW CHUNK.

## Architecture notes (observations only)

These are facts the inspector can now show. They are **not** fixes:

- PLAYING still generates at most 1 chunk/frame and skips **all** mesh if that generate ran.
- Lighting processes nearest unlit and **breaks** if another chunk owns the flood.
- Mesh **continues** past unlit / `!lightContextReady`.
- `waitM` is `pendingMesh.size`. Halo chunks stay dirty until meshed, and `pruneChunks` does not clear `pendingMesh` for removed keys. Count `queuedObsolete` before assuming the head job is the hole in front of the player.

## Tests

Unit tests cover category/color mapping, blocker strings, read-only ranks, obsolete counts, durations (including open lit→meshStart), F9 freeze, slow-chunk threshold, LAST SPIKE age, ready vs blocked head, and front-target selection. They do **not** diagnose a runtime bottleneck.

Existing performance/lighting tests must stay green.

`npm run check` on this pass: 323 tests / 42 files, production 99 modules, 1.06 MiB / 167 files.

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

Actual streaming fix (fair mesh vs generation, obsolete pending cleanup) is in `docs/reports/2026-08-23_chunk-streaming-starvation-fix.md`. This inspector pass remains the capture tool (`?perf=1&chunks=1`, F9, LAST SLOW CHUNK).

## Git

Feature branch only. No merge to main. No force push.
