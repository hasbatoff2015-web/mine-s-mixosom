# Performance audit + spawn walk spikes

Date: 2026-09-04  
Branch: `cursor/perf-audit-spawn-3ff8`  
Base: `main` @ `03685a9` (Farming V1 + Networking V2 + Anarchy spawn bake)

## Goal

Найти реальные причины периодических просадок FPS на большом Anarchy spawn и убрать их без слепого рефакторинга, без ломки Farming V1 / Networking V2 / spawn geometry.

## Result

P0 confirmed and fixed on CPU: PLAYING **stacked generate + mesh on the same frame** while walking into new spawn chunks.

- BEFORE spawn walk (48 steps, RD=4, 4 ms job budget): **39/48 frames** ran generate and mesh together. Stacked cost avg **29.5 ms**, max **39.1 ms**.
- AFTER: **0 stacked frames**. Generate and mesh alternate. Deferred generates **17**. Worst remaining single job: mesh max **28.7 ms** (still over the 4 ms budget, but no longer added on top of generate).

GPU/FPS/1% lows **were not measured** in this Cloud VM (no reliable browser GPU path). Do not treat CPU ms as FPS.

Farming, Networking V2 (FIFO / `ackCommandSeq` / prediction / serverTick interpolation), and spawn block data were not changed.

## Method

MEASURE → IDENTIFY → OPTIMIZE → MEASURE AGAIN.

Tools used:

- Node `performance.now()` via `npm run benchmark:spawn` (`scripts/benchmark-spawn-perf.ts`)
- Existing `ChunkMesher.lastProfile` (scan vs geometry)
- `planMeshFrame` / `collectReadyMeshJobs` walk simulator matching `Game.processWorldJobs`
- Restored Anarchy `FsWorldStore` spawn (63 modification chunks / 361578 cells)
- DEV instrumentation already present: `?perf=1` `DevProfiler`, F3 `renderer.info`, job-frame counters. Added `genDeferredForMesh` (boolean on the existing inspector counters; cheap).

Not used (unavailable / not trustworthy here): Chrome DevTools Performance/Memory, `renderer.info` live GPU, 1% low FPS.

## Baseline (CPU, this VM)

Procedural 9×9 (RD=4): mesh avg 19.3 ms / p95 28.0 / max 49.7; ~4329 faces/chunk; 220 draw-call layers.

Spawn 9×9 around (53.5, 70.5): mesh avg 24.8 ms / p95 34.2 / max 44.3; ~5175 faces/chunk; **419181** faces; 245 layers. Scan is ~90% of mesh time (4-corner AO). Geometry upload ~2 ms.

Spawn walk 48 steps × 3.2 m, RD=4, PLAYING budget 4 ms:

| | generate | mesh | stacked gen+mesh |
| --- | --- | --- | --- |
| n | 48 | 39 | **39** |
| avg ms | 8.5 | 20.8 | **29.5** |
| p95 ms | 10.3 | 27.1 | 37.2 |
| max ms | 10.9 | 31.1 | **39.1** |

Lighting stayed inside its 2 ms slice (avg 0.87 ms).

Empty/procedural walk: generate max ~9–12 ms, 0 meshes in this harness (lighting halo not finishing in 2 ms before collect). Terrain generate itself is still 8–12 ms here; earlier slower machines have shown 25–85 ms.

`npm run benchmark:performance` was **not** used as a gate: it already fails on `EntityHost` in `MobManager` (pre-existing, unrelated).

## Ranked bottlenecks

### P0 — stacked generate + mesh (walk spikes)

