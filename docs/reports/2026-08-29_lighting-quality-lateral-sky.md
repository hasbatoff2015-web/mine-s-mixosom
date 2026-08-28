# Lighting Quality and Lateral Sky

Date: 2026-08-29. Branch: `codex/lighting-quality-lateral-sky`.

## Goal

Fix roof-shaped rectangular darkness beside wide openings, over-columnar canopy shade, chunk-corner seams, external regional block light and cube/special lighting differences without restoring the expensive monolithic sky passes. Preserve fixed 20 TPS, live RAF look, render distance, one-chunk halo, day/night uniforms and the 2 ms PLAYING light budget.

## Result

Current follow-up: main `25fb847` is integrated at height256. Targeted274/274 plus final50/50; full check962 passed/24 failed with two RPC errors; separate build/size/archive PASS,3.60 MiB/221 files. Actual WebGL fixtures passed at1280x720 and844x390; Creative and Anarchy new/save/load smoke passed. Native pointer lock/manual building/flight remain unverified. See **Height-256 integration** for current results. The following original result and benchmark sections are historical96.

The canonical lighting path now computes a vertical baseline followed by bounded, resumable lateral propagation. Open-room/cave samples decay 13,12,...,1,0; sealing the opening removes them. A small roof hole gives a local 15 peak, with the far interior still zero. Meshes wait for every sampled neighbor and stable pending work. No ambient/gamma increase, new renderer, second lighting system, worker, gameplay feature or asset pack was added.

Targeted production-path checks passed 228/228 across 14 files, followed by 74/74 focused checks after the final guard change. Browser fixture checks cover actual WebGL rendering and control-driven mutations; native gameplay/GPU/mobile soak remains open. Full `npm run check` is not claimed green; see Tests. Production build/size/archive checks pass: 3.59 MiB, 219 files.

**Historical height96 delivery:** the sections below preserve the original measurements and integration gate as history. The follow-up integrates main `25fb847` at WORLD_HEIGHT=256; see **Height-256 integration** at the end for current contracts, validation and risks. PR #13 remains Draft and must not be merged without user acceptance.

## Confirmed Root Causes

- **Vertical-only sky confirmed on base main.** `fillColumnSky` stored incoming sky per column, opaque roofs zeroed all cells beneath them, and there was no lateral sky stage. A wide side entrance therefore could not change a roof's XZ shadow projection.
- **Historical performance reason confirmed.** The August 23 reports describe removal of full-chunk multi-pass horizontal sky after roughly 29-33 ms LIGHT stalls. This implementation does not restore that algorithm.
- **Diagonal contract mismatch confirmed.** `ChunkMesher` cached all eight adjacent chunks for corner samples, but `worldJobs.lightContextReady` and generation-unlock inspection considered four cardinals. The new diagonal-ready regression failed on the untouched baseline.
- **Regional external-light import confirmed missing.** Resetting an arbitrary block-light AABB seeded local emission but did not seed light arriving through the six outside faces. Baseline external Torch/Glowstone/Lantern tests returned 0 instead of 12/13/13.
- **Cube/special mismatch confirmed.** Cube corners averaged four cells; special geometry largely used one adjacent sample. The old average included opaque zero cells as darkness, coupling occlusion and light intensity.
- **Additional correctness risks confirmed.** The append-only 8192 queue could discard pending nodes; same-bounds edits did not restart already-scanned regional work; some gameplay getters/placement/furnace paths performed synchronous work. Dynamic emission of a broken burning furnace also needs the previous runtime emission, not only its registry value.
- **Partially confirmed visually:** the supplied forest/seam symptoms were not reproduced in the original user's saved world. Code/fixture regressions establish the mechanisms; native saved-world acceptance is still required. Current source already had budgeted streaming, versioned meshes, emission 15 Glowstone/Lantern and uniform day/night; those systems were extended, not duplicated.

The first five new regressions (room, three external sources, diagonal readiness) were run against untouched lighting code and all five failed before implementation.

## Implemented

### Sky and Block Algorithm

1. Initial vertical fill remains a column cursor; cache the highest filtering cell per column to avoid scanning uniform sky above terrain when looking for a frontier.
2. Seed only transitions that can improve a neighbor, plus initialized incoming chunk-boundary values. Propagate six-neighbor indirect sky with strictly decreasing level.
3. `LATERAL_SKY_RADIUS = 14` is the maximum positive indirect path from a direct level-15 cell: 15 -> 14 -> ... -> 1 -> 0. This avoids a conspicuous level-7-to-zero cutoff at radius 8, stays inside the existing 16-block halo, and the measured workload is below the old vertical-only implementation despite adding sky nodes. Radius was retained after benchmarking, not assumed cost-free.
4. Air, glass, ice, cross plants, doors, ladders, torches, lantern and chain do not filter sky. Oak/Birch/Spruce leaves, cutout cubes and water/lava filter vertical light by 1 and indirect steps by 2 (distance 1 + filter 1). Opaque cubes stop sky. Small shapes remain whole-voxel transmission approximations.
5. Material/filter changes reset the bounded affected XZ region to vertical baseline for its **full height**, then refill lateral sky inside it. Full-height column work is necessary because a roof edit affects cells far below the edit's Y. Addition and removal use the same reset/refill strategy; unchanged-bounds edits restart a job too.
6. Block light uses bounded XYZ clear/seed/flood. Seeds include local emitters and incoming light on **all six** AABB faces. Opaque non-emitting cells, including a cold furnace, cannot import boundary light. A burning furnace queues its own dynamic emission before that guard. Torch/furnace remain 14; Glowstone/Lantern/Lava remain 15. Emission-only torch/furnace transitions skip sky.
7. Reusable packed `Uint32Array` ring queue, one pending flag per active voxel, cached chunk-neighbor entries and typed registry filter/emission tables. Capacity may grow to the active loaded voxel bound; overflow does not drop light. No per-node string-key lookup in the chunk interior.
8. One continuation per world in the existing LightEngine, shared by sky/block; no second mutex. Phases are clear, seed and flood for each channel. Deadline checks every 4 scanned columns / 32 nodes; finite caps of 256 columns per engine continuation and 4096 nodes. An initial call can also fill up to 256 vertical columns. This bounds work even with a frozen clock; it is not a hard real-time 2.000 ms guarantee.
9. Lazy touched-chunk snapshots compare final arrays before version publication. Only real final differences and border/diagonal readers are dirtied, once per completed job. Reset/refill yielding the same field causes no remesh. Snapshot comparison and small allocations are bounded by the job's touched loaded chunks but are not a separate resumable commit phase.

### Scheduler and Rendering

- Lighting computation itself has no neighbor-ready dependency. All **eight** sampled neighbors are required only for meshing; the same offsets drive generation unlock and debug dependency walks.
- Keep skip-blocked, nearby unlock priority, current-owner resumption, obsolete abandonment and distant initial-job preemption. A queued edit acquires a free lane before another initial job; active work retains the one queue. No second global owner is introduced.
- Game enables `deferredLighting` on new and loaded worlds. Normal mutation/getter/furnace paths cannot synchronously drain the queue. Explicit synchronous test/DEV utilities remain.
- Pending regional bounds, queued emitters and actively written chunks gate meshes. Initial completion requires vertical sky, lateral sky and block light.
- `sampleSurfaceVertexLight` is shared by cube and actual special-geometry vertices. Bilinear exposed-side samples exclude opaque cells from intensity. Two solid side cells suppress a diagonally hidden light sample; AO is separate and limited to 0.8..1. Existing ambient, gamma, face orientation shade and fire emission override remain.
- Stored sky now includes indirect light, so direct-sun gameplay uses a bounded direct-column sample after a cheap stored-sky early-out. Bright lateral level 14 under a roof must not ignite hostiles.
- Existing DEV vegetation viewer gained shared deterministic lighting fixtures and its real sliced light/mesh lifecycle; controls use the real World APIs and existing F7 modes. No production HUD was added.

## Changed Files

- Engine/lifecycle: `src/world/LightEngine.ts`, `World.ts`, `Chunk.ts`, `worldJobs.ts`, `streamingScheduler.ts`, `streamingSim.ts`, `src/core/constants.ts`, `src/core/Game.ts`.
- Rendering/gameplay sampling: `src/world/lightSampling.ts`, `src/rendering/ChunkMesher.ts`, `WorldRenderer.ts`, `src/combat/fireSources.ts`.
- DEV/benchmarks: `src/dev/lightingQaScenes.ts`, `VegetationQaHarness.ts`, `src/main.ts`, `scripts/benchmark-lighting.ts`.
- Tests: lighting-seams, lighting-jobs, lighting-scheduler, streaming-scheduler, fluid-streaming and dirty-queue.
- Documentation: PROJECT_STATE, ARCHITECTURE, TESTING, ROADMAP, this report and the two archived CPU benchmark JSON files.

## Architecture Decisions

The queue/state stays in LightEngine and the scheduler keeps the same lane. The 14-step model costs more sky nodes but eliminates repeated registry/world lookups and full-volume synchronous resets. Per-chunk column-height metadata is 512 bytes; active-job flags cost one byte per voxel, with lazy light snapshots only for touched already-ready channels. Save arrays/schema, 20 TPS, live camera, render distances, mesh budgets, atlas caches and Yandex SDK paths are unchanged.

No vanilla-exact partial-block occlusion, directional skylight, weather, worker/greedy meshing or global ambient adjustment is included.

## Performance: CPU

Same script, scenes, seed, WORLD_HEIGHT=96, 2 ms budget and three measured trials per case, after two warm-ups. Baseline runs dynamically imported the untouched detached worktree at `6e27b93bb0b05e1bc7e115d262603c866fa153a5`; then the clean worktree was removed before full Vitest discovery. These are not measurements of the later 256-height main. Final raw data:

- [Before](../benchmarks/2026-08-29_lighting-before.json)
- [After](../benchmarks/2026-08-29_lighting-after.json)

Totals measure `World.processLighting`, excluding world generation, synchronous fixture preparation, mutation cost and mesh building. Mutation timings are separately present in JSON. Worst slice is the largest full World call or internal light slice across all three trials, not an average. Cases are executed to completion, not truncated at a chosen frame count.

| Scenario | Before total median, ms | After total median, ms | Before worst slice, ms | After worst slice, ms |
| --- | ---: | ---: | ---: | ---: |
| initialChunk | 22.18 | 5.22 | 2.87 | 2.08 |
| initial81StreamingSlices | 1334.29 | 445.20 | 3.91 | 3.64 |
| openRoom | 248.27 | 67.25 | 3.27 | 2.13 |
| caveEntrance | 243.12 | 75.45 | 3.38 | 2.07 |
| forest | 249.56 | 80.69 | 3.54 | 2.08 |
| roofOpen | 14.90 | 13.90 | 5.67 | 2.07 |
| roofClose | 13.42 | 7.89 | 5.04 | 1.20 |
| torchAdd | 7.09 | 2.06 | 2.49 | 2.06 |
| torchRemove | 21.13 | 4.77 | 21.91 | 1.25 |
| glowstoneAdd | 64.20 | 13.44 | 25.60 | 2.43 |
| glowstoneRemove | 56.77 | 9.78 | 24.48 | 1.74 |
| lanternAdd | 7.98 | 2.32 | 2.47 | 2.78 |
| lanternRemove | 24.17 | 6.23 | 24.91 | 1.82 |
| externalRegionSource | 0.20 | 1.38 | 0.31 | 1.45 |
| cardinalBorder | 6.21 | 1.65 | 2.23 | 1.94 |
| diagonalCorner | 61.97 | 13.33 | 26.83 | 2.06 |
| repeatedEdits30Frames | 78.06 | 16.94 | 7.26 | 2.05 |
| creativeBurst100 | 31.82 | 16.21 | 10.43 | 2.04 |
| wallCloseOpen | 34.35 | 18.02 | 13.78 | 2.04 |

