# UI visual system / HUD / loading / Creative / World Select

Date: 2026-08-30

## Goal

Unify the existing Frontier Cubes DOM UI around one self-hosted type/token system and polish four visible surfaces from the supplied references: world loading, gameplay HUD, Creative inventory and World Select. Keep Russian as the primary language, preserve the existing `GameUI` ownership/callbacks and fixed-tick gameplay, verify the exact desktop/mobile viewport matrix in a real browser, and deliver only through a feature branch and Draft PR.

Out of scope by design: gameplay balance, simulation, world/lighting, input ownership, pointer-lock behavior, save schema, new inventory/world-list systems, remote font/CDN dependencies and integration of parallel server work.

## Result

The UI pass is complete on `codex/ui-visual-system-pass`. Press Start 2P now carries the compact voxel identity while Inter handles body text and long Russian labels. Loading, HUD, Creative and World Select share explicit visual roles and responsive targets without replacing `GameUI` or adding a second lifecycle.

Automated UI validation is 46/46. Typecheck, build, build-size and archive checks pass. Actual in-app Chromium layout QA is 28/28 across the requested four screens and seven viewport sizes, with interaction smoke for Creative and World Select and no console diagnostics. Full-suite baseline remains non-green outside the UI diff: 982 passed, 14 failed, 996 total, plus one Vitest worker RPC timeout.

## Implemented

### Typography and tokens

- Added `src/uiTokens.css`, imported before `style.css`.
- Added self-hosted Cyrillic and Latin WOFF2 subsets for Inter and Press Start 2P; `font-display: swap`; no runtime network requests.
- Display role: Press Start 2P for brand, menu/window headings, short loading labels, selected item and Creative tabs.
- UI role: Inter for body text, Russian metadata, buttons and counts.
- Debug role: system monospace only. Removed Cascadia/Courier/Segoe UI Mono references from production styling.
- Added source/license mapping in `docs/FONT_ASSETS.md` and local SIL OFL 1.1 copies under `docs/licenses/fonts/`.

### Loading

- Preserved the existing Frontier brand card and separated brand, `Загрузка мира` kicker, current phase, progress bar, visible percent and optional detail.
- Determinate mode exposes `role=progressbar`, min/max/current ARIA attributes and a visible rounded percent.
- `updateWorldLoading` updates stable nodes and progress semantics rather than remounting the screen.
- Low-height landscape compaction removes the previous card scrollbar at 740×360 while retaining every text level.

### HUD

- Unified status and hotbar widths with shared CSS variables.
- Desktop hotbar: 50 px slots at 1280/1366, 60 px at wide 1920 desktop. Low-height landscape: separate 35 px slots.
- Increased item fill, count contrast, durability visibility and selected-slot emphasis.
- Kept the existing red hearts, yellow absorption hearts and armor icons.
- Replaced the OS `◆` hunger glyph with authored pixel SVG drumsticks: full, half and empty.
- Added pure `hungerHudIcons(0..20)` mapping with the same ten-icon presentation boundary as hearts/armor.

### Creative inventory

- Retained `renderCreativeInventory`, `.mc-stage`, `patchCreativeDynamic`, the existing catalog node and `InventoryContext.onClose`.
- Changed the Creative logical body height from 222 to 166 and limited the catalog viewport to six logical rows.
- Removed the catalog-mode `margin-top:auto` dead-zone behavior; player hotbar follows visible content directly.
- Kept the catalog as an independently scrollable host.
- Kept close as a stage sibling to the right of the panel. `containerUiScaleWithClose` now accounts for logical panel width, gap and a real minimum 44 px target before choosing scale.
- Added ARIA tablist/tab/selected state without changing tab switching behavior.

### World Select

- Preserved single-click selection, `aria-pressed`, double-click load and existing `WorldListActions` callbacks.
- Added mode badge, updated date, play time, seed and a visible selected check marker.
- Reordered actions into danger Delete plus neutral Back/Create and amber primary Play.
- Replaced native `window.confirm` with an in-screen `role=dialog`, modal label, autofocus on Cancel, Escape, backdrop and explicit Cancel handling. Confirm still calls the existing `actions.delete(selectedId)`.
- Added compact landscape padding so the window border remains inside every requested viewport.

### Deterministic QA route

