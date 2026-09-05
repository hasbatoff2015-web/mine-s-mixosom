# Budgeted mesh slices + hitch research (after PR #49)

Date: 2026-09-05  
Branch: `cursor/mesher-hitch-slices-3ff8`  
Base: PR #49 `cursor/mesher-typed-emit-3ff8` @ `14c06d8`  
PR: stacked draft `#50`. Do not merge #49 automatically.

## Goal

One nearby mesh is still ~12–18 ms total CPU. Priority is **no big RAF hitch**, not avg &lt; 8 ms for the whole job.

Path **B** (split/cap the hitch) is the rational production step. Path **A** (faster mesher) needs greedy/AO/worker with higher risk.

## Result

PLAYING meshing is resumable. A chunk is scanned in Y slices of `MESH_SLICE_BUDGET_MS = 8`. The previous GPU mesh stays until the CPU job commits. LOADING and urgent mutation remesh still finish in one call. Generate XOR mesh: skip generate while a slice is in progress.

Spawn walk **per-frame mesh** (the hitch):

| Metric | PR #49 oneshot | This pass (slices) |
| --- | --- | --- |
| stacked gen+mesh | 0 | **0** |
| mesh avg ms | 12.27 | **6.20** |
| mesh p95 / p99 / max ms | 18.24 / 18.24 / 18.24 | **8.24 / 8.39 / 8.39** |
| generate max ms | 9.15 | **8.55** |
| spawn 9×9 faces | 419181 | **419181** |

Oneshot total CPU for a full nearby mesh is unchanged (~14.4 ms avg on the 9×9 grid). The job is just no longer one RAF.

Sliced vs one-shot attributes: **0 mismatches** (`tests/chunk-mesher.test.ts`).

## 1. Current bottleneck (oneshot, isolation)

| Part | avg ms |
| --- | --- |
| voxel walk + visibility | 6.5 |
| emit | 3.3 |
| cached AO extra | 5.7 |
| geometry conversion | 0.41 |
| cheap light extra | 0.69 |
| full AO + cache total | 16.6 |

GPU upload still unmeasured (see §7).

## 2. Budgeted meshing — implemented (PLAYING only)

Feasible: the voxel loop is already Y-major. State is the typed emit buffers + `y` cursor + `contentRevision`/`lightVersion`.

- Deterministic: same faces/attrs as `build()`.
- No half-mesh in the renderer: `commitMeshed` runs only after `takeBuild()`.
- New chunks still appear only when the last slice commits (2–3 frames later at 8 ms). Old mesh is kept on remesh.
- Abort if the chunk is edited (`contentRevision`) or leaves mesh radius.
- Urgent online remesh uses infinite slice budget (player-placed blocks stay one-shot).

Not a total-CPU win. It is a hitch cap.

## 3. Worker — research only

9-chunk payload ~2.4 MB, `structuredClone` **1.65 ms**. Main-thread leftover would be clone + apply, not 16 ms of scan. Worker **total** time ≈ oneshot + clone. Hitch reduction: high. Latency: +1 frame plus apply. Architecture: DTO, stale `lightVersion`, cancellation, farming stems, atlas — **high**. Slices already cap hitch without that. **Do not ship.**

## 4. Greedy — research only

Spawn chunk cube faces (this pass, `cx=3,cz=4`):

| | Quads | Ratio vs naive |
| --- | --- | --- |
| naive cube faces | 4583 | 1 |
| merge by block id only | 1430 | **3.20×** |
| merge by id + AO fingerprint | 2282 | **2.01×** |

6-dir id-only upper bound on another chunk remains **5.39×** (mesh-scan). Texture/biome splits shrink it further.

- AO: id-only **wrong**. id+AO is closer but not bilinear-correct on merged quads.
- Light: same.
- Water / vegetation / specials: not in this prototype; need separate greedy or stay naive.
- Seams: high risk at chunk borders.

CPU gain only if faces drop in the **production** mesher. Visual risk **high**. **Do not ship.**

## 5. AO 3×3 — prototype, 0 mismatches, not production

