# 2026-09-19 — World events persistence and streaming races

## Goal

Точечный follow-up после независимого code audit ветки `cursor/world-events-event-chest-525a` @ `213af35`. Не переписывать WorldEventsManager / Moscow scheduler / virtual claim / journal / loot / staged generation / resumable meshing / F3 telemetry — закрыть 7 дефектов.

## Result

Overlay больше не загрязняет `world.modifications`. Snapshot restore снимает `BlockRenderState`, если его не было. Resumable MeshJob не считает chunk clean, если во время job мутировала уже собранная секция. Server event search больше не делает 4 полных far `getChunk(true)` за тик. Failed search не ставит сундук после `cleanupAt`. Catch-up берёт lock/announce из фактического `now`. Перед place — один fresh validation context.

HEAD before: `213af3587c1355c6125ead85601e0fc19f04ff73`  
HEAD after: (this commit)

## Implemented

### EVENT PERSISTENCE

`applyPlacement()` / `restoreSnapshot()` вызывали `applyBlockBatch` без `record: false`. Default `record = options.record !== false`, поэтому `writeBlockRaw` писал overlay и restored terrain в `world.modifications`. Теперь оба пути (и fallback cleanup `Air`) используют `EVENT_TRANSIENT_BATCH = { skipSupport, deferLighting, record: false }`. Существующие modification entries не чистятся вручную.

`restoreSnapshot` всегда вызывает `replaceBlockState(x,y,z, cell.state)` где `state` может быть `undefined`. Раньше `if (cell.state)` пропускал отсутствие state; при том же block ID `applyBlockBatch` был no-op и event facing/stairs оставались.

### MESH

`meshRevision()` смотрел `lightVersion` + dirty Y range. Mutation внутри уже покрытого range не меняла revision, `ensureMeshJob` продолжал со следующей секции, `finalizeMeshJob` ставил `dirty = false`. Добавлен monotonic `Chunk.meshContentVersion` (bump в `markMeshDirty`, то есть и block ID, и `setBlockState` / `replaceBlockState`). In-progress job не rewindится (иначе AutoMine голодает); mismatch → `stale`, finalize оставляет `dirty` и не вызывает `acknowledgeMeshed`.

### EVENT SEARCH

`randomCandidate()` → `surfaceY` → `getChunk(true)` синхронно генерировал far chunk (pending: `while (!advanceGenerate)`; fresh: `generator.generate`). `attemptsPerTick = 4` мог закончить несколько новых chunks за один server tick. Search теперь выбирает X/Z без generation, держит pending footprint chunks и крутит `continueGeneration` с `EVENT_SEARCH_GENERATION_BUDGET_MS = 4` и max 1 chunk commit / tick. `getChunk(generate=true)` не менялся глобально.

### SCHEDULER / VALIDATION / TEXTURE

- `now >= cleanupAt` и unplaced occurrence → discard без place/announce; `lastSpawnDayKey` по-прежнему только после успешного scheduled place.
- `placeAt` считает `locked = now < unlockAt`; announce использует `minutesRemaining(unlockAt, now)` или «Сундук открыт!».
- Cached context остаётся на цикл; непосредственно перед `placeAt` — один `freshValidationContext()` + повторный `validateCandidate`.
- `loadEventChestSource()` возвращает `{ image, sourcePath, sourceKind }` (`windows-canonical` | `repo-surrogate` | `normal-fallback`).

## Changed files

- `server/services/worldEvents.ts`
- `src/world/World.ts`
- `src/world/Chunk.ts`
- `src/rendering/WorldRenderer.ts`
- `scripts/paint-event-chest.mjs`
- `scripts/qa-world-events-races.ts` (new)
- `tests/server/world-events.test.ts`
- `tests/server/world-events-plugin.test.ts`
- `tests/incremental-mesh.test.ts`
- `tests/event-chest-texture.test.mjs`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, this report

## Architecture decisions

- `record: false` instead of wiping the modification map: force-spawn volume may already contain real player edits.
- Finish-then-refresh MeshJob instead of rewinding `nextSection`: continuous section-0 writes would otherwise starve the job.
- Search generation cap is **commits per tick** (1), not a fake sub-phase wall clock. One generator feature phase may still exceed 4 ms.
- Fresh validation is once per almost-placed candidate, not per voxel. Failed fresh check replaces the cached context so the new claim is visible to later attempts without extra disk IO.

## Tests

Focused 20 files / **125 tests PASS** (world-events 30, plugin 3, incremental-mesh 4, generation-stages, scheduler, claims/anchors, event chest texture, hidden-tab, longtask, automine, urgent mesh).

## Visual QA

No live two-client session. Headless:

- `tests/server/world-events-plugin.test.ts` WorldInstance: force spawn, protection, `serializeModifications` before/after spawn and cleanup.
- `npx vite-node scripts/qa-world-events-races.ts`

## Performance

QA far search (`spawnMin=Max=80`, budget 4 ms, max 1 commit/tick): 8 ticks until place; commits per tick `0,1,0,1,...` max **1**; tick duration max **7.0 ms**, avg **4.5 ms**; last search generation slice **5.3 ms**. Not 4× full far generate.

## Known issues

Canonical Windows `E:\Games\Minecraft123\...\event_chest.png` отсутствует на этой VM; sourceKind = `repo-surrogate`. Live F3 at event distance still owner-only.

## Deferred

Owner live Anarchy FPS QA at event ring.

## Next work

Live two-client confirmation of catch-up announce and far-search tick times on a populated Anarchy world.

## Git

One commit on `cursor/world-events-event-chest-525a`. No merge / rebase / force push. `main` untouched.
