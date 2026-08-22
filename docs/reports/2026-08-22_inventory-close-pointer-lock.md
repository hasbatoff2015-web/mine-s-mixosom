# 2026-08-22 Inventory close restores pointer lock

## Goal

Fix desktop mouse-look after closing inventory/Creative on `cursor/minecraft-item-pipeline-rework-935a` HEAD `d1d0e50`. E and Close left the system cursor visible; camera required an extra canvas click. Do not change held items, icons, stairs/slabs, ladder, geometry, or `FIRST_PERSON_SPRITE_POSE`. No commit/push.

## Result

Implemented. One close path for E, Close, Esc-on-open-inventory, and container modals.

## Root cause

`openInventory` correctly `exitPointerLock` so the cursor can click slots. Closing called `closeInventory()` + `enterPlaying()` (`PLAYING`, HUD back), but **never** `requestPointerLock()`. Capture existed only on canvas `click` in `InputManager`. Keyboard E is not a canvas click, and the Close button click hits the modal, not the canvas, so lock did not return.

Not an E-only bug: every modal close used that same resume without recapture.

## Implemented

- `shouldRequestPointerLock` / `InputManager.tryRequestPointerLock()`: request only when `canCapture` (PLAYING and inventory closed), not coarse, not already locked. Canvas click uses the same helper.
- `Game.closeInventoryAndResumeLook()`: close modal → `enterPlaying()` → `tryRequestPointerLock()`. Used by toggle-E, Close `onClose`, Esc while inventory is open, chest/furnace/table Close.
- Pause open/resume still uses `enterPlaying()` only (no auto-lock). `pointerlockchange` while PLAYING still pauses. Inventory open still exits lock.

No synthetic click, no `setTimeout`.

## Changed files

- `src/input/pointerLock.ts` (new)
- `src/input/InputManager.ts`
- `src/core/Game.ts`
- `tests/pointer-lock.test.ts` (new)
- `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/ROADMAP.md`
- `docs/reports/2026-08-22_inventory-close-pointer-lock.md`

## Tests

`npm run check` green: typecheck, 211 tests / 27 files, Vite 82 modules, 0.96 MiB / 165 files.

`tests/pointer-lock.test.ts`: capture after PLAYING + inventory closed; no capture while inventory open or pause; no capture on coarse / already locked; `applyPointerLockRequest` calls the canvas API only on resume.

## Visual QA

Desktop: open inventory with E, close with E — cursor gone, look works immediately. Same with Close. Esc on inventory closes inventory and recaptures; Esc from PLAYING still pauses without stealing the cursor back. Touch unchanged.

## Git

No commit / push (per task).
