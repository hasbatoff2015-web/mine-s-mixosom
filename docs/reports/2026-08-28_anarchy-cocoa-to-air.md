# Anarchy cocoa pods → Air

Date: 2026-08-28  
Branch: `cursor/spawn-map-import-256-height`  
Parent: `docs/reports/2026-08-28_anarchy-jungle-oak-y-shift.md`

## Goal

Local QA still saw Diamond Blocks where jungle-tree cocoa pods / beans hang. Map those Minecraft blocks to Air on the next Anarchy import. Do not change jungle→oak or the general Diamond fallback.

## Result

- `minecraft:cocoa` (states `age`, `facing`) and legacy names `cocoa_pod` / `cocoa_beans` / `cocoaplant` → **Air**.
- Counted in `ImportReport.cocoaToAir` / `cocoaReplacements` (not Diamond, not Oak Log).
- `ANARCHY_IMPORT_VERSION = 3`. Versions 1–2 rebuild once on a fresh world (no stacked copy).

The real `frontier_spawn2.schem` is not in Cloud; the cocoa cell count for that file appears in `[anarchy] spawn import` (`cocoaToAir` / `cocoaReplacements`) after the v3 rebuild.

## Changed files

- `src/world/import/blockMapper.ts`, `placeStructure.ts`, `anarchy.ts`, `index.ts`
- `tests/schematic-import.test.ts`, `tests/anarchy-world.test.ts`
- docs: PROJECT_STATE, ARCHITECTURE, ROADMAP, TESTING, this report

## Tests

Targeted: schematic-import 9, anarchy-world 5.

`npx tsc --noEmit`: PASS.

Full vitest: **918 passed / 2 failed / 920**. Failures are pre-existing `authored-item-assets.test.mjs` ENOENT.

Production: **3.61 MiB / 221 files**.

## Git

- Branch: `cursor/spawn-map-import-256-height`
- Implementation: `45800f6`
- Draft PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/12
- Ordinary push. No force push. Do not merge `main`.