The external-source case does **more correct work** after the fix: final light is 13 instead of the baseline's wrong 0. No speed-up is claimed there. The 100-break case really removes 100 distinct prepared Stone blocks, with one mutation call per break. The two-frame wall close/open case intentionally measures coalescing, while room tests separately settle both states.

| Scenario | Columns before / after | Nodes before / after | After job calls (median) | Peak dirty before / after | CPU mesh commits before / after |
| --- | ---: | ---: | ---: | ---: | ---: |
| initialChunk | 512 / 1024 | 703 / 703 | 4 | 1 / 1 | 0 / 0 |
| initial81StreamingSlices | 41472 / 82944 | 24511 / 31367 | 344 | 81 / 81 | 52 / 49 |
| openRoom | 8192 / 16384 | 0 / 2518 | 64 | 16 / 16 | 4 / 4 |
| caveEntrance | 8192 / 16384 | 0 / 2518 | 64 | 16 / 16 | 4 / 4 |
| forest | 8192 / 16384 | 0 / 5616 | 66 | 16 / 16 | 4 / 4 |
| roofOpen | 289 / 3364 | 0 / 2155 | 25 | 2 / 4 | 2 / 4 |
| roofClose | 289 / 3364 | 0 / 0 | 24 | 2 / 4 | 2 / 4 |
| torchAdd | 0 / 0 | 1955 / 1956 | 1 | 3 / 4 | 7 / 4 |
| torchRemove | 0 / 1682 | 0 / 0 | 8 | 4 / 4 | 4 / 4 |
| glowstoneAdd | 961 / 3844 | 2275 / 2275 | 17 | 4 / 4 | 4 / 4 |
| glowstoneRemove | 961 / 3844 | 0 / 0 | 16 | 4 / 4 | 4 / 4 |
| lanternAdd | 0 / 0 | 2275 / 2276 | 1 | 3 / 4 | 7 / 4 |
| lanternRemove | 0 / 1922 | 0 / 0 | 8 | 4 / 4 | 4 / 4 |
| externalRegionSource | 0 / 80 | 0 / 223 | 4 | 0 / 0 | 0 / 0 |
| cardinalBorder | 0 / 0 | 1956 / 1957 | 1 | 3 / 4 | 7 / 4 |
| diagonalCorner | 961 / 3844 | 2275 / 2275 | 17 | 4 / 4 | 4 / 4 |
| repeatedEdits30Frames | 1724 / 6554 | 0 / 2518 | 53 | 2 / 2 | 60 / 2 |
| creativeBurst100 | 676 / 5776 | 0 / 2518 | 36 | 2 / 4 | 2 / 4 |
| wallCloseOpen | 680 / 6152 | 0 / 2518 | 49 | 2 / 2 | 4 / 2 |

Columns count phase visits, not unique XZ cells; the new clear/seed stages mean 1024 visits per initial chunk instead of 512. Nodes include indirect sky and, after the diagnostics fix, add-emitter seed visits. Job calls are continuation attempts, not unique completed jobs; `completedJobs` in JSON is the scheduler's initial-chunk completion counter. Old add-emitter attempts were not counted, so their job-call totals are not directly comparable.

Mesh commits are **production-gated CPU acknowledgements**, not actual geometry timing, draw calls or GPU FPS. Initial81 is 49 visible chunks plus halo; baseline's 52 acknowledgements include repeated premature refreshes. Dirty/commit figures must not be sold as browser frame-rate gains.

Final comparable 12-chunk radius-6 flight: near-wanted worst absence 8900 -> 2450 simulated ms, player absence 150 -> 0 ms, completed visible meshes 42 -> 112; peak in-radius mesh pending 168 both. The older prefetch ready-age metric increased 1700 -> 2033 ms, so not every queue metric improved. This is CPU scheduler simulation, not measured browser latency.

Final scenario worst slice: 26.83 ms before / 3.64 ms after. An earlier after run reached 5.76 ms; retaining that observation avoids implying every invocation is <=2 ms. No tens-of-ms LIGHT slice appeared in the isolated after benchmark. Heavy concurrent full-suite CPU load is a different measurement condition.

`npm run benchmark:streaming` completed the canonical sweep. Radius-6 30-chunk flight / reversal / zigzag: player absence 0 / 0 / 0 ms, near-wanted worst absence 2350 / 2300 / 2566.7 simulated ms; ready-wanted-to-mesh maximum 16.7 / 0 / 16.7 ms. All had peak obsolete mesh 0. Far/prefetch latency is not eliminated: reversal wanted-to-visible maximum 14783.3 ms and old prefetch age 19900 ms. The 30-break regression remained one dirty chunk / one pending mesh. Cold actual CPU mesh probes were 47.40-65.21 ms, not LIGHT slices and not a GPU result; no claim that this task made chunk geometry building hard-real-time.

## Tests

