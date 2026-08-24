# Fire contact, sunlight burning, 3D minecart

Date: 2026-08-24  
Branch: `cursor/fluids-and-items-pass-935a`  
Draft PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/6  
Base: `main`  
**main was not merged.** **No force push.** Code is frozen pending local visual QA.

## Goal

Keep accepted Water/Lava, fluid surfaces, streaming, Fire Arrow (no terrain fire) and fire-block visual. Add fire-contact damage, hostile daylight burning, rail look-axis orientation, a real 3D minecart with rail-constrained W/S + push, TNT-in-cart, and the 5-ingot U recipe.

## Result

Implemented on the existing fluids branch. Fire contact and sunlight are separate burn causes from Fire Arrow. Minecarts are 3D rail vehicles, not item billboards. TNT carts reuse the same movement and the canonical TNT explosion queue.

## Implemented

### Fire Contact

- Detection: entity body AABB vs any `BlockId.Fire` cell (`aabbOverlapsBlockType` / `PlayerController.overlapsBlock`). Not feet-only.
- Damage: 1 HP per 20 simulation ticks (`FIRE_DAMAGE_INTERVAL_TICKS`), canonical survival/mob damage. Not per render frame.
- Leave Fire → `FIRE_CONTACT` ends immediately. Fire Arrow keeps its own `arrowFireTicks` / mob `fireTicks` (~100 ticks / 5 s).
- Water clears Fire Arrow and sunlight/lava linger. Contact is absent unless the AABB still overlaps Fire.

### Sunlight

- Continuous rule: `daylightFactor ≥ 0.82` and raw skylight ≥ 14.
- Applies to **all hostile** mobs via `isHostileMob` (disposition), not a vanilla undead whitelist. This is an intentional product simplification: creeper and spider burn in open daylight too.
- Player and passive mobs are exempt.
- Roof/cave/tree (low skylight), water, and night (`daylight` 0.2) do not ignite.
- Overlay: existing shared fire overlay; `mob.isOnFire` is contact ∪ arrow ∪ sunlight.

### Rails

- Isolated placement uses `isolatedRailShapeFromYaw` (look axis: N/S → `north_south`, E/W → `east_west`), then `refreshRailsAround` / `resolveRailShape` for autoconnect.
- Visual: EW family gets `railTextureYaw = π/2`. Topology (NS, EW, curves, ascending) is unchanged; only the strip UVs/mesh yaw of the EW family was rotated 90° so logical EW matches what you see.

### Minecart Visual

- `minecartGeometry.ts`: open-top boxes — four thick walls, floor, inner darker lining, wheels. Exterior `entity/minecart`. Inner/floor solid gray (`0x3d3d44` / `0x4a4a52`).
- Size ≈ 0.98 × 0.98 × 0.62. Snaps to rail sample height. Item icon stays 2D; placed entity is 3D (`isMinecartEntityVisual`).

### Riding

- Use on a normal cart mounts; sneak dismounts to a clear neighbor (not inside a block / the cart / under the rail).
- W/S: look projected onto rail tangent. Accel ~0.5 s to `WALK_SPEED`. Release coasts (`0.965`/tick). S brakes then reverses. A/D ignored (no derail).
- Downhill adds, uphill subtracts slope gravity; W can still climb a 1-block ascending rail.
- Simulation 20 TPS; render interpolates like other entities.
- Riding player position snaps after cart update so chunk streaming follows the cart. Unloaded next chunk pauses the cart.

### Push

- Player AABB overlap → `dot(playerVelocity, railTangent)` only. Sideways cannot derail. One-way (cart does not shove the player).

### TNT Cart

- Use TNT on a normal cart → variant `tnt`, consumes 1 in Survival. Same movement. Not rideable.
- TNT cube sits in the basin and sticks above the rim (`block/tnt`).
- Flint and Steel: 80-tick fuse, cart keeps rolling, then canonical explosion power/radius 4.
- Fire Arrow hit: immediate explode. Ordinary arrow: no explode. Ordinary ground: still no fire.

### Craft

- Shaped 5× Iron Ingot U: `I I` / `III` (matches top or bottom of a 3×3). Output 1 Minecart. Recipe Book reads `CRAFTING_RECIPES`.

## Changed files

- `src/combat/fireSources.ts`, `src/combat/PlayerArrowManager.ts`, `src/combat/index.ts`
- `src/survival/SurvivalSystem.ts`, `src/player/PlayerController.ts`
- `src/entities/MobManager.ts`, `src/entities/MinecartManager.ts`, `src/entities/railPath.ts`, `src/entities/index.ts`
- `src/rendering/minecartGeometry.ts`, `src/rendering/ChunkMesher.ts`, `src/rendering/specialBlockGeometry.ts`
- `src/core/Game.ts`
- `tests/fire-contact-sunlight-minecart.test.ts`, `tests/crafting.test.ts`
- Docs: `PROJECT_STATE.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `TESTING.md`, this report

## Architecture decisions

- Burn causes are flags/timers, not one shared duration that would make contact linger like an arrow.
- Rail motion samples only the current cell and its immediate neighbor. No network pathfinding.
- TNT cart is a variant on the same entity, not a second physics class.
- Explosion events go through the existing `ExplosionQueue` with the same TNT power/radius as primed TNT blocks.

## Tests

`npm run check` green: typecheck, **453 tests / 51 files**, production build 109 modules, **1.13 MiB / 180 files**.

`tests/fire-contact-sunlight-minecart.test.ts`: 24 tests covering fire AABB, independent Fire Arrow timer, hostile daylight (all hostiles; shade/water/night/passive/player exempt), rail look-axis + EW visual yaw, 3D cart, W/S/cap/coast/reverse, A/D no derail, push projection, curve/slope/chunk-border, TNT insert/fuse/explode, U-recipe + Recipe Book.

## Visual QA

This cloud environment cannot honestly screenshot WebGL. Local checklist:

- Daytime hostile burn; shade/water/night protection; player/passive exempt
- Stand in Fire; leave Fire (contact stops; Fire Arrow still burns ~5 s)
- Isolated rail follows look; NS/EW/curve/ascending still connect
- Placed minecart is a 3D tub, not a billboard; TNT sits inside
- Ride W/S, curves, slopes, chunk border; push along rail not sideways
- Flint fuse ~4 s; Fire Arrow detonates TNT cart; recipe U of 5 ingots
- Fluids and chunk streaming unchanged

## Performance

- Fire overlap is a small AABB cell scan. Sunlight is one skylight sample per mob.
- Minecart steps at most a few neighbor rails per tick.

## Known issues / Deferred

- Periodic fire/sunlight DOT does not apply hurt-stun, so creeper fuse still runs in daylight (intentional).
- No powered rails, no cart-cart coupling, no mob riding carts (not a blocker).
- A/D junctions not implemented.
- Sunlight uses column skylight, not a tall raycast (intentional).
- TNT-cart explosion has no vanilla speed bonus.

## Next work

Local visual QA on this draft PR. Do not merge `main`.

## Git

Branch: `cursor/fluids-and-items-pass-935a`  
Draft PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/6  
**main was not merged.** **No force push.** Code is frozen pending local visual QA.
