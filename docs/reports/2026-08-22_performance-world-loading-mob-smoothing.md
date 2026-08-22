# Performance / world loading / mob smoothing

Date: 2026-08-22  
Branch: `cursor/performance-world-loading-mob-smoothing`  
Base: `main` @ `9e2b81c165f4a0a80a6567b17d7cee17df90b6c5`

## Goal

Убрать заметные лаги, frame-time spikes и 20-FPS «рывок» мобов, не повышая simulation TPS и не снижая visual quality (render distance, lighting, particles, resolution, FPS cap).

Наблюдаемые симптомы:

- A. 3–5 с низкого FPS сразу после входа в мир.
- B. Мобы визуально обновляются как 20 FPS.
- C. Rapid Creative break роняет FPS до 0–10.
- D. Периодический stutter при беге по новым chunks.

## Result

CPU/job hot paths измерены, затем исправлены на существующих системах (`ChunkMesher`, `WorldRenderer`, `VoxelWorld`, `LightEngine`, `MobManager`, fixed loop). GPU gameplay FPS в этом cloud environment **не измерялся** — local GPU QA обязателен.

Canonical 20 TPS сохранён. Interpolated transforms — только rendering.

## Baseline

Node/`vite-node` CPU, до финального lighting-dirty fix (тот же class of work: 30 sequential interior stone↔air breaks, full-chunk sky, `getChunk` gen+light):

| Scenario | BEFORE (CPU) |
| --- | --- |
| 30 interior breaks | ~62 ms avg / ~72 ms p95 / ~1868 ms total, **120 sky recomputes**, **6 dirty chunks** |
| One `recomputeChunkSky` | ~16.5 ms |
| `seedChunkBlockLight` | ~7 ms |
| `generator.generate` only | ~8 ms |
| Mesh one chunk | ~50–61 ms (`scan` ~55, `geometry` ~6, ~3970 faces) |
| `getChunk` (gen+light together) | ~31–56 ms |

GPU/FPS before: not measured in this environment. User-reported: world entry 3–5 s hitch, Creative rapid break 0–10 FPS, mobs stepping at 20 Hz, short stalls while running.

## Root causes

In order of measured impact:

1. **`relightRegion` / `relightAround` делали полный 6-pass sky каждого overlapping chunk** (radius 8 → ~4 chunks × ~16 ms ≈ 64 ms на один break). Creative ломает 1 блок/tick → death spiral.
2. **LightEngine ставил `chunk.dirty = true` на каждый light write**, поэтому flood/spread помечал соседние chunks к remesh даже для interior occlusion-only edit. 30 edits → десятки mesh jobs.
3. **World entry сразу в `PLAYING`**: маленький sync ring, затем generate+light+mesh по 1 chunk/tick (~30–56 ms) уже во время gameplay.
4. **Mob/drop/arrow visual transform = simulation pose** каждый tick; при 60/120/144 Hz это ступеньки 50 ms. Player/TNT/falling уже интерполировались.
5. **`rebuildDirty` проверял budget после 50 ms remesh** и мог ещё и `ensureChunkLighting` в том же вызове (light+mesh пачка).
6. Catch-up: `MAX_FRAME_DELTA = 0.25` уже резал elapsed, но явного `MAX_CATCH_UP_TICKS` не было.

Не подтвердилось как главный Creative-break виновник: item drops (Creative и так не спавнит collectible drops), particles (в break path нет particle system), autosave (30 s interval, async IndexedDB).

## Changes

### World Loading

SYMPTOM: игрок в мире при FPS 5, пока строится ring.  
MEASURED: `startSession` → `enterPlaying` без готовности render-distance square; `getChunk` ещё и светил chunk синхронно.  
FIX:

