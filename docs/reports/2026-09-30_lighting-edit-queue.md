# Continuous edit lighting without a quiet hold

Follow-up for add-only emitter starvation and mid-flood consistency: `docs/reports/2026-09-30_lighting-emitter-fairness.md`.

Date: 2026-09-30
Branch: `cursor/lighting-flicker-stable-mesh-audit-47e9`
Base: `origin/main` `bc8b29fcb31d59a8ccb91088b8b342acb6428ada`
**Draft PR #114. Do not merge.** Production and the live spawn world were not changed.

## Goal

Stop region lighting from waiting until the player stops mining. A 20 TPS stream of accepted block edits must make lighting commits while edits are still arriving, without showing partial flood light, without a second full light buffer, and without raising `WORLD_LIGHT_BUDGET_MS`.

## Result

The 80 ms quiet hold is gone. Deferred gameplay light is a bounded spatial queue. Overlapping regions merge. A flood that has already started runs to a commit against the block ids it began with. Edits that land during that flood are pinned sparsely and become the next job. The mesh still reads the last committed snapshot until that commit.

On a Node CPU model of 100 edits with three `processLighting(2)` calls between edits (about 60 FPS between 20 TPS edits): **9 commits while later edits were still arriving**, queue peak 2, oldest age about 16–19 ms, restarts 0, max slice about 2.02 ms.

## Old root cause

`EDIT_LIGHT_BURST_BLOCKS = 8` and `EDIT_LIGHT_BURST_HOLD_MS = 80` skipped an edit-origin region flood until 80 ms passed with no new edit. `noteEditBurst` stored `performance.now()` on every accepted mutation. At 20 TPS the next edit arrived in about 50 ms, which is less than 80, so the hold never expired for as long as mining continued. When the button was released, one merged region ran as a catch-up.

A second failure mode sat under the hold: `queueLight` merged every pending region into one box and called `resetRegionLightFlood`, so a flood that had started was thrown away on the next edit. Adjacent mining always overlaps a radius-14 region, so a reset-on-edit policy also fails to commit.

`tests/lighting-edit-queue.test.ts` keeps the old predicate as a local function and checks that a 50 ms stream would have stayed held. The production scheduler does not call it.

## Design

Considered:

- **A. Small local jobs only.** A radius-14 sky+block region is hundreds of columns. One 2 ms slice does not finish it, and the next edit arrives before a reset-based job can commit. Not sufficient alone.
- **B. Versioned active job that cannot commit.** Marks the result stale but does not create forward progress if every new edit invalidates the active job. Rejected as the only mechanism.
- **C. Consistent batch view.** The active flood finishes against the blocks it started with, then a later job covers edits that arrived during it. Chosen, without copying chunk arrays.
- **D. Increase/decrease light queues.** Correct long-term shape, and a much larger rewrite of propagation. Not required once C lets the existing region flood commit on a schedule.

Chosen model:

- Queue of region jobs, cap 32. Intersecting pending jobs merge. If the cap is full, the closest pending job absorbs the new region. The running job is never expanded.
- Distant edits stay separate. A glowstone cluster near the origin and another 10 chunks away stayed two regions (`maxX` 28 and `minX` 151 in the CPU benchmark).
- While `owner === region`, `noteLightingBlockOverride` records the previous block id (and furnace emission) for cells edited after the flood started. The flood reads that pin. The pin is cleared when the flood finishes. Memory is O(edits during one job), not a second light buffer.
- The finished job commits, snapshots drop, and the next job’s first touch freezes that commit as the new baseline. Mesh readers keep seeing the previous commit until then.
- Fairness: an in-progress region flood is not aborted for streaming. If both unlit chunks and an edit are waiting, streaming may take 2 slices first, unless the oldest edit is already 150 ms old. Initial chunk lighting is not moved into this queue.
- Immediate server/`setBlock` lighting does not enter the queue.

`allowPendingLighting: true` is unchanged. `WORLD_LIGHT_BUDGET_MS` stays 2. Brightness constants and `THREE.PointLight` were not touched. Network command ownership was not touched.

## Profiler

`?perf=1` adds:

`EDITQ <queued>[ active] age <ms> commits <n> restart <n> merge <n>`

Emitter census runs only while the profiler is enabled. A pass still walks a couple of chunks per step, and steps are 400 ms apart. A finished pass is kept for 4 s unless the loaded chunk set changes, which starts a new pass immediately. World switches still reset the scanner. `ChunkMesher.build` still releases committed readers in `finally`.

## Tests

