# 2026-08-29 — Entity interpolation, input recovery, visual sync

## Goal

Fix two-client QA issues on Anarchy server gameplay (PR #15) without new gameplay systems:

- remote non-player entities jittered;
- WASD could stop after chat / tab switch while mouse and chat still worked;
- mob hurt flash, death pose, bow draw, and arrow meshes were missing or unsynced.

## Result

Server remains authoritative. Client interpolation is time-based snapshot history (same delay class as remote players). Input recovers after chat/focus/pointer-lock/tab hide. Hurt/death/bow/arrow visuals are driven by server snapshots + `entity_event`.

Browser two-client visual QA was **not** performed in this environment.

## Root Cause — Entity Jitter

`src/net/applyEntitySnapshots.ts` `pose()` copied `previousPosition ← position` and `position ← snapshot` **when the packet arrived**. Online `tickOnline` does not tick mobs/drops/arrows, so that pair only changed at packet rate.

`Game.render()` still called `interpolateVisuals(alpha)` where `alpha` is the **client fixed-step remainder** (`accumulator / FIXED_DT`), unrelated to snapshot timestamps. A snapshot arriving at high client alpha jumped the mesh toward the new pose (classic 20 Hz rubber-band). Remote players already avoided this via `RemotePlayerView` / `sampleRemotePose` (~80 ms delay).

## Interpolation

`EntityInterpolationBuffer` (`src/net/entitySnapshotInterpolation.ts`):

- server tick → `entity_snapshot` (stale/out-of-order ticks dropped);
- per-`entityId` history (max 8 samples, receive timestamps);
- render samples `now - 80ms` between pose A and B (not FPS);
- shortest-angle yaw; distance ≥ `ENTITY_SNAP_DISTANCE` (6) snaps;
- first sample is immediate spawn; `retain()` deletes history so remove cannot lerp a ghost.

Three modes stay separate: local player chase (`authoritativeMotion`), remote players (`RemotePlayerView`), other entities (this buffer + `MobEntity.networkRenderPose` for visuals; simulation `position` stays the latest snapshot for targeting).

## Input Bug

`GameLifecycleManager` treated **every** `window.blur` as `BACKGROUND`. Pointer-lock exit and focusing chat can fire blur while `document.hasFocus()` is still true. Look still rendered (`applyImmediateRenderLook`); `tickOnline` did not run because `worldSimulationActive` is PLAYING-only → WASD never reached the server. Chat still typed because it is DOM.

## Input Fix

- Blur → BACKGROUND only if the document is hidden or truly unfocused (`src/core/lifecycleFocus.ts`).
- `visibilitychange` still BACKGROUND on tab hide.
- Chat close, canvas click, pointer-lock acquire, window focus: `resumePlayingIfVisible`.
- Chat close: blur input, cancel pending focus timeout, `clearHeldKeys`, focus canvas.
- Keydown: a leftover focused INPUT after chat close is blurred; WASD is captured again. Chat open still suppresses gameplay keys.

## Visual Events

- `entity_event`: `hurt` / `death` / `projectile_spawn` / `projectile_hit` keyed by `entityId`.
- Hurt: rising-edge snapshot `hurt` or event → existing per-entity `hurtFlashSeconds` + `applyMobLight`. Client ticks flash down in `tickRemoteVisuals` (online does not run mob AI).
- Death: server `state: 'die'` / event → `applyAuthoritativeDeath`. Corpse kept until animation time even if the snapshot drops; `remove()` does not emit client loot.
- Bow: visual-only `stepVisualBowUseTicks` from hold RMB + bow in hotbar. Server still fires the projectile on `input.use`.
- Arrows: interest pack puts arrows/TNT first (cap 96); skeleton projectiles included as `kind: 'arrow'`; interpolator drives the existing `PlayerArrowManager` mesh.

## Tests

- Targeted: interpolation 10/10, input recovery 9/9, visual events 7/7, plus remote-player / entity-lerp / modal / hurt-flash / anarchy-server / anarchy-gameplay / arrow-cleanup all green in the focused run (84/84).
- `tsc --noEmit` clean. Production build + size/archive PASS: **3.63 MiB / 221 files**.
- Full `npm run check` stops on the pre-existing suite: **1039 passed / 8 failed** (2 authored-asset ENOENT, 6 minecart 5s timeouts) + 1 vitest RPC timeout. Same class as PR #15 (1014/7); one extra cart timeout under the longer run. Not caused by interpolation/input changes.
- Browser two-client visual QA was **not** performed here.

## Changed files

- `src/net/entitySnapshotInterpolation.ts`, `src/net/applyEntitySnapshots.ts`, `src/net/entityEvents.ts`, `src/net/index.ts`
- `src/core/lifecycleFocus.ts`, `src/core/Lifecycle.ts`, `src/core/Game.ts`
- `src/input/gameplayKeys.ts`, `src/input/InputManager.ts`, `src/ui/GameUI.ts`
- `src/entities/MobManager.ts`, `src/combat/PlayerArrowManager.ts`, `src/redstone/RedstoneSystem.ts`
- `server/gameplay.ts`, `server/WorldInstance.ts`, `shared/protocol.ts`
- tests + `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/LOCAL_SERVER.md`

## Architecture decisions

- Reuse remote-player delay; do not invent a second FPS lerp.
- Visual pose vs latest snapshot position split on mobs (`networkRenderPose`).
- Generic entity events instead of per-kind client combat prediction.
- No IndexedDB spawn import, no new commands/plugins/VPS.

## Visual QA

Not run here (no two-client browser session). Owner local QA is the acceptance gate.

## Performance

No per-frame material clone or mesh create. Existing entity instances + bounded sample arrays (8).

## Known issues / Deferred

- Remote player model is still a box (no third-person bow).
- Owner two-client soak.
- IndexedDB Anarchy world import remains a separate task.

## Next work

Owner localhost QA on this branch. Do not merge main.

## Git

Branch: `cursor/entity-interpolation-input-visual-sync-bbb1`  
Base: `cursor/full-anarchy-server-gameplay-bbb1` (`fe1509f`), not a main merge.  
Implementation: `90cdea1`  
Verification (this report): `2966d0b`  
PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/16 (draft)  
Working tree: clean.
