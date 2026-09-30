# Lighting flicker: stable mesh during a sliced flood

Date: 2026-09-30
Branch: `cursor/lighting-flicker-stable-mesh-audit-47e9`
Base: `origin/main` `bc8b29fcb31d59a8ccb91088b8b342acb6428ada`
**Draft PR. Do not merge.** Production and the live spawn world were not changed.

## Goal

Stop the short dark flash that appears when blocks break faster than a sliced light flood can finish, without delaying the new voxel geometry and without a second full light buffer on every chunk.

Also add a way to measure whether a large number of voxel emitters costs idle CPU, initial lighting, or live edits. Do not raise global brightness in this change.

## Result

Urgent remesh still runs with `allowPendingLighting: true`. While a lighting job is open, the mesh reads the last committed light (lazy snapshot pages, then the live array for untouched pages). After the job commits, `lightVersion` bumps only when the result differs, and the normal light remesh follows.

`WORLD_LIGHT_BUDGET_MS` stays 2. Shader ambient, sky term, block-light visual scale, torch color, and daylight factor are unchanged. No `THREE.PointLight` path was added.

## Reproduced bug

Regression: `tests/lighting-stable-mesh.test.ts`.

A settled lantern (or glowstone) is removed through `applyNetworkBlockChanges` with deferred lighting. The test then slices `processLighting` until `world.blockLightAt` on a neighbor cell differs from the pre-image. At that moment:

- the raw working array has already been cleared or partially rewritten;
- `world.readMeshBlockLight` and `ChunkMesher.meshLightCell` still return the pre-image;
- `lightVersion` has not changed;
- `lightingMemoryUsage().snapshotBytes` is greater than 0 and smaller than two full light arrays for every loaded chunk.

After the job settles, the same cell is the final value (0 for a removal, 15 for an add), `lightVersion` has increased by one, and snapshot bytes are 0.

The same split is asserted for a roof hole (sky), a roof close, a cardinal border sample, a diagonal corner sample, an emitter add, a restarted edit burst, and lanterns at Y 200 and Y 230.

## Root cause

```text
block_update / block_batch
  → applyNetworkBlockChanges()
  → VoxelWorld.applyBlockBatch({ deferLighting: true })
  → lighting job queued
  → Game.queueUrgentMutationMesh()
  → processWorldJobs()
       LightEngine slice writes chunk.skyLight / chunk.blockLight
       touch() has already copied the old page
       drainUrgentMutationMesh()
         WorldRenderer.rebuildDirty({ allowPendingLighting: true })
           ChunkMesher.packedLightCell reads the working arrays
```

`LightEngine` mutates the real chunk arrays during a resumable flood. `touch()` copies a 4096-byte page of the previous logical light before the first write on that page. Commit (`consumeLightTouched`) compares those pages to the finished arrays and bumps `lightVersion` only on a real difference, then drops the pages.

Before this change the urgent mesh did not consult those pages. A yielded slice therefore baked a half-cleared field. The next commit bumped `lightVersion` and a second remesh restored the correct light. That is the flash: dark intermediate frame, then the final frame.

The frame order is lighting slice, then urgent mesh. If the job finishes inside the same 2 ms budget, the mesh already sees the final arrays and there is no flash. The flash is the yield.

## Why `allowPendingLighting: false` was rejected

Collision is already the server result. Skipping the urgent mesh until the flood commits would leave the broken block on screen for the rest of the job. Creative and a fast pickaxe would show input-to-visual latency. The required behavior is the opposite: the block disappears immediately, and the light on the remaining surfaces stays on the last committed field until one final update.

## Implementation

Committed read API on `LightEngine`, wrapped by `VoxelWorld`:

- `readMeshSkyLight` / `readMeshBlockLight` — one cell. Used by the breaking overlay.
- `bindMeshLightSample` — per-chunk closures for one mesh build.
- `chunkNeedsCommittedMeshLight` — true only when a non-initial snapshot has sky or block pages.

Read rule: if the chunk is `lightPending` and `lightingReady`, and the snapshot is not `initial`, and that page was copied, return the copied byte. Zero is a real level. Otherwise return `skyLightAtIndex` / `blockLight[index]`. Untouched pages are still the committed values, so a full second buffer is unnecessary.

`ChunkMesher` does not know page size. `bindCommittedLight` looks at self plus the eight neighbors. The hot path stays `packedLightCell` (direct arrays, no page lookup) unless one of those chunks actually has snapshot pages. A fake `lightPending` with no pages, which `tests/urgent-block-mesh.test.ts` sets, stays on that fast path. The function pointer switches only when the reader identity changes.

`sampleVoxelLightLevels` uses the same committed view so entity tint does not bake a partial flood. Gameplay `getSkyLight` / `getBlockLight` still see the working arrays.

Checked against the existing flood:

- Sky pages are copied through `skyLightAtIndex`, so implicit 15 above `skyStoredHeights` is the committed value.
- High Y 200 and 230 are covered by the regression test.
- `resetRegionLightFlood` clears the queue and owner, keeps `lightPending` and the existing pages, and does not restore the arrays. `startWork` does not clear `state.touched`, so a restarted burst keeps the original committed bytes. The burst test removes a glowstone, yields, then applies 30 more edits; mesh light stays on the original 15 until one later commit.
- Add-emitter jobs brighten the working array before commit; the mesh stays on the old value, including 0.
- Removal clears working block light toward 0; the mesh stays bright until commit.
- Border and diagonal samples go through the same binding on the neighbor chunk.
- Initial floods set `snapshot.initial` and store no pages. `rebuildDirty({ allowPendingLighting: true })` still returns 0 while `lightingReady` is false.

## Memory

No `committedSkyLight` / `committedBlockLight` arrays. Each loaded chunk still has one `skyLight` and one `blockLight`, each `VOLUME` bytes (`WORLD_HEIGHT` 256 → 65536).

Extra storage is the existing lazy pages: 4096 bytes per touched page per channel, only while a non-initial job is open. `lightingMemoryUsage().snapshotBytes` returns to 0 after commit, and `peekLightTouched` is empty. Initial chunk lighting does not allocate pages (`snapshot.initial`).

Idle overhead of the mesh reader is the 3×3 `lightPending` check already needed to decide the path. There is no per-vertex `Map` lookup when no neighbor has pages.

## CPU benchmark

Command: `npm run benchmark:lighting` on this agent, 2026-09-30. Output: `.local/lighting-benchmark-256-after.json` (gitignored).

This is a **CPU benchmark; not browser/GPU FPS.** Three trials, closed QA room, torches/lanterns/glowstone on a 2-block grid so radii overlap. Wall-clock milliseconds vary by machine; node and column counts are the structural signal.

| emitters | initial ms (3 trials) | max slice ms | nodes | slices | idle 30 calls | break nodes | remove nodes | add nodes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 13.52 / 13.46 / 13.28 | 0.46 / 0.42 / 0.45 | 0 | 48 | 0 nodes, 0 cols, ~0.23 ms | 0 | — | — |
| 32 | 15.39 / 19.85 / 16.92 | 1.37 / 2.90 / 1.09 | 5008 | 48–49 | 0 / 0 | 2106 | 1980 | 43 |
| 128 | 16.29 / 16.15 / 19.91 | 1.34 / 1.28 / 1.43 | 7943 | 48 | 0 / 0 | 2157 | 1992 | 43 |
| 256 | 18.47 / 15.97 / 16.43 | 2.00 / 1.29 / 1.38 | 8304 | 48 | 0 / 0 | 2157 | 1992 | 13 |

Sky columns stay 16384 in this scene (the vertical fill of the QA chunks), independent of emitter count. Initial flood `peakSnapshotBytes` stays 0 because the initial flag stores no pages. Idle `snapshotBytes` is 0 and `pending` is 0 at every count. One 256-emitter removal trial took 7.48 ms (max slice 3.92 ms) with the same 1992 nodes.

Reading: after settle, `LightEngine` does no flood work at every count in this scene. Static voxel emitters are not a per-frame lighting cost. They do add initial flood nodes, and in a closed overlapping room that curve saturates (the volume is already bright). A local break or one removal stays near ~2000 nodes from 32 emitters upward. Adding one emitter into an already bright room is a few dozen nodes.

Mesh triangle cost of torch/lantern geometry is separate and was not measured as GPU time.

## Tests

Commands on this agent, 2026-09-30:

| command | result |
| --- | --- |
| `npm run typecheck:client` | PASS |
| `npm run typecheck:server` | PASS |
| `npm run build` (`tsc --noEmit && vite build`) | PASS |
| `npx vitest run` the eight lighting/mesh files together | 125 passed, 7 failed (details below) |
| `npx vitest run tests/urgent-block-mesh.test.ts` alone | PASS 4/4 |
| `npx vitest run tests/lighting-scheduler.test.ts` together with urgent, second invocation | PASS 19/19 |
| `npm run benchmark:lighting` | completed, exit 0 |
| `npm run check` | not run |
| GitHub CI | not started |

Together, in one vitest process:

- `tests/lighting-stable-mesh.test.ts` — PASS 11/11
- `tests/incremental-mesh.test.ts` — PASS 4/4
- `tests/lighting-physics-interaction.test.ts` — PASS 8/8
- `tests/lighting-height-256.test.ts` — PASS 24/24, including the Y200 roof
- `tests/lighting-seams.test.ts` — 53 passed, 3 failed: wide wall, room entrance, cave entrance. `pendingLightJobs` stayed 1.
- `tests/lighting-jobs.test.ts` — 5 passed, 1 failed: lava idle expected > 5, got 0
- `tests/urgent-block-mesh.test.ts` — 2 failed inside that shared process (`rebuilt` 0, or `dirty` still true). PASS when run alone.
- `tests/lighting-scheduler.test.ts` — 1 timeout (15 s) inside that shared process. PASS on the next run (10187 ms).

`tests/urgent-block-mesh.test.ts` still expects urgent geometry while `lightPending` is set. It was not flipped to `allowPendingLighting: false`. The 2 ms budget is wall-clock, so a busy process can fail it without changing the reader.

The seam and lava failures match the existing edit-burst hold: `EDIT_LIGHT_BURST_BLOCKS = 8` and `EDIT_LIGHT_BURST_HOLD_MS = 80`. A tight `processLighting` loop on this VM finishes before the hold expires, so the region flood never starts. This branch does not change that hold. `src/world/World.ts` only adds the mesh-light wrappers.

## Build

`npm run build` PASS. Vite client bundle: `dist/assets/index-s98_AAXI.js` 1578.83 kB (gzip 451.52 kB). The existing chunk-size warning is unchanged in kind. `npm run check` was not used as a gate: it runs the full vitest suite, including the burst-hold cases above.

GitHub CI was not started from this agent.

## Manual QA required

Deploy this branch on the shared DEV environment. Do not delete spawn blocks.

1. Creative, a lit area: break a long line or wall quickly. Neighbor surfaces must not flash dark. The broken blocks must disappear immediately.
2. Survival with a fast pickaxe: the same.
3. A dark room with one torch or lantern: break ordinary blocks beside it. The source must not flicker.
4. Remove a torch, a lantern, and glowstone. Final light must go out. There must be no black frame before the final field.
5. Place them back. Light must come in as one update, not black then bright then final.
6. Open and close a roof, several blocks in a row.
7. Repeat near a chunk border (F8 or `?perf=1&chunks=1`).
8. If a high structure is available, repeat around Y 200.

Spawn measurement, DEV only (`?perf=1`). Wait until the `EMIT` line no longer says `scanning`.

A. Stand still 30–60 s. Record FPS, frame p50/p95/p99 if the overlay shows them, LIGHT slice / maxSlice, MESH, render, pending jobs, and the `EMIT` census.
B. Run around spawn for 60 s. Same numbers.
C. Dig only a permitted test area. Same numbers.

If LIGHT stays near 0 while standing, the static emitters are not an idle lighting cost. Initial load and edit node counts can still be large. Do not change global brightness from those numbers alone. A later request can compare a temporary emitter reduction; this branch does not remove spawn blocks.

## Recommendation

Do not raise `SKY_AMBIENT` or the other visual light constants yet. Do not replace voxel light with point lights.

From the code and the synthetic CPU benchmark, hundreds of settled voxel emitters do not keep `LightEngine` busy. They can increase initial flood nodes and the mesh cost of the torch/lantern models. Whether the real DEV spawn is in that saturated regime is what the `EMIT` census is for. If a later pass wants fewer lights, the options are fewer physical emitters or decorative non-propagating glow blocks. That is a separate change.

## Known limitations

- Simulation getters still observe the in-progress flood. Fire spread and mob spawn rules are unchanged.
- The urgent 2 ms mesh budget test is wall-clock. It passed alone (4/4). In one vitest process with the other lighting suites it missed the budget. That is contention, not a second light buffer.
- Entity samples and the breaking overlay follow committed light. They do not add a second lighting engine.
- Real spawn emitter counts and browser FPS were not measured here. The spawn world is not in the repository.

## Deferred

- Owner manual QA on DEV.
- Any spawn emitter reduction, decorative non-propagating glow, or ambient change.
- GitHub CI for this draft.

## Next work

Owner runs the checklist above on DEV and reports the `?perf=1` lines. Only after that is there a basis to change emitter count or brightness.

## Git

- Base: `bc8b29fcb31d59a8ccb91088b8b342acb6428ada`
- Branch: `cursor/lighting-flicker-stable-mesh-audit-47e9`
- Implementation commit: `8637d0a5d9b314e64e0557a34ca31def1f7c51e2`
- Not merged. No production deploy.
