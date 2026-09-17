# Unknown-block save load compat (dev)

## Goal

World load still crashed with `Unknown block id: 165` on the UI-redesign branch even after the earlier placeholder. Keep ID 165 in the save, do not register a real `BlockId.165`, and make every `getBlockDefinition` path return a runtime placeholder.

## Result

Load no longer throws for unregistered storable IDs (0–65535), including JSON string `"165"`. The numeric ID stays in `modifications` / chunk `Uint16Array`. Runtime uses the same non-registry stone/unbreakable cube placeholder as before.

## Why the previous fix missed this branch

The first compat only treated `Number.isInteger(id)` as storable. IndexedDB / `world.json` / welcome payloads can carry `"165"` as a string. `Number.isInteger("165")` is false, so `getBlockDefinition` skipped the placeholder and threw (`Invalid block id: 165` after the first patch, originally `Unknown block id: 165`). Lighting `adoptUnknownBlockLight` had the same integer check, so string IDs never filled FILTER/OCCLUDES.

Existing tests only called `VoxelWorld.restore` with a numeric `165`, not `parseWorldSnapshot` / `IdbWorldStore` / `WorldInstance.initialize`.

## Implemented

- `normalizeStorableBlockId`: numbers and decimal digit strings in 0–65535.
- `getBlockDefinition`: never throws for those IDs; still throws `Invalid block id` for NaN / fractions / out of range.
- Lookup table is a 65536-slot array (same width as LightEngine FILTER).
- `bindUnknownBlockLight` so creating a placeholder also adopts lighting tables, including IDs seen before LightEngine loaded.
- `VoxelWorld.restore` keeps original IDs after normalize; does not rewrite 165 to Stone.
- Regression: JSON snapshot `"165"` through `IdbWorldStore`; filesystem snapshot `165` through `WorldInstance.initialize`. Both also run lighting, fluids, collision, selection, meshing, and a full-chunk `getBlockDefinition` scan.

## Changed files

- `src/blocks/registry.ts`
- `src/world/LightEngine.ts`
- `src/world/World.ts`
- `tests/block-registry.test.ts`
- `tests/unknown-block-load.test.ts`
- `tests/fs-world-store.test.ts`
- docs: PROJECT_STATE, ROADMAP, TESTING, ARCHITECTURE, this report

## Architecture decisions

- Still no `BlockId.165` and no `BLOCK_REGISTRY` entry.
- Coercing `"165"` → `165` at lookup/restore is not a save rewrite; the voxel identity stays 165.
- Lighting stays in LightEngine; registry only holds a bind callback to avoid a registry ↔ LightEngine import cycle.

## Tests

- Focused: unknown-block-load 3/3, block-registry 16/16, fs-world-store 7/7 PASS.
- `test:server`: 50/51 files, 497/498. `tests/server/tick-load-flight.test.ts` timing flake under parallel load (mean/max setView budget); isolated retry 3/3 PASS (same flake as earlier reports).
- `typecheck`, `typecheck:client`, `typecheck:server`, `typecheck:sim`, `check:boundaries`, `build` PASS.

## Visual QA

Not a UI change. Unknown voxels still look like stone until the real block is registered.

## Known issues

- Placeholder is opaque/solid; the real 165 may differ until the teammate registers it.

## Deferred

- Drop this layer when both branches share the same registry.

## Git

Branch: `cursor/ui-redesign-a8dc` (no visual redesign edits in this pass). Commits `a1bbcd3`, `7e56f83`.
