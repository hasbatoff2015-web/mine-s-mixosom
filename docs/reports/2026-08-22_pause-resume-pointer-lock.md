# 2026-08-22 Pause resume restores pointer lock

## Goal

After inventory close recapture (`9337e5b`), Continue from pause still left the system cursor visible. Restore mouse-look on pause resume using the existing `tryRequestPointerLock()` path. Do not recapture when Esc *opens* pause.

## Result

Implemented. Continue and Esc-on-pause resume recapture; Esc-from-gameplay still only releases lock.

## Root cause

`showPause({ resume: () => enterPlaying() })` returned to PLAYING without `requestPointerLock()`. Capture lived on canvas click and inventory close (`closeInventoryAndResumeLook`), not pause resume. Continue is a click on the pause button, not the canvas.

## Implemented

`Game.resumeFromPause()`: `enterPlaying()` → `InputManager.tryRequestPointerLock()` (same helper as inventory). Wired to Continue and to Esc while already paused (Esc is the resume key). Opening pause from PLAYING still `setState(PAUSED)` + `exitPointerLock` + `showPause`. World load / death / ads still `enterPlaying()` only.

No setTimeout, Promise delay, or synthetic click.

## Changed files

- `src/core/Game.ts`
- `tests/pointer-lock.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/ROADMAP.md`
- `docs/reports/2026-08-22_pause-resume-pointer-lock.md`

## Tests

Policy: Esc-open-pause no capture; Continue captures; modal/coarse/already-locked still blocked; inventory-close still captures.

`npm run check` green: 214 tests / 27 files, 82 modules, 0.96 MiB.

## Git

Commit after `npm run check`. No merge main. No force push.
