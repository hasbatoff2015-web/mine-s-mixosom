# Online respawn input fix (stabilization)

Date: 2026-08-29  
Branch: `cursor/online-respawn-input-fix-bbb1`  
Base: `c75497b` (`cursor/shared-game-core-kernel-bbb1`, Phase 1 / draft PR #18)  
**Not merged to main.** `origin/main` remains `a056e6f` (no Anarchy gameplay).

## Goal

After any Online Anarchy death → respawn, WASD / Space / Shift / mouse look / chat must work the same as before death. One canonical respawn/input lifecycle. No Phase 2, no GameplayKernel changes, no client-authoritative movement.

## Result

Stabilization pass only. Server death paths share `respawnIfDead` (flush `health` dead then alive). Client restore no longer races into `BACKGROUND`, so `tickOnline` keeps sending input packets. Server remains authoritative.

## Exact Root Cause

Validated QA symptom: mouse look works, chat typing works, WASD does not.

That is not a dead keyboard. `InputManager` still records `keydown` on `window`. Look is applied every render frame (`applyImmediateRenderLook`). Chat is a DOM field. Gameplay movement is sent only from `tickOnline`, and `frame()` runs `tickOnline` only when `worldSimulationActive(lifecycle)` → **`lifecycle === 'PLAYING'`**.

Two stacked bugs:

1. **Client lifecycle race (all death paths that restore, including `/kill`).**  
   `restoreOnlinePlayingFromRespawn` always `canvas.focus()` + `tryRequestPointerLock()` and `clearHeldKeys()`. Pointer-lock / focus can fire `window.blur` while `document.hasFocus()` is briefly **false** even though the tab is still visible. `GameLifecycleManager` then queued BACKGROUND. If the pointer stayed locked, the player could still look around and would not click the canvas, so they never `resumePlayingIfVisible`. WASD keys entered the Set but no input packets left the client. Server `lastInput` stayed zeroed from respawn.

2. **Divergent server death paths (natural / mob / TNT / PvP vs `/kill` / fall / fire).**  
   `/kill`, fall physics, and survival fire/lava already went through `flushHealthIfDeadThenRespawn` (dead packet, then respawn, then alive packet). Mob melee, explosions, and `hurtPlayer` called `respawnIfDead` only. Same-tick 20→0→20 HP left `flushHealth` signature equal to the pre-death `{ health: 20, dead: false }`, so the client **never saw dead→alive** and restore did not run. Combined with (1) when restore *did* run on other paths, `/kill` was not a reliable workaround.

`/kill` had no unique input hack. It used the flush path, which made restore more likely, which made the BACKGROUND race more likely. Natural mob death often skipped restore entirely (bug 2) and/or still hit the same client race if a later `health`/`player_state` looked like a respawn.

## Natural death vs `/kill`

| Path | Before this pass | After |
|---|---|---|
| Fall (player physics damage) | `flushHealthIfDeadThenRespawn` | `respawnIfDead` (now flushes) |
| Fire / lava (survival.tick) | `flushHealthIfDeadThenRespawn` | same |
| `/kill` | damage + `flushHealthIfDeadThenRespawn` | same wrapper → `respawnIfDead` |
| Mob melee (`handleMobEvents`) | `respawnIfDead` only, no dead health | same function, now flushes |
| TNT / explosion | `respawnIfDead` only | same |
| PvP / projectile (`hurtPlayer`) | `respawnIfDead` only | same |

No `/kill`-only client workaround.

## Input lifecycle

- `InputManager.keys` still listen on `window` regardless of PLAYING.
- `tickOnline` requires PLAYING.
- Blur → BACKGROUND only if the document is hidden, or truly unfocused **and** not pointer-locked, not lock-pending, not in the respawn restore guard.
- Respawn restore: map BACKGROUND/DEAD → PLAYING; close chat/inventory; **do not** `canvas.focus` / re-request lock if already locked; clear held keys **only** if chat/inventory owned the keyboard (not `keys.W = false` as the fix).
- Pointer-lock acquire calls `onPointerLockAcquired` (resume PLAYING) **before** releasing an illegal lock.

## Server state

`respawnIfDead` now: if dead → `flushPlayerLife` (health `dead: true`) → drop/teleport/clear lastInput movement (seq unchanged) → `survival.respawn` → `flushPlayerLife` (alive). Same `PlayerController` object; no replacement, so no stale InputManager binding to an old player.

Client: `health` or `player_state` dead→alive runs restore. Stale `player_state` with `dead: true` and `tick <= lastAliveTick` is ignored for life flags (position interpolation unchanged).

## Fix

Correct flow remains: keydown → InputState → tickOnline → input packet → server `applyInput` → `PlayerController.tick` → snapshot → client chase. No client-side post-respawn locomotion.

## Tests

- `tests/online-respawn-input.test.ts` — restore contract for every death label; blur+pointer lock; lock pending; tab hide; chat open/close; consecutive deaths; stale dead snapshot; plan does not focus when locked.
- `tests/server/anarchy-gameplay.test.ts` — fall, fire, lava, TNT/explosion, mob melee, `/kill` consecutive, two-client A then B: each sends dead→alive health and then accepts WASD.
- Existing `network-input-recovery`, `network-block-state-respawn`, `pointer-lock`, `gameplay-kernel`, `network-entity-visual-events`, `anarchy-server` still green.

Targeted pack: **97/97**. `tsc --noEmit` clean. Production build/size PASS **3.63 MiB / 221 files**.

## Regression

Not modified: `GameplayKernel` step order, entity interpolation buffer, fluids, block states, rendering, mob visuals, bow, arrow, singleplayer `Game.tick` world sim.

## Visual QA / Performance

No browser/device QA in this cloud pass (no gameplay display claimed). No meshing/render change. No per-frame debug logs left in.

## Known issues

Owner must still run local two-client death QA. Full `npm run check` baseline failures (authored ENOENT `bucket_empty.png`, minecart 5s timeouts, occasional vitest RPC) are pre-existing and out of scope.

## Deferred

Phase 2 `useHeld` unify. GameplayKernel extraction of more systems.

## Next work

Owner local QA, then stop. Do not merge main.

## Git

- Branch: `cursor/online-respawn-input-fix-bbb1`
- Base: `cursor/shared-game-core-kernel-bbb1` @ `c75497b`
- HEAD: `c97565d` (implementation); docs pin `46006a6`
- Draft PR: **#19** stacked on #18. Do not merge `origin/main`
