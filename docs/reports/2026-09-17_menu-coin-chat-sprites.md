# Menu coin asset + chat PNG sprites

## Goal

Two visual fixes on the current feature branch, using the attached PNGs:

1. Main Menu coin next to «Баланс» must be fully visible (no crop) and vertically aligned; balance text size/format stays the same.
2. Open-chat controls (Общий / Рядом / Клан, X+E, Chat ON, Chat OFF, Enter) must use the attached sprite assets, not CSS-drawn buttons. Keep existing chat layout and client behavior. Do not change Chat server logic.

## Result

Done. The menu coin is the attached high-res disc in a padded square with `object-fit: contain`. Chat buttons are sliced PNGs under `public/ui/chat/` wired through `chatChromeStyle()`.

## Implemented

- Replaced `public/ui/menu/icon_coin.png` with a 128×128 LANCZOS downsample of the attached coin, cropped to alpha bbox then padded on a square canvas so the disc never touches the frame.
- `.mc-menu-coin-wrap` is 16 logical px, `flex-shrink: 0`, overflow visible; `.mc-menu-coin` uses `object-fit: contain` and `image-rendering: auto` (the asset is anti-aliased, not 32px pixel art). Balance copy remains `Баланс: N монет` at `font-size: 7px` logical.
- Sliced the attached chat sheet into `tab_global.png`, `tab_nearby.png`, `tab_clan.png`, `close.png`, `on.png`, `enter.png`, `off.png`.
- `GameUI` chat markup keeps IDs / `data-chat-tab` / `active` / `is-off`. Visible captions are `.chat-sr`. Faces come from CSS variables set by `chatChromeStyle()`.
- Buttons size by height + native `aspect-ratio` and `background-size: contain` so they are not stretched. Inactive tabs `filter: brightness(0.72)`; `.active` is unfiltered.

## Changed files

- `public/ui/menu/icon_coin.png`
- `public/ui/chat/*.png` (new)
- `src/ui/gameMenuGui.ts`, `src/ui/GameUI.ts`, `src/style.css`
- `tests/chat-layout.test.ts`, `tests/game-menu-gui.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

- Chat sprites live next to menu HUD sprites (`public/ui/chat/`) and reuse the same `spriteStyle()` helper with `chatAssetUrl()`.
- The sheet has no separate selected-tab art; selected state is full brightness vs dimmed siblings.
- Chat ON and Chat OFF are two files, swapped with existing `#chat-visibility.is-off`.
- Server `handleChat` / channels / `NEARBY_CHAT_RADIUS` are untouched.

## Tests

- Menu coin wrap 16px, `object-fit: contain`, `image-rendering: auto`, copy still `Баланс: 100 монет`.
- Chat layout: PNG faces, `chatChromeStyle()`, `background-size: contain`, tab filters, sprite files exist, no `<svg>` in GameUI chat.

## Visual QA

DEV fixtures `?qaUi=menu-root` and `?qaUi=chat-open` (real `GameUI`, no world tick), desktop / landscape / portrait.

## Performance

No tick/mesh/network rate changes. Extra PNGs are small (chat set ~97 KiB, coin ~15 KiB).

## Known issues

None found in this pass.

## Deferred

No second selected-tab artwork; brightness filter is the active-state cue.

## Next work

None required for these two fixes.

## Git

Branch `cursor/ui-redesign-a8dc`. No merge to `main`.
