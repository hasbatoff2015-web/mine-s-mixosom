# 2026-09-20 Minecart occupancy and stable vehicle controls

## Goal

After live multiplayer QA: one passenger per minecart, independent per-cart control, W latches travel direction from camera only on a new press from a stop, S brakes to zero and never reverses.

## HEAD before

`004e6fdc503bdacdd130d357543cfa9b639252dd` on `codex/entity-special-visual-fixes`. `main` was not merged.

## Result

Authoritative occupancy is `player.ridingCartId` (max one live passenger). `MinecartManager.update` takes a per-cart `controls` map and still steps each cart once. W/S state machine is shared simulation. Visual pose interpolation, `MINECART_VISUAL_YAW_OFFSET`, slope visual axis, rider interpolation, and `MINECART_MAX_SPEED = WALK_SPEED * 1.5` were not changed.

## Implemented

- Occupancy helpers: `findMinecartPassenger` / `collectMinecartPassengers` / `extraMinecartOccupants`.
- `enterVehicle` rejects occupied carts and already-riding players.
- `forceReleaseVehicle` for disconnect, death, explosion, and cart break (not cancellable `vehicleExit`).
- Snapshot `passengerId` from connected live occupants only.
- Duplicate occupancy reconciliation (first live rider wins).
- Per-cart `{ throttle, riderYaw }` in one physics `update`.
- W edge latch (`throttleHeld`); S brake (`MINECART_BRAKE_TIME` 0.55 s) after slope gravity, clamped at 0.

## Changed files

- `src/entities/minecartOccupancy.ts` (new)
- `src/entities/MinecartManager.ts`
- `src/entities/index.ts`
- `src/gameplay/useInteraction.ts`
- `src/core/Game.ts`
- `server/gameplay.ts`
- `server/WorldInstance.ts`
- `shared/playerActions.ts`
- `tests/minecart-controls.test.ts` (new)
- `tests/server/minecart-occupancy.test.ts` (new)
- `tests/fire-contact-sunlight-minecart.test.ts`
- `tests/tnt-minecart.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/reports/2026-09-20_minecart-occupancy-controls.md`

## Architecture decisions

- Do not store `passengerId` on shared `MinecartEntity`. Occupancy is derived from players.
- `cart.rider` remains a derived/cache/visual hint.
- Prefer reject (toast) over transferring seats when already riding another cart.
- Direction latch lives on the cart (`throttleHeld`), not as a client-trusted network flag. Protocol still sends `vehicleForward` + yaw.

## Tests

- `tests/minecart-controls.test.ts` — occupancy helpers, camera W, repress W, S brake-only, reverse after stop, camera spin/corner, held-W latch, four slopes, per-cart map, max speed invariant.
- `tests/server/minecart-occupancy.test.ts` — same-cart two-player, two-cart independent W/S, disconnect, switch-reject + duplicate repair, death vs cancelled `vehicleExit`.
- Updated fire-contact W/S and TNT max-speed tests so S no longer reverses.
- Focused TNT/rail/use/kernel tests green.

## Visual QA

Not a visual change. Previous minecart visual pose / rider interpolation left intact.

## Performance

One `minecarts.update` per tick; each cart still stepped once.

## Known issues

Live two-client manual QA was not run in this session (no second browser client). Automated occupancy and two-cart control tests cover the same scenarios.

## Deferred

Owner live two-client pass: same cart, two carts, camera, reverse, disconnect, slope.

## Next work

Owner live QA on `codex/entity-special-visual-fixes`.

## Git

Feature branch only. No merge/rebase/force-push of `main`.