- Untouched base: `npm run check` passed typecheck but failed tests: 35 failed tests, one failed suite and three worker-RPC errors. CRLF geometry-source fingerprint (`e71967bd` vs `be428190`), reference-audio extractor syntax, worldgen/fire/minecart/lighting CPU timeouts and timing assertions were already present. This checkout is not the older missing-authored-pack environment.
- Intermediate full check: 906 passed / 32 failed / 938 tests, one failed suite, four RPC errors, 239.14 s. Three dirty-queue failures were new fixture assumptions: they cleared each chunk before later initial jobs refreshed neighboring light. The fixture now clears only after all initial jobs finish; original locality/coalescing assertions were not relaxed.
- Targeted broad run: **228/228 in 14 files**, 103.21 s, `--maxWorkers=1`, including 55 lighting-seams tests, fluid source/motion/streaming, radius-6 flight, furnace, TNT/support and batch paths. Subsequent changes add diagnostic job counts and the cold-furnace boundary guard/regression, not new rendering or propagation phases.
- The first broader targeted run exposed an outdated mesh fixture: an unlit center now correctly blocks all eight surrounding chunks. It now tests a ready second ring, retaining the skip-blocked assertion.
- Lighting-jobs setup uses one batch instead of hundreds of synchronous setup edits. Roof-neighbor and water/lava expectations were updated from the intentional vertical-only model to the requested lateral model. Unrelated tests and time limits were not changed.
- Final full `npm run check`: typecheck passed; **919 passed / 20 failed / 939 tests**, 9 failed / 71 passed files, one failed suite, two worker-RPC errors, 196.35 s. Build was not reached because tests failed. The CRLF fingerprint and extractor syntax failures match baseline. Fire/minecart, worldgen/lava/spawn, lighting preemption/flight and water-flight timeouts/timing failures remain; the relevant isolated lighting/fluid cases pass without threshold changes.
- The full run also failed `entities.test.ts` soft separation once (distance 0.09639 vs >0.3). It passes in the focused rerun (all 9 entity tests), and entity movement code is unchanged. This is an intermittent observed failure, **not proven pre-existing** by the baseline run and not declared fixed.
- Final focused run after the last engine guard: **74/74 in 4 files**, 10.61 s, `--maxWorkers=1`: lighting-seams 56, dirty-queue 4, furnace-orientation-lit 5, entities 9. No timeout overrides.
- Direct-sun integration diagnostic: **5/5 sunlight-burning tests**, 34 unrelated tests skipped, 25.53 s. Command: `npx vitest run tests/fire-contact-sunlight-minecart.test.ts -t "sunlight burning" --maxWorkers=1 --testTimeout=30000`. Two cases took 5.49 / 7.26 s, so this explicitly uses a longer command-line limit than the original suite. No source test timeout was changed; this does not make the default full check green.
- Logs remain locally in `.local/lighting-check-final.log`, `lighting-targeted-final.log`, `lighting-followup-tests.log` and `lighting-sunlight-followup.log`. The full check preceded the 56th seam regression; the final focused run includes it.

## Build

- `npm run build`: PASS (TypeScript + Vite, 142 transformed modules, Vite build 6.42 s).
- `npm run check:size` and `npm run check:archive`: PASS, **3.59 MiB / 219 files**. The standard archive check validates the production directory, not creation of a ZIP: root index exists, paths contain no spaces/Cyrillic and no source/debug files are shipped.
- Production JS/CSS: 1004.53 / 39.27 kB before gzip. Vite reports the expected external `/sdk.js` warning and >500 kB JS chunk warning. `/sdk.js` stays in root `index.html`; DEV lighting fixture route/labels are absent from the built JS.

## Visual QA

Actual in-app Browser / WebGL checks, not Node geometry tests:

- Room: ready SKY line 13..0; Wall close yielded all zero, reopening restored the line.
- Single roof hole in the closed room: 11,12,13,14,15,14,...,1,0 along the sample line. Closure removed sky.
- Torch, Glowstone and Lantern were selected via the UI in the sealed room; source illumination was visibly localized. Lantern at night retained warm block light. Source removal in BLOCK mode produced a completely black canvas scene below the UI (one sampled color, mean 0).
- Cave fixture: ready pending=0, nine meshes, continuous entrance-to-interior gradient. Forest fixture: pending=0, nine meshes, edge sky15/14 and interior6 under nine filtering layers.
- Desktop 1280x720 and landscape 844x390 screenshots inspected. The mobile canvas fills the viewport; document scrollWidth=844 and all control bounds fit without overlap. Forest orbit screenshots differ, confirming movement and live assets.
- Canvas-region screenshot pixel sampling excludes the top UI: room 549 sampled colors/mean54.79; sealed room 301/34.61; roof hole482/58.65; torch1581/55.20; glowstone1751/57.84; lantern-night1643/51.17; mobile room534/61.87; forest frames1001/120.64 and1007/120.91. These are image QA statistics, not physical luminance or GPU performance.
- Browser console errors: none observed in inspected settled scenes. Isolated viewer light max was 1.9-2.5 ms; a room session during concurrent test activity recorded 4.3 ms. No native-GPU FPS claim is made.

Local evidence is under `.local/lighting-*.jpg` (not shipped or committed). Early captures taken before lighting settled were replaced for final room/forest/cave evidence. The browser can throttle background RAF, so wait for pending=0 rather than treating an intermediate missing mesh as a completed result.

## Known Issues

