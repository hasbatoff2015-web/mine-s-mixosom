# Crafting UI UX patch

## Goal

Fix the new craft menu layout: square close X, craftable-first sort, compact inventory Крафт button, Russian label, unclipped last column, hidden scrollbar with wheel/touch scrolling.

## Result

UI-only patch on `cursor/crafting-ui-a8dc`. Recipes, `craft_recipe`, and inventory authority are unchanged.

## Implemented

- Close control is a wrap: square `.mc-close` (red ×) + `.mc-close-hotkey` **E** under it. The caption no longer stretches the button. Clan ← still has no E.
- `craftCatalogEntries` sorts craftable-now items first, then the previous group order. Recomputed on every menu render/craft.
- Inventory CRAFT button is 32×32 logical (was 64). Label `Крафт` (no language switcher in GameUI; item i18n is display names only).
- `.mc-panel.mc-craft-panel` is 256 logical px to match `MC_CRAFT_MENU_WIDTH`. Six 18px columns (108) fit in the list inner width (148).
- List scrollbar hidden (`scrollbar-width: none` / webkit none); `overflow-y: auto`, `touch-action: pan-y`, wheel `stopPropagation`.

## Changed files

- `src/crafting/craftCatalog.ts`
- `src/ui/containerTheme.ts`, `src/ui/containerStrings.ts`, `src/ui/craftGui.ts`, `src/ui/GameUI.ts`, `src/style.css`
- `tests/crafting-catalog.test.ts`, `tests/crafting-ui.test.ts`, `tests/container-ui.test.ts`
- Docs: `PROJECT_STATE.md`, `ROADMAP.md`, `TESTING.md`, this report

## Tests

Focused 87/87 PASS. `npm run test:server` — **47 files / 481 tests PASS**. `typecheck` / client / server / sim PASS. `check:boundaries` PASS. `build` PASS.

## Known issues

Live browser QA of clipping/scroll/touch still belongs to the owner. A full `test:server` run can flake `tick-load-flight` on timing; that test is unrelated and passed on retry.

## Git

- Branch: `cursor/crafting-ui-a8dc`
- Not merged to main