- Where: `Game.processWorldJobs` + `planMeshFrame`.
- What: PLAYING generates 1 chunk (~8–11 ms here, historically much more) then immediately meshes another (~20–31 ms) because nearby/urgent mesh was always allowed on a generate frame (`chebyshev <= 1` or wait ≥ 150 ms), and fairness forced a mesh after one gen-only frame regardless of elapsed time.
- How often: almost every new-chunk frame while moving on spawn (39/48).
- FPS impact: one frame of ~30–40 ms CPU before GPU; on a weak device with 25–85 ms generate this becomes a hitch well below 20 FPS.
- Fix: never mesh in the same PLAYING frame as a generate. After a gen-only frame, `shouldDeferGenerateForMesh` skips the next generate if any mesh job is ready.
- Risk: low. Holes last one extra frame (~16–50 ms) instead of a 30–40 ms hitch. LOADING_WORLD still generates and meshes together.

### P1 — mesh scan still 15–30 ms

- Where: `ChunkMesher.build` / `fastCornerLight` → `sampleSurfaceVertexLight` per cube-face corner.
- Why: no greedy meshing; 4 AO samples per visible face. Spawn occupancy is high.
- Partial fix: `cheapVertexLight` when Chebyshev ≥ 3 (one light sample, no AO). Sample on a heavy spawn chunk: full 27.8 ms → cheap 19.4 ms, same face count. Nearby rings 0–2 keep full AO.
- Remaining: a single nearby mesh is still over the 4 ms budget. Greedy meshing / worker meshing **not** done this pass (large, visual/seam risk; AGENTS.md wants this only after profiling — profiling confirms cost, but scheduler was the spike multiplier).

### P1 — desktop meshLimit 2

- Two 20 ms meshes could follow a generate. PLAYING `meshLimit` is now **1** (mobile was already 1).

### P1 — retina pixel ratio cap 2

- `WebGLRenderer` used `min(dpr, 2)` desktop / `1.4` mobile. Fill-rate 4× on dpr=2. Unmeasured here (GPU). Cap is now **1.25** desktop / **1.0** mobile, applied on init and resize.

### P2 — rebuild/collect scanned every loaded chunk

- `rebuildDirty` / `collectReadyMeshJobs` now iterate `pendingMesh` when it is non-empty.

### P2 — matrixAutoUpdate on static chunk groups

- Chunk vertices are world-space; groups never move. `matrixAutoUpdate = false` after build.

### P3 / not done

- Greedy meshing, worker meshing, worldgen rewrite, removing Farming/particles, restoring Networking V1 snap/chase, full Low/Medium/High settings UI, InstancedMesh of chunks (already one Mesh per layer per chunk with shared materials).

## Optimizations implemented

1. PLAYING: generate XOR mesh per frame (mesh only on non-generate frames).
2. `shouldDeferGenerateForMesh` after a gen-only streak when any ready mesh exists.
3. PLAYING `meshLimit = 1`.
4. Distant cheap vertex light (Chebyshev ≥ 3).
5. Pixel ratio caps 1.25 / 1.0.
6. `pendingMesh` iteration for mesh candidate collection.
7. Freeze chunk group/mesh matrices.
8. DEV `jobFrame.genDeferredForMesh` for `?perf=1` / chunk inspector HUD.
9. `npm run benchmark:spawn` for repeatable CPU before/after.

## What was intentionally not optimized

- **Greedy / worker meshing** — confirmed expensive, but the user-visible spike was stacking, not the existence of a 20 ms mesh by itself. High visual risk.
- **Lighting flood** — already 2 ms budgeted; walk light avg < 1 ms.
- **Farming / Networking V2 / prediction** — not on the spawn-walk CPU profile.
- **Spawn schematic data** — 361k cells is content, not a bug.
- **Full quality presets UI** — settings already expose render distance 2–6. New knobs are listed below; no extra menu.

## BEFORE / AFTER (CPU, same harness)

GPU/FPS/1% low / GC: **not measured**.

