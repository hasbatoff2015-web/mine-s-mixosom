# Lighting performance and chunk seams

Date: 2026-08-23  
Branch: `cursor/performance-world-loading-mob-smoothing`  
Accepted previous HEAD: `22db1dbcfd832feb20796c389d17fd98ca356016`  
PR: #4 remains draft. **Do not merge main.**

## Goal

Second performance pass on the same branch. Local GPU QA after the first pass accepted mob smoothing, world loading, and rapid Creative break. Remaining issues:

1. Running/streaming still had frame-time spikes.
2. Square/rectangular darkened patches with straight X/Z edges, looking like chunk lighting seams.

Product decision: **PERFORMANCE + plausible light + stability**, not vanilla-accurate lighting.

## Root Cause

Streaming LAST SPIKE on the user GPU was typically `total ~34–40 ms` with **LIGHT ~29–33 ms** and MESH ~3–6 ms. Idle standing was already fine (`p95 ~1.5 ms`).

In code, `LightEngine.recomputeChunkSky` ran a **6-pass horizontal sky spread** over the whole `16×80×16` chunk (six neighbor lookups + `getBlockDefinition` per cell per pass ≈ hundreds of thousands of operations). `processWorldJobs` treated “4 ms budget” as permission to call that function once — the job itself did not yield. The budget was useless.

Chunk-shaped dark squares matched **stale baked vertex light**, not different column math:

- First pass stopped LightEngine from setting `chunk.dirty` on every light write (correct for break FPS).
- Mesher 4-tap samples neighbor cells. Chunk A could mesh while neighbor B was still unlit (`sky=0` on the border) → a darker square ending on the chunk boundary.
- When B later generated, `getChunk` dirtied A and the square disappeared after remesh.

Hypotheses A/C/D were the real combination. Independent per-chunk column sky (B/E) is consistent on open surface once both sides are filled; the visible seam was the mesh.

## Simplified Lighting Model

**Lighting is intentionally simplified for performance.**

| Component | What is computed | What is not |
| --- | --- | --- |
| Sky | Vertical column, top → bottom. Opaque seals the column to 0. Air keeps 15. Water and leaf cubes attenuate by 1. Cross plants / torches / doors do not change sky class. | 6-pass / 4-pass horizontal sky, bounced light, vanilla cave-entrance gradients, per-block special cases |
| Block | Bounded BFS from emitters. Torch 14, burning furnace = torch, lava 15, redstone torch 7. Reusable typed queue, node cap. Border absorb so light crosses chunks. | Full-chunk rescan on every voxel, sky recompute on torch/furnace |
| Final | Shader `max(sky^γ * uDaylight, torchWarm * block)` + cheap face shade | Extra lighting simulation passes, world relight on day/night |

Open sky is bright. Enclosed stone is dark. A roof hole admits sky in that column. Torch/furnace light is local and disappears when removed.

## Chunk Seams

Yes — the dark patches lined up with chunk X/Z boundaries.

Cause: mesh A baked neighbor samples of 0 while B was ungenerated/unlit. After B existed and A remeshed, the square went away.

Fix:

- Generate `renderDistance + 1` (lighting halo).
- Light halo + visible area.
- Mesh only the visible radius, and only if `lightContextReady` (cardinal neighbors inside the halo exist and are lit).
- `lightVersion` / `meshedLightVersion`; rebuild if they differ.
- When a chunk first becomes lit, already-meshed neighbors get one visual refresh.

Deterministic test: two flat chunks, columns `x=15` and `x=16` match at several Y. Torch at A `x=15` lights B `x=0` (level 13).

## Light / Mesh Consistency

Many light writes → one `lightVersion++` on affected dirty chunks after the job, not per voxel.

`WorldRenderer` rebuilds if `dirty || lightMeshStale`, skips unlit / out-of-mesh-radius / missing neighbor light, then sets `meshedLightVersion = lightVersion`.

An ACTIVE visible chunk cannot sit forever on old baked light: stale version keeps it in the mesh queue.

Interior occlusion edits do **not** remesh all flood-touched neighbors (keeps the rapid-break win). Emission (torch/furnace) still dirties the light AABB.

## Incremental Jobs

`VoxelWorld.processLighting(budgetMs)`:

- Continues one deferred mutation region **or** the nearest unlit chunk.
- Sky fill: column cursor, yield every 96 columns or when the deadline hits.
- Block seed: column emitter scan + resumable flood (typed ring, 768 nodes/slice).
- PLAYING budget `WORLD_LIGHT_BUDGET_MS = 2`. Loading `8`.
- Hard column/node caps so a frozen clock still yields.

CPU after this pass: 81-chunk sliced lighting **maxSlice 2.17 ms** (was a monolithic ~16–33 ms sky job). One `ensureChunkLighting` (tests/sync) ≈ 4 ms, not 23 ms.

## Streaming

Lifecycle: generated → lit/stable → meshed with current light → visible.

PLAYING still skips mesh in a frame that generated. New chunks are requested at halo radius. Visible mesh waits for neighbor light context.