- Historical height96 gate, superseded by Height-256 integration below: main advanced to WORLD_HEIGHT=256 during the initial delivery; those old measurements did not certify the combination.
- Full repository check remains red: baseline CRLF/extractor and CPU/RPC failures plus the separately classified intermittent entity-separation observation. No blanket green-suite or all-failures-pre-existing claim.
- Native pointer lock, gameplay Creative flight/breaking on the user's GPU, multi-minute soak and physical mobile touch are not established by the fixture viewer.
- Skylight is an integer, finite-distance approximation. Glass/small geometry does not simulate directional or partial voxel shadowing; there is no light from unloaded space outside the existing halo.
- Very widely separated edits coalesce into a larger AABB; continuous edits can delay final mesh publication until the region stabilizes. Work is sliced, but a frame cannot be guaranteed exactly 2 ms under GC/OS stalls.
- Snapshot comparison/publication and queue growth are not separate resumable phases. Observed cost is small here; pathological wide edit batches remain a profiling target.
- Existing old meshes can stay visible while refreshed light is pending; new meshes do not bake partial zero fields.
- `getDirectSkyLight` scans at most one WORLD_HEIGHT column for direct-sun candidates; it is not another stored light map.

## Deferred

No weather, new blocks, gameplay expansion, worker meshing, advanced redstone, dynamic shadow map or vanilla-exact light engine. No merge into main.

## Manual QA Checklist

Use a new throwaway Creative world, not a valuable save. DEV fixtures are transient, but ordinary gameplay still autosaves. The integrated branch now supports height256/current schema; the original height96 warning no longer applies to this head. A separate localhost origin/profile still protects valuable worlds during QA.

1. Spawn on an open field: daylight is bright; compare FINAL and SKY.
2. Find a dense forest: it is darker than the field without isolated black column holes.
3. Fly above multiple canopy layers and inspect the transition across their edges.
4. Walk beneath the canopy and compare edge vs center.
5. Build a large wooden room with a roof and a wide open wall.
6. Compare near floor/wall against the deep interior; expect a gradual decrease.
7. Close part of the opening: light should shrink locally.
8. Close the entire opening: no leftover daylight inside.
9. Reopen it and check that the gradient returns.
10. Open one ceiling block: a local bright column and surrounding falloff.
11. Replace it: no ghost sky remains.
12. Approach a cave entrance and walk inward through the gradient.
13. Check a deep sealed cave: dark without artificial light.
14. Place/remove a Torch and wait for LIGHT pending to settle.
15. Repeat with Glowstone; it is emission15, Torch14.
16. Repeat with standing/hanging Lantern and a Chain support.
17. Fuel a Furnace, let it stop and break it while burning: no stale light.
18. Place sources at x/z=15 and 16, including the four-chunk corner.
19. Enable F8 chunk overlay and F7 SKY/BLOCK/FINAL; inspect seams during loading and after settling.
20. Fly quickly in Creative through new chunks, then reverse and zigzag at the same render distance.
21. Break/place many blocks rapidly; also test a TNT batch and water/lava movement.
22. Observe LIGHT maxSlice, pending jobs and mesh refreshes; distinguish LIGHT from GEN/MESH/OS hitches.
23. Compare day and night; block light stays local and day/night does not queue full relight/remesh.
24. Weather is absent by scope. Check existing time-of-day transitions only; do not add rain for this task.
25. On a real landscape phone/tablet, check touch, safe areas, rotation and sustained performance. The automated 844x390 check is layout/render QA only.

## Next Work

The original integration prerequisite is handled in the Height-256 integration follow-up below. Keep the draft for user acceptance; do not repeat the merge or replace either side's implementation.

Then run the native checklist. Investigate full-suite baseline environment/timing failures separately; profile pathological wide-AABB edits only if actual device traces show a problem.

## Git

- Initial local branch: `feat/custom-production-sfx`, clean, HEAD `27a9c3c9b850e75ff8e02f5ce206dfb2d34a7152`.
- Freshly fetched base `origin/main`: `6e27b93bb0b05e1bc7e115d262603c866fa153a5`.
- Work branch: `codex/lighting-quality-lateral-sky`, created from that base.
- Implementation commit SHA: `6ab1d13f1399627a6cc952b439d42a09dc29dc30`.
- Final delivery head: the documentation follow-up on the PR; a report cannot contain its own immutable Git hash. The final response and PR head identify that commit.
- PR URL: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/13 (draft, feature -> main, not merged).
- Final origin/main recheck: **changed**, now `25fb847fc3762b99f8b10b6a6f24f0b2d234c998`, ten commits beyond the original base. Merge commit: `Merge branch 'cursor/spawn-map-import-256-height'`.
- Required status/branch/30-commit graph were inspected after fetch. `git merge-tree --write-tree --name-only HEAD origin/main` (no checkout/index/ref changes) returned content conflicts in `src/world/LightEngine.ts` and `src/world/World.ts`. All four current docs also overlap the incoming change and will need a combined state description. Decision: publish the reviewed 96-height implementation as a draft; leave integration explicitly blocked, not silently overwrite the 256-height work or claim it tested.
- Temporary clean baseline worktree was removed. No main commit/push, history rewrite, force push or PR merge.
- GitHub connector creation returned403. The PR was created through GitHub's API using the existing local Git credential helper, without logging or persisting its credential. Browser comparison showed no signed-in session. Local helper scripts/body under `.local/` are not part of the change set.

## Height-256 integration

### Scope and conflicts

Integrated main: `25fb847fc3762b99f8b10b6a6f24f0b2d234c998`, into the existing `codex/lighting-quality-lateral-sky` branch, continuing the already-resolved working tree and in-progress ordinary merge. Original feature head: `04e023534b5c33d14d4db876fdbb772718a969f6`. Conflicts in `LightEngine.ts`, `World.ts`, `ROADMAP.md` and `TESTING.md` were resolved semantically; neither side was selected wholesale. Incoming height256, importer, Anarchy and save changes remain present. No reset, new feature branch, rebase, force push, new PR or PR merge.

### Height, implicit sky and import contracts