`shadePackedQuad` extracted from `sampleSurfaceVertexLight` (behavior-preserving). Isolated `sampleCubeFace3x3`: **4000 faces, 0 mismatches** including occluder bit 256. Prototype CPU 18.7 → 13.2 ms on those 4000 faces (~30%). Production cube path still 4× per-vertex. Next pass may wire this if we want ~1–2 ms off nearby AO without visual change.

## 6. Voxel walk

Already uses local `chunk.blocks` + cardinal neighbor arrays. Packed 18×18×H **fill costs 2.3 ms** — more than edge-branch savings. **Not implemented.** Interior cells already skip world API. LUT occlusion is in `faceVisible` from #49.

## 7. GPU / upload

`toGeometry` / BufferAttribute compact ≈ **0.4–0.6 ms** CPU. Three.js GPU upload happens on first draw; **not measured**. Camera rotation does not remesh (no mesh CPU spike from look). Chunk-boundary walk is the mesh spike source; slicing caps it.

## 8. Frame spikes

Camera rotation: no mesh. Movement / chunk boundary: mesh jobs. GC: isolation heap still negative (−18 MB this run). Walk mesh frames now p95 **8.24** / max **8.39** vs oneshot 18.

## Scheduler

Existing `meshJobSortScore`: ring, age, movement-ahead, distSq. Frustum/look not added (velocity already biases ahead). `pendingMesh` unchanged.

## Low-end (no UI)

| Parameter | Current | Low-end | CPU | GPU | Visual |
| --- | --- | --- | --- | --- | --- |
| render distance | 4 desktop | 2 | high | high | pop-in |
| pixel ratio | 1.25 / 1.0 mobile | 1.0 desktop | none | fill, unmeasured | slight softness |
| cheap AO | Chebyshev ≥ 3 | ≥ 2 | ~5 ms ring 2 | none | less AO mid-distance |
| mobile mob/particle caps | already lower | keep | already done | already done | low |

Do not cut: AO rings 0–1, water, vegetation, lighting flood, spawn, Farming, V2.

## Approach table

| Approach | CPU gain | Hitch reduction | GPU gain | Risk | Visual | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| PLAYING Y-slices 8 ms | none (total) | **high** (~18 → ~8 ms) | none | medium | delayed first mesh 2–3 frames | **Do** (this PR) |
| Keep old mesh until commit | none | none | none | low | no remesh hole | **Do** (this PR) |
| 3×3 AO | ~1–2 ms nearby | small | none | low if 0 mismatch | none | Next, not this PR |
| Packed 18×18 blocks | negative (~+2.3 fill) | none | none | low | none | No |
| Greedy id-only | large | large | maybe | high | AO/seams | No |
| Greedy id+AO | medium (~2×) | medium | maybe | high | still AO/texture | No |
| Worker | none (moves CPU) | high | none | high | stale chunks | No; slices first |
| Frustum priority | none | hides off-screen | none | medium | holes behind | No |

## Metric | Current | Target

| Metric | Current (this PR) | Target |
| --- | --- | --- |
| stacked gen+mesh | 0 | 0 |
| walk mesh avg (per frame) | 6.20 | keep &lt; 8 |
| walk mesh p95 / max | 8.24 / 8.39 | ≤ ~8–10 hitch |
| oneshot nearby mesh avg | 14.4–16.6 | not the hitch metric |
| generate max | 8.55 | unchanged |
| worst sliced frame | 8.39 | ≤ 10 |
| GPU FPS | unknown | device QA |

## Tests

- typecheck / typecheck:server PASS
- chunk-mesher (incl. sliced identity), lighting-seams, streaming-scheduler, urgent-block-mesh, ao-3x3-prototype PASS
- test:server 13 files PASS
- build PASS
- benchmark:spawn / mesh-scan / mesh-hitch as above

## Known issues

- First-time streaming of a chunk is visible 2–3 frames later. Remesh keeps the old mesh.
- Slice can slightly exceed 8 ms (8.39) because the budget is checked after a Y layer / setup.
- GPU/FPS still unknown.

## Git

`cursor/mesher-hitch-slices-3ff8` → draft PR stacked on `cursor/mesher-typed-emit-3ff8`.