## Initial Loading

`LOADING_WORLD` overlay is unchanged in UX. Ready now means:

- Inner render-distance square: generated + lit + mesh reflects current light.
- Halo ring: generated + lit (mesh optional).

The extra ring is why loading can take a little longer; the bar still animates.

## Torch / Furnace

Place/remove torch: block flood only (sky class air↔torch is `pass`). Burning furnace uses existing `relightAround(..., recomputeSky=false)` + AABB remesh. Neither starts a full sky recompute or world relight. Cross-border torch is tested.

## Benchmarks

### BEFORE (user local GPU, first pass, `?perf=1`)

Standing: p95 ~1.5 ms, p99 ~1.6, max ~1.8.

Running/streaming: p95 ~26–34 ms, p99 ~40+, max ~76 ms. LAST SPIKE total ~34–40 ms with **LIGHT ~29–33 ms**, MESH ~3–6 ms.

Rapid Creative break: already recovered (p95 a few ms). Do not treat this pass as the break fix.

GPU FPS after this pass: **not measured here**. manual local GPU QA required.

### AFTER (this environment, CPU / `vite-node`)

| Scenario | AFTER (CPU) |
| --- | --- |
| 81-chunk sliced sky+block, 2 ms budget | total ~369 ms, **maxSlice 2.00 ms**, 414 job slices |
| 81-chunk sync `ensureChunkLighting` | ~452 ms (~5.6 ms/chunk) |
| One chunk ensure | ~4.3 ms (was ~16.5 sky + ~7 block with 6-pass) |
| Torch place/remove in air | place ~5 ms, remove ~9 ms, sky recomputes **0**; neighbor light 13 across border |
| Cross-chunk torch | ~3 ms, source 14 / neighbor 13, sky 0 |
| Furnace on/off | sky recomputes **0** |
| Roof hole | sky in chamber 15 |
| 30 occlusion edits | avg **1.00 ms**, p95 **1.66 ms**, 1 dirty, 1 pending mesh |
| 30 interior breaks (`benchmark-perf-pass`) | avg **1.15 ms**, p95 **1.55 ms**, 1 dirty (was 5.8 / 7.9 after first pass) |
| 100 deferred Creative-style edits | **3.0 ms** total, 1 pending mesh, 1 dirty |

Do not convert these CPU times into user GPU FPS.

## Tests

`npx vitest run`: **311 passed / 41 files** (was 301 / 40).

New: `tests/lighting-seams.test.ts` (10). Lighting/torch/furnace/explosion/break/dirty-queue tests remain green.

`npm run benchmark:lighting` and `npx vite-node scripts/benchmark-perf-pass.ts` recorded above.

## Manual QA

Cloud GPU is not a reliable gameplay capture. **manual local GPU QA required.**

1. Spawn, wait for Loading World; first frame should not flash dark chunk squares.
2. `?perf=1&chunks=1` (or F8): 16×16 grid. Confirm dark patches vs grid.
3. Sprint 60 s into new terrain. Watch LIGHT line: `frame` / `maxSlice` should stay a few ms, not ~30.
4. Screenshot after the largest SPIKE.
5. Look for square dark patches on open plains.
6. Cave / enclosed stone: dark.
7. Roof hole: column becomes bright.
8. Torch place/remove.
9. Torch on a chunk border (F8): light must cross.
10. Furnace start/stop burn.
11. Rapid Creative breaking: no return to 0–10 FPS.
12. Optional F7: SKY / BLOCK / FINAL false-color.

## Architecture decisions

- Prefer a slightly simpler sky over a 30 ms hitch. No optional lateral sky spread (it would reintroduce flood cost).
- Dedicated light budget, independent of “start one heavy function if 4 ms remain”.
- Halo + activation gate instead of meshing unlit borders.
- Keep previous pass wins: pendingMesh dedupe, interior neighbor skip, deferred Creative lighting, catch-up cap 4, mob interpolation, shared materials.

## Known issues / Deferred

- One chunk mesh is still ~12–30 ms CPU; not this pass.
- Column-only sky is harsher at cave mouths than vanilla (4-tap still softens the hole itself).
- Getter `getSkyLight` / `getBlockLight` may still sync-complete a cheap column fill if something reads an unlit chunk (no longer a 30 ms 6-pass).
- No light-only vertex-attribute update without remesh (coalesced remesh stayed cheaper than a renderer rewrite).

## Changed files

See git commit. Principal: `src/world/LightEngine.ts`, `src/world/Chunk.ts`, `src/world/World.ts`, `src/world/worldJobs.ts`, `src/core/constants.ts`, `src/core/Game.ts`, `src/core/devProfiler.ts`, `src/rendering/WorldRenderer.ts`, `src/rendering/worldLighting.ts`, `src/rendering/ChunkGridOverlay.ts`, tests, `scripts/benchmark-lighting.ts`, docs.

## Git

Feature branch only. Ordinary push. No merge to main. No force push. Freeze after push for local GPU QA.
