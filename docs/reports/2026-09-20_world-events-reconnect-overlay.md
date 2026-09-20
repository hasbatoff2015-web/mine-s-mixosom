# 2026-09-20 — World event overlay on reconnect

## Goal

Reconnect and late-join clients must see the same active shrine as the live server. Transient event voxels must not become persistent `world.modifications`.

## Result

Welcome and `chunk_data` carry **effective network** modifications (persistent deltas + active `placement`). `EVENT_TRANSIENT_BATCH.record` stays `false`. `ServerPlayer.knownChunks` is connection-scoped.

## Implemented

- `overlayEventPlacementOnModifications` / `overlayEventPlacementOnChunkModifications` in `server/services/worldEvents.ts`. Air overlay cells are kept.
- `WorldEventsManager.networkPlacement()` only while `spawned_locked` / `active_unlocked`.
- `WorldInstance.networkModifications()` / `networkChunkModifications()`; `modifications()` and `flushWorldSnapshot` still use `serializeModifications()`.
- `AnarchyServer` welcome uses `networkModifications()`. Live `serializeBlockStates()` already includes event facing/stairs.
- `resetConnectionInput` clears `knownChunks`. In-memory session resume now `syncChunksFor` like a new join. `materializeStoredPlayer` already started with an empty set.
- Client `chunk_data` still `getChunk(true)` for generation + signs. Block IDs come from `welcome.modifications` via `VoxelWorld.restore` → `finishGeneratedChunk`. Far (3000–5000) event columns are not generated at login.

## Changed files

- `server/services/worldEvents.ts`
- `server/WorldInstance.ts`
- `server/AnarchyServer.ts`
- `src/core/Game.ts`
- `tests/server/world-events.test.ts`
- `tests/server/world-events-plugin.test.ts`
- `tests/server/anarchy-server.test.ts` (chat wait matches exact text so event announce cannot steal the assertion)
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`

## Architecture decisions

Persistent save and network bootstrap are different accessors. Overlay is a copy; `world.modifications` is never mutated. Priority is event cell over persistent cell, including Air.

## Tests

Reconnect restore vs control without overlay (control = old bug), full placement parity, representative shrine cells, chunk-border overlay, prune/reload, cleanup-after-reconnect, late join, knownChunks connection lifetime, storedPlayers restart resume, persistence-no-pollution.

## Visual QA

No live two-client browser session in this cloud run. Headless `VoxelWorld.restore` matches `Game.startOnlineAnarchy`.

## Performance

Network overlay is a small modification delta. Login does not `getChunk` the far event ring.

## Known issues

Live Anarchy reconnect at the shrine still needs owner browser QA.

## Deferred

Owner live two-client reconnect / render-distance / cleanup walkthrough.

## Next work

Owner Anarchy reconnect QA at the shrine.

## Git

Follow-up commit on `cursor/world-events-event-chest-525a`. No merge / rebase / force push.
