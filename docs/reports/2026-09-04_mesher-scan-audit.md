# Mesher scan audit (after PR #47)

Date: 2026-09-04  
Branch: `cursor/mesher-scan-audit-3ff8`  
Base: PR #47 `cursor/perf-audit-spawn-3ff8` @ `2682e65`  
`origin/main` is still `03685a9` — **PR #47 is OPEN, not merged**. This work is stacked on #47 and does not revert it.

## Goal

Explain the remaining 15–30 ms nearby mesh scan, compare greedy / worker / scheduler / AO / pixel-ratio options, then apply only a proven low-risk mesher change.

## Browser / GPU

Chrome is installed (`/usr/local/bin/google-chrome`, `DISPLAY=:1`), but this pass has **no DevTools Performance trace, no `renderer.info` live capture, and no F3 FPS**.

**GPU FPS / 1% low / draw calls / GC in Chromium: not measured. Numbers below are Node CPU only.**

Pixel ratio cap (desktop 1.25 / mobile 1.0) was **not** changed. No fill-rate measurement to justify 1.0 on desktop.

## Current PLAYING pipeline (PR #47, kept)

- Generate XOR mesh. `shouldDeferGenerateForMesh` after a gen-only streak.
- `meshLimit = 1`.
- Chebyshev ≥ 3: cheap vertex light (no 4-corner AO).
- `WORLD_JOB_BUDGET_MS = 4` still exceeded by a single nearby mesh.

## Why nearby mesh scan is 15–30 ms

Isolation on the baked Anarchy spawn, 81 chunks (RD=4), same mesher, `collectDetail` on:

| Mode | total avg | p95 | p99 | max | scan avg | light reads |
| --- | --- | --- | --- | --- | --- | --- |
| visibilityOnly (no emit, no light) | 6.2 | 8.7 | 11.9 | 11.9 | 6.1 | 0 |
| emitFlatLight (push verts, no samples) | 14.9 | 21.2 | 31.7 | 31.7 | 13.1 | 0 |
| emitCheapLight (1 sample / face) | 15.7 | 21.6 | 25.8 | 25.8 | 13.9 | ~10k |
| fullAo (4-corner, uncached) | 24.2 | 30.8 | 33.6 | 33.6 | 22.4 | ~83k |
| fullAo + neighborhood cache | 20.0 | 25.8 | 32.7 | 32.7 | 18.3 | ~83k hits |

Derived split of scan (typical heavy spawn chunk, ~5k faces):

| Part | ~ms | What |
| --- | --- | --- |
| Voxel walk + face visibility | 6–11 | 16×Y×16 cells, `occupancyTop` ~74–90, `getBlockDefinition`, neighbor ids |
| Emit + `number[]` push | 7–11 | 9 parallel JS arrays per vertex, texture/tint, indices |
| Cheap light | ~1–3 | 2 `packedLightCell` / face |
| Full AO extra | 5–9 | 4 corners × bilinear 4-tap ≈ **16 `packedLightCell` / face** (~80k/chunk) |
| `toGeometry` + Float32 copy | 1–3 | `Float32BufferAttribute` from `number[]`, bounding sphere |
| GPU upload | not measured | `WorldRenderer.rebuild` BufferGeometry; Node has no WebGL |

`packedLightCell` (uncached) does neighbor chunk index math + `skyLightAtIndex` + **`getBlockDefinition(block).occludesFaces`**. That object lookup × 80k is the AO hot path.

GC: Node heap grew ~35–52 MB while meshing 81 chunks × 5 isolation modes (BufferGeometry churn). **Browser GC spikes were not measured.** `number[]` growth + copies are the likely allocation source.

Chunk-boundary: PR #47 already removed gen+mesh stacking (0 stacked frames). Remaining boundary hitch = one mesh job (now ~16–25 ms walk, still > 4 ms budget).

## Algorithm comparison

### 1. Current mesher (PR #47)

Per-face cubes, 6 layer geos, 4-corner AO nearby, cheap light far. Faces on spawn 9×9: 419181. Correct seams/AO/water/vegetation via existing path.

### 2. Same topology, faster internals (chosen)

- **18×18×(H+2) packed light+occlusion cache** for full AO. Same sky samples as uncached (unit test). Fill ~3 ms, net **~4 ms avg** off full mesh (24.2 → 20.0). Distant cheap light does **not** fill the cache (10k reads < 30k fill).
- **`BLOCK_OCCLUDES_FACES` Uint8Array** instead of `getBlockDefinition` in the light cell.

Not done: growable `Float32Array` instead of `number[]` (emit still 7–11 ms). Two-pass count-then-allocate would add a visibility pass.

### 3. Greedy meshing

+Y-only upper bound on one spawn chunk: 582 faces → 135 quads (**4.3×**). Real greedy must split on texture, AO, light, biome tint — merge ratio will drop. Touches water/vegetation/slabs/seams. **High visual risk. Not implemented.** Could cut both emit and AO if faces drop, but not as a first patch.

### 4. Worker mesher

9-chunk payload ~1.0–2.3 MB. `structuredClone` **0.8–1.1 ms**, typed slice **0.13–0.18 ms**. Transfer is cheap.

Blocker: `ChunkMesher` needs `VoxelWorld` (neighbor chunks, `resolveState`, fluids, farming stems, furnace, atlas). A worker needs a frozen DTO + job cancellation + revision tokens. Clone cost is not the issue; **architecture and stale-job correctness are**. **Not implemented.**

## Scheduling