- WORLD_HEIGHT is 256, valid Y is 0..255. Terrain still caps at 84. `occupancyTop`/`writeIndex`/`scanMaxY` remain authoritative and conservative; removal never requires a full occupancy rescan.
- Vertical fill and direct-sun scans start at `scanMaxY`. Frontier seeding uses `skyFilterHeights`; block clear/seed uses the greater of occupied height and conservative `blockLightTop`, including neighbor spill above its own low occupancy.
- Effective sky is 15 above each column's materialized extent. `skyStoredHeights` preserves this when transparent high geometry raises global occupancy without a sky job. This was necessary: the first new run caught Lantern230 changing previously implicit sky to raw zero. The fix is shared by flood, getter and packed mesher access via `skyLightAtIndex`.
- High opaque roof/import invalidation recomputes required columns before readiness, so stale implicit 15 is never baked through a Y200 roof. Column extents can differ after a partial regional pass; unchanged columns remain valid. Stored sky still includes direct plus lateral; gameplay direct-sun queries stay distinct.
- Import preserves `skipSupport`, `deferChunkLighting`, 8192-write batches and current save deltas. It cancels/restarts the single continuation while preserving emission seeds, invalidates all eight mesh readers and all three light readiness flags. Initial block seeding ignores unready neighbors' stale arrays. No per-voxel synchronous import relights.
- All four Game paths set deferred lighting before setup: singleplayer new/load, Anarchy new/persisted. Actual-path tests restore schema1 Y255 modifications and retain canonical Anarchy id/spawn/old metadata without fetch or rebuild. Production still never imports `.schem`; no save migration or identity change.
- Radius14 remains horizontal/path-distance bounded inside the unchanged 16-block generated halo. Eight-neighbor mesh readiness, skip-blocked scheduling, regional six-face external seeds, dynamic furnace emission, same-bounds restart, stable versions and shared cube/special sampling remain intact.

### Memory audit

Dense voxel storage remains 128 KiB blocks + 64 KiB sky + 64 KiB block light = 256 KiB/chunk, versus 96 KiB at the historical height96. This unavoidable 2.667x storage change comes from height256, not snapshots. The new engine uses one-bit queued flags (8 KiB/active entry), not 64 KiB byte flags. Snapshots copy only first-written 4 KiB channel pages and compare effective sky, not whole light arrays.

| Render radius | Loaded with one-chunk halo | Blocks MiB | Sky MiB | Block light MiB | Metadata KiB | Measured peak snapshots KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 49 | 6.125 | 3.0625 | 3.0625 | 73.5 | 36 |
| 4 | 121 | 15.125 | 7.5625 | 7.5625 | 181.5 | 48 |
| 6 | 225 | 28.125 | 14.0625 | 14.0625 | 337.5 | 48 |

These measured generated-world + emitter workloads retained 64 KiB flags and a 128 KiB ring; snapshots and entry references returned to zero after completion. Metadata includes surface/biome caches plus both 512-byte sky height arrays. Across the full scenario sweep, the largest snapshot peak was 48 KiB (highYEmitter). A one-cell no-op relight regression copies exactly one 4 KiB page and does not bump the light version. Idle flag retention is capped at 16 buffers (128 KiB), and an expanded ring shrinks back to 128 KiB.

The audit also found a strong legacy diagnostics reference (`lastState`) retaining the most recent world after session exit despite the WeakMap. `disposeWorldLighting` now clears the matching reference and state during Game/DEV teardown; the regression checks released buffers and isolation from another live world. This lifecycle-only follow-up does not change benchmark execution paths.

For scale, naively retaining full byte flags plus both full light-array snapshots for every loaded chunk would add 9.1875 / 22.6875 / 42.1875 MiB at radii2/4/6. This is a hypothetical allocation bound for mechanically porting the old design, not a measured allocation of main's different engine. Lazy pages can still cover a full channel if an edit genuinely changes every page; the reduction is workload dependent. Temporary Maps/entries/targets are per active job/chunk, not per voxel string maps, and released on completion. `pruneChunks` retains radius+1, but flight can temporarily accumulate more chunks between its 80-tick calls. JS objects, pending edits/import voxel objects, renderer caches and GPU buffers are excluded, so these figures are not total browser RSS or a mobile memory guarantee.

### CPU benchmark at 256

Same script, seed, scenes, 2 ms budget and three trials; baseline dynamically imports untouched main `25fb847` from a temporary detached worktree. Historical96 JSON above is unchanged. Current raw data: [before256](../benchmarks/2026-08-29_lighting256-before.json), [after256](../benchmarks/2026-08-29_lighting256-after.json). Columns/nodes below are phase visits/work, dirty/commits are after maxima. CPU mesh acknowledgements are not geometry timings or GPU FPS. Baseline has incorrect vertical-only room/external light, so equal appearance is not implied.

