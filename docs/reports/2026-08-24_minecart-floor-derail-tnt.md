# Minecart floor, derail, Shift dismount, TNT ignition and primed texture

Date: 2026-08-24  
Branch: `cursor/fluids-and-items-pass-935a`  
Draft PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/6  
Base: `main`  
**main was not merged.** **No force push.** Code is frozen pending local visual QA.

Previous accepted HEAD: `67901c2416ca2c5f20a06f64912a236cd45136cd`.

## Goal

Keep accepted fluids, streaming, fire, sunlight, 3D cart and TNT-cart explosion animation. Fix: rail visible through cart floor; carts glued to the last rail; Shift not dismounting; Fire Arrow / Flint TNT-cart ignition; ordinary primed TNT turning into a red cube.

## Result

Focused corrections on the same draft PR. ON_RAIL / OFF_RAIL movement, opaque inner floor, Shift edge dismount, entity-first flint, taller cart hit AABB + arrow slop, primed TNT keeps `block/tnt` during fuse flash.

## Minecart Floor

**Root cause:** the inner floor sat at local `y ≈ 0.09` while the rail strip is `2/16 = 0.125`, so the rail poked through the basin. The floor was also a narrow inner slab.

**Fix:** full-width opaque floor named `minecart-floor`, `MINECART_FLOOR_TOP = 0.16` (above the rail), thickness `0.12`, `DoubleSide`, `transparent: false`, `depthWrite: true`. Walls start at floor top. Open top unchanged. TNT cargo sits on the floor (`FLOOR_TOP + seat + size/2`), not through it.

## Derail

**End of rail:** `nextRail` returns nothing and the next cell’s chunk is **loaded** → `leaveRail`. Unloaded next chunk still pauses (no void driving).

**Velocity:** `worldVel = endTangent * alongSpeed`, plus a ≥ `0.08` push past the end. `alongSpeed` cleared; `rail` cleared; 4-tick recapture grace so the last cell does not immediately glue the cart back.

**OFF_RAIL:** `GRAVITY` + `moveVoxelBody` (no terrain pass-through), ground friction `0.78`/tick, air drag `0.995`. W/S/A/D are not applied (`forward` only while `cart.rail` is set; Game also gates steering on `isOnRail`). Rider can stay seated; camera/streaming still snap to the cart. Crossing a real rail cell after grace snaps to the centerline and projects world velocity onto the tangent.

## Dismount

**Why Shift failed:** riding checked `movement().sneak` (`KeyC`). Desktop sprint/Shift is `ShiftLeft`/`ShiftRight`.

**Now:** rising edge of `movement().sprint` via `minecartDismountFromSprint`. Hold does not repeat. Mount latches held so a Shift already down does not instant-dismount. `findDismountPosition` tries 8 neighbors × lift 0/1, skips the cart AABB and blocked cells, on- and off-rail.

## TNT Cart Fire Arrow

**Why it missed:** cart AABB height was `0.62` (rim only), so the TNT cube above the rim was not hittable; the rail voxel (non-solid) often won the world raycast and the arrow never called `onMinecartHit`.

**Now:** hit height `1.15`; arrows prefer a cart within `0.5` blocks of a closer block hit. `onMinecartHit` + flaming + `variant === 'tnt'` → `explodeNow` (immediate, including already primed). Ordinary arrows do not explode.

## Flint TNT Cart

**Why Fire appeared:** flint used the **voxel** hit (rail/neighbor face) and `tryIgniteAt` placed Fire when `primeTnt` was skipped or the cart was not resolved.

**Now:** `handleFlintUse` raycasts the cart first. `resolveFlintAndSteelUse` returns `prime-cart` / `already-primed` and Game **returns** without block-use. Already primed: handled, no fuse reset, no Fire, no extra explosion. Successful prime wears flint once (Survival). Fuse still 80 ticks; cart keeps moving; cargo pulse animation unchanged.

## TNT Visual

**Why the red cube:** `createTntVisual` used `createEntityMaterial({ color: 0xc33b2e })` with no map. Fuse scaled that untextured mesh.

**Now:** cloned materials with `block/tnt` map and white color. Fuse keeps the map and pulses `material.color` white ↔ `0xffe7b0` plus existing scale/rotate. TNT minecart cargo pulse is unchanged.

## Tests

`npm run check`: PASS.

- tsc `--noEmit`: PASS
- Vitest: **51 files, 464 tests, 464 passed**
- production build: 109 modules, 1.13 MiB / 180 files
- `check:size` / `check:archive`: PASS

New coverage: opaque floor geometry, 10-rail derail + momentum, gravity, ground friction, no W/A/S/D off-rail, recapture, off-rail save, Shift edge + blocked-side dismount, Flint entity-first (no Fire, durability once, idempotent), Fire Arrow vs ordinary arrow through `PlayerArrowManager` (including primed cart), primed TNT `block/tnt` map through fuse tint.

## Manual QA

Not claimed (no WebGL acceptance in this environment). Local checklist:

1. Look inside a placed minecart — rail not visible through the floor.
2. Ride a rail.
3. Finish the track at speed.
4. Cart continues by inertia (OFF_RAIL).
5. After derail, W/A/S/D do not steer.
6. Ground friction slows the cart.
7. Shift dismounts on-rail and off-rail.
8. TNT + Use — cargo visible in the basin.
9. Flint + Use on TNT cart — no Fire block.
10. Fuse starts immediately; ~4 s explosion.
11. Fire Arrow → immediate explosion.
12. Ordinary Arrow → no explosion.
13. Prime ordinary TNT — texture remains through fuse, flash/tint ok, then explosion.

## Changed files

- `src/rendering/minecartGeometry.ts`
- `src/entities/MinecartManager.ts`
- `src/combat/PlayerArrowManager.ts`
- `src/core/Game.ts`
- `src/redstone/RedstoneSystem.ts`
- `tests/fire-contact-sunlight-minecart.test.ts`
- `tests/redstone.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/ROADMAP.md`, this report

## Architecture decisions

- Off-rail is the same entity with `rail === undefined`, not a second vehicle type.
- Recapture is overlap-only (current cell), not a magnet.
- Flint routing is a small pure function so entity success cannot fall through to Fire.
- Primed TNT fuse polish tints color; the map stays assigned.

## Deferred

- Vanilla minecart powered rails / cart-cart coupling.
- Per-face primed TNT UV (top/bottom/side) — single `block/tnt` tile is enough to stay textured.
- Touch dismount control (desktop Shift is the required binding).

## Git

Branch `cursor/fluids-and-items-pass-935a`, draft PR #6, ordinary push, no merge of `main`.