| Command | Result |
| --- | --- |
| `npx vitest run tests/lighting-edit-queue.test.ts tests/emitter-census.test.ts` | PASS 12 |
| `npx vitest run` lighting-stable-mesh, urgent-block-mesh, lighting-jobs, lighting-scheduler, lighting-seams, lighting-height-256, lighting-physics-interaction, incremental-mesh, block-break-batch, fluid-streaming, lighting-adapter | 157 passed, 1 failed |
| `npm run typecheck:client` | PASS |
| `npm run typecheck:server` | PASS |
| `npm run check:boundaries` | PASS |
| `npm run build` | PASS |
| `npm run benchmark:lighting` | Node CPU, see below |

The one failure is `urgent-block-mesh` “dirties collision immediately…”, `chunk.dirty` still true after the 2 ms urgent slice. Eight isolated repeats: 5 pass, 3 fail. This is the previously documented same-env 2 ms timing flake, not a new assertion. It was not rewritten.

The previous same-env failures that came from the quiet hold (seam settle, lava idle, height-256 settle in a tight loop) passed in this combined run. That is expected: those loops no longer wait for 80 ms of silence.

Deterministic queue coverage:

- Legacy 50 ms stream stays inside the removed hold; the live scheduler commits during a 5 s / 60 FPS fake-clock stream (`commitsDuring > 1`) and during a 4 s / 30 FPS stream (`commitsDuring > 0`).
- Final sky and block light match an immediate reference world.
- Mid-flood mesh sample stays on the pre-edit value across a second edit, then updates after a real commit. Override count and snapshot bytes return to 0. Restarts stay 0.
- 100 overlapping `queueLight` calls become 1 job and 99 merges. 40 disjoint regions stay at the cap of 32.
- Cardinal torch and diagonal glowstone cross the chunk border after deferred settle, then removal clears that light.
- 100 breaks inside one chunk change at most 25 chunk light versions, fewer than the loaded set.
- Immediate `setBlock` does not enqueue.

## CPU benchmark

Node only. Not a browser FPS claim. `WORLD_LIGHT_BUDGET_MS = 2`. Three trials.

`creativeBurst100` (100 breaks queued, then settle): about 9.2 ms total, max slice about 2.02 ms, 5776 columns, 2518 nodes, 36 slices, peak snapshot 8192 bytes, snapshot bytes 0 after settle. Column count matches the earlier single-region flood. The quiet hold is no longer sitting in front of that work.

`creativeBurst100Stream` (3 slices per edit):

| | trial |
| --- | --- |
| edits | 100 |
| commits while more edits remained | 9 |
| max queue | 2 |
| max pending age | 16–19 ms |
| restarts | 0 |
| merges / jobs created | 89 / 11 |
| columns / nodes during the edit phase | 41124 / 20558 |
| max slice | about 2.02 ms |
| edit-phase CPU | about 71–74 ms |
| settle after the last edit | 38 slices, about 11 ms |
| snapshot after settle | 0 bytes (peak 8192) |

The higher column count versus one batched relight is the repeated region work of those 9 commits, not a reset loop.

100 same-chunk breaks: 100 `queueLight` marks, 1 job created, 99 merges, queue length 1. Distant glowstone clusters: 2 jobs, regions `maxX` 28 and `minX` 151, not one box across the gap. Many-emitter idle after settle is still 0 nodes and 0 columns for 0, 32, 128, and 256 emitters.

Old policy on the same stream: 0 commits until the edits stopped, by the hold predicate above.

## Manual QA on DEV

Stay on this branch. Do not merge.

1. Creative, hold LMB on a wall or the ground for 5–10 seconds. Blocks disappear immediately. Light should step forward during the hold, not only after release. No black flash.
2. `?perf=1` during that hold: `EDITQ` should stay small, age should not climb into seconds, `commits` should increase before LMB is released, `restart` should stay near 0, `maxSlice` near 2 ms.
3. Break a long roof for several seconds, then build it back. Skylight should follow the mining.
4. Dark room, torch / lantern / glowstone, break nearby blocks quickly. Then place and break glowstone several times. Final light should match the blocks.
5. Repeat near `x % 16` and `z % 16` of 15 and 0, including a diagonal corner.

## Known issues

- Urgent 2 ms mesh test remains timing-sensitive (see above).
- A commit can describe the world as of flood start, so light lags the newest blocks by one job. That is the consistent batch, not a partial flood.
- Spawn emitter count is still a separate DEV measurement. This change does not remove torches.

## Deferred

- A dedicated increase/decrease propagation queue.
- Browser FPS and GPU timing. Not measured here.