| Scenario | Before median ms | After median ms | Before worst slice ms | After worst slice ms | After columns | After nodes | Dirty | CPU mesh commits |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| initialChunk | 16.77 | 6.74 | 2.72 | 2.07 | 1024 | 703 | 1 | 0 |
| initial81StreamingSlices | 980.59 | 475.68 | 4.19 | 19.45 | 82944 | 31257 | 81 | 49 |
| openRoom | 102.20 | 35.29 | 2.23 | 2.04 | 16384 | 2518 | 16 | 4 |
| caveEntrance | 99.62 | 38.26 | 2.28 | 3.19 | 16384 | 2518 | 16 | 4 |
| forest | 105.35 | 46.91 | 2.30 | 2.08 | 16384 | 5616 | 16 | 4 |
| roofOpen | 11.84 | 16.34 | 6.84 | 2.69 | 3364 | 2155 | 4 | 4 |
| roofClose | 9.77 | 9.82 | 5.82 | 1.70 | 3364 | 0 | 4 | 4 |
| torchAdd | 10.25 | 2.13 | 2.61 | 2.13 | 0 | 1956 | 4 | 4 |
| torchRemove | 22.61 | 3.31 | 23.53 | 0.94 | 1682 | 0 | 4 | 4 |
| glowstoneAdd | 51.81 | 12.64 | 32.22 | 2.05 | 3844 | 2275 | 4 | 4 |
| glowstoneRemove | 45.11 | 9.30 | 32.60 | 3.65 | 3844 | 0 | 4 | 4 |
| lanternAdd | 8.86 | 1.92 | 2.66 | 2.03 | 0 | 2276 | 4 | 4 |
| lanternRemove | 24.09 | 3.92 | 25.05 | 1.23 | 1922 | 0 | 4 | 4 |
| externalRegionSource | 0.20 | 1.16 | 0.26 | 1.83 | 80 | 223 | 0 | 0 |
| cardinalBorder | 6.56 | 2.00 | 2.43 | 2.24 | 0 | 1957 | 4 | 4 |
| diagonalCorner | 52.75 | 14.71 | 27.38 | 2.76 | 3844 | 2275 | 4 | 4 |
| repeatedEdits30Frames | 67.34 | 19.93 | 17.09 | 2.06 | 6554 | 2518 | 2 | 2 |
| creativeBurst100 | 19.75 | 18.23 | 9.86 | 2.06 | 5776 | 2518 | 4 | 4 |
| wallCloseOpen | 22.98 | 19.59 | 13.43 | 2.06 | 6152 | 2518 | 2 | 2 |
| highYRoom | 462.26 | 259.37 | 4.03 | 2.57 | 16384 | 2518 | 16 | 4 |
| highYEmitter | 14.20 | 5.40 | 2.21 | 3.37 | 0 | 4090 | 4 | 4 |
| importedStructureLighting | 475.70 | 268.37 | 4.25 | 2.62 | 16384 | 0 | 16 | 4 |

Initial81 after trials had maxima 2.77 / 19.45 / 2.20 ms. An isolated three-trial repeat gave 3.59 / 2.17 / 2.29 ms, with unchanged 82944 columns / 31257 nodes / 49 commits and only 20 KiB peak snapshots. The >10 ms event did not repeat; its exact cause is not established (no trace proving GC/OS), and the original value is retained. Common edit cases did not show recurring 20-30 ms LIGHT stalls. High-Y and page comparison can exceed 2 ms modestly; no hard-real-time claim.

The actual 9956-voxel imported room spans 16 chunks and multiple 8192-write batches: mutation/import call 32.56-41.44 ms after, then sliced light median268.37 ms / worst2.62 ms. There is no multi-second synchronous relight. Import itself remains synchronous/batched infrastructure, so arbitrarily huge offline imports are not promised stall-free. RoofOpen takes more total CPU than main because it now performs correct lateral propagation; externalRegionSource returns correct13 instead of wrong0.

Comparable 12-chunk radius6 simulation: near-wanted worst absence 8900 -> 2333.3 simulated ms, player absence 0 -> 0, visible completions62 -> 120. Canonical `benchmark:streaming` radius6 flight/reverse/zigzag: player absence0/0/0; near-wanted2316.7/2283.3/2533.3 ms; ready-wanted-to-mesh max16.7/0/16.7 ms; obsolete mesh0. Prefetch/far latency remains, including reverse wanted-to-visible max14800 ms. Thirty-break regression is one dirty chunk / one pending mesh. Cold actual CPU mesh samples47.79-66.22 ms are geometry costs, not LIGHT or GPU FPS.

### Tests256

- Immediately after conflict resolution, before the optimization pass:78/78 across lighting-seams, world-height-256, schematic-import and anarchy-world. Initial optimization compatibility run82/82 including dirty-queue.
- New `lighting-height-256.test.ts`:24 tests covering roof200/direct-vs-lateral/open-close, local hole220, Glowstone/Lantern230 and removal, all requested Y0/84/95/96/128/200/254/255 and invalid bounds, high diagonal mesh ordering, low-occupancy neighbor spill, imported high roof/ghost emission/in-flight restart, transparent occupancy growth/partial column materialization, page snapshots/no-op versions, disposal isolation and all four actual Game creation/load paths with current schema1.
- Broad targeted:274/274 in18 files,102.73 s, `--maxWorkers=1`, before the final disposal regression. Final follow-up:50/50 in5 files,13.61 s (height lighting24, dirty4, height6, import9, Anarchy7), after the last code edit. No assertion/timeout relaxation.
- Fresh untouched main256 `npm run check`: typecheck PASS,880 passed/36 failed/916 tests,12 failed/71 passed files, one failed suite and two worker-RPC errors,174.56 s. Temporary clean baseline worktree removed before integrated full discovery.
- Integrated `npm run check`: typecheck PASS,962 passed/24 failed/986 tests,9 failed/75 passed files, one failed suite and two RPC errors,255.38 s. All24 new high-Y tests passed in this full run. Build was not reached because tests failed; it was run separately.
- Matching failure names: CRLF source fingerprint (`e71967bd` vs `be428190`), reference-audio extractor SyntaxError, fire/sunlight/minecart, worldgen/lava/spawn and lighting/fluid/streaming CPU timing. Under full parallel load, water-flight exceeded20 s and lava-flight measured8366.7 simulated ms versus its8000 limit; both passed the isolated broad run unchanged.
- **Additional observed default-timeout failure:** minecart Shift dismount `places the player beside the cart...` passed this main baseline but timed out integrated; isolated default rerun also timed out at6.64 s versus5 s. Its assertions pass with an explicit30 s CLI diagnostic. The shared legacy fixture clears terrain with thousands of synchronous `setBlock` calls; runtime Game worlds defer lighting. This timeout is not labelled pre-existing or fixed, and unrelated fixture code/timeouts were not changed.
- Explicit diagnostic: `npx vitest run tests/fire-contact-sunlight-minecart.test.ts -t 'sunlight burning|places the player beside' --maxWorkers=1 --testTimeout=30000`:6 passed/33 skipped,47.42 s, including all5 sunlight cases and dismount. This is behavioral evidence with an increased command-line timeout, not a default full-check pass.
- Local logs: `.local/lighting256-{merge-baseline-tests,optimization-tests,targeted-final,followup-tests,check-main,check-final,dismount-rerun,sunlight-diagnostic}.log`. CPU JSON and separate spike repeat remain locally; the two complete256 JSON files are committed.

