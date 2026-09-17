# Pause heading off + Creative graphite tabs

## Goal

1. Pause overlay must not show «ИГРА НА ПАУЗЕ» / «Пауза». Keep only Continue / Settings / Save and quit, compact and vertically balanced. Live-world overlay and pause behavior stay.
2. Creative Inventory tabs «Каталог» / «Инвентарь» must use the graphite chrome. Hide the catalog scrollbar while wheel and mobile pan still scroll, without clipping the 9th item column.

## Result

Done. Pause is an actions-only card. Creative tabs are graphite with a distinct active face. Catalog scroll is native overflow without a visible track.

## Implemented

- `showPause` no longer renders `.menu-heading` / eyebrow / `<h1>Пауза</h1>`.
- `.pause-window` padding is 0; `.pause-actions` uses even 22px padding (12px 14px on short viewports). Button sizes and overlay dim are unchanged.
- `.mc-creative-tabs button` uses `--mc-btn-pressed` + muted text when idle, `--mc-btn-face` + title text when `.active`. IDs/`data-creative-tab` unchanged.
- `.mc-creative-catalog` is `width: 100%`, `overflow-y: auto`, `touch-action: pan-y`, `scrollbar-width: none`, webkit scrollbar `display: none`. Right gutter reserved for a visible bar is gone (`MC_CREATIVE_SCROLL_GUTTER = 0`). Nine `--mc-slot` columns and catalog item logic are unchanged.

## Changed files

- `src/ui/GameUI.ts`, `src/style.css`, `src/ui/containerTheme.ts`
- `tests/pause-overlay.test.ts`, `tests/container-ui.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

- Do not change pause overlay class or simulation pause. Heading removal is HTML + related padding only.
- Do not add a second Creative tab control or a custom JS scroller. Native overflow plus hidden scrollbar matches chat/craft lists.
- Keep the 195-wide creative panel. Extra inner slack after dropping the gutter protects the last column if a scrollbar overlay ever appears.

## Tests

- Pause HTML has the three actions and no heading strings.
- Creative tabs CSS uses graphite tokens, not `#8b8b8b`.
- Catalog CSS hides the scrollbar, keeps 9 columns, `overflow-y: auto`, `touch-action: pan-y`.
- `9 * 18` still fits `195 - 14`.

## Visual QA

`?qaUi=pause` and `?qaUi=creative` desktop and landscape.

## Performance

No tick/mesh/network rate changes.

## Known issues

None for these two UI changes.

## Deferred

No dedicated pause-button PNG sheet.

## Next work

None required for these two changes.

## Git

Branch `cursor/ui-redesign-a8dc`. No merge to `main`.
