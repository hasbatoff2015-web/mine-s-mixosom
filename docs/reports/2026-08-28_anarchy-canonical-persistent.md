# Anarchy canonical persistent world

Date: 2026-08-28  
Branch: `cursor/spawn-map-import-256-height`  
Parent: `docs/reports/2026-08-28_anarchy-cocoa-to-air.md`

## Goal

Freeze the locally accepted Anarchy map as the canonical persistent server world. Production must not fetch or import `frontier_spawn2.schem`. Keep the importer as a DEV/offline tool.

## Result

- `Играть онлайн → Анархия PvP` loads IndexedDB id `anarchy` if present (any `importVersion`).
- Canonical respawn is `serverWorld.spawn` (then player spawnPoint, then last position).
- Missing `.schem` does not toast or block. First-ever empty persistence creates a procedural Anarchy world (same id/seed), not a schematic import.
- `spawnImported` / `importVersion` remain on the save for legacy compatibility and are not used to rebuild.

## Changed files

- `src/world/import/anarchy.ts`, `index.ts`
- `src/core/Game.ts`
- `tests/anarchy-world.test.ts`
- `scripts/copy-frontier-spawn.mjs` (comment only)
- docs: PROJECT_STATE, ARCHITECTURE, ROADMAP, TESTING, this report

## Git

Draft PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/12