- Lifecycle `LOADING_WORLD` (`Lifecycle.ts`, `gameplayModal.ts`). Simulation/input/pointer lock/Creative flight выключены. Yandex `GameplayAPI.start()` только с `PLAYING`.
- Ready = generate + sky/block light + mesh, `chunk.dirty === false`, радиус = текущий render distance (`initialReadyChunkRadius`).
- Determinate overlay: «Загрузка мира» + bar + percent из weighted milestones (`worldLoading.ts`). DOM патчится, экран не пересоздаётся каждый кадр. Percent монотонный, 100 только в `ready`. Exception → error screen, не вечные 97%.
- Jobs с `WORLD_LOADING_JOB_BUDGET_MS = 10`, до 8 generate / 4 light / 4 mesh за кадр, spatial sort. Main thread отдаёт кадры между jobs (один mesh всё ещё может занять 15–30 ms — это не 5-секундный sync freeze).
- Spawn для нового мира оценивается через `generator.columnAt` **без** генерации chunks; после ready — `snapPlayerToTerrain`. Save load использует сохранённую позицию, но тоже ждёт ready radius.
- `renderer.compile` + один warmup render до PLAYING.

### Mob Smoothing

SYMPTOM: рывки 20 Hz.  
MEASURED: `syncVisual` писал simulation position.  
FIX: `entityInterpolation.ts` — previous/current pose, `lerp` position/walkPhase, `lerpAngle` shortest-path yaw, snap если расстояние² ≥ 36. `MobManager.interpolateVisuals(alpha)` с render alpha. AI/physics/hitboxes не читают interpolated pose. Spawn/death/teleport snap. Chicken flap использует visual age. Entity light sampling остаётся на 20 TPS. Тот же path для drops, player arrows, skeleton projectiles. Falling/TNT уже были.

### Block Breaking

SYMPTOM: Creative rapid destroy → FPS 0–10.  
MEASURED: 30 breaks → 120 sky recomputes, 6 dirty chunks, ~62 ms/break.  
FIX:

- `pendingMesh` Set: повторный `markMeshDirty` того же chunk не создаёт второй job.
- Interior edit: `neighborMeshOffsets` пустой; boundary — только нужный ±X/±Z neighbor.
- Opacity+emission unchanged (tall grass → air) → lighting skip.
- Occlusion: localized sky columns radius 4, не 6-pass всех overlapping chunks.
- Block flood только если emission изменился или рядом есть block light.
- LightEngine больше не dirty-ит geometry.
- Emission (torch/furnace): dirty chunks overlapping light AABB.
- `breakTarget` / Creative stress: `applyBlockBatch(..., { deferLighting: true })`; flush один раз за frame.
- Creative по-прежнему не создаёт collectible drops.

AFTER (same machine, `scripts/benchmark-perf-pass.ts`):

| Scenario | AFTER |
| --- | --- |
| 30 interior breaks (stone↔air) | 5.8 ms avg / 7.9 ms p95 / 176 ms total, 45 sky counts, **1 dirty**, **1 pending mesh** |
| 100 deferred Creative-style edits | 26 ms total, **1 sky recompute**, **1 pending mesh**, **1 dirty**, flush < 80 ms (test bound) |

### Streaming

SYMPTOM: stutter при беге в новые chunks.  
MEASURED: generate+light+mesh могли сложиться; lighting dirty-ил соседей.  
FIX: unlit generate → отдельный light job → mesh. PLAYING: если в кадре была generation, mesh откладывается. Adaptive budget от remaining headroom к `TARGET_FRAME_MS`. Unlit dirty chunks не мешатся (`rebuildDirty` skip). Spatial sort. Generation request = `getChunk` cache, без duplicate generate.

### Lighting

SYMPTOM: каждый break = полный relight нескольких chunks.  
FIX: column sky + 4-pass spread in AABB; `sampleSky` не триггерит nested full recompute; `getSkyLight`/`getBlockLight` lazy-ensure только если chunk ещё не lit. Furnace `syncFurnaceEmission` по-прежнему `relightAround(..., false)` + radius remesh.

### Fixed Step

SYMPTOM: риск spiral of death после 300 ms stall.  
FIX: `advanceFixedStep` — cap elapsed и drop excess beyond 4 ticks (200 ms sim). 60 кадров @ 60 Hz ≈ 20 ticks.

### Memory / GC

MEASURED: mesher scan выделял через `world.getBlock`/`resolveState`/`columnAt` на каждый face; geometry arrays новые каждый build.

