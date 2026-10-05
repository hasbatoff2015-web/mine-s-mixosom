# Invisibility world particles and air HUD — 2026-10-05

## Goal

Give an invisible player a sparse world-space swirl so other players can roughly place them, and show a Minecraft-like air bubble row while the head is underwater. Drowning math and the potion protocol stay as they are.

## Result

Both presentations are client-only. `invisible` was already on the remote pose and on the local survival state. `SurvivalSystem.airTicks` was already the 0–300 supply. No packet, duration, drain, refill, or drowning-damage change.

## Implemented

### World particles

`InvisibilityWorldParticles` is a child of `PlayerVisual.root`. It is not attached to the head, body yaw, skin, or armor. `PlayerVisual.update` calls `setActive(state.invisible)` and then `update(deltaSeconds)`. Turning the effect off recycles every sprite in that call, so a visible player does not keep a leftover cloud.

The pool is 7 sprites, created once. A new particle is scheduled every 0.28–0.45 s. Activation seeds two sprites at life 0.18 and 0.42 so the cloud is visible immediately without filling the pool. Lifetime is 1.3–2.0 s. Spawn is a disk of radius 0.34 around the feet origin, Y 0.15–1.75. Rise is 0.18–0.35 blocks. Lateral drift is 0.04–0.08. Size is 0.10–0.16 and eases down by 8% over life. Opacity fades in over the first 15% of life, holds until 75%, then fades out. Peak opacity is 0.52. Tint is `#F6F6F6`.

Sprites use the existing swirl row: `POTION_SWIRL_FRAMES`, `applyPotionSwirlUv`, and `particle/particles.png`. Eight frame maps are shared. Each `SpriteMaterial` swaps `map`. Filters are nearest, mipmaps off. Material flags: `transparent`, `depthTest: true`, `depthWrite: false`, `fog`, `toneMapped: false`, `NormalBlending`. A wall that writes depth hides the sprites.

`Game.updatePlayerPresentation` still sets `playerVisual.root.visible` only in third person while playing and not blocked by an overlay. First person therefore does not draw this group. `SharedPotionParticles` remains the first-person screen overlay.

`dispose` removes the group and disposes the seven materials. The shared frame owner stays alive for the next `PlayerVisual`.

Remote players use the same `PlayerVisual`. `RemotePlayerView` already passes `pose.invisible`. No new interpolation field.

### Air HUD

`airHudIcons` clamps air to 0–300 and uses:

- `fullCount = ceil((air - 2) * 10 / 300)`
- `visibleCount = ceil(air * 10 / 300)`
- `burstingCount = visibleCount - fullCount`

Bursting icons are emitted first. `.air` is `justify-content: flex-end` with a fixed ten-icon width, so the popping bubble sits on the left of the remaining cluster and the cluster stays over the right side of hunger. Empty slots are not rendered. `submerged === false` sets `visible: false` even while air is still refilling.

`#status-bars` is `.status-left` (armor, hearts) and `.status-right` (air, hunger). Both columns use `align-items` so hearts and hunger share the bottom baseline. Icon size and gap are `--hud-status-icon-size` and `--hud-status-icon-gap`. Mobile uses the same `#status-bars` and `--hud-scale`.

`Game.refreshHud` sets `airVisible` only for survival with `headSubmerged && inWater && !inLava`. Creative, feet-only water, lava, and a surfaced head hide the row. The accessible name is `Воздух: N из 10` without `aria-live`.

Assets: `public/textures/gui/air_full.svg` and `air_bursting.svg`, 16×16, `crispEdges`, outline `#16334a`, shadow `#276b91`, base `#55b7df`, highlight `#d8f5ff`. Paths follow the hunger SVG `BASE_URL` pattern.

## Changed files

- `src/rendering/InvisibilityWorldParticles.ts`
- `src/rendering/player/PlayerVisual.ts`
- `src/ui/airHud.ts`
- `src/ui/GameUI.ts`
- `src/core/Game.ts`
- `src/style.css`
- `public/textures/gui/air_full.svg`
- `public/textures/gui/air_bursting.svg`
- `src/dev/PlayerQaHarness.ts`
- `src/dev/UiQaHarness.ts`
- `tests/invisibility-world-particles.test.ts`
- `tests/air-hud.test.ts`
- `tests/air-hud-dom.test.ts`
- `tests/survival-air.test.ts`
- `tests/remote-player-view.test.ts`
- `tests/remote-player-interpolation.test.ts`
- `package.json` / `package-lock.json` (`happy-dom` for the DOM test)
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`

## Architecture decisions

Client owns presentation. Server still owns invisibility and air. The first-person overlay and the world emitter stay separate so the camera does not get two swirl systems. Particles are a hint with depth test, not an outline, hitbox, or nameplate.

## Tests

Focused files:

- `tests/air-hud.test.ts` — 300, 299, 272, 270, 30, 2, 0, surfaced hide, clamp, NaN, Infinity.
- `tests/air-hud-dom.test.ts` — `.status-right`, hidden/shown, full and bursting sources, hunger kept, armor still independent.
- `tests/survival-air.test.ts` — 30 submerged ticks → 270, 300 ticks → 0, one surfaced tick → 4. Health stays 20 through the empty tank.
- `tests/invisibility-world-particles.test.ts` — pool, depth flags, opacity, volume, recycle, shared frames, dispose, first-person scene has the overlay and not the world group.
- Remote view activates and clears the emitter from the existing `invisible` pose. Interpolation still has no particle field.

Commands and counts are filled in after the verification run on this branch.

## Visual QA

DEV harnesses, not a second gameplay path:

- `?qaPlayer=1&invis=1&armor=none` — third-person front, no armor, world swirls.
- `?qaPlayer=1&invis=1&armor=none&wall=1` — solid wall between the front camera and the player.
- `?qaPlayer=1&invis=1&armor=none&camera=first` — screen overlay, world root hidden.
- `?qaUi=hud-full&air=300`, `&air=272`, `&air=2`, and a run with no `air` param.

Two live clients on a server were not opened in this pass.

## Performance

Seven sprites per player. No per-frame `THREE.Sprite`, no DOM particles, no timer, no network event. Twenty invisible remotes stay at 140 sprites and 8 shared maps.

## Known issues

The full vitest suite already fails on unrelated asset and tooling checks (missing SFX bytes, menu-icon Python). Those are outside this change.

`happy-dom` is a devDependency because the air DOM test builds a real `GameUI`. The production bundle does not import it.

## Deferred

No two-client online session. No change to drowning, potions, combat, or worldgen.

## Next work

Owner two-client check: drink invisibility, confirm the other client sees swirls, walk behind a solid wall, then surface and dive again to confirm the air row.

## Git

Branch `cursor/invisibility-particles-air-hud-5805`. Draft PR. Do not merge.
