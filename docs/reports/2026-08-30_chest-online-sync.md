# 2026-08-30 — Online Anarchy chest GUI sync

## Goal

Fix open chest GUI staying stale after a server-authoritative put/take. Not Phase 6. Do not change persistence, GameplayKernel, or Shared Core.

## Exact Root Cause

Server mutation was already correct. `WorldInstance.applyInventoryAction` runs `applyInventoryUiAction` on the live chest, then `flushPlayerInventory` sends:

```text
inventory + cursor + window: { kind: 'chest', x, y, z, slots }
```

The client restored player inventory and cursor, then **skipped** `openOnlineContainer` when `ui.isInventoryOpen()` was true. Slot copy into `session.world.getChest()` happened only inside that open path. The open GUI holds that same `ChestState` object, so it kept painting the pre-click slots.

Put: inventory/cursor updated (looked like the item left the player), chest GUI empty of the new stack until close/reopen.

Take: inventory showed the item, chest GUI still showed it (visual duplication). Reopen matched the server (one copy).

Not a persistence bug. Not a missing protocol type.

## Put Flow

1. Client click → `inventory_action` only (no optimistic chest mutation).
2. Server validates window/slot and mutates chest + player inventory/cursor.
3. Actor receives `inventory` with `window.slots`.
4. Other players with the same chest window also receive `inventory` (their inventory + new slots).
5. Client `applyAuthoritativeContainerSlots` then `applyAuthoritativeCursor` (re-paint).

## Take Flow

Same path. Chest slot cleared on the live object before the GUI re-renders. Actor inventory/cursor comes from the same packet.

## Protocol

Existing `inventory` / `inventory_action`. No new message. Payload is one player inventory + one container slot array (27 or 3), not the world.

## Two Client

`flushSharedContainerViewers` after the actor flush. Match is `sameSharedContainerWindow` (kind + x/y/z, chest or furnace). Each viewer gets **their** inventory snapshot plus the shared slots.

## Anti-Duplication

Server is single-threaded: two takes of one stack serialize; the second sees an empty slot. Clients do not locally add the item. GUI only displays the last `window.slots`.

## Persistence

Chest blobs were already in `WorldSnapshot.chests` / `world.json`. Unchanged. Restart still loads the mutated slots.

## Singleplayer

Online GUI uses `submitAction` (network only). SP still mutates locally via `applyInventoryUiAction` on the same chest object. Covered by `online-container-sync` SP click test and existing `container-ui` / `inventory` tests.

## Implemented

- `src/net/onlineContainerSync.ts` — parse stacks, apply slots, `shouldOpenOnlineContainer`
- `src/core/Game.ts` — apply slots on every `inventory` packet; open GUI only the first time
- `server/WorldInstance.ts` — `flushSharedContainerViewers`
- `src/inventory/inventoryUiAction.ts` — `sameSharedContainerWindow`

## Tests

- `tests/online-container-sync.test.ts`
- `tests/server/anarchy-chest-sync.test.ts` (put/take both clients, reopen, concurrent take, closed reject, full inventory, invalid slot, persist restart)

Targeted packs also green: container-ui, inventory, anarchy-server, kernel, use-interaction. `tsc` clean.

Full `npm run check`: **1160 passed / 7 failed** (2 authored ENOENT `bucket_empty.png` + 5 minecart 5s timeouts) + 1 vitest RPC. Same baseline as PR #26. Not hidden.

Production `npm run build` + size/archive: **3.65 MiB / 221 files**.

## Performance

One extra `inventory` packet per other viewer of that container. Not a world/chunk dump.

## Next work

Owner local QA. Do not start Phase 6 (RNG + lighting adapters).

## Git

Branch `cursor/chest-online-sync-fix-bbb1` from Phase 5 `cc74c11`. Implementation `b8a2b76`. Draft PR **#27** stacked on **#26**, not `origin/main`.