FIX: reused layer buffers (`resetBuffers`), packed light из соседних chunk arrays, skip `resolveState` для plain cubes (не furnace), `faceVisible` по adjacent `BlockId`. Shared chunk materials без churn. Entity light не сэмплируется каждый render frame.

Не делался слепой rewrite всех `Vector3` в проекте: mob AI cost низкий (`mobTick24` avg 0.61 ms / p95 0.37 ms на 24 мобах).

### Profiler

`?perf=1`: FPS, frame ms / avg / p95 / p99 / max, tick p95, render ms, gen/mesh/wait/light/dirty/mutations, mob count, heap если `performance.memory`, last spike category. Overlay throttle 200 ms. Выключенный profiler — no-op, без p99.

## Benchmarks

### CPU job metrics (this environment)

| Metric | BEFORE | AFTER |
| --- | --- | --- |
| 30 sequential interior breaks avg | ~62 ms | 5.8 ms |
| 30-break p95 | ~72 ms | 7.9 ms |
| 30-break total | ~1868 ms | 176 ms |
| 30-break sky recomputes | 120 | 45 sequential / **≤ 2** in one `applyBlockBatch` |
| 30-break dirty chunks | 6 | **1** |
| 100 deferred edits pending mesh | (would remesh per edit / extra neighbors) | **1** |
| 81-chunk generate avg (`getChunk`) | ~15.4 ms mixed gen+light historically; ~31–56 with light | **4.76 ms** generate-only |
| 81-chunk mesh avg | 18.2 ms (older pass) / ~50–61 single-chunk audit | **12.8 ms avg / 16.4 p95 / 31.4 max** |
| 24-mob tick avg | 0.90 ms (older pass) | 0.61 ms |

### GPU / FPS

**Not measured here.** Cloud agent has no honest 60 Hz gameplay GPU capture for this pass. Do not treat CPU job times as FPS.

manual local GPU QA required.

## Tests

`npx vitest run`: **301 passed / 40 files** (было 276 / 33).

Новые: `entity-interpolation`, `fixed-step`, `world-loading`, `dirty-queue`, `lighting-jobs`, `block-break-batch`, `perf-profiler`.

Существующие lighting/torch/furnace/explosion/UI тесты зелёные.

## Manual QA

Проверить локально (GPU):

1. Новый мир: loading screen живой, percent растёт, не 5 с frozen; PLAYING только когда зона готова; pointer lock после overlay.
2. Load existing save: тот же ready gate, не полупустой мир.
3. Первый gameplay кадр: пол под ногами, lighting не «доезжает» секундами.
4. `?perf=1` overlay: FPS, p95, last spike.
5. Бег/sprint 30–60 с через новые chunks; повороты камеры.
6. Forest с мобами: walk/chase/turn/stop без 20 Hz steps.
7. Один break, 20 breaks, Rapid Creative destroy площадки.
8. Place many blocks; torch place/remove; furnace light on/off.
9. Explosion, stairs/slabs, chest/furnace/crafting GUI, Creative flight.
10. Esc pointer-lock fallback не сломан.

## Deferred

- Один chunk mesh всё ещё 12–30 ms CPU: greedy meshing / worker — отдельное решение после device profiling.
- Initial `recomputeChunkSky` 6-pass на новый chunk (~десятки ms) при streaming. **Снято follow-up lighting pass 2026-08-23:** вертикальный sky + resumable slices, maxSlice ~2 ms CPU.
- Нет occlusion culling / frustum job skip beyond distance sort.
- Autosave JSON всего world не переписывался; 30 s interval, не попал в measured break path.
- Adaptive quality (lower render distance) **не** включался.

## Next work

Follow-up (2026-08-23): lighting performance + chunk seams. See `docs/reports/2026-08-23_lighting-performance-and-chunk-seams.md`.

Device GPU capture with `?perf=1` on the user machine. Если mesh p95 всё ещё > ~16 ms на target device — профилировать greedy vs worker, не резать quality.

## Git

Feature branch only. No merge to main. No force push.
