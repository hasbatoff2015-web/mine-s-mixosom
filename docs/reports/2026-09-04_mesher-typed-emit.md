# Mesher typed emit (after PR #48)

Date: 2026-09-04  
Branch: `cursor/mesher-typed-emit-3ff8`  
Base: PR #48 `cursor/mesher-scan-audit-3ff8` @ `d85a27b`  
PR: stacked draft `#49`. `origin/main` is still without #47/#48.

## Goal

Cut CPU meshing on the existing `ChunkMesher` without changing visuals. Profile emit (`number[]` → Float32) and GC, keep generate XOR mesh, do **not** ship greedy meshing or a worker.

## Result

TypedArray emit + single compact copy into `BufferAttribute` is a real win. Solid-neighbor occlusion LUT in `faceVisible` is a small voxel-walk win. AO formula was **not** changed (0-mismatch requirement). Spawn 9×9 faces stayed **419181**. Stacked generate+mesh stayed **0**.

Nearby full-AO mesh is still **above** the <8 ms avg / <12 ms max target. Remaining cost is voxel walk (~6 ms) + 4-corner AO (~6 ms with cache). Emit is no longer the largest piece.

## Browser / GPU

Not measured. No DevTools Performance trace, no `renderer.info`, no F3 FPS / 1% low / draw-call capture in this Cloud VM. Do not invent GPU numbers.

## What was profiled (emit)

A nearby spawn chunk emits ~20k vertices × 9 float attrs + ~30k indices.