- Added DEV-only `?qaUi=loading|hud-full|hud-low|hud-absorption|creative|world-list`.
- The fixture instantiates the real `GameUI` with deterministic inventory and world summaries.
- It does not start `Game`, create a WebGL world, read/write IndexedDB, alter saves or expose production state.
- Production import is guarded by `import.meta.env.DEV` and dynamically loaded.

## Changed files

Production code and styles:

- `src/main.ts`
- `src/uiTokens.css`
- `src/style.css`
- `src/ui/GameUI.ts`
- `src/ui/hungerHud.ts`
- `src/ui/containerTheme.ts`
- `src/ui/hudStatusLayout.ts`

Runtime assets:

- `public/fonts/inter/inter-cyrillic-400-700.woff2`
- `public/fonts/inter/inter-latin-400-700.woff2`
- `public/fonts/press-start-2p/press-start-2p-cyrillic-400.woff2`
- `public/fonts/press-start-2p/press-start-2p-latin-400.woff2`
- `public/textures/gui/hunger_full.svg`
- `public/textures/gui/hunger_half.svg`
- `public/textures/gui/hunger_empty.svg`

DEV/tests/docs:

- `src/dev/UiQaHarness.ts`
- `tests/ui-visual-system.test.ts`
- `tests/ui-visual-contract.test.mjs`
- `tests/container-ui.test.ts`
- `tests/heart-hud.test.ts`
- `docs/FONT_ASSETS.md`
- `docs/licenses/fonts/Inter-OFL-1.1.txt`
- `docs/licenses/fonts/Press-Start-2P-OFL-1.1.txt`
- `docs/PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`
- `docs/ROADMAP.md`
- this report

Not changed: `src/Game.ts`, input/pointer lock, world generation/lighting, rendering architecture, gameplay simulation, persistence/schema and Yandex lifecycle.

## Architecture decisions

1. `GameUI` remains the sole DOM UI owner. New visual structure extends current render/patch paths.
2. Typography tokens are CSS-only presentation infrastructure and load before the existing stylesheet.
3. HUD scaling is CSS responsive presentation; fixed 20 TPS state updates and render cadence are untouched.
4. Hunger is a pure presentation helper parallel to heart/armor helpers, not survival logic.
5. Creative sizing continues through the canonical stage/scale helpers, including the existing callback and dynamic patch flow.
6. The World Select dialog calls the existing action interface and owns no storage.
7. The QA harness is isolated, deterministic and DEV-only, so it cannot create or mutate player saves.

## Tests

### Passing gates

- `npm run typecheck`: PASS.
- Targeted command: `npx vitest run tests/ui-visual-system.test.ts tests/ui-visual-contract.test.mjs tests/container-ui.test.ts tests/heart-hud.test.ts tests/armor-hud.test.ts tests/menu-model.test.ts --maxWorkers=2`.
- Targeted result: **46 passed / 46 total**, six files.
- `npm run build`: PASS, 151 modules transformed.
- `npm run check:size`: PASS, **3.73 MiB / 228 files**.
- `npm run check:archive`: PASS, **3.73 MiB / 228 files**.

New/updated checks cover font binaries, OFL records, font roles, absence of old fallback stacks, Russian strings, loading percentage/ARIA contracts, hunger full/half/empty boundaries, desktop/mobile HUD constants, Creative compact height and panel+close fit, canonical catalog/onClose source contracts, World Select selection/double-click/disabled Play and the in-game delete callback.

### Full suite

Command: `npm test -- --maxWorkers=2`.

Result: **81 files passed / 5 files failed; 982 tests passed / 14 failed / 996 total; one unhandled Vitest worker RPC timeout; duration 250.88 s**.

All UI suites pass. The non-UI failures were left untouched:

- 12 tests exceeded the unchanged default 5 s timeout: two `worldgen-terrain` cases and ten sunlight/minecart cases.
- Existing `GeneratedItemGeometry` source fingerprint expected `be428190`, received `e71967bd`; this pass did not edit that file.
- `entities` mob-separation assertion was below its threshold in the full run.
- `minecraft-reference-extractor.test.mjs` failed suite parsing separately.
- Vitest reported a worker `onTaskUpdate` RPC timeout after the long CPU-heavy run.

Established Vite warnings remain: root `/sdk.js` is not bundled as a module and the main JS chunk exceeds 500 KiB. The SDK path was not changed.

## Visual QA

Browser: Codex in-app Chromium against local Vite, using only explicit `?qaUi=` routes. The temporary viewport override was reset and the tab/server were closed after QA.

Matrix for each of Loading, HUD full, Creative and World Select:

| Class | Viewports |
| --- | --- |
| Desktop | 1920×1080, 1366×768, 1280×720 |
| Landscape mobile | 932×430, 896×414, 844×390, 740×360 |

Automated DOM geometry result: **28/28 passed**. Every required element existed and stayed inside the viewport; status/hotbar, world-list/footer and Creative panel/close did not overlap; document width/height did not overflow; loading-card had no internal scroll; close target was 56 px desktop and 44 px compact landscape. Console warnings/errors: none.

Manual screenshot inspection used representative 740×360 loading/Creative/World Select and 1366×768 absorption HUD frames:

- Loading retained logo, display heading, phase, bar, 79% and detail with no scrollbar.
- HUD aligned armor/hearts/absorption/hunger with the larger centered hotbar; selected item remained legible.
- Creative showed six catalog rows, visible scrollbar, adjacent 44 px close and immediate hotbar with no dead band.
- World Select kept selected emphasis and hierarchy while all four footer actions remained visible; Play rendered a distinct amber primary style.

Interaction smoke:

- HUD full: ten full hearts, ten full hunger icons, ten full armor icons.
- HUD low: one half heart plus empties; one half hunger plus empties.
- HUD absorption: 19 HP + four absorption HP; hunger 17 resolves to eight full, one half, one empty.
- Creative catalog scrolled to 322 of 396 px; Inventory/Catalog ARIA state changed correctly; close removed the stage and restored visible nine-slot HUD through `onClose`.
- World selection moved to `Таёжный рубеж`, only that row had `aria-pressed=true`; double-click called load and produced the fixture toast.
- Delete dialog title/autofocus passed; Escape and Cancel preserved four rows; confirmation called delete and changed four rows to three.

## Performance and size

- No per-frame UI loop, observer, polling task or additional gameplay work was introduced.
- HUD retains cached HTML signatures and updates only when state changes.
- Loading retains node patching instead of screen remount.
- Creative retains shared item visuals/caches and the dynamic patch path.
- Four font subsets total 121,932 bytes uncompressed. Production build remains far below the 20 MiB internal budget and 100 MB platform limit at 3.73 MiB.
- CSS output is 47.80 KiB (10.84 KiB gzip); JS output is unchanged in order at 1,012.98 KiB (285.79 KiB gzip).
- No GPU FPS or native-input performance claim is made; this pass is DOM/layout presentation.

## Known issues

- Full Vitest remains red for the unrelated failures listed above.
- Automated viewport emulation does not validate a physical device's browser chrome, notches/safe-area values, touch ergonomics or native pointer lock.
- The QA harness uses production item registry assets/layout but a static existing background; it is not a gameplay/WebGL screenshot fixture.
- The main JS chunk warning predates and remains outside this UI task.

## Deferred

- Native landscape phone/tablet review with actual safe areas and touch controls.
- Native desktop pointer-lock/Escape/inventory lifecycle review inside a real world.
- Combined UI + future server-branch acceptance only after those server changes land on `main`.
- Unrelated full-suite CPU timeout, parser, fingerprint, mob-separation and Vitest RPC cleanup.

## Next work

1. Review the Draft PR screenshots/diff without merging it.
2. On real desktop, enter a throwaway world and verify loading transitions, HUD at native resolution, inventory close/Escape and pointer lock reacquisition.
3. On landscape mobile hardware, check safe areas, touch-control overlap, 44 px close target and World Select footer at the narrowest supported size.
4. If server work lands first, fetch `origin/main` and merge it normally into `codex/ui-visual-system-pass` (no rebase/force push), resolve only semantic overlaps, then rerun typecheck, 46-test UI gate, full suite, build/size/archive and the full 28-case browser matrix before marking the PR ready.

## Git

- Started from clean `origin/main`: `a056e6f5d4b7f2e206b697f0a774ece921cbbefa` (`Merge pull request #13 from hasbatoff2015-web/codex/lighting-quality-lateral-sky`).
- Branch: `codex/ui-visual-system-pass`.
- Final pre-commit fetch on 2026-08-30: `origin/main` remained exactly `a056e6f5d4b7f2e206b697f0a774ece921cbbefa`; main did not move, so no integration was required or performed.
- Delivery commit: the branch head containing this report; immutable SHA is reported in the Draft PR/final handoff because a commit cannot embed its own SHA.
- Pull request: Draft, target `main`; created only after the branch is committed and pushed. It must not be merged by this task.
