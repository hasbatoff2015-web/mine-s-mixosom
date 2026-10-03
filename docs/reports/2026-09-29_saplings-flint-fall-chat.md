# Saplings, flint, silent glass steps, fall damage, chat Tab

## Goal

Five gameplay changes on the current systems: birch/oak/spruce saplings, gravel flint, no glass footstep, halved non-lethal fall damage, and a chat close button that shows TAB.

## Result

Implemented on `cursor/saplings-flint-fall-chat-3e3c`. No production deploy.

## Implemented

- Sapling blocks `oak_sapling` / `birch_sapling` / `spruce_sapling` (`BlockId` 167–169) are normal registry items. They place only on dirt, grass, farmland, or snow, and store `plantedAtMs` on the existing block state.
- Breaking leaves still drops the leaf and, at chance 0.2, also drops the matching sapling. The roll is `rollBrokenBlockDrops` on the server and in singleplayer.
- After 120000 ms of real time, `VoxelWorld.tick` grows the sapling with `treeCells` (the generator shape). A blocked canopy leaves the sapling in place. Restore reloads the timestamp from `blockStates`.
- Gravel drops flint at chance 0.1, otherwise gravel. One stack per break, including hand and shovel.
- Walking on glass, ice, and glowstone plays nothing. Glass break and place still use the glass sample.
- Fall damage is `floor(ceil(distance - 3) / 2)`, computed once in `PlayerController`. If that hit would leave 0 HP, health becomes 1. Melee, lava, and void can still kill. A lethal fall does not consume death protection.
- `public/ui/chat/close.png` stays 102×96. The corner caption is TAB. Close is still Tab / the button click. Menu close art was not changed.
- Sapling sprites in `public/textures/block/` are byte copies of `assets/minecraft/textures/blocks/sapling_oak.png`, `sapling_birch.png`, and `sapling_spruce.png`.

## Changed files

- Blocks/items: `src/blocks/types.ts`, `dropTables.ts`, `registry.ts`, `index.ts`, `soundGroups.ts`, `src/i18n/ru.ts`, `src/world/import/blockMapper.ts`
- Trees and growth: `src/world/trees.ts`, `Generator.ts`, `saplings.ts`, `World.ts`, `placement.ts`, `src/gameplay/useInteraction.ts`
- Drops: `src/gameplay/random.ts`, `index.ts`, `server/gameplay.ts`, `src/core/Game.ts`
- Audio: `src/audio/soundEvents.ts`, `src/core/AudioManager.ts`
- Fall: `src/player/fallDamage.ts`, `PlayerController.ts`, `src/survival/SurvivalSystem.ts`
- UI: `public/ui/chat/close.png`, `public/textures/block/*_sapling.png`
- Tests: `tests/server/saplings-and-drops.test.ts`, `tests/fall-damage.test.ts`, `tests/audio-sfx.test.ts`, `tests/player-physics.test.ts`, `tests/chat-layout.test.ts`
- Docs: `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `TESTING.md`, this report

## Architecture decisions

- No per-sapling `setTimeout`. The world tick scans the planted-at index and compares it to `Date.now()`, so a TPS hitch does not freeze the timer and a restart continues the same clock.
- Tree shape is shared with worldgen. Growth writes through `applyBlockBatch`, so the server publishes the same block deltas as other edits.
- Substitute and bonus are optional fields on the existing `BlockDrop`. Drops without them keep the old RNG.
- Fall scaling lives in the controller. The 1 HP floor lives only in `SurvivalSystem` for `source === 'fall'`.

## Tests

```text
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.sim.json
npx tsc --noEmit -p tsconfig.server.json
npx tsc --noEmit -p tsconfig.client.json
node scripts/check-import-boundaries.mjs
npx vitest run tests/server/saplings-and-drops.test.ts tests/fall-damage.test.ts tests/audio-sfx.test.ts tests/player-physics.test.ts tests/block-registry.test.ts tests/chat-layout.test.ts tests/survival-death-invariant.test.ts tests/utility-items.test.ts tests/server/utility-items-authority.test.ts tests/server/anarchy-gameplay.test.ts
npm run build
```

Typecheck, sim/server/client typecheck, and import boundaries passed. Focused vitest for the new rules passed. `npm run build` passed.

Full `npx vitest run` is 2879 passed / 18 failed before the totem/fall test updates. After those updates, the remaining failures also fail on current `main` in this environment: lighting jobs that never reach zero pending work, fence step-up `y > 1.9`, tick-load timing, missing Python PIL, an extra MP3 already in `public/audio/sfx`, and a minecart geometry cache count. They are not from this change.

## Visual QA

Chat close sprite inspected: same frame and red X, caption TAB, size 102×96. Sapling PNGs are the pack files from `assets/minecraft/textures/blocks/` (oak and spruce RGBA, birch indexed with tRNS). No live browser session.

## Performance

Growth is capped at 4 trees per tick and skips unloaded chunks. Blocks without a plant timestamp are not scanned.

## Known issues

The first attached chat PNG was not present as a file, so the 102×96 close button was edited in place for the TAB caption. A later follow-up asked to swap that file for a new transparent PNG; that file was not in the workspace either, so the chat sprite was left unchanged rather than redrawn.

## Deferred

Shears still drop the leaf block; the sapling is an extra roll, not a silk-touch rule. No bone-meal instant growth.

## Next work

None required for this pass.

## Git

Branch `cursor/saplings-flint-fall-chat-3e3c`. Not deployed.