**CURRENT (PR #48):** `number[]` push per component, then `Float32BufferAttribute` which does `new Float32Array(number[])` (box + copy). Emit 7–11 ms, conversion 1–3 ms. Heap +35…52 MB on 81×5 isolation rebuilds.

**THIS PASS:** growable `Float32Array` / `Uint32Array` (`FloatList` / `IndexList`) reused on the session `ChunkMesher` (`WorldRenderer` holds one). `compact()` is one `slice` so Three owns an exact-size buffer while the growable list resets. `BufferAttribute` keeps that TypedArray (no second copy). Geometric 2× growth, initial cap 16k. Not a general allocator / pool.

## Implemented

1. Reusable typed emit buffers; cube hot path `push3`/`push2`/`push6` with `ensure` per face; no per-corner object literals; no `uvs` temp array.
2. `toGeometry` uses `BufferAttribute(compact())`.
3. `faceVisible`: `BLOCK_OCCLUDES_FACES` returns false immediately for solid cubes; slabs/glass/leaves still use definitions + `resolveState`.
4. `npm run benchmark:mesh-scan` phase breakdown (avg/p50/p95/p99/max), vertex/index totals, 6-dir greedy upper bound, worker clone cost.
5. Tests: bit-identical rebuild of all layer attrs+indices; slab/glass do not occlude cube faces; existing cache sky equality kept.

## AO (investigated, not shipped)

4-corner AO still calls `sampleSurfaceVertexLight` once per vertex. Each call reads 4 packed cells (16 reads/face, ~83k/chunk). Adjacent corners of one face share a 3×3 on the exposed plane (9 unique cells), but with the neighborhood cache those reads are already array hits.

Remaining cost is bilinear math × ~20k vertices, not cache misses. An unoccluded `mask===0` fast path would skip the blocked loop but can differ in float divide-by-`weight` vs assuming `weight===1`. **Not taken.** Corner-sharing across faces uses different origins/normals, so AO is not one value per voxel corner.

Requirement: 0 mismatches vs current AO. Rebuild test: **0** attribute mismatches. Cache vs uncached sky: **0** mismatches (existing test).

## Voxel walk

Already uses local `chunk.blocks` + cardinal neighbor chunk arrays. LUT skips `getBlockDefinition` on occluding neighbors (the common interior case). Boundary blocks still read the neighbor chunk array. Cross-chunk seams unchanged.

## Isolation BEFORE / AFTER (81 spawn chunks, RD=4)

PR #48 numbers are the before column.

| Metric | Before (#48) | After | Change |
| --- | --- | --- | --- |
| visibilityOnly avg ms | 6.2 | 5.95 | −0.25 |
| emitFlat avg ms | 14.9 | 10.21 | −4.69 |
| emitCheap avg ms | 15.7 | 10.57 | −5.13 |
| fullAo uncached avg / p95 / p99 / max | 24.24 / 30.79 / 33.58 / 33.58 | 20.64 / 27.61 / 28.33 / 28.33 | ~−3.6 avg |
| fullAo cached avg / p95 / p99 / max | 20.04 / 25.80 / 32.70 / 32.70 | 16.20 / 20.76 / 28.94 / 28.94 | −3.84 avg |
| emit phase avg ms | ~7–11 | 3.72 (p95 8.07, max 12.70) | ~half |
| geometryConversion avg ms | 1–3 | 0.48 (p95 0.59, max 0.64) | ~−1–2 |
| voxel walk + visibility avg ms | 6–12 | 5.90 (p95 8.44, max 11.36) | small LUT |
| cheap light extra avg ms | 1–3 | 0.39 | small |
| full AO extra uncached / cached avg ms | 5–9 | 10.14 / 5.71 | cache still the AO win |
| heap delta (81×5) | +35…52 MB | −7.08 MB | reuse + less boxing |
| faces / vertices / indices | 419181 / — / — | 419181 / 1676724 / 2515086 | faces 0 |

`visibilityOnly` face counts omit specials (those builders are skipped when `emitGeometry: false`). Totals above are from `fullAoLightCache` and match spawn 9×9.

## Spawn walk BEFORE / AFTER

| Metric | Before (#48) | After | Change |
| --- | --- | --- | --- |
| stacked gen+mesh frames | 0 | 0 | 0 |
| mesh avg ms | 16.3 | 12.27 | −4.03 |
| mesh p95 / max ms | 24.6 / 24.6 | 18.24 / 18.24 | −6.36 |
| generate max ms | 11.4 | 9.15 | noise / VM |
| spawn 9×9 mesh avg / max ms | 20.3 / — | 14.80 / 22.12 | −5.5 avg |
| faces | 419181 | 419181 | 0 |

Walk meshes mix nearby full AO and Chebyshev ≥ 3 cheap light (PR #47). Isolation `fullAoLightCache` is the nearby-mesh number: **16.2 ms avg, 28.9 ms max** — still over the 8/12 target.

## Greedy meshing (research only, not in renderer)

Isolated 6-dir merge on one spawn chunk (`cx=-1,cz=0`), cube/slab, merge by block id only, ignore AO/light/texture/biome:

| | Naive faces | Greedy quads | Ratio |
| --- | --- | --- | --- |
| +Y only | 582 | 135 | 4.31× |
| all 6 dirs | 3760 | 698 | 5.39× |

Upper-bound verts/indices if every quad stayed 4/6: 2792 / 4188 vs current ~20500 / 30750 on that chunk. Real greedy must split on texture, AO, light, biome tint — merge ratio drops. Water, vegetation, slabs, farming stems, and chunk seams need separate rules.

- Expected CPU gain: large **if** faces drop (emit + AO both scale with faces). Not proven on a correct greedy.
- Expected GPU gain: fewer triangles / maybe fewer verts; unknown without GPU.
- Implementation risk: **high** (new topology, materials, boundaries).
- Visual risk: **high** (AO/seams/water/vegetation).

**Do not implement next** unless a correct isolated prototype matches face lighting and still shows a big CPU win.

## Web Worker (research only)

9-chunk payload ~1.0 MB. `structuredClone` **1.24 ms**, typed slice **0.13 ms**. Transfer is cheap.

Worker does **not** speed `mesh()`. It only moves ~16–22 ms off the render thread. Hitch would drop; mesh latency would add at least one frame plus serialize/apply. Architecture: freeze a DTO (`VoxelWorld` neighbors, `resolveState`, fluids, farming stems, atlas UVs), job ids, cancellation, stale results vs `lightVersion`. **High complexity. Not implemented.**

## Low-end (no new presets)

| Parameter | Current | Low-end recommendation | Visual impact | Expected gain |
| --- | --- | --- | --- | --- |
| render distance | 4 desktop | 2 | pop-in | large CPU+GPU |
| pixel ratio | 1.25 desktop / 1.0 mobile | 1.0 desktop | slight softness | GPU fill, unmeasured |
| cheap AO ring | Chebyshev ≥ 3 | ≥ 2 | less AO at mid distance | ~5 ms on ring 2 |
| mobile mob caps | already lower | keep | low | already done |
| mobile particle caps | already lower | keep | low | already done |

Do **not** cut: AO rings 0–1, water, vegetation, lighting flood, spawn data, Farming, Networking V2.

## Tests

- `npx tsc --noEmit` / `tsconfig.server.json` PASS
- `tests/chunk-mesher.test.ts`, `streaming-scheduler`, `lighting-seams`, `urgent-block-mesh` PASS (79)
- `npm run build` PASS
- `npm run test:server`: 124/125 then flake `tick-load-flight` serialize timing (5.11 ≰ 4.43); re-run of that file PASS. Unrelated to mesher.
- `benchmark:spawn` / `benchmark:mesh-scan` as above

## Known issues

- Nearby full AO still 16–22 ms typical, p99 isolation 28.9 ms. Target <8/<12 not met without topology change or dropping nearby AO.
- First grow of typed buffers can spike a chunk (emitFlat max 26.7 ms in isolation); session mesher in `WorldRenderer` amortizes this after the first large chunk.
- GPU/FPS still unknown.

## Deferred / next

1. **Not greedy/worker in production** without a proven isolated prototype.
2. AO input reuse / voxel-corner cache only if a 0-mismatch comparison exists.
3. Owner GPU pass (`?perf=1`, F3, `renderer.info`).
4. Low-end: RD 2 / pixel 1.0 / cheap AO from ring 2 — settings only, no new UI this stack.

## Git

`cursor/mesher-typed-emit-3ff8` → draft PR stacked on `cursor/mesher-scan-audit-3ff8`.
