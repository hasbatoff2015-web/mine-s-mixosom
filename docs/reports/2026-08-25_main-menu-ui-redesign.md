# Main menu UI redesign

Date: 2026-08-25
Branch: `codex/main-menu-ui-redesign`
Base: `origin/main` (`420d31885d8383dfb11765f897d6aac2c548935c`)

## Goal

Redesign the Frontier Cubes menu family from the current `origin/main` without taking work from the active Cursor branch: polished voxel-survival main menu, improved singleplayer list, offline online-server mock, settings and a read-only controls reference based only on implemented bindings.

## Result

The existing DOM `GameUI` now presents one coherent menu family. Main navigation exposes Одиночная игра / Играть онлайн / Настройки; submenu screens share a generated background, rectangular bevel controls, scrollable panels and consistent footer actions. No gameplay simulation, save schema, networking backend or control bindings were changed.

## Implemented

- Original voxel landscape background under `public/ui/frontier-menu-background.png`.
- CSS/HTML Frontier Cubes logo treatment with no copied game logo or branded asset.
- Main-menu routing to singleplayer, online mock and settings.
- Singleplayer selection state, double-click/load, explicit play/create/delete/back actions, retained delete confirmation and create-world flow.
- Offline online mock with Анархия PvP / Выживание PvP, `0 / 300`, signal bars and disabled connect action.
- Settings preserve volume, sensitivity, render distance and FOV; values update beside sliders; separate controls entry.
- Read-only controls grouped by movement, gameplay and diagnostics, generated from `menuModel.ts`; no chat `T` binding and no rebinding UI.
- Screen-local Esc/back callback for menu navigation without changing gameplay pause/pointer-lock behavior.
- Compact landscape and narrow viewport CSS fallbacks.

## Changed files

- `src/core/Game.ts`
- `src/ui/GameUI.ts`
- `src/ui/menuModel.ts`
- `src/style.css`
- `public/ui/frontier-menu-background.png`
- `tests/menu-model.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`
- this report

## Architecture decisions

- Extended the existing `GameUI`; no parallel screen/router system.
- Kept `Game` as callback owner for world/settings navigation.
- Kept online entries presentation-only and deliberately disconnected from any network service.
- Kept control documentation in a data-only model so the UI does not imply mutable bindings.
- Reused all existing save/load/create/delete callbacks.
- Background is a temporary original generated visual; replace later with an approved real Frontier Cubes gameplay screenshot when available.

## Tests

- `npm run typecheck` — PASS.
- `npm test -- --run tests/menu-model.test.ts` — PASS, 3/3.
- `npm run build` — PASS, 101 modules.
- `npm run check:size` — PASS, 3.36 MiB / 168 files.
- `npm run check:archive` — PASS, 3.36 MiB / 168 files.
- HTTP smoke: `/` and `/ui/frontier-menu-background.png` — 200.
- `npm run check` — not fully green: 381/385 tests pass. The four failures are outside changed UI files: Windows newline-sensitive `GeneratedItemGeometry` fingerprint (Git blob matches `origin/main`), existing radius-6 lighting threshold, and two worldgen 5 s timeouts. The three expensive failures reproduce in a sequential rerun.

## Visual QA

The supplied Minecraft screenshots were used only as composition and interaction references: centered hierarchy, restrained rectangular controls, strong selected-row state and a dense controls table. No screenshot content, branding or assets were copied.

The in-app browser runtime could not initialize in this Windows environment because the sandbox failed while applying deny-read ACLs. Therefore interactive screenshot and console QA are not claimed. Static review, responsive CSS review, Vite HTTP asset delivery and production build were completed. Manual browser smoke remains required before merge.

## Performance

Production output is 3.36 MiB unpacked. The generated menu background is the largest file at 2,312.2 KiB; main JS is 876.54 kB (242.63 kB gzip), CSS 36.34 kB (8.45 kB gzip). No new render-loop or fixed-tick work was added.

## Known issues

- Manual browser screenshots and console-error inspection remain blocked by the local Codex browser ACL failure.
- Online screen is intentionally a visual mock and cannot connect.
- Controls are intentionally read-only.
- Settings still do not persist between sessions.
- Generated background should be replaced by an approved current-game screenshot during final branding polish.

## Deferred

- Networking/backend/server authority.
- Rebindable controls, settings persistence, fullscreen/accessibility preferences.
- Real-device mobile QA and full browser viewport screenshots.

## Next work

Run the manual browser checklist from `docs/TESTING.md` on desktop and compact landscape, confirm console is clean, and replace the temporary generated background if an approved Frontier Cubes screenshot becomes available.

## Git

Commit: pending final review.
Push: pending final review.
Draft PR: pending final review.
No merge to `main` performed.