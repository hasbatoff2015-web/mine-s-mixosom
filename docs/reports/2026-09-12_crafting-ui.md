# Crafting UI overhaul

## Goal

Replace Survival inventory 2×2 crafting + recipe book with a CRAFT button that opens a dedicated inventory-style craft menu. Keep `CRAFTING_RECIPES` as the source of truth. Craft remains server-authoritative (`recipeId` only). Unify inventory-style close controls with a red × and an E caption.

## Result

Done on `cursor/crafting-ui-a8dc`. Ordinary E-inventory no longer shows a crafting grid or recipe book. CRAFT opens a list of every obtainable item; one click crafts one recipe; full inventory is an atomic reject. Crafting-table 3×3 + recipe book is unchanged.

## Implemented

- Survival inventory chrome: armor column + large CRAFT button (`crafting_table` icon).
- Craft menu: `mc-backdrop` / `mc-stage` / `mc-panel` / `mc-slot`, search by name, all `obtainableItems()`, display order planks → tools → armor → TNT → logs/sticks/weapons/food/resources/blocks/other (not UI category tabs).
- Green list highlight only when a recipe exists and every ingredient count is enough for one craft; recalc after each craft.
- Detail: result icon, name, `×N` when output count > 1, CRAFT, ingredient `have/need` (white / red). Uncraftable: «Данный предмет невозможно скрафтить.» and no fake ingredients.
- Online: `inventory_action` + `craft_recipe` + `recipeId`. Parser drops extra count/inventory/result fields. `craftOnceByRecipeId` is atomic (unknown / missing / full).
- Close: red × + E under it on inventory-style UIs. E while the craft menu is open returns to inventory. Clan ← has no E. Chat X unchanged.
- Search patches the list in place and keeps focus (`keepCraftSearchDraft`).

## Changed files

- New: `src/crafting/needs.ts`, `src/crafting/craftOnce.ts`, `src/crafting/craftCatalog.ts`, `src/ui/craftGui.ts`
- `src/crafting/index.ts` re-exports the helpers
- `shared/protocol.ts` — `craft_recipe`; parse keeps only `recipeId`
- `src/inventory/inventoryUiAction.ts` — `applyCraftRecipe`
- `src/ui/GameUI.ts`, `src/core/Game.ts`, `src/ui/containerInteractions.ts`, `src/ui/containerTheme.ts`, `src/ui/containerStrings.ts`, `src/ui/recipeBook.ts`, `src/style.css`
- Tests: `tests/crafting-catalog.test.ts`, `tests/crafting-once.test.ts`, `tests/crafting-ui.test.ts`, `tests/server/craft-recipe.test.ts`, plus `tests/container-ui.test.ts` / `tests/ui-main-integration.test.ts`
- Docs: `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `TESTING.md`, this report

## Architecture decisions

- No second recipe/item registry. Catalog reads `obtainableItems()` + `CRAFTING_RECIPES`.
- Ingredient counts for availability = inventory slots + offhand, not armor (same as the old book).
- Hidden server 2×2 for `action: 'recipe'` stays so crafting-table/book placement and existing Anarchy tests keep working. Survival UI no longer exposes those slots.
- Client does not optimistic-mutate on online craft; the next inventory snapshot re-patches the open menu.

## Tests

```text
npx vitest run tests/crafting-catalog.test.ts tests/crafting-once.test.ts tests/crafting-ui.test.ts tests/crafting.test.ts tests/container-ui.test.ts tests/ui-main-integration.test.ts tests/server/craft-recipe.test.ts --maxWorkers=2
```

PASS: catalog 5, once 8, ui 7, crafting 12, container-ui 22, ui-main-integration 5, server craft-recipe 3.

Also PASS: `tests/gameplay-ui-entity-polish.test.ts`, `tests/online-gameplay-polish.test.ts`, `tests/server/online-gameplay-polish.test.ts`, `tests/server/anarchy-gameplay.test.ts`, `tests/online-container-sync.test.ts`.

`npm run test:server` — **47 files / 481 tests PASS**.

## Visual QA

Not run in a live browser on this pass. Remaining owner checks: E → CRAFT → search/select/craft/close X/E, green highlight after a craft, uncraftable copy, Auction/Buyer/Clan X+E, crafting-table book still works.

## Performance

Craft menu patches `[data-craft-list]` / `[data-craft-detail]` when already mounted. Search updates only the list. No extra mesh/world work.

## Known issues

Rapid online clicks before the inventory snapshot can send extra `craft_recipe` intents; the server still validates atomically. Full-inventory toast is client-prechecked; a lost race fails silently like other rejected inventory clicks.

## Deferred

- Live Anarchy / desktop visual QA of the new menu
- Quantity picker (explicitly out of scope)
- Removing the unused server 2×2 path for the inventory window

## Next work

Do not start the next feature until this branch is reviewed. Owner should pull `cursor/crafting-ui-a8dc` and click through inventory CRAFT in a browser.

## Git

- Branch: `cursor/crafting-ui-a8dc`
- Commit: `28dd2d20546a4acb19cdee17c13e53ccc6819523`
- PR: [#88](https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/88)
- Base: `origin/main` (`1c802ab`)
- Conflicts: none
