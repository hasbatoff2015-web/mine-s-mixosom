# Mobile flight descend — 2026-10-04

## Goal

Stop the mobile crouch button from keeping Creative Flight in a permanent descent after the finger lifts.

## Root cause

`bindTouch` toggled `touchSneak` on every sneak `pointerdown`. `pointerup` and `pointercancel` did not clear it. `movement()` fed that one flag to both `sneak` and `descend`. `updateFlyVelocity` subtracts `CREATIVE_VERTICAL_SPEED` whenever `descend` is true, so one tap kept `desiredY` negative.

The windows were not the problem. The same latched bit was both ground crouch and flight descend.

## Contract

Survival, and creative while not flying: one tap latches crouch, the next tap clears it. The gold `.is-active` state and `aria-pressed` follow the latch. Releasing the finger does not clear it.

Creative and `isFlying`: the button is momentary. `pointerdown` sets descend, `pointerup` and `pointercancel` clear it. The latch is not toggled. The button is gold only while the finger is down.

A ground latch is cleared the moment flight begins, and it never feeds `descend`. Leaving flight starts the latch at off. A press that began in the air does not become a ground toggle when the finger later lifts.

Desktop Shift still sets both sneak and descend for as long as the key is held.

## Implementation

`touchSneakPressed` and `touchSneakLatched` live in `MobileSneakState`. `mobileSneakIntent` builds sneak from the latch and descend from the physical press or desktop Shift. `syncMobileSneakMode` runs after the local tick, after prediction, and after reconciliation, using `gamemode === 'creative' && isFlying`. No new protocol field. `descend` was already edge-sensitive in compaction.

## Tests

`tests/mobile-sneak-flight.test.ts` drives the gesture into `PlayerController`, including the latch-to-flight case, landing before release, desktop Shift, and a predicted descend press/release that reconciles. `tests/server/creative-flight-manual-jump.test.ts` runs the same descend edge through `WorldInstance`.

## Visual QA

Chrome headless, 844×390, `pointer: coarse`, dev server `127.0.0.1:5173`. The sneak button center was `(760, 310)` and `elementFromPoint` was the sneak button.

- Survival: one tap set `is-active` and `aria-pressed=true`. The next tap cleared both.
- Creative on the ground: the same toggle. One tap latched, the next cleared it.
- Creative after a double tap on jump: holding crouch set `is-active` only while the pointer was down. `pointerup` cleared the class and `aria-pressed`.
- Creative with crouch already latched, then a slower double tap on jump: the gold class and `aria-pressed` cleared without another crouch press.

The live view was not used to measure altitude. Descent and the return toward hover were checked on `PlayerController` and `WorldInstance`.

## Follow-up: authoritative gamemode

An online `inventory` message can change gamemode and return before the next tick. It already called `syncLocalCreativeFlight`, which updated creative permission and jump-lock, and left the crouch mode on `flight-hold` until the next prediction or reconcile. A crouch tap in that gap was a momentary press, so the first survival toggle was lost.

`syncLocalCreativeFlight` now also calls `syncMobileSneakMode(session, gamemode)` with that same gamemode. Survival clears flight-hold immediately, even while `isFlying` is still true. A finger that is already down stays `pressed` and does not become a latch. The calls after tick, prediction, and reconciliation stay, because those are when `isFlying` itself changes. No protocol field changed.

`tests/mobile-sneak-flight.test.ts` covers creative flight to survival with no tick and an immediate latching tap, a held finger across that change, grounded creative staying on the toggle, and flight still clearing the latch. The inventory case calls the sync before it returns and does not sample movement.

This path was not clicked in a live online session.

## Git

Branch `cursor/mobile-controls-sky-hud-f726`. PR #115 stays draft. Do not merge.
