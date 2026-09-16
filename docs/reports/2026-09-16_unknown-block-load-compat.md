# Unknown block load compat (dev)

## Goal

Temporary compatibility so a world that contains voxel IDs from a teammate’s unmerged block work (example: **165**) can load on this branch without `RangeError: Unknown block id`. Do not invent BlockId 165. Do not rewrite saved IDs to a known block.

## Result

Load no longer throws. The numeric ID stays in chunk `Uint16Array` and `modifications`. Runtime queries use a **non-registry** placeholder (opaque stone-textured cube, unbreakable). When the real definition is registered in a later build, `BLOCK_DEFINITIONS_BY_ID` wins and the same voxels become the real block.

## How load worked (and still works)

1. Filesystem / IndexedDB snapshot stores `modifications[chunkKey][cellIndex] = number`.
2. `VoxelWorld.restore()` copies those numbers into `this.modifications` (no registry check).
3. `getChunk()` generates terrain, then `chunk.writeIndex(index, block)` writes the raw ID.
4. Lighting, fluids, collision, meshing call `getBlockDefinition(id)`. **That** used to throw for any ID missing from `BLOCK_REGISTRY` (`src/blocks/registry.ts`). Highest registered ID on this branch is `TntDestructive = 163`.

## Implemented

- `getBlockDefinition`: known IDs unchanged; storable unknown IDs (0–65535) get a cached placeholder; non-integers still throw `Invalid block id`.
- `tryGetBlockDefinition` / `isKnownBlockId` / `BLOCK_REGISTRY` still mean **registered** blocks only. Plugins cannot place 165.
- `adoptUnknownBlockLight` fills LightEngine FILTER/OCCLUDES tables so unknown voxels occlude sky like stone without a hot-path Map lookup on every grass cell.
- Save serialization still writes the original number.

## Changed files

- `src/blocks/registry.ts`
- `src/world/LightEngine.ts`
- `src/world/World.ts`
- `tests/block-registry.test.ts`, `tests/unknown-block-load.test.ts`
- docs: PROJECT_STATE, ROADMAP, TESTING, this report

## Architecture decisions

- No format change. Chunk storage was already raw `Uint16`.
- Placeholder uses existing `block/stone` texture so meshing does not need a new atlas tile.
- Placeholder is **not** inserted into `BLOCKS` / `BLOCK_REGISTRY`, so ID 165 is free for the teammate’s real block.

## Tests

- Registry: 165 is unknown, definition is placeholder, registry size unchanged.
- Restore + lighting + serialize keeps 165; adjacent Stone write does not clobber it.

## Visual QA

Not run in a live world. Unknown voxels will look like stone until the real block is registered.

## Known issues

- Placeholder is opaque/solid; the real 165 might be a different shape. Lighting/collision on this branch will not match the teammate’s block until merge.
- Creative/admin overwrite of that cell still changes the saved ID (player edit, not load rewrite).

## Deferred

- Drop this compat after both branches share the same registry.

## Git

Branch: `cursor/unknown-block-compat-31b4` from `cursor/main-menu-social-a8dc`.
