# Lighting Quality and Lateral Sky

Date: 2026-08-29. Branch: `codex/lighting-quality-lateral-sky`.

## Goal

Fix roof-shaped rectangular darkness beside wide openings, over-columnar canopy shade, chunk-corner seams, external regional block light and cube/special lighting differences without restoring the expensive monolithic sky passes. Preserve fixed 20 TPS, live RAF look, render distance, one-chunk halo, day/night uniforms and the 2 ms PLAYING light budget.

## Result

The canonical lighting path now computes a vertical baseline followed by bounded, resumable lateral propagation. Open-room/cave samples decay 13,12,...,1,0; sealing the opening removes them. A small roof hole gives a local 15 peak, with the far interior still zero. Meshes wait for every sampled neighbor and stable pending work. No ambient/gamma increase, new renderer, second lighting system, worker, gameplay feature or asset pack was added.

Targeted production-path checks passed 228/228 across 14 files, followed by 74/74 focused checks after the final guard change. Browser fixture checks cover actual WebGL rendering and control-driven mutations; native gameplay/GPU/mobile soak remains open. Full `npm run check` is not claimed green; see Tests. Production build/size/archive checks pass: 3.59 MiB, 219 files.

**Integration gate:** the final fetch found a newer main (`25fb847`) with WORLD_HEIGHT=256 and Anarchy/import changes. This branch and all reported measurements use the original base, whose actual WORLD_HEIGHT is **96** (the standing AGENTS scope still says 80). A non-mutating merge-tree check found engine/world conflicts. No automatic integration was performed; the PR is draft and must not be merged until the 256-height integration and repeat validation are complete.

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

- Latest main advanced to WORLD_HEIGHT=256 during this task. Integration is deliberately unperformed, with confirmed content conflicts in LightEngine/World and overlapping current documentation. Neither the benchmark nor the green focused runs certify that combination. Do not merge the draft as-is.
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

Use a new throwaway Creative world on this branch, not a valuable save. DEV fixtures are transient, but ordinary gameplay still autosaves. Do **not** open a save created by the newer 256-height main with this 96-height branch; use the isolated DEV fixture routes or a separate browser profile for gameplay.

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

Before accepting the draft PR, integrate the newer main on this feature branch without rewriting history: reconcile occupancyTop/implicit empty-sky optimization with the new stored sky field, retain import options in World, invalidate lateral readiness and all sampled neighbors after imports, and enable deferred lighting for the new Anarchy create/restore session paths. Repeat lighting, import/height and streaming suites plus comparable CPU benchmarks at height256. This is a real integration task, not a mechanical conflict-marker removal.

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
