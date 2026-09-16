# Merge unknown-block compat into Main Menu visual

## Goal

Bring PR #90 (`cursor/unknown-block-compat-31b4`) onto `cursor/main-menu-visual-31b4` so worlds with unregistered voxel ID 165 load, without dropping the Main Menu visual restyle.

## Result

Ordinary merge from merge-base `41bb511`. Menu chrome and unknown-ID placeholder both present. No new placeholder implementation. Saves still keep ID 165; it is not rewritten to Stone/Air.

Merge commit: `d3801a1de6adf4d4d5eef6fce5ad6d785f6fd8e2`  
Parents: `9853ff6` (Main Menu visual) + `8ecf6d1` (unknown-block compat).

## Implemented

- `getBlockDefinition` returns a runtime-only placeholder for storable unknown IDs (0–65535) instead of throwing `Unknown block id`.
- `VoxelWorld` restore / raw writes call `adoptUnknownBlockLight` so lighting does not crash on those IDs.
- Main Menu dark chrome, 4+3 icon grid, HUD sprites, and `closeButtonHtml()` remain from the visual branch.

## Changed files (merge)

- `src/blocks/registry.ts`
- `src/world/World.ts`
- `src/world/LightEngine.ts`
- `tests/block-registry.test.ts`
- `tests/unknown-block-load.test.ts`
- `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/TESTING.md`
- `docs/reports/2026-09-16_unknown-block-load-compat.md`

## Architecture decisions

Reuse PR #90 as-is via ordinary merge. Do not invent BlockId 165. Do not add a second placeholder. `isKnownBlockId` / `tryGetBlockDefinition` stay registered-only.

## Conflicts

Only documentation:

- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/TESTING.md`

Resolved by keeping both the Main Menu visual section and the Unknown block load compat section, plus a merge note. Code (`registry.ts`, `World.ts`, `LightEngine.ts`, tests) merged cleanly with no conflict markers.

## Tests

```text
npm test -- tests/unknown-block-load.test.ts tests/block-registry.test.ts tests/game-menu-gui.test.ts tests/trade-gui.test.ts tests/server/game-menu.test.ts
```

**31/31 PASS** (unknown-block-load 2/2, block-registry 16/16, game-menu-gui 6/6, trade-gui 2/2, server/game-menu 5/5).

## Visual QA

No new visual work in this merge. Menu chrome from `9853ff6` is unchanged.

## Performance

No change expected: placeholder lookup is a Map cache after first unknown ID; lighting adoption is a small registry of unknown emitters.

## Known issues

Placeholder looks like a stone cube and is unbreakable. That is intentional until the real block exists on this tree.

## Deferred

Merge to `main` is not part of this pass.

## Next work

Keep this branch until Main Menu visual and unknown-block compat are both wanted on `main`.

## Git

- Branch: `cursor/main-menu-visual-31b4`
- Merge: `d3801a1de6adf4d4d5eef6fce5ad6d785f6fd8e2`
- No rebase, no force push, no merge to `main`.
