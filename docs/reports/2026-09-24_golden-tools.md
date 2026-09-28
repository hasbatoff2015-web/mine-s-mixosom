# Complete golden tool set

## Goal

Add the missing golden pickaxe, axe, shovel and sword beside the existing golden hoe, using the generic tier pipeline.

## Result

`golden_pickaxe`, `golden_axe`, `golden_shovel`, `golden_hoe` and `golden_sword` are registered, craftable and textured. `golden_hoe` keeps id `golden_hoe` and the previous stats (tier gold, durability 32, miningSpeed 12, attackDamage 1). Harvest rank is still wood. Titanium upgrade recipes are unchanged.

## Implemented

- `TierStats` accepts prefix `golden`. The gold row sits between iron and diamond: durability 32, miningSpeed 12, damageBonus 0.
- Generic tool, hoe and sword generation creates the five items. The handwritten golden hoe object is gone, so the id is not duplicated.
- `toolMaterials` includes Gold Ingot. Hoes use that same list. Titanium stays a shapeless Ruby upgrade.
- Russian names for the four new items. English names for all five.
- `scripts/import-assets.mjs` maps `gold_pickaxe.png`, `gold_axe.png`, `gold_shovel.png` and `gold_sword.png` onto `golden_*.png`. `golden_hoe` mapping is unchanged.
- Runtime PNGs are byte copies of `assets/minecraft/textures/items/gold_*.png`.

## Changed files

- `src/items/types.ts`
- `src/items/registry.ts`
- `src/crafting/recipes.ts`
- `src/i18n/ru.ts`
- `src/i18n/en.ts`
- `src/dev/MoveItemsHarness.ts`
- `scripts/import-assets.mjs`
- `public/textures/item/golden_pickaxe.png`
- `public/textures/item/golden_axe.png`
- `public/textures/item/golden_shovel.png`
- `public/textures/item/golden_sword.png`
- `tests/golden-tools.test.ts`
- `tests/combat.test.ts`
- `tests/block-registry.test.ts`
- `tests/third-person-held-item.test.ts`
- `tests/sword-blocking-visual.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`
- `docs/MINECRAFT_1_9_REFERENCE.md`
- `docs/ASSET_AUDIT.md`

## Architecture decisions

Gold is one tier in the existing generator, not four extra item objects. Prefix is `golden` because that is the item id used by `golden_hoe`. Armor keeps `gold_*`. `TOOL_TIER_RANK.gold` stays 1. No combat, protocol or save migration changes: new ids are ordinary strings, and `golden_hoe` is the same string as before.

## Tests

- `npm run typecheck:client` — PASS
- `npm run typecheck:server` — PASS
- Targeted vitest (golden tools, crafting, mining, ruby/titanium, item rendering, combat, third-person held item, sword blocking, block registry, authored item assets) — PASS, 10 files, 159 tests
- `tests/golden-tools.test.ts` after the durability typing fix — PASS, 12 tests
- `npm run build` (`tsc --noEmit && vite build`) — PASS
- `npm test` — 296 files passed, 9 files failed; 2871 tests passed, 14 failed, 1 skipped. Failures are lighting budgets, AutoMine reset timing, tick-load timing, a missing Pillow import, an extra local sfx file (27 vs 26), fence jump height, and a minecart geometry cache count. None of those files are part of the golden tool change. GitHub CI was not checked.

## Visual QA

Not run in a browser on this pass. DEV VPS checklist is in the task report.

## Performance

No meshing, tick or render-path changes.

## Known issues

None from the registry change. In-game icon and pose still need owner QA.

## Deferred

Lapis, farming expansion, enchanting and other out-of-scope content stay out.

## Next work

Owner QA via `dev-switch cursor/golden-tools` on https://dev.megacraft.agariobrainrot.ru. Do not merge until that check.

## Git

Branch `cursor/golden-tools` from `origin/main` `90eb9acd7005f0c9c8e094c3887f1be01e43e310`. Not merged.