Keep generate XOR mesh. `meshLimit = 1` is correct while one mesh is 16–25 ms. Budget-by-ms cannot split a synchronous 20 ms `build()`. Frustum-priority would hide holes behind the camera (OK for Low) but needs measurement. **No scheduler change.**

## Pixel ratio / GPU

Unmeasured. Do not drop desktop 1.25 → 1.0 without a GPU pass. Shadows are off in gameplay (`shadowMap` only in QA harness). Fog exists. No post-processing. Chunks use `MeshBasicMaterial` + vertex colors/light attrs.

## Low / Medium / High (no UI this pass)

| Parameter | Perf impact | Visual impact | Mobile-safe cut |
| --- | --- | --- | --- |
| renderDistance 4→2 | High | Medium (pop-in) | Yes (already default 2) |
| pixelRatio 1.25→1.0 | High GPU (unmeasured) | Low–medium softness | Yes |
| cheap AO from Chebyshev 3→2 | Medium CPU | Low at distance | Yes |
| particles / mob caps | Medium | Low | Already lower on coarse |
| shadows | n/a (off) | — | — |
| water/vegetation layers | Medium GPU | High | No |
| lighting flood quality | Low CPU (already 2 ms) | High | No |
| nearby AO rings 0–1 | High CPU | High | No |

## Optimization table

| Optimization | Expected gain | Risk | Visual | Recommendation |
| --- | --- | --- | --- | --- |
| Neighborhood light cache (full AO) | ~4 ms avg mesh; better locality | Low | None if cache matches (tested) | **Do** (this pass) |
| Occlusion LUT | small, helps cache fill | Low | None | **Do** (this pass) |
| TypedArray vertex bags | ~5–8 ms emit (estimated) | Medium (buffer bugs) | None if correct | Next CPU pass |
| Greedy meshing | up to ~3–4× faces (upper bound) | High | Seams/AO/water | Defer |
| Worker mesher | hide 15–25 ms off main | High | Stale chunks | Defer |
| Scheduler / frustum | hide off-screen work | Medium | Holes | Keep XOR; no extra system |
| Cheap AO closer | 5–9 ms on ring 2 | Low | Less AO mid-distance | Low preset only |
| Pixel ratio 1.0 desktop | GPU fill (unmeasured) | Low | Softer | Measure first |
| Render distance 2 | Large | Low–medium | Pop-in | Existing setting |

## Metric | Current (PR #47 CPU) | Target

| Metric | Current | Target |
| --- | --- | --- |
| stacked gen+mesh frames | 0 | 0 (keep) |
| nearby mesh avg | ~19–25 ms | < 8 ms (still open) |
| nearby mesh p99/max | ~29–47 ms | < 12 ms (still open) |
| generate max | ~11 ms | unchanged / later worldgen |
| world-job budget | 4 ms | one mesh still over |
| GPU FPS | unknown | measure on device |

## What we implemented after the isolation report

1. Default **neighborhood light cache** when vertex light is `full` (nearby rings). Opt out: `neighborhoodLightCache: false`.
2. `BLOCK_OCCLUDES_FACES` LUT in `packedLightCellUncached`.
3. `npm run benchmark:mesh-scan` isolation harness (`visibility / flat / cheap / full / cache`).
4. Spawn bench now reports **p99**.

Farming, Networking V2, spawn cells, generate XOR mesh: unchanged.

## BEFORE / AFTER (this pass)

Isolation, 81 spawn chunks, same process:

| Metric | fullAo uncached | fullAo + cache | Change |
| --- | --- | --- | --- |
| mesh avg ms | 24.24 | 20.04 | −4.20 |
| mesh p95 ms | 30.79 | 25.80 | −4.99 |
| mesh p99 ms | 33.58 | 32.70 | −0.88 |
| mesh max ms | 33.58 | 32.70 | −0.88 |
| scan avg ms | 22.43 | 18.27 | −4.16 |

Spawn walk (PR #47 numbers on this VM vs this branch; cache now on for nearby):

| Metric | PR #47 | This pass | Change |
| --- | --- | --- | --- |
| stacked frames | 0 | 0 | 0 |
| mesh avg ms | 19.5 | 16.3 | −3.2 |
| mesh p95 ms | — | 24.6 | — |
| mesh max ms | 28.7 | 24.6 | −4.1 |
| generate max ms | 10.9 | 11.4 | ~noise |
| spawn 9×9 mesh avg | 25.5 | 20.3 | −5.2 |
| faces | 419181 | 419181 | 0 |
| FPS / draw calls | not measured | not measured | — |

Sky samples with cache vs uncached: **0 mismatches** (`tests/chunk-mesher.test.ts`).

## Remaining bottleneck

1. **Emit / `number[]` growth (~7–11 ms)** — next safest CPU win is typed vertex bags.
2. **Nearby AO still ~5–9 ms** even with cache (80k cache hits).
3. **One mesh still 16–25 ms vs 4 ms budget** — spikes at chunk entry remain, but no longer stacked with generate.
4. GPU unknown.

## Tests

- `tests/chunk-mesher.test.ts` (cache equality) PASS
- `tests/streaming-scheduler.test.ts` PASS
- `npm run typecheck` / `typecheck:server` PASS
- `npm run test:server` PASS
- `npm run build` PASS
- `npm run benchmark:mesh-scan` / `benchmark:spawn`

## Changed files

- `src/rendering/ChunkMesher.ts`
- `src/blocks/registry.ts`
- `scripts/benchmark-mesh-scan.ts`
- `scripts/benchmark-spawn-perf.ts` (p99)
- `package.json`
- `tests/chunk-mesher.test.ts`
- docs: this report, `PROJECT_STATE.md`, `ROADMAP.md`
