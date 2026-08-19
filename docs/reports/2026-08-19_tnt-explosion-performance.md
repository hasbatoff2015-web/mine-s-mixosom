# TNT / explosion pipeline performance

Date: 2026-08-19  
Project: Frontier Cubes `0.1.0`

## Problem

Один TNT уже давал заметный hitch. Цепочка из десятков primed TNT полностью вешала вкладку: input и render переставали отвечать, браузер показывал «страница не отвечает». Радиус, power и cap `64` здесь ни при чём — ломался main-thread алгоритм.

## Reproduction

1. Creative, положить плотный массив TNT (10 / 32 / 64).
2. Поджечь один блок рычагом, огнём или соседним взрывом.
3. До фикса: после нескольких одновременных fuse игра замирает на сотни миллисекунд–секунды.

## Profiling

Hot path до фикса:

```
detonate → consumeExplosionEvents → Game.explode
  for each voxel in ~9×9×9:
    new THREE.Vector3(...).distanceTo
    world.setBlock(Air)          // relightAround per block
    redstone.notifyBlockChanged  // enqueue self + 6 neighbours
    if TNT: primeTnt → setBlock(Air) again + relightAround
```

`relightAround` на каждый solid→air:

- `recomputeChunkSky` по всем loaded chunks в радиусе света (полный столбец `16×80×16` + до 6 spread passes);
- `propagateBlockLight` / flood до `8192` узлов;
- dirty соседних chunks.

80 разрушенных блоков ≈ 80 полных sky recomputes одного и того же chunk. 32 explosions в одном tick умножают это ещё раз. Allocation `Vector3` на каждый voxel добавляет GC, но не является главным.

## Root cause

Per-block expensive side effects (`relightAround` + redstone notify + optional second `setBlock` на chain TNT) плюс unbounded `for (event of consumeExplosionEvents()) explode(event)` в одном simulation tick.

Не lighting engine как таковой и не mesher: `WorldRenderer.rebuildDirty` уже budgeted. Explosion path звал relight синхронно до meshing.

## Old explosion pipeline

```
fuse 0 → event
Game.explode (sync, все events)
  damage player/mobs
  voxel loop + Vector3
  setBlock + notify per cell
  primeTnt → setBlock Air + notify + entity
```

## New explosion pipeline

```
fuse 0 → event → ExplosionQueue.enqueue
each tick, while budget:
  resolveExplosion (read-only scan, scalar distanceSq)
  collect destroyed + chained TNT (dedupe keys)
applyBlockBatch (raw writes, then ONE relightRegion)
notifyBlocksChanged (Set enqueue)
primeTnt(..., { blockAlreadyRemoved: true })
≤2 explosion tones / tick
```

Mesher по-прежнему забирает dirty chunks своим бюджетом. Immediate rebuild нет.

## Bulk world mutation

`VoxelWorld.applyBlockBatch(mutations, { record, updateLighting, scheduleNeighbors })`:

- last-write-wins по `blockKey`;
- `writeBlockRaw` без lighting;
- dirty chunk + boundary neighbours через `Set`;
- scheduled ticks через `scheduledKeys` (без сотен дублей одной клетки);
- затем `relightRegion` на union AABB + light margin.

`setBlock` теперь тонкая обёртка над batch из одного элемента — одиночная копка не теряет immediate lighting.

## Lighting batching

`LightEngine.relightRegion` — канонический путь. `relightAround` делегирует ему. `lightEngineStats.skyRecomputes` / `blockPropagations` считают вызовы.

50 solid→air в одном chunk:

| | sky recomputes |
| --- | ---: |
| 50× `setBlock` | >> 8× batch |
| 1× `applyBlockBatch` | ≤ 9 (затронутые loaded chunks, каждый один раз) |

## Redstone batching

`notifyBlocksChanged`. `enqueue` по-прежнему через `dirtySet`: повторный notify той же клетки не растёт. 50× `notifyBlockChanged(5,40,5)` → `pendingPropagation === 7` (клетка + 6 соседей).

## Explosion queue / budget

`ExplosionQueue` (не второй explosion engine):

- desktop: ~3.5 ms, 12 jobs, 512 voxels / tick;
- mobile (`pointer: coarse`): ~1.8 ms, 6 jobs, 256 voxels;
- первый job в slice всегда завершается целиком, чтобы одиночный TNT не «ел стену по блоку»;
- overlapping jobs в одном slice делят один batch + один relight.

## Chain TNT

Resolve кладёт TNT в тот же destroyed batch. Entity создаётся `primeTnt(..., { blockAlreadyRemoved: true })` без второго `setBlock`/`relightAround`. Cap `64` уважается через `primedCapacityRemaining`. Перекрывающиеся explosions не праймят одну клетку дважды (`ignore` set).

Обычное рычаг/redstone priming по-прежнему удаляет блок само.

## Scheduled ticks

`schedule` больше не пушит дубликаты одного `blockKey`. Falling sand/gravel после дырки по-прежнему ставятся в очередь и подхватываются существующим `FallingBlockManager`.

## Benchmarks

Unit harness (`tests/explosion-performance.test.ts`):

| Case | Result |
| --- | --- |
| 50-block lighting | sequential sky recomputes > 8× batched; batch ≤ 9 |
| 50 redstone notifies | unique pending < 50×7; identical cell ×50 → 7 |
| Chain 3 TNT | one primed entity per TNT, one batch relight |
| 32 overlapping explosions, 2 ms budget | queue drains in >1 and <40 ticks, peak CPU < 250 ms/slice |
| Single radius-4 dirt blast | processed=1, pending=0, cpu < 100 ms |

Gameplay radius/power/cap не уменьшались.

## Stress tests

Автоматически: single slice, 32-job drain, chain, lighting/redstone dedupe.

Browser (Creative, F3: `boom Q pending/processed vx destroyed · cpu/relight ms sky N`):

- A — 1 TNT: мгновенная дырка, свет открывается, без freeze.
- B/C/D — 10 / 32 / 64: chain идёт волной по ticks; вкладка остаётся отзывчивой; queue → 0; primed → 0. Допускается краткий FPS drop, не stall >500 ms.

Канон: Creative, не QA harness.

## Performance

- JS 713.58 kB / 190.94 kB gzip (было ~709 / 189).
- Archive 0.92 MiB / 165 files.
- 70 modules. Extra draw/mesh path не добавлялся.
- Explosion audio: максимум 2 tone/tick.

## Tests

`tests/explosion-performance.test.ts` — 5 cases. Suite: **19 files / 108 tests**.

Pipeline: `tsc`, `vitest`, `vite build`, `check:size`, `check:archive` — PASS.

## Known limitations

- Sky light в vertex color всё ещё не масштабируется time-of-day; открытый ночной факел слабее пещерного.
- Huge AABB из далёких одновременных TNT всё ещё один `propagateBlockLight` на union; bounded loaded chunks, но не vanilla light engine.
- Queue не сериализуется mid-slice; каждый applied batch атомарно в `modifications`, autosave безопасен.
- 64 TNT не обязаны держать 180 FPS.

## Next work

- Browser mass-TNT на слабом Android.
- Если после batching slice всё ещё >4 ms: профилировать `recomputeChunkSky` spread, не worker.

## Git

Не коммитилось, пока пользователь явно не попросит.
