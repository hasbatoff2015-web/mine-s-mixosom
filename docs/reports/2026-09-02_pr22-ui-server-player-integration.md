# PR #22 UI integration with authoritative server/player main

## Goal

Integrate the existing Draft PR #22 UI visual-system branch with current `origin/main` after the authoritative server, PR #28 breaking overlay and PR #31 player presentation landed, without replacing current gameplay/network/lifecycle/save contracts or creating another branch/PR.

## Result

The existing branch now contains exact main `020d9d38d58f2d23231683a6aca736acf813bcb7` plus the retained UI visual system. Server authority, `Game.tickOnline`, GameplayKernel, Online containers/cursor, death/respawn/chat, breaking overlay and PlayerVisual/F5 remain intact. UI typography, responsive HUD, authored hunger, loading, Creative, World Select and `qaUi` fixtures remain intact. The delete modal received the requested bounded accessibility completion.

## Implemented

- Resolved the DEV router so `qaUi`, `qaPlayer` and `qaBreaking` coexist.
- Audited the auto-merged `GameUI` API and added `tests/ui-main-integration.test.ts` to guard live server status, authoritative inventory/cursor flow, chat/death/respawn, Online no-local-simulation and overlay/player render hooks.
- Added `aria-describedby` and deterministic Tab/Shift+Tab cycling to the World Select delete dialog; Escape and trigger focus restoration remain.

## Changed files

The merge imports the current main server/shared/player/overlay stack. Integration-authored changes are limited to `src/main.ts`, `src/ui/GameUI.ts`, `tests/ui-main-integration.test.ts`, `tests/ui-visual-contract.test.mjs` and the required state/roadmap/architecture/testing/report documentation. The pre-existing PR #22 font, texture, CSS, UI helper and fixture files are retained.

## Architecture decisions

- Main wins for gameplay/server/network/lifecycle/save contracts.
- `GameUI` remains the only DOM UI implementation; no parallel inventory/menu system.
- UI is a presentation consumer of authoritative state. Online inventory actions remain protocol messages and Online world mutation remains server-only.
- Existing PlayerVisual/overlay systems are not coupled to the UI fixture or changed by the integration.

## Tests

- UI: 7 files, **50/50**.
- Combined integration: 29 files, **241/241**.
- Shared sim: **42/42**; server: **73/73**.
- `typecheck`, `typecheck:sim`, `typecheck:client`, `typecheck:server`, boundaries, sim/server smokes: PASS.
- Full feature: **118/122 files, 1251/1267 tests**; exact main: **114/119 files, 1236/1253 tests**. No new failure class; details in `docs/TESTING.md`.

## Visual QA

In-app Chromium passed 28/28 layout cases for Loading/HUD/Creative/World Select at 1920×1080, 1366×768, 1280×720, 932×430, 896×414, 844×390 and 740×360. Fonts and authored hunger assets loaded. HUD variants, Creative ARIA tabs/260-of-396 scrolling/close, World Select selection/double-click/autofocus/Tab loop/Escape/Cancel/trigger restoration, current offline Online screen, plus player/breaking DEV routes passed without console diagnostics.

## Performance

No UI frame loop, polling, world tick, meshing or server work was added. Existing HUD signature caching, stable loading node updates and shared item/player/overlay caches remain. Build is **3.88 MiB / 284 files**, far below platform limits.

## Known issues

The full suite retains the exact-main classes of CPU-heavy default timeouts, stale GeneratedItemGeometry source fingerprint, reference-extractor parser failure and Vitest worker RPC timeout. Vite retains the established `/sdk.js` non-module and large main-chunk warnings.

## Deferred

Native pointer-lock/gameplay, physical landscape mobile and two-visible-client QA; skin provenance; future selector/upload/protocol work. None belongs to this integration.

## Next work

Owner review of the existing Draft PR #22 and native device/manual gameplay acceptance. Do not merge the PR as part of this task.

## Git

- Branch: `codex/ui-visual-system-pass`.
- Pre-integration HEAD: `cbbb97cd49d061b662c1a119c6c1af59b993063c`.
- Integrated main: `020d9d38d58f2d23231683a6aca736acf813bcb7`.
- Delivery: one merge commit, pushed to the same branch; immutable SHA reported in the final handoff.
