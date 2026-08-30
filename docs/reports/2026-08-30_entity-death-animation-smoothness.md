# 2026-08-30 — Entity death animation smoothness

## Goal

Restore smooth playback of the existing mob death pose after Phase 4 (`EntityHost`). Do not rewrite the animation. Do not raise server TPS. Do not start Phase 5+.

Owner local QA after PR **#24**: ordinary movement, spawn, interpolation, and hurt flash were fine; death animation looked choppy / low-frame, especially online.

## Result

Server still decides died / lifetime / removal at **20 TPS**. Client death pose now advances from the **render loop** (`rawElapsed`) with the same 0.7 s / 90° / 25% shrink curve as before.

## Exact Root Cause

Death pose in `ThreeEntityHost.syncMob` is `progress = deathSeconds / 0.7` → `rotation.z = progress * π/2`, `scale = 1 - progress * 0.25`.

After Phase 4 that `deathSeconds` value was still only advanced on the simulation clock:

- SP: `MobManager.update()` when `state === 'die'`
- Online: `tickRemoteVisuals(FIXED_DT)` from `Game.tickOnline`

`interpolateVisuals` already ran every frame, but **did not interpolate `deathSeconds`** (chicken flap *does* use `visualAge = ageSeconds - FIXED_DT * (1 - alpha)`). Online is worse: `applyInterpolatedEntityVisuals` calls `interpolateVisuals(1)`, so there is no tick-alpha smoothing at all. Position stayed smooth via `EntityInterpolationBuffer` (~80 ms). Death rotation/scale only changed when the 20 TPS clock ticked (~14 poses over 0.7 s).

Snapshots do **not** send `deathSeconds`. `applyAuthoritativeDeath` already started death only if `state !== 'die'` (no restart). Interpolator set `networkRenderPose` (x/y/z/yaw); `syncMob` then overwrote `rotation.z` / scale from the coarse clock. The conflict was **clock rate**, not snapshot overwrite of the fall pose.

This is not “the server is 20 TPS so animation must be 20 FPS.” Movement already used a client interpolator. Death did not.

## Before / After

**Before Phase 4 / after EntityHost (broken):**

```text
20 TPS: deathSeconds += FIXED_DT
render:  syncMob(deathSeconds)   // same value until next tick
online:  interpolateVisuals(1)   // no alpha on the death clock
```

**After this pass:**

```text
20 TPS: deathSeconds += FIXED_DT          // lifetime / finishDeath / shouldKeepRemoteDeath
render: deathVisualElapsed += rawElapsed  // Game.frame, one loop over mobs
        syncMob(mobDeathVisualSeconds(...))
```

Pose formula in `ThreeEntityHost.syncMob` is unchanged. SP production now also uses the render clock (same curve, denser samples). Tests that never call `advanceDeathVisuals` keep the tick-interpolated `deathSeconds` fallback (creeper death test).

## Animation Timing

- Timer: `MobEntity.deathVisualElapsed` (client-only).
- Advanced by `MobManager.advanceDeathVisuals(deltaSeconds)` from `Game.frame` next to `updateSharedFireAnimation(rawElapsed)`.
- Cap one frame at 0.25 s (same idea as other dt clamps). No `setInterval`, no per-mob RAF.
- First activation catch-up: `deathVisualElapsed = deathSeconds` then `+= dt` so a late first render does not restart from 0 while sim lifetime has already moved.
- `beginDeath` zeros both sim and visual clocks **once**.

## Snapshot Interaction

`applyAuthoritativeDeath` / `entity_event death` call `beginDeath` only when `state !== 'die'`. Repeated `health: 0` / `state: 'die'` snapshots continue the current `deathVisualElapsed`. Snapshots never write the visual clock. Serialize/restore still omit visual fields.

## Interpolation

Pipeline:

```text
snapshots → EntityInterpolationBuffer.sample → setNetworkRenderPose (x/y/z/yaw)
then syncMob:
  visual.position / rotation.y from interpolated base
  visual.rotation.z / scale from death visual elapsed (on top)
```

Interpolator does not reset `rotation.z`. Living entities still get `rotation.z = 0`.

## Entity Isolation

Visual clock lives on `MobEntity`. Advancing A does not touch B. Hurt flash remains `hurtFlashSeconds` per entity; this pass does not clone materials.

## Singleplayer

SP `Game.frame` calls the same `advanceDeathVisuals(rawElapsed)` before `render()`. Duration, rotation amount, and scale are the same constants. Behavior should look like the pre-regression pose, not a new animation. Tests without the render clock still sample `deathSeconds` so creeper death assertions stay valid.

## Implemented

- `MOB_DEATH_ANIMATION_SECONDS = 0.7` (was a literal in keep-alive / finishDeath).
- `mobDeathVisualSeconds(deathSeconds, alpha, renderElapsed?)`.
- `MobManager.advanceDeathVisuals`.
- `Game.frame` wires the render dt.
- `tests/entity-death-animation.test.ts`.

## Changed files

- `src/entities/MobManager.ts`
- `src/core/Game.ts`
- `tests/entity-death-animation.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- this report

## Architecture decisions

- Keep EntityHost: `syncMob` still receives `deathSeconds`; the smoother value is computed in `MobManager.syncVisual`.
- Do not put Three.js state on the server. Headless never needs the visual clock.
- Do not send 60 animation frames from the server.
- Do not change GameplayKernel, useInteraction, blockGeometry, interpolator delay, hurt-flash sharing, or server tick rate.

## Tests

Targeted: `entity-death-animation` (start once, no restart, render delta vs snapshot rate, interpolation does not zero death pose, A vs B, remove/new id, hurt flash isolation, creeper fallback without render clock). Plus existing creeper death, mob-hurt-flash, network-entity-visual-events, interpolation, arrows/minecart/TNT/server packs, `npm run check`.

## Visual QA

Owner local:

- SP: kill a mob; existing death pose, not choppy, not a new animation.
- Anarchy: kill a mob; smooth fall at client FPS.
- Two clients: A kills; A and B see the same mob die smoothly; another living mob keeps moving.

## Performance

One extra loop over current mobs per frame (`advanceDeathVisuals`). No extra RAF, no material clone, no per-entity timer. Cost is a few numeric adds per mob.

## Known issues

None from this pass. Known unrelated baseline: authored ENOENT `bucket_empty.png`, minecart 5s timeouts, occasional vitest RPC — do not treat as this PR.

## Deferred

- Phase 5+ (persistence envelopes, RNG, plugins, renderer folder moves, protocol).
- Changing the death pose itself.

## Next work

Owner local QA of this PR on top of #24. **Do not merge main. Do not start Phase 5+.**

## Git

Branch `cursor/entity-death-animation-smoothness-bbb1` from Phase 4 `fee6604`. Stacked on draft PR **#24**, not `origin/main`.
