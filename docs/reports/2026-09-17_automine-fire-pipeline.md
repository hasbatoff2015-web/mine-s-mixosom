# 2026-09-17 — Player fire height + AutoMine reset pipeline

## Goal

1. Halve the vertical size of the burning-player fire overlay without changing width, PlayerVisual body, or mob fire.
2. Find the real AutoMine reset bottleneck (not “too many blocks per tick”) and remove duplicate work so large resets stay smooth on client and server.

## Result

Fire overlay is squashed on Y via `scale.y = 0.5`. AutoMine lag was **repeated full-column chunk remesh + aborted/restarted lighting floods**, not 64 writes/tick. Fill still writes 64 voxels/tick, but lighting is not queued per batch, region floods are time-sliced, and live remesh rebuilds only dirty Y sections.

## ROOT CAUSE

Previous pass already batched writes (`AUTOMINE_BLOCKS_PER_TICK = 64`) and deferred `relightRegion` until after fill. That did **not** remove the hitch:

1. **Client mesh (primary FPS spike).** Each `block_batch` dirtied the same 16×256×16 columns. `Game.queueUrgentMutationMesh` rebuilt those columns every tick via `WorldRenderer.rebuild` → `ChunkMesher.build` scanning `0..occupancyTop`. A 15³ mine is ~53 batches × 1–4 full columns. The first remesh in a frame ignores the 2 ms urgent budget, so each fill tick could hitch 5–15+ ms. That stacks into a multi-second freeze, even while TPS stays near 20.
2. **Client lighting.** `applyNetworkBlockChanges` used `deferLighting: true`, so every batch merged a growing edit region and `resetRegionLightFlood` aborted any in-flight flood. Between 20 Hz batches the flood would start, then die on the next packet.
3. **Server lighting.** End-of-fill `flushLighting()` ran the whole cuboid+14 halo synchronously on one tick. Fill batches still called `queueLight` (`updateLighting: true` + `deferLighting: true`).
4. **Server redstone.** `onCommittedBlocks` called `notifyBlockChanged` per voxel (64× neighbours per tick) instead of one `notifyBlocksChanged`.

Reducing 64→5 would only stretch the same repeated remesh over more ticks. The fix is to stop remeshing the untouched Y of the column and to stop restarting lighting while voxels are still streaming in.

## BEFORE

From the previous AutoMine pass (same 64/tick, immediate or once-at-end lighting, **full-column urgent remesh unchanged**):

| Metric | 15³ | 32³ |
| --- | --- | --- |
| blocks/tick | 64 | 64 |
| lighting | 1 synchronous `flushLighting` after fill (plus per-batch `queueLight` merge/reset) | same |
| client remesh | full 16×256×16 column every batch (~53 / ~512 times) | same pattern |
| observed hitch | 2–3 s FPS freeze | worse |
| TPS | can still read ~20 while frames stall | same |

## AFTER

Headless production pipeline (same `applyBlockBatch` + client `applyNetworkBlockChanges` + urgent `rebuildDirty`), not paced at 50 ms ticks:

| Metric | 15³ (3375) | 32³ (32768) |
| --- | --- | --- |
| max batch | 64 | 64 |
| write ticks + lighting ticks | 53 + 4 = 57 | 512 + 16 = 528 |
| max write ms | 0.81 | 0.42 |
| max lighting slice ms | 3.08 | 2.30 |
| max AutoMine tick ms | 7.15 | 12.04 |
| wall duration (unpaced) | 201 ms | 2085 ms |
| paced duration @ 20 TPS | ~2.85 s | ~26.4 s |
| client max remesh ms / batch | 5.59 | 11.82 |
| client avg remesh ms / batch | 2.99 | 3.68 |
| max Y-sections remeshed | 2 | 3 |
| implied unpaced TPS | 284 | 253 |

Paced 20 TPS still takes ~N/64 seconds to fill; that is visible top-down generation, not a freeze. Per-tick server work stays well under 50 ms. Client remesh is 1–3 sections instead of the whole column.

## FIRE

`PlayerVisual.syncFireOverlay` still creates `SharedFireTexture.createScaledOverlay(0.7, 1.85)` at `position.y = 0.15` (feet stay put). After create it sets `overlay.scale.y = PLAYER_FIRE_OVERLAY_SCALE_Y` (`0.5`). `scale.x` / `scale.z` remain 1. Mob fire in `ThreeEntityHost` and first-person quads are unchanged. On/off still follows discrete `onFire`.

## CHANGES

- `src/rendering/player/PlayerVisual.ts` — player-only fire `scale.y = 0.5`.
- `src/world/Chunk.ts` — dirty Y range + section range helper.
- `src/world/World.ts` — `markMeshDirty(chunk, y?)`; hold edit-region floods while a ≥8-block burst is still arriving (`EDIT_LIGHT_BURST_HOLD_MS = 80`); `hasQueuedRegionLight`.
- `src/rendering/ChunkMesher.ts` — optional `{ minY, maxY }` scan; vertical neighbours read outside the band.
- `src/rendering/WorldRenderer.ts` — one Three.js group per `MESH_SECTION_HEIGHT` (16); live edits rebuild dirty sections only.
- `src/core/constants.ts` — `MESH_SECTION_HEIGHT`.
- `server/services/autoMine.ts` — fill uses `updateLighting: false`; lighting phase is budgeted `processLighting` (`AUTOMINE_LIGHT_BUDGET_MS = 8`).
- `server/gameplay.ts` — one `notifyBlocksChanged` per committed batch.
- Tests: `tests/remote-player-fire.test.ts`, `tests/automine-reset-pipeline.test.ts`, `tests/server/auto-mine-core.test.ts` (15³ + 32³).

## Architecture decisions

- Extend `ChunkMesher` / `WorldRenderer` instead of a second mesher. Section groups replace “delete whole column and rebuild”.
- Do not lower 64→5. Burst lighting hold is activity coalescing (80 ms after the last ≥8-block edit), not `setTimeout`/`sleep`.
- Server AutoMine does not queue light during fill; one cuboid+halo job is sliced across ticks. Client still queues from `block_batch`, but does not start the flood until the burst pauses, so `resetRegionLightFlood` is a no-op during fill.
- Light rebake after the flood still marks the whole column (`meshDirtyAllY`) because vertex light is baked into every section.

## Tests

- `npm run typecheck` PASS
- `npm run typecheck:server` PASS
- `npm run check:boundaries` PASS
- `npm run test:server` 509/509 (was 508)
- `npm run test:sim` 66/66
- `npm run build` PASS
- Targeted: fire overlay scale, 15³/32³ fill, section remesh, lighting hold, urgent remesh, lighting adapter

## Visual QA

Not re-run in a live browser this pass. Overlay scale and AutoMine pipeline are covered by unit/pipeline tests. Live FPS during a 32³ reset in Anarchy was not measured in-game.

## Performance

See AFTER table. Client frame spike is now a per-batch remesh of 1–3 Y-sections (max ~12 ms on 32³ in the harness), not a multi-second full-column storm.

## Known issues / remaining limitations

- After lighting completes, a light rebake still remeshes occupied sections of touched columns (once, time-sliced by the ordinary mesh budget).
- Urgent remesh still allows the first section group in a frame to exceed the 2 ms budget; a dense new 16×16×16 band can hitch ~10 ms.
- Fill duration at 20 TPS is still volume/64 ticks (~26 s for 32³). That is generation time, not a freeze.
- No live in-game FPS capture (before/during/after) in this environment.

## Deferred

Y-section light rebake (only dirty light bands). Worker/greedy meshing. Changing AutoMine 64/tick.

## Next work

Live Anarchy FPS pass on a 32³ mine if a hitch is still visible after light rebake.

## Git

Branch `cursor/bugfix-performance-gameplay-31b4` (PR #93). Do not merge.