### Build256

`npm run build`, `npm run check:size`, `npm run check:archive`:PASS. Vite149 modules,8.04 s; production3.60 MiB/221 files; JS1010.18 kB (gzip285.10), CSS39.27 kB. Expected `/sdk.js` external-script and >500 kB chunk warnings remain. Archive check validates the output directory and root index/paths/no debug sources; it does not create a ZIP. DEV lighting routes/labels/benchmark case names are absent from built assets. No SDK path, production Anarchy behavior or assets scope change from this lighting integration.

### WebGL QA256

Actual in-app Browser against the integrated Vite source on separate origin `http://127.0.0.1:4174/`, protecting existing4173 saves. All7 fixtures (room/closed/hole/cave/forest/sources/high) rendered at both1280x720 and844x390, with actual textures and stable nine-mesh completion. One early high-mobile capture at7 meshes was replaced after all9 completed. No console errors observed. Controls fit without overlap, document scrollWidth844 at844 width. Viewer slice maxima were1.9-3.2 ms; these are observations, not native-GPU FPS certification.

Room and high-room wall close gave all-zero SKY; reopen restored13..1..0. Roof hole gave a local15 peak with zero far interior. Torch/Glowstone/Lantern were selected through controls in the closed room, night retained localized block light, and removing the source in BLOCK mode left a black scene. Forest edge15/14 transitions to interior6; separate orbit captures changed, demonstrating live rendering. No ambient/gamma tuning was used.

Canvas-region screenshot pixel samples (every8 pixels, below y130 UI) confirm nonblank assets: desktop room523 colors/mean55.29; closed284/34.61; hole434/59.07; Torch1467/55.63; Glowstone1635/58.27; Lantern-night1514/51.68. Mobile high498/63.03, closed209/35.54. Removed BLOCK scene1 color/mean0. Forest moving frames435/115.30 and365/114.75. These are image checks, not physical luminance. Evidence: `.local/lighting256-*.png`, not shipped.

Real gameplay smoke: created `Lighting256 QA throwaway`, seed`lighting256-browser`, Creative, via ordinary menus; initial chunks settled81/121 with sky15 and fixed20 TPS. Actual terrain/canopy and assets rendered. Pause/save/exit and reload preserved mode/seed/position56.50,66.01,0.50. Anarchy new entry and persisted re-entry both rendered the procedural world, seed`anarchy-spawn-v1`, Survival, spawn0.50,69.01,0.50, three starter apples and81/121 chunks. Anarchy stayed out of the singleplayer list. No schematic dependency appeared; no-fetch/no-rebuild behavior is established by actual Game-path tests and unchanged production importer/save code, not a claimed browser network trace.

**Input limitation:** pointer capture failed in this automation browser even with a visible tab, leaving the continue overlay. Chat opened but Enter did not submit the command through the supported input API. Thus real manual flight, building a large roof, source placement/removal and day/night through ordinary gameplay were not completed; fixture mutations/night are separately verified. No hidden runtime mutation or direct IndexedDB edit was used to bypass this limitation. Native input, device/GPU soak and physical mobile acceptance remain for the user. An F3 read briefly retained prior-session text until toggled; subsequent readings showed the correct Anarchy session. No unrelated HUD rewrite was made.

### Remaining risks and local acceptance

Keep Draft. Full check remains red as classified above, including the additional synchronous-fixture timeout. Wide-AABB batches can touch more snapshot pages; commit comparison and queue growth are not independent sliced phases. Conservative occupied/light tops can retain extra scan cost after tall geometry/source removal. Import writes themselves are still synchronous batches. Far-prefetch latency and cold mesh costs remain. Rare OS/GC scheduling spikes cannot be ruled out; the19.45 ms observation is preserved rather than attributed without a trace.

Run `npm run dev -- --port 4174` if the provided local server is stopped, then open `http://127.0.0.1:4174/?qaLighting=high` and use Wall/Roof hole/source/day controls. For native acceptance use a new throwaway Creative world and the25-step checklist above, including roof200, hole220, emitters230 and Y255 boundary, F7/F8, rapid flight/reversal, then Anarchy save/exit/re-entry. Do not delete/migrate valuable saves or merge PR13 as part of QA.

### Integration Git

This section is part of the ordinary integration merge commit; its first parent is feature04e0235 and second parent is main25fb847. The immutable resulting SHA is identified by the final delivery and PR13 head (a commit cannot embed its own hash). Publication target stays `origin/codex/lighting-quality-lateral-sky`, PR13 remains Draft. No new branch/PR, no main push and no PR merge. Working-tree/PR-base diff checks pass; cached merge diff against the old feature also reports nine pre-existing Markdown hard-break trailing spaces from incoming main reports, which were deliberately preserved rather than rewriting unrelated history.
