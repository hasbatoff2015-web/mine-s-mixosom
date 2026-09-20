# Sword blocking animation (Minecraft 1.5.2-style)

Дата: 2026-09-20  
Ветка: `cursor/sword-blocking-animation-7e91`

## Goal

При удержании ПКМ с мечом игрок визуально блокирует удар. First-person, local third-person и remote third-person должны показывать одну и ту же blocking action. Существующая механика замедления при use не меняется.

## Result

Implemented. Source of truth остаётся `CombatSystem.swordBlocking` (fixed 20 TPS from `InputManager.using` / server `input.use`). Visual layer adds a 0.1 s idle↔block interpolation overlay on top of existing held-item calibration. Live two-client Anarchy pose QA was not run in this environment.

## Existing systems found

- RMB / use-item: `InputManager.using`, `Game.tick` / `tickOnline` send `use`, `movementDuringItemUse` (×0.2 for swords and bow).
- Sword blocking state: `CombatSystem.updateUse` → `swordBlocking` when held item is `kind: 'weapon' && weapon === 'sword'`, gameplay active, alive.
- Server: `WorldInstance.tickConnectedPlayers` copies command `use` into `lastInput`, calls `combat.updateUse`, publishes `presentation.swordBlocking`.
- First-person: `FirstPersonRenderer` already had an instant overlay; it is now interpolated.
- Third-person: `PlayerVisualAnimator` already snapped the right arm; held sword stayed on the idle `/moveitems` pose. Arm is now interpolated; sword gets a separate extra TRS overlay.
- Remote: `RemotePlayerView` already forwarded `actions.swordBlocking` into `PlayerVisual.update`.

## How sword blocking is determined

`isSwordItem()` (`kind: 'weapon'` + `weapon: 'sword'`). IDs: wooden/stone/iron/diamond/ruby/titanium swords. Axes, pickaxes, shovels, hoes, bow, food, blocks do not block.

## Network sync

No new protocol field. Server-authoritative `PlayerPresentationState.swordBlocking` was already on `player_state` / join `presentation`. Client injection of presentation is still rejected. Remote `PlayerVisual` now applies the overlay from that flag.

## First-person animation

`FirstPersonRenderer.update`: `advanceSwordBlockingProgress` then `applyFirstPersonSwordBlockingOverlay` after `applyItemViewTransform` (idle / QA pose). Overlay is extra position/rotation on the item root. Arm mesh stays hidden while holding an item (existing rule).

## Third-person animation

- Arm: lerp toward `THIRD_PERSON_SWORD_BLOCKING_ARM` (0.86 / −0.62 / 0.42) by `blockingProgress`.
- Held sword: `applyThirdPersonSwordBlockingTransform` = stored idle base (production or `/moveitems` live overlay) + extra local TRS. Scale unchanged.
- Local third-person and `RemotePlayerView` share `PlayerVisual`.

## Interpolation

Linear 0.1 s (`SWORD_BLOCKING_TRANSITION_SECONDS`). Render-frame, clamped dt 0.1. Release / overlay / pause lerp down. Item swap off a sword, death and bed rest snap to 0 so the new/idle pose is not left in BLOCK.

## Transforms

First-person extra (on `FIRST_PERSON_SPRITE_POSE`):

- position `(-0.30, 0.18, 0.08)`
- rotation `(-0.65, 0.52, 1.00)` rad

Third-person extra (on sword `/moveitems` pose, local quaternion multiply):

- position `(0.05, 0.05, -0.08)`
- rotation `(-0.18, -0.85, -1.25)` rad

Not a copy of vanilla GL numbers. Principle: raise toward center / across the body.

## `/moveitems` calibration

`THIRD_PERSON_HELD_ITEM_DEFAULTS.sword` and `FIRST_PERSON_SPRITE_POSE` are unchanged. `PlayerVisual` stores the idle base (defaults or `applyHeldItemCalibration`) and only writes the overlay while `blockingProgress > 0`. After release the stored calibration is restored exactly.

## Changed files

- `src/items/registry.ts` — `isSwordItem`
- `src/combat/CombatSystem.ts` — uses `isSwordItem`
- `src/rendering/player/swordBlockingVisual.ts` — new overlay/lerp helpers, reused Euler/Quaternion
- `src/rendering/player/PlayerVisualAnimator.ts` — `blockingProgress`, interpolated arm
- `src/rendering/player/PlayerVisual.ts` — held-item overlay on stored calibration
- `src/rendering/player/thirdPersonHeldItem.ts` — `isThirdPersonSwordItem` via `isSwordItem`
- `src/rendering/FirstPersonRenderer.ts` — interpolated overlay
- `tests/sword-blocking-visual.test.ts` — new
- `tests/player-visual-animation.test.ts`, `tests/classic-combat-integration.test.ts`, `tests/remote-action-presentation.test.ts`, `tests/server/remote-presentation.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, this report

## Architecture decisions

Reuse `swordBlocking` instead of a second RMB detector. Blocking is a visual overlay layer, not a new held-item pose table. First-person and third-person extras are independent, matching old Java ItemRenderer vs RenderPlayer. No new Three.js objects per frame.

## Tests

```text
npx vitest run tests/sword-blocking-visual.test.ts tests/player-visual-animation.test.ts tests/classic-combat-integration.test.ts tests/combat.test.ts tests/third-person-held-item.test.ts tests/remote-action-presentation.test.ts tests/server/remote-presentation.test.ts --maxWorkers=2
```

**7 files / 125 tests PASS.**

## Visual QA

Not run live. Headless environment has no in-game two-client session. Deterministic transform tests cover idle restoration, overlay deltas, remote forwarding and calibration isolation.

## Performance

No per-frame Mesh/Geometry/Material/Quaternion allocation in the overlay path (module-level scratch Euler/Quaternion). Works for many remote players through existing `PlayerVisual` instances.

## Known issues

- Live first-person / third-person / two-client pose acceptance pending owner QA.
- First-person arm stays hidden while holding a sword (pre-existing); only the item moves.

## Deferred

Owner Anarchy QA: player A holds RMB with a sword, player B sees the block pose.

## Next work

Owner visual acceptance; do not merge without review.

## Git

Branch `cursor/sword-blocking-animation-7e91`. Do not merge to main. Do not touch PR #96.
