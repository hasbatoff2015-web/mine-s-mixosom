# 2026-09-07 — Portal Chest (personal store)

## Goal

Add **Портальный сундук** (`portal_chest`) as a full block: same chest model/lid/UI as the wooden chest, personal 27-slot inventory per player (Ender Chest mechanics), server-authoritative, persisted, multiplayer-safe, claims-aware. Do not fork a second container system.

## Result

Any physical `portal_chest` is only an access point. The server opens that player's `portalChest.slots`. Player B never receives player A's snapshot. Ordinary chests stay coord-keyed and shared.

## Implemented

- `BlockId.PortalChest = 158`, key `portal_chest`, Russian name «Портальный сундук», `renderShape: 'chest'`, wood SFX, hardness 2.5 / axe / not flammable.
- Recipe `portal_chest`: `[ ][redstone_dust][ ]` / `[ ][chest][ ]` / `[obsidian][obsidian][obsidian]` → 1.
- `src/inventory/portalChest.ts`: 27-slot helper, normalize/assign, `isChestWindowKind`, `isChestLikeBlock`.
- Server: `GameplayPlayer.portalChest`; `openContainer('portal-chest')`; `applyInventory` / `flushPlayerInventory` bind player store; `releaseContents` does not drop/wipe personal slots; persist on `SerializedPersistedPlayer.portalChest`.
- Client SP: `GameSession.portalChest` in snapshot save/load; same chest GUI; lid animation via existing `ChestRenderer.setOpenTarget`.
- Online: `ContainerKind` += `'portal-chest'`. Not a shared window. `applyAuthoritativeContainerSlots` writes portal slots onto the player store, never `world.getChest`.
- Texture: authored `public/textures/entity/chest/portal.png` (128×128, same UV layout as `normal.png`, dark teal body + purple accents; gold/lime latch 12×10 unchanged). Fallback tile `public/textures/block/portal_chest.png`. Visual polish: `docs/reports/2026-09-07_portal-chest-texture.md`.
- Claims: existing `blockPlace` / `blockBreak` / `playerInteract`. No new claim flag and no extra bypass.

## Changed files

Core: `src/blocks/types.ts`, `registry.ts`, `soundGroups.ts`, `src/inventory/portalChest.ts`, `index.ts`, `inventoryUiAction.ts`, `src/crafting/recipes.ts`, `shared/protocol.ts`, `src/i18n/ru.ts`.

Server: `server/gameplay.ts`, `server/WorldInstance.ts`.

Client: `src/core/Game.ts`, `gameplayModal.ts`, `src/gameplay/useInteraction.ts`, `src/net/onlineContainerSync.ts`, `src/ui/GameUI.ts`, `containerTheme.ts`, `containerStrings.ts`, `containerInteractions.ts`, `recipeBook.ts`, `src/world/blockInteraction.ts`, `collision.ts`, `src/save/types.ts`, `snapshot.ts`.

Render: `src/rendering/chestModel.ts`, `ChestRenderer.ts`, `WorldRenderer.ts`, `ItemVisualFactory.ts`.

Assets: `public/textures/entity/chest/portal.png`, `public/textures/block/portal_chest.png`.

Tests/docs: `tests/portal-chest.test.ts`, `tests/server/portal-chest.test.ts`, crafting / chest-model / online-container-sync / placement / gameplay-modal / audio / special-preview; `docs/PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `TESTING.md`.

## Architecture decisions

- Reuse chest geometry, lid lerp, container UI, `applyInventoryUiAction`, and the existing `inventory` packet. New kind `'portal-chest'` is enough to stop sharing and to route slots to the player.
- Identity = `ServerPlayer.id` (UUID). Reconnect uses `sessionToken` → same stored player → same `portalChest`.
- Do not allocate `VoxelWorld.chests` for portal blocks. Opening must not call `getChest`.
- Persistence is an optional player-record field. Missing/corrupt → empty 27 slots. No world-schema bump.
- Claims stay on place/break (and plugin `playerInteract`). Ordinary chests were already openable in foreign claims; portal chests follow that.

## Tests

```text
npx vitest run tests/portal-chest.test.ts tests/server/portal-chest.test.ts \
  tests/crafting.test.ts tests/online-container-sync.test.ts tests/chest-model.test.ts \
  tests/special-preview-contract.test.ts tests/gameplay-modal.test.ts \
  tests/placement-support.test.ts tests/audio-sfx.test.ts tests/server/anarchy-chest-sync.test.ts \
  --maxWorkers=2
npm run typecheck && npm run typecheck:client && npm run typecheck:server && npm run typecheck:sim
npm run check:boundaries
npm run test:sim && npm run test:server -- --maxWorkers=2
npm run build
```

- Focused pack: **118 PASS** (portal unit 7, portal server 8, crafting 9, online-container-sync 6, chest-model 10, special-preview 4, gameplay-modal 9, placement 37, audio 20, anarchy-chest-sync 8).
- All four typechecks PASS. Boundaries PASS. `test:sim` **42/42**.
- `test:server` **274/275**; only known CPU-sensitive `tick-load-flight` exceeded 80 ms. Not raised.
- `npm run build` PASS.

## Visual QA

Follow-up texture pass: `docs/reports/2026-09-07_portal-chest-texture.md`. Body/lid now use dark teal + purple accents; gold/lime latch is unchanged. Owner should still craft, place two portal chests, and confirm two players on one block see different inventories.

## Performance

No extra world chest entities. Portal slots live on the player record. ChestRenderer now has a second entity material; instance count is still one group per visible chest cell.

## Known issues

- Manual two-client / SP craft-and-open QA is still owner-side.
- `tick-load-flight` remains the known wall-clock flake on loaded CI VMs.

## Deferred

Homes/TPA/economy/kits. Vanilla Ender Chest recipe (Eye of Ender). Double-chest portal variant.

## Next work

Owner live QA listed on the roadmap. Merge only after that if visual/latch contrast needs a texture tweak.

## Git

Branch `cursor/portal-chest-3f93` from `main` `26552b4`. Draft PR **#67**.
