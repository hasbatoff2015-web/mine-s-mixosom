# Anarchy TNT types — 2026-09-08

## Goal

Add powerful and destructive TNT on the existing Anarchy explosion path. Ordinary TNT must not break block-claim anchors or regular `/claim` voxels, and obsidian must act as a spatial blast shield (not a global cancel). New types share primed mesh/pulse and chain with their own profiles.

## Result

Implemented. Ordinary TNT (`BlockId.Tnt = 109`) keeps radius 4. Powerful (`TntPowerful = 161`) radius 6 can break anchors. Destructive (`TntDestructive = 162`) uses ordinary radius, breaks obsidian, ignores the obsidian shield. All three skip regular `/claim` voxels. Chain passes `blockId`.

## Implemented

- `TntProfile` on `ExplosionJob` (`src/world/tnt.ts`). Default missing profile = ordinary flags.
- `resolveExplosion` skips iron/gold/diamond when `canBreakBlockClaims` is false; voxel DDA `obsidianOccludesCell` when `canBreakObsidian` is false; optional `canDestroy` for regular claims.
- `PrimedTnt.blockId` through prime / serialize / entity snapshot / `syncNetworkPrimed`.
- `ServerGameplay.loadRegularClaimVolumes` from ClaimStore (no PluginManager in shared sim).
- Recipes: shapeless `tnt + gold_block`; shaped 8 obsidian around TNT.
- 32×32 textures recolored from `public/textures/block/tnt.png` (red body only).

## Changed files

- `src/blocks/types.ts`, `src/blocks/registry.ts`, `src/blocks/tnt.ts`, `src/blocks/index.ts`
- `src/world/tnt.ts`, `src/world/Explosion.ts`
- `src/redstone/RedstoneSystem.ts`, `src/redstone/types.ts`
- `src/entities/EntityHost.ts`, `src/entities/ThreeEntityHost.ts`, `src/entities/MinecartManager.ts`
- `src/combat/fireArrow.ts`, `src/gameplay/useInteraction.ts`, `src/net/applyEntitySnapshots.ts`
- `src/core/Game.ts`, `src/crafting/recipes.ts`, `src/i18n/ru.ts`
- `server/gameplay.ts`, `server/WorldInstance.ts`
- `scripts/recolor-tnt.mjs`, `scripts/import-assets.mjs`
- `public/textures/block/tnt_powerful.png`, `public/textures/block/tnt_destructive.png`
- Tests and docs listed below

## Architecture decisions

- One explosion engine. Profile flags + DDA, not a second queue.
- Claim-anchor skip is by block id in shared sim; regular `/claim` skip is a server callback so `src/world` stays Node-safe.
- Destructive obsidian bypasses hardness/`power*3` so radius 4 can actually break hardness 50.
- Chain `blockId` is required so a second TNT keeps its own radius/shield/anchor rules.

## Tests

```text
npx vitest run \
  tests/tnt-profiles.test.ts \
  tests/tnt-textures.test.mjs \
  tests/server/tnt-types.test.ts \
  tests/server/claim-anchor-blocks.test.ts \
  tests/crafting.test.ts \
  tests/block-registry.test.ts \
  tests/redstone.test.ts \
  tests/explosion-performance.test.ts \
  --maxWorkers=2
```

Focused **61/61** (`tnt-profiles` 7, `tnt-textures` 1, `tnt-types` 5, `claim-anchor-blocks` 8, crafting 12, block-registry 14, redstone 9, explosion-performance 5). `test:sim` **42/42**. All four typechecks, `check:boundaries`, production build PASS.

## Visual QA

Not run in this cloud environment (no interactive Anarchy client). Textures and primed mesh/pulse are covered by unit tests.

## Performance

Explosion scan is still the existing cube + optional DDA per candidate cell (radius 4–6). No extra systems.

## Known issues

None observed in focused tests. Creeper/minecart blasts that enqueue without a TNT `blockId` inherit ordinary profile flags (obsidian shield, no anchor break).

## Deferred

Owner live Anarchy QA: craft, obsidian wall, mixed chain, two-player claims.

## Next work

Owner playtest of the three TNT types on a running Anarchy server.

## Git

Branch `cursor/anarchy-tnt-types-3f93`. No PR (requested).
