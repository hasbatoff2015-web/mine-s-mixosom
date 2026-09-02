# 2026-09-01 — Inactive Anarchy client world sync

## Goal

Online Anarchy: an inactive/paused/inventory/hidden client still receives world mutations. Block visuals must not stay stale until the player becomes PLAYING again. Not Phase 8. Do not rewrite networking.

## Exact Root Cause

**Case D** (with C/E as the visible symptom):

1. WebSocket `onMessage` is **not** lifecycle-gated (only stale-client generation).
2. `handleOnlineMessage` calls `applyNetworkBlockChanges` immediately → VoxelWorld + `pendingMesh` / deferred light.
3. `Game.frame` called `processWorldJobs` (lighting drain + `rebuildDirty`) **only when** `worldSimulationActive` (`PLAYING`).
4. `render()` still ran every RAF: remote players + `applyInterpolatedEntityVisuals` keep moving.

So packets arrived, world cache was current, meshes were not rebuilt until PLAYING resumed.

Inventory/chest stay `PLAYING` (input blocked by overlay). Pause overlay and tab hide use `PAUSED` / `BACKGROUND` — those skipped remesh entirely.

## Network Receive

Packets continued. `AnarchyClient` does not check lifecycle. `shouldHandleOnlineClientEvent` is session identity only (PR #19/#20).

## World State

Authoritative voxels were already applied. No pending packet queue was added (would duplicate on resume).

## Mesh / Rendering

Dirty chunks waited on `processWorldJobs`. Entities interpolate from a snapshot buffer in `render()`, independent of that scheduler.

## Inventory / Pause

| State | Input | Kernel / tickOnline | World apply | Remesh/light |
| --- | --- | --- | --- | --- |
| Inventory/chest | blocked | still PLAYING | yes | already yes |
| Pause overlay | blocked | no | yes | **now yes** (online) |
| BACKGROUND | blocked | no | yes | **now yes** when a frame runs |

## Background Tab

Browser may throttle or stop RAF. We do not force 60 FPS. When a frame runs (or on resume), jobs drain already-applied dirties. Visual matches state without replaying packets.

## Fix

Minimal: `shouldProcessOnlineWorldVisuals` (`PLAYING` \| `PAUSED` \| `BACKGROUND`). Online `Game.frame` still skips kernel ticks when not PLAYING, but drains `processWorldJobs`. Singleplayer pause unchanged. No LightEngine rewrite. No second fluid sim. No interpolation architecture change.

## Fluid

Same `applyNetworkBlockChanges` path (id then `BlockRenderState`). Tests keep fluid level + chunk-border dirty. No client fluid tick online.

## Lighting

`deferLighting: true` still queues jobs. `processWorldJobs` → existing `processDeferredLighting`. Budget **2** unchanged. LightEngine not rewritten.

## Entities

Interpolation path unchanged.

## Tests

`tests/inactive-client-world-sync.test.ts` (12): policy + apply while paused/inventory/background, batch order, parsed batch idempotence, chunk border, fluid, deferred light, no kernel.

Retained: gameplay-modal, network-block-state-respawn, online-session/respawn/input-recovery, anarchy-server/gameplay, kernel, use-interaction, lighting-adapter.

Full `npx vitest run`: **1194 passed / 7 failed** + 1 RPC (`onTaskUpdate`). Failures are the known baseline: 2 authored ENOENT `bucket_empty.png`, 5 minecart 5s timeouts. Not hidden. `tsc` + `npm run build` PASS.

## Browser QA

Not performed in cloud. Owner: inventory, pause, tab, fluid, two-client (see task TEST A–E).

## Performance

No extra simulation. Same budgeted `processWorldJobs`. No full-world remesh. No resume replay queue.

## Git

- Branch: `cursor/inactive-client-world-sync-37a2` (requested `…-bbb1`; cloud suffix `-37a2`)
- Base: Phase 7 HEAD `a995ded` (`cursor/shared-tooling-split-37a2`)
- Do not merge main. Do not start Phase 8.
