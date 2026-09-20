# 2026-09-19 Minecart rider interpolation + 1.5× speed

## Goal

Stop the seated local player stepping at 20 TPS inside a smoothly interpolated minecart, and raise on-rail max speed by ~50% without changing rail topology or acceleration time.

## HEAD before

`ef58842d2d82ffcedca7b63b73b870edf92ed51d` on `codex/entity-special-visual-fixes`. `main` was not merged.

## Exact jitter root cause

Minecart simulation is 20 TPS (`FIXED_DT = 0.05`). `MinecartManager.update()` copies `cart.previousPosition` then writes the new `cart.position`. Render-time `interpolateVisuals(alpha)` lerps that pair, so the hull moves every rAF frame.

`Game.render()` already sampled `LocalPlayerRenderState` (leftover / `FIXED_DT`) and passed that pose into `updatePlayerPresentation()`. Seated local origin ignored it and used current `cart.position` + `MINECART_RIDER_GAMEPLAY_Y`. The rider therefore held `S(n)` until the next tick, then jumped to `S(n+1)`, while the cart was on `lerp(S(n-1), S(n), alpha)`.

## Old render path

- Cart visual clock: `previousPosition → position`, `alpha = leftover / FIXED_DT` via `minecarts.interpolateVisuals(alpha)` (after presentation).
- Seated local player clock: current simulation `cart.position` (20 TPS steps).
- `updateMinecartRiding` already wrote player previous/current from cart previous/current + 0.2, and `localRender.sample()` already interpolated that ride pose. Presentation discarded it when seated.

## New render path

- Cart visual clock: unchanged (`interpolateVisuals(alpha)`).
- Seated local player clock: the same leftover sample already passed into `updatePlayerPresentation` (`seatedLocalPlayerVisualOrigin(position)`).
- Rider Y is **not** added again: the sampled pose already includes `cart.y + MINECART_RIDER_GAMEPLAY_Y`.
- Render order was left as-is. Using the sampled pose is enough.
- Remote: unchanged. `RemotePlayerView.group.position` is interpolated; `visual.root` keeps seat offset `{0,0,0}`. No second interpolation layer.

## Speed

| | blocks/sec |
| --- | --- |
| Old `MINECART_MAX_SPEED` | `WALK_SPEED` = 4.317 |
| New `MINECART_MAX_SPEED` | `WALK_SPEED * 1.5` ≈ 6.4755 |
| Ratio | 1.5× |

`ACCEL_TIME` stays 0.5 s, so `accel = MAX / 0.5` scales 1.5× and time-to-cap stays ~0.5 s. Friction, slope gravity, push gain, derail grace, and `railPath` were not changed. Singleplayer and `server/gameplay.ts` share `MinecartManager`.

A 80-block NS track under held W reached `alongSpeed ≈ MINECART_MAX_SPEED` (above old walk cap) in the focused test.

## Changed files

- `src/core/Game.ts`
- `src/rendering/player/seatVisual.ts`
- `src/entities/MinecartManager.ts`
- `tests/player-visual-animation.test.ts`
- `tests/tnt-minecart.test.ts`
- `tests/fire-contact-sunlight-minecart.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`

## Tests

- `player-visual-animation` **18/18** (new mid-tick seat origin ≈ 10.15, not 10.3)
- `tnt-minecart` **10/10** (cap 1.5× walk, brake, coast, reverse on a long straight)
- `rail-corner-path` **10/10**
- isolated fire-contact W/S (`-t "caps at 1.5"`) **PASS** (353 ms; `deferredLighting` only in that case)
- `server/tnt-minecart` + `server/anarchy-gameplay` **40/40**
- Full `fire-contact-sunlight-minecart.test.ts` still hangs on this host (baseline). Slope/curve/derail isolated filter also hung; those physics constants were not changed.

`typecheck` ×4, `check:boundaries`, `build` PASS. `git diff --check` clean.

## Manual QA

Cursor browser on the current Vite (`localhost:4174`):

- `/?qaSpecial=seated`: hip 90°, upright torso, legs inside cart, hull along NS rail. Cart is parked (`alongSpeed = 0`); this harness still parents the rider to `cart.position`.
- `/?qaSpecial=rails&row=tracks`: hulls stay on the rail and keep the −π/2 visual yaw.

Live third-person ride in a generated world (W on a long straight, corners, slopes) was **not** fully exercised here: no pointer-lock gameplay session. The production jitter path is `Game.updatePlayerPresentation`, covered by the render-sample regression. Online Anarchy rider/observer was not live-tested; server TNT/anarchy suites passed.

## Git

Feature branch only. No merge to `main`, no rebase, no force push.
