# 2026-09-18 Bed occupancy, Totem particles, utility icons

## Goal

On `codex/utility-items-v1` only: one player per bed, Minecraft-like Totem world particles after authoritative activation, and targeted inventory icons for White Bed, Oak Door, Farmland, Sugar Cane.

## Result

Done on `codex/utility-items-v1`. `main` was not merged, rebased, or changed.

## Implemented

- Canonical bed occupancy from live `ServerPlayer.restingBed` + HEAD identity (`isSameBed` / `findBedOccupant`). Occupied use returns existing `occupied` reason; client toasts «Кровать занята».
- `totem_activate` now carries `playerId` + position and is broadcast to nearby clients. `TotemParticles` plays a short lime/green/gold burst (~28 particles, 0.55–0.9s) for owner and nearby. HUD still owner-only. SP burst after real offhand consume.
- Icons: White Bed 3D entity-sheet preview; Oak Door `item/oak_door` from `door_wood.png`; Sugar Cane `item/sugar_cane`; Farmland shallow 3D block with dirt sides and 15/16 height.

## Changed files

- `src/world/bed.ts`, `server/gameplay.ts`, `server/WorldInstance.ts`
- `src/gameplay/totemBurst.ts`, `src/rendering/TotemParticles.ts`, `src/core/Game.ts`, `shared/protocol.ts`
- `src/items/itemIcons.ts`, `src/items/itemRenderProfiles.ts`, `src/blocks/placement.ts`
- `src/rendering/ItemIconRenderer.ts`, `src/rendering/ItemVisualFactory.ts`, `src/rendering/specialBlockGeometry.ts`
- `scripts/import-assets.mjs`, `public/textures/item/oak_door.png`
- tests: `tests/server/utility-items-authority.test.ts`, `tests/utility-items.test.ts`, `tests/totem-burst.test.ts`, `tests/item-icon-utility.test.ts`, `tests/special-block-items.test.ts`, `tests/special-preview-contract.test.ts`
- docs: `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `TESTING.md`, this report

## Architecture decisions

- No occupancy Map: second source of truth is worse than scanning connected players. Disconnect already drops `restingBed`.
- Totem visuals use an extended presentation packet, not `world_sound` / AudioManager.
- No vanilla White Bed item PNG exists in the pack; inventory uses the existing entity sheet as a 3D item model. Door and sugar cane use canonical item sprites.

## Tests

Focused: **6 files / 81 tests PASS**. `typecheck`, `typecheck:sim`, `typecheck:client`, `typecheck:server`, `check:boundaries`, `build`, `check:size`, `check:archive` — PASS. Production **4.39 MiB / 368 files**. Full `npm test` not rerun; known host baseline failures remain.

## Visual QA

Not run as live two-client pointer-lock QA in this pass. Code-level occupancy, presentation delivery, particle lifecycle, and icon descriptors are covered by tests.

## Performance

Totem: one Points object, 4-burst cap, 28 particles each. Icon changes are per-item descriptors.

## Known issues

Full `npm test` on this branch previously had host baseline failures (timeouts, CRLF chat-layout, tick-load-flight). Not hidden.

## Deferred

Live two-client occupancy / Totem PvP / inventory visual QA.

## Next work

Merge/rebase onto current `origin/main` as a separate task.

## Git

Branch `codex/utility-items-v1` only.
