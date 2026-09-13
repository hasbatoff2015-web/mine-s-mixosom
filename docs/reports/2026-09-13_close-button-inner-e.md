# Close X inner E

## Goal

Match the inventory-style close control to the square reference: slightly larger button, large red ×, small white E in the bottom-right corner **inside** the button. Same look everywhere that control is used. No other UI/logic changes.

## Result

UI-only patch on `cursor/crafting-ui-a8dc`. Craft recipes, `craft_recipe`, and close/E behavior are unchanged.

## Implemented

- `closeButtonHtml()` is a single square `<button class="mc-close">` with `.mc-close-x` (×) and `.mc-close-hotkey` (E) as children. The wrap + outside caption is gone.
- Size is 20 logical px (`MC_CLOSE_LOGICAL_SIZE` / CSS `max(touch-target, 20×scale)`), up from 14.
- × stays `#d32f2f`, larger (15 logical px). E is small, white, absolutely positioned bottom-right with a dark shadow so it reads on the gray bevel.
- Shared by inventory, craft menu, auction, buyer, clan close. Clan ← (`.mc-close.mc-back`) and chat `#chat-close` still have no E.

## Changed files

- `src/ui/GameUI.ts`, `src/ui/containerTheme.ts`, `src/style.css`
- `tests/crafting-ui.test.ts`
- Docs: `PROJECT_STATE.md`, `ROADMAP.md`, `TESTING.md`, this report

## Tests

See `TESTING.md`. Clan back and chat close assertions remain: no E caption.

## Visual QA

Not run in a live browser on this pass. Owner check: inventory / craft / auction / buyer / clan X+E vs clan ← and chat X.

## Git

- Branch: `cursor/crafting-ui-a8dc`
- Not merged to main
