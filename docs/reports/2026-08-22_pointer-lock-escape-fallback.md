# 2026-08-22 Pointer lock Esc fallback

## Goal

Handle Chrome's default Esc unlock gesture without retries or security hacks. Continue after Esc must either relock or show a single-click overlay after a real failed request.

## Result

Implemented. Inventory/programmatic relock unchanged. Esc pause opens from `pointerlockchange` without a second `exitPointerLock`. Continue issues one `tryRequestPointerLock()`. Overlay only after failure.

## Pointer lock flow

- `programmatic`: inventory/chest/furnace/death `InputManager.releasePointerLock()`.
- `escape`: unlock while focused/visible, not programmatic → open pause.
- `focus-lost`: hidden or unfocused document; do not open pause, do not auto-request.
- `unknown`: unused leftover.

## Esc / Continue

Esc while locked is ignored in keydown (browser unlocks). Same Esc is swallowed until keyup so it cannot immediately resume. Continue: `resumeFromPause()` → `enterPlaying()` → one request. Pause stays closed even if the request fails.

## Fallback

Shown only after Promise rejection / `pointerlockerror` while PLAYING. Click overlay → one more request. Success (`pointerlockchange` lock) hides it. No timer/retry loop.

## Tests / Git

See `npm run check` in the user report. Commit after green.
