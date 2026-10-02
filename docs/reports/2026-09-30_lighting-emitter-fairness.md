# Add-emitter fairness and a consistent flood view

Date: 2026-09-30
Branch: `cursor/lighting-flicker-stable-mesh-audit-47e9`
Base before this follow-up: `18ecb8e8bfbcf58e04abd2b4dfb1595b25db82b2`
**Draft PR #114. Do not merge.**

## Goal

Close two correctness gaps in the accepted region-edit scheduler. Do not replace that scheduler. `WORLD_LIGHT_BUDGET_MS` stays 2.

1. Add-only emitters (air → torch / lantern / redstone torch) were a side queue. While `lightJobs` stayed non-empty, `processLighting` never started them, so a continuous mining stream starved the torch until mining stopped.
2. `noteLightingBlockOverride` pinned blocks only for `owner === region`. An add-emitter flood is also sliced and reads `viewedBlock`. A block edit mid-flood could make one commit mix two world states. New sources were also appended into the flood already running.

## Result

Region work and pending add-emitter work both make progress under a continuous edit stream. An in-progress add-emitter flood commits the block view it started with. Sources and edits that arrive during that flood are the next batch. The mesh still reads the last committed snapshot until that commit.

## Starvation cause

`lightingInvalidation` returns `addEmitter` when emission rises and opacity does not change. `applyBlockBatch` then pushes those coordinates to `pendingEmitters` when there is no region invalidation.

`processLighting` used to do this, in order:

- if the owner was already `add-emitter`, drain `pendingEmitters` into that flood;
- else if a region flood was active or `lightJobs` was non-empty, run only the edit queue;
- else start emitters.

A 20 TPS mining stream keeps `lightJobs` non-empty, so the third branch never ran. The torch waited until the edit queue drained.

## Fairness

One `LightState` cannot interleave a region flood and an emitter flood. Fairness is at job boundaries, not mid-slice.

- An active region flood runs to its own commit. It is not restarted and not preempted.
- When that commit happens on a budgeted slice and emitters are waiting, the edit queue stops. The next idle start is the emitter batch (`lightTurn = 'emitter'`).
- When the emitter batch commits and region jobs remain, the next idle start is the edit queue.
- If both are waiting and neither flood is active, an overdue emitter (age ≥ `EDIT_LIGHT_MAX_WAIT_MS` = 150) starts before an edit that is not itself overdue. If both or neither are overdue, `lightTurn` decides.
- Streaming still gets up to `EDIT_LIGHT_STREAM_SLICES` (2) before a queued edit, unless the edit or the emitter is already overdue.
- `flushLighting` still drains everything. It finishes an active emitter batch without absorbing newer sources, then the queued batch, then region jobs.

`?perf=1` extends the edit line with `EMITQ <queued>[ active] age <ms> commits <n>`.

## Add-emitter consistency

Chosen model: immutable batch plus the same sparse pins (options A and B together). Not a merged job type, and not a full region flood per torch.

- The coordinates copied into the flood at start are the batch. `addBlockLightEmitters` does not append later calls while `owner === add-emitter`.
- `noteLightingBlockOverride` records the previous block id for both `region` and `add-emitter`. First write wins. `viewedBlock` / `emissionAt` read that pin.
- A torch broken mid-flood still emits for that flood. The removal is a region job and runs after the emitter commit.
- A torch placed mid-flood stays on `pendingEmitters` and lights in the next batch, against the live world after pins are cleared.
- The commit matches the block view at flood start. The following scheduler work (region job and/or next emitter batch) reaches the final world.

## Tests

`tests/lighting-emitter-fairness.test.ts`

- Torch and lantern, each placed mid-stream while stone breaks arrive about every 50 ms and `processLighting(2)` runs at 60 FPS for several seconds. The block is in the world immediately. Emitter light commits while later breaks are still being applied (torch at 27 of 80 breaks, neighbor block light 13; lantern at 24 of 80, neighbor 14). Edit commits continue after that (4 further edit commits in the probe). Neither queue waits for the stream to end. Restarts stay 0. Queue peak 2. Pending emitter count peak 1. Emitter pending age about 217–333 ms of test clock. Edit pending age about 1.17–1.30 s of test clock.
- Wall placed during a yielded add-emitter flood, plus a second torch. Mesh light at the source stays on the pre-commit value. The second torch stays queued (count 1) through the first commit. That commit matches an immediate world that has only the original torch. After settle, block and sky match an immediate world that has the torch, the wall, and the second torch. Pins and snapshot bytes are 0.
- Torch place → partial flood → break torch → emitter commit matches the immediate lit world, then settle matches the immediate dark world.
- Torch on/off, lantern on/off, redstone torch on/off while region edits continue. Both job kinds commit during the stream. Final samples match the immediate reference. Queue stays within the cap. Pins and snapshots are released.

`tests/lighting-edit-queue.test.ts` age guard:

The old `maxAge < 2500` allowed a multi-second stall. Under this fake clock one call is one cap-slice and then the clock jumps a whole frame, so age is not the 16 ms CPU figure. The measured peak is 75 frames at 60 FPS (1.25 s of test clock) and 57 frames at 30 FPS (1.90 s). The frame bound is that peak plus `2 * EDIT_LIGHT_MAX_WAIT_MS` of slack (1.55 s at 60 FPS, 2.20 s at 30 FPS). A second assert prices the same age as slices times `WORLD_LIGHT_BUDGET_MS` and requires it to stay under `2 * EDIT_LIGHT_MAX_WAIT_MS` (300 ms). A quiet hold for the whole stream fails both. The assert is not an exact timestamp.

Census: `EmitterCensusScanner.advance` compares loaded chunk keys on the census step, not on every animation frame. A set change during the hold is picked up at the next step (400 ms). The census test covers that.

## CPU benchmark

`npm run benchmark:lighting`, Node, budget 2 ms. Same shape as the queue pass:

| Trial | Result |
| --- | --- |
| creativeBurst100 | about 8.0–8.3 ms, max slice about 2.02 ms, 5776 columns, 2518 nodes, 36 slices, peak snapshot 8192, 0 after settle |
| creativeBurst100Stream | commits during 9, max queue 2, age 16 ms, restarts 0, merges 89 / enqueued 11, columns 41124, nodes 20558, max slice about 2.02–2.03 ms, edit phase about 69 ms, settle 38 slices about 10.5 ms, snapshot 0 / peak 8192 |
| same chunk | queue 1, merges 99, enqueued 1 |
| distant | queue 2, regions maxX 28 and minX 151 |

## Other validation

| Command | Result |
| --- | --- |
| lighting-emitter-fairness, lighting-edit-queue, lighting-stable-mesh, lighting-jobs, lighting-scheduler, lighting-physics-interaction, emitter-census | 62 passed |
| `npm run typecheck:client` | PASS |
| `npm run typecheck:server` | PASS |
| `npm run check:boundaries` | PASS |
| `npm run build` | PASS |
| `npm run benchmark:lighting` | PASS, numbers above |

The known urgent-mesh 2 ms timing flake was not rewritten and not used to hide anything. This follow-up does not change that test.

## Preserved

Region queue, no active-region restart, sparse pins, stable committed mesh light, reader release in `finally`, queue cap 32, spatial coalescing, streaming fairness (2 slices / 150 ms), immediate server lighting, budget 2, no second full light buffers, no global brightness change.
