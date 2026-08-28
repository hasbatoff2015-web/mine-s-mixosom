# Anarchy jungle→oak log and spawn Y-28

Date: 2026-08-28  
Branch: `cursor/spawn-map-import-256-height`  
Base: `6e27b93` (`origin/main`)  
Parent: `docs/reports/2026-08-28_spawn-map-import-256-height.md`

## Goal

After local QA of `frontier_spawn2.schem`: map jungle wood to Oak Log (not Diamond, not planks), shift the imported Anarchy spawn down by exactly 28 blocks, and bump import version so a previously imported world is rebuilt once without stacking a second copy.

## Result

- `jungle_log` / `jungle_wood` / stripped variants / 1.12 `log[variant=jungle]` → `oak_log`.
- Other unsupported ids still → Diamond Block.
- Anarchy placement: auto-fit, then `ANARCHY_SPAWN_Y_SHIFT = -28`. X/Z stay 0. Out of `Y 0..255` throws `SchematicHeightError` (no crop).
- `ANARCHY_IMPORT_VERSION = 2`. Version 1 saves are treated as not imported; the next Anarchy enter builds a **new** world and overwrites IndexedDB (no second structure). Version 2 then loads without re-import.

## Implemented

- `blockMapper.ts`: jungle wood special-case before alias/planks fallback; `jungleToOak` flag for the report.
- `placeStructure.ts`: `applyVerticalShift`, `baseOffset` / `yShift` / `jungleToOak` / `jungleReplacements` on `ImportReport`.
- `anarchy.ts`: version 2, `yShift: -28` on import.
- `Game.openAnarchyWorld`: logs rebuild when a stale `serverWorld` is present; still only restores when version matches.

## Changed files

- `src/world/import/blockMapper.ts`, `placeStructure.ts`, `anarchy.ts`, `index.ts`
- `src/core/Game.ts`
- `tests/schematic-import.test.ts`, `tests/anarchy-world.test.ts`
- `docs/PROJECT_STATE.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `TESTING.md`, this report

## Architecture decisions

- Jungle is a **known alias**, not a Diamond fallback. Counts are separate so a spawn with only jungle wood reports `unsupportedToDiamond = 0`.
- Y-28 is Anarchy-only (`importAnarchySpawn` passes `yShift`). Generic importer default remains 0 so tiny fixtures do not fall below Y=0.
- Version bump + fresh `VoxelWorld` (no restore of old modifications) avoids stacking two copies.

## Tests

Targeted: schematic-import 8, anarchy-world 5, world-height-256 6.

`npx tsc --noEmit`: PASS.

Full vitest: **917 passed / 2 failed / 919**. Failures are pre-existing `authored-item-assets.test.mjs` ENOENT (no `assets/` in Cloud).

`npm run build` / `check:size` / `check:archive`: PASS. Production **3.61 MiB / 221 files**.

`npm run check` exits 1 only because of the two authored-asset tests.

## Visual QA

Not re-run in Cloud (no real `.schem`). Local QA after pull: Anarchy should sit 28 lower; former diamond trees are oak logs.

## Known issues

- A version-1 Anarchy save is replaced on next enter (player edits from the first QA pass are discarded by design).
- Real jungle→oak **count** for `frontier_spawn2.schem` is in the browser console `[anarchy] spawn import` after the v2 import.

## Deferred

- Real multiplayer. Survival PvP mock.

## Next work

Local QA checklist in the task (height, oak logs, no duplicate, spawn point).

## Git

- Branch: `cursor/spawn-map-import-256-height`
- Implementation: `1f97474`
- Draft PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/12
- Ordinary push. No force push. Do not merge `main`.