| Metric | Before | After | Change |
| --- | --- | --- | --- |
| spawnWalk stacked frames | 39 | **0** | −39 |
| spawnWalk deferred generates | 0 | 17 | +17 |
| spawnWalk generates | 48 | 31 | −17 |
| spawnWalk meshes | 39 | 17 | −22 |
| spawnWalk over-budget meshes | 39 | 17 | −22 |
| spawnWalk stacked max ms | 39.1 | 0 | −39.1 |
| spawnWalk stacked avg ms | 29.5 | 0 | −29.5 |
| spawnWalk generate p95 ms | 10.3 | 9.6 | ~noise |
| spawnWalk generate max ms | 10.9 | 10.9 | ~noise |
| spawnWalk mesh avg ms | 20.8 | 19.5 | −1.3 |
| spawnWalk mesh max ms | 31.1 | 28.7 | −2.4 |
| spawn 9×9 mesh avg ms | 24.8 | 25.5 | +0.7 (noise; full AO path) |
| spawn 9×9 total faces | 419181 | 419181 | 0 |
| cheap vs full (one spawn chunk) | n/a | 27.8 → 19.4 ms | −30% scan, faces match |
| draw calls / triangles (GPU) | not measured | not measured | — |
| average/min/1% FPS | not measured | not measured | — |

Worst PLAYING world-job frame class: BEFORE generate+mesh **~39 ms**. AFTER one mesh **~29 ms** or one generate **~11 ms**, not both.

## Tests

- `npx vitest run tests/streaming-scheduler.test.ts tests/chunk-mesher.test.ts` PASS
- `npm run typecheck` PASS
- `npm run typecheck:server` PASS
- `npm run test:server` PASS
- `npm run build` PASS

Visual QA / Anarchy two-client / GPU FPS: **not run** (Cloud CPU-only). Owner should walk spawn with F3 / `?perf=1` and confirm no holes linger more than a frame and distant AO is acceptable.

## Remaining bottlenecks

1. Nearby chunk mesh scan 15–30 ms (AO). Next candidate: greedy meshing or a worker, after a GPU confirm.
2. Terrain `generate` 8–12 ms here; can be 25–85 ms on slower CPUs. Still one unbounded sync `getChunk` per frame (now without a mesh on top).
3. First mesh in `rebuildDirty` still ignores the leftover budget (limit 1 makes this one chunk).
4. Desktop fill-rate after pixel-ratio 1.25 still unmeasured.
5. `benchmark:performance` still broken (`EntityHost`).

## What can be cut for weak devices (low visual risk)

- Render distance 4 → 2 (already in settings; mobile default is 2).
- Pixel ratio cap 1.0 on desktop too.
- Particle / mob caps (already lower on coarse pointer).
- Keep cheap vertex light at Chebyshev ≥ 2 (would drop AO on ring 2).

## What strongly affects visuals (leave alone unless required)

- Nearby AO (rings 0–2).
- Face culling / layer split (opaque vs water vs vegetation).
- Spawn block data and lighting flood quality.
- Networking V2 interpolation / prediction.
- Farming geometry.

## Future Low / Medium / High knobs (no UI this pass)

| | Low | Medium | High |
| --- | --- | --- | --- |
| renderDistance | 2 | 3–4 | 5–6 |
| pixelRatio cap | 1.0 | 1.25 | 1.5 |
| cheap vertex light from ring | 2 | 3 | off |
| PLAYING meshLimit | 1 | 1 | 1 |
| particles / mobs | current mobile caps | current desktop | current desktop |

## Changed files

- `src/world/streamingScheduler.ts`
- `src/world/streamingSim.ts`
- `src/core/Game.ts`
- `src/rendering/ChunkMesher.ts`
- `src/rendering/WorldRenderer.ts`
- `src/debug/chunkStreamingInspector.ts`
- `src/debug/chunkStreamingRuntime.ts`
- `tests/streaming-scheduler.test.ts`
- `tests/chunk-mesher.test.ts`
- `scripts/benchmark-spawn-perf.ts`
- `package.json`
- `docs/ARCHITECTURE.md`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/reports/2026-09-04_perf-audit-spawn.md`

## Git

Do not commit `.schem` or `server/data/worlds/**`.
