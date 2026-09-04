# Local interaction aim desync

Date: 2026-09-04  
Branch: `cursor/local-aim-desync-86e1` (from PR #38)  
Do not merge main. Do not change remote interpolation or local prediction physics.

## Goal

The first-person crosshair and local block targeting must agree while the mouse moves between 20 TPS ticks. Bow spawn must use the same look as the visible camera.

## Result

Local interaction now samples **live `InputManager` yaw/pitch** with the canonical player eye. Fixed-tick physics still owns `PlayerController.yaw/pitch`. Server Online interact/break remains authoritative.

## Root cause

| Path | Look source | Rate |
|---|---|---|
| Camera | `applyImmediateRenderLook(this.camera, this.input)` | every RAF |
| Selection / break / place / bow | `session.player.viewDirection()` | 20 TPS tick only |

`PlayerController.tick` / `tickOnline` copy input look at tick start, but `session.target` was not refreshed on frames with 0 ticks. At 60–165 FPS the outline lagged up to ~50 ms — enough to pick the top face of a neighbor while the crosshair sat between two logs.

Copying `input.yaw` onto the controller every online frame (`stepOnlineAuthority`) was not enough: the raycast itself still ran only on ticks.

## Architecture (smallest safe change)

New Node-safe helper `src/player/localAim.ts`:

```text
origin    = player.eyePosition()
direction = viewDirectionFromLook(input.yaw, input.pitch)
```

Same YXZ basis as the first-person camera. Not `camera.position` / `getWorldDirection` (that would break third-person front).

- `Game.refreshLocalCrosshair` — outline + `session.target` only (no mining/clicks)
- called from `render()` when gameplay is allowed
- `updateTargetAndActions` reuses it, then consumes attacks / mining at 20 TPS
- `releaseBow` / SP use context / Q-drop use the same look
- `PlayerController.viewDirection` delegates to `viewDirectionFromLook(this.yaw, this.pitch)` for physics callers

Did **not**: write look into the controller at render rate; change server raycasts; change prediction; touch PR #38 remote interpolation.

## Changed files

- `src/player/localAim.ts` (new)
- `src/player/PlayerController.ts` (delegate viewDirection)
- `src/player/index.ts`
- `src/core/Game.ts`
- `tests/local-aim.test.ts` (new)
- `tests/player-main-integration.test.ts`
- docs: PROJECT_STATE, ROADMAP, ARCHITECTURE, TESTING, this report

## Tests

```text
npx vitest run tests/local-aim.test.ts tests/player-main-integration.test.ts tests/camera-look.test.ts tests/use-interaction.test.ts tests/tooling-boundaries.test.ts
```

Result: **local-aim 6/6**, player-main 4/4, camera-look 2/2, use-interaction + boundaries included in a 70-test combined pass. Typecheck client/server/sim **PASS**.

| Case | Result |
|---|---|
| Tick pitch=0 hits y=71 log; live pitch=0.42 hits y=72 | pass |
| Selection aim === action aim | pass |
| Bow direction matches live look, not stale controller | pass |
| Unchanged look matches `player.viewDirection()` | pass |
| F3 HUD + `?aimDiag=1` DEV gate | pass |
| Game does not targeting-raycast `player.viewDirection` or camera world dir | pass |

## Visual QA

Not run with two live clients here. Owner: stand in front of two stacked logs, sweep the crosshair across the seam — outline must follow the camera, not stick to the last tick face. Fire a bow while flicking the mouse; the arrow should leave along the first-person aim.

## Performance

One extra DDA raycast per render frame while PLAYING. No new allocations on the hot path (reused origin/direction Vec3).

## Known issues

- F3 Aim line is on the existing 7-tick HUD throttle.
- Online break/interact still validated by the server from sim look; overlay now matches the client camera. A 50 ms server look lag can still reject a flick-place (pre-existing authority).

## Deferred

- Remote action sync (still next after interpolation).
- Do not merge main.

## Git

Stacked on PR #38. Do not modify remote interpolation in follow-ups for this bug.
