# 2026-09-19 — World events hardening + bounded streaming

## Goal

Follow-up after code review and live QA on `cursor/world-events-event-chest-525a`: keep the existing world-events foundation, fix scheduling/protection/crash/IO defects, and bound chunk generation/meshing so event-distance streaming no longer spends a full 50 ms mesh in one frame.

## Result

Hardening landed on the existing `WorldEventsManager` / templates / EventChest / shared `/wand` path. Client streaming now uses resumable generation slices and section mesh jobs. Focused tests, typechecks, boundaries, and production build passed. Canonical Windows `E:\...\event_chest.png` is **not** available in this cloud VM; latch tests use the checked-in surrogate `scripts/event-chest-source.png`.

## Implemented

### World events

- IANA `timeZone` (`Europe/Moscow` default). Cached `Intl.DateTimeFormat`. 20:00 Moscow = 17:00 UTC.
- Catch-up spawn if the server starts after daily time but inside the duration window; miss after the window.
- `lastSpawnDayKey` only after successful **scheduled** placement. Manual force spawn is `countsAsDaily: false`.
- Failed search retries after `SEARCH_RETRY_MS` (30 s). It does not consume the day.
- `/events force spawn` without coordinates starts a time-sliced search job.
- `/events reload` reschedules only `scheduled` / `warning_sent`.
- In-memory `SpawnValidationContext` (O(1) store reads per search cycle).
- Reject player modifications, chests/furnaces/signs, and obvious player blocks in the **structure** volume.
- Crash journal `placing` / `cleaning`; reapply stored loot (no reroll); `acknowledgeWorldSaved` only after the latest queued world save.

### System claim

- Virtual claim from `active` / journal, not `claims.json`.
- `structureVolume` = template footprint (snapshot/placement).
- `protectionVolume` = same X/Z, `MIN_WORLD_Y..MAX_WORLD_Y`.
- `/claim create` and claim-anchor **volumes** (not just the placed block) hard-deny overlap, including operators.
- Build/break/explosion use protection volume with a 2.5 s deny-message cooldown. Boundary shown via `ClaimBoundaryNetwork`.

### FPS / streaming

- Live F3 at ~X=-4295 Z=1586 (event ring) showed gen max 32.70 ms and mesh max 56.10 ms with TPS 20. EventChest renderer was not the bottleneck.
- `continueGeneration` + `TerrainGenerator.advanceGenerate` slices. `getChunk()` still completes a chunk for readers that need it.
- `WorldRenderer.rebuildDirty` meshes a bounded number of **sections**, keeps `dirty` until the job finishes, swaps a section only after the replacement exists.
- Frame spike capture 33 ms (console 100 ms). HUD `latest` vs `max` for longtask and frameSpike. Hidden-tab / resume samples are `background`.

## Changed files

World events: `server/services/worldEvents.ts`, `eventScheduler.ts`, `eventProtection.ts` (new), `spawnValidation.ts` (new), `eventLoot.ts` (unchanged API), `jsonStore.ts` (`readCount`), `server/builtin-plugins/worldEvents.ts`, `claims.ts`, `server/WorldInstance.ts`.

Streaming: `src/world/Generator.ts`, `src/world/World.ts`, `src/rendering/WorldRenderer.ts`, `src/core/Game.ts`, `src/debug/longTaskMonitor.ts`, `src/debug/pageVisibilityProbe.ts`.

Texture: `scripts/paint-event-chest.mjs` (E:\ candidate + latch bounds). Surrogate source unchanged.

Tests / QA: `tests/server/world-events.test.ts`, `world-events-plugin.test.ts`, `event-scheduler.test.ts`, `tests/incremental-mesh.test.ts`, `generation-stages.test.ts`, `longtask-monitor.test.ts`, `hidden-tab-motion.test.ts`, `urgent-block-mesh.test.ts`, `event-chest-texture.test.mjs`, `scripts/qa-streaming-budget.ts`.

Docs: `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, this report.

## Architecture decisions

- Virtual system claim instead of a persisted user claim so restart/cleanup cannot leave stale `claims.json` rows.
- Protection Y is full world height; snapshot Y stays the 3-block shrine.
- Journal + queued `WorldInstance.save()` (only the latest generation acknowledges) instead of a database transaction.
- Generation is staged on the existing generator, not a WebWorker rewrite. Feature passes (ores/decorate) are still one slice each.
- Mesh budget is applied **before the next section**, not before the first section of a frame (one bounded section may still start).

## Tests

Focused world-events / claims / wand / chest / mesh / scheduler / longtask: **PASS**.

Additional claims + AutoMine + streaming-scheduler + chunk-mesher: **PASS**.

See Validation below.

## Visual QA

No two-client live F3 in this cloud run. Node QA: `npx vite-node scripts/qa-streaming-budget.ts`. Latch texture test PASS on surrogate source. Plugin tests spawn/lock/protect/cleanup EventChest on a real `WorldInstance`.

## Performance

Live QA **BEFORE** (player F3, event distance ~4000):

| metric | before |
| --- | --- |
| FPS | 89 |
| frame avg / p95 / max | 10.74 / 13.10 / 19.50 ms |
| generation avg / max | 10.79 / 32.70 ms |
| mesh avg / max | 20.32 / 56.10 ms |
| frameSpike max | 0 ms (100 ms threshold) |
| longtask last | 1923 ms @ ~9.7 min (historical max) |

Agent **AFTER** (this VM, `qa-streaming-budget.ts`, not the same hardware as the live client):

| metric | after (this VM) |
| --- | --- |
| generation full `getChunk` avg / max | 10.258 / 18.265 ms |
| generation slice avg / p95 / max | 0.335 / 0.841 / 1.548 ms |
| far `continueGeneration` slice avg / max | 3.973 / 5.050 ms |
| mesh section call avg / p95 / max | 3.144 / 5.781 / 14.503 ms |
| mesh job wall (all sections, many frames) avg / max | 15.726 / 35.570 ms |

A single section can still cost ~14 ms on this CPU. A full-chunk 50+ ms mesh is no longer one frame. Dirty stays set until every required section is done.

## Known issues

- `getChunk(generate=true)` still finishes a pending job synchronously (physics / server readers). Client streaming uses `continueGeneration`.
- Feature generation passes (lava/ores/deposits/decorate/cane) are one slice each; residual cost if decorate is heavy on some seeds.
- First mesh section of a frame can still exceed 4 ms (budget gates the *next* section).
- Canonical `E:\Games\Minecraft123\assets\minecraft\textures\entity\chest\event_chest.png` is not on this VM.
- Live two-client F3 at event distance was not re-run here.

## Deferred

Owner live Anarchy FPS pass with the new F3 `latest`/`max` lines. Optional further split of `decorate()`.

## Next work

Repeat the live scenario (warm terrain, then ~4000 blocks, then event shrine open/closed) and compare F3 against the BEFORE table.

## Git

Branch `cursor/world-events-event-chest-525a`. No merge/rebase/force-push. Base remains `main`.
