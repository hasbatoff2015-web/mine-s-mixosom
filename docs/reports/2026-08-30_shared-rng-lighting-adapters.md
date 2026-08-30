# 2026-08-30 — Phase 6 RNG + lighting adapters

## Goal

Make simulation RNG runtime-independent (browser / Node / tests) and separate lighting **simulation/state** from **client rendering/deferred work**. Architecture/refactor only. Do not rewrite `LightEngine`. Do not change intended lighting behavior. Do not raise `WORLD_LIGHT_BUDGET_MS`. No new gameplay features.

## Result

```text
Simulation RNG          Visual RNG
─────────────────       ─────────────────
RandomSource.next()     Math.random()
  SYSTEM_RANDOM           particles
  seeded (tests)          audio pitch
  Game.simRandom          world id / seed
  ServerGameplay.random

Lighting mode (host)    Lighting flood
─────────────────       ─────────────────
deferred = Game         LightEngine (unchanged)
immediate = server      WORLD_LIGHT_BUDGET_MS = 2
processDeferredLighting LATERAL_SKY_RADIUS = 14
  no-op if immediate
```

## Audit (call paths)

### Simulation RNG that used `Math.random`

| Site | What | After |
|---|---|---|
| `Game` block drops / scatter | drop count, item pop velocity | `rollDropCount` / `dropScatterVelocity(simRandom)` |
| `ServerGameplay` scatter / drops | same | `this.random` (`systemRandomFn`) |
| `MobManager` | spawn, AI wander, loot, skeleton arrows, embedded release, knockback | `options.random ?? systemRandomFn` |
| `PlayerArrowManager` | spread, embedded release | same |
| `Explosion.resolveExplosion` | blast skip, chained TNT fuse | `options.random ?? systemRandomFn` |
| `CombatSystem.applyKnockback` | knockback resistance roll | `options.random ?? systemRandomFn` |
| `ArrowPhysics.inaccurateArrowDirection` | gaussian spread | default `systemRandomFn` |

Fluids and minecarts had **no** `Math.random`. Melee crits stay deterministic (fall/ground), not a random roll.

### Already seeded (left alone)

`TerrainGenerator` ores/trees/plants/caves use `mulberry32` / `hashCoords` / `random01` in `world/noise.ts`. Coordinate-hashed worldgen is not the tick `RandomSource` stream. Mixing them would change Anarchy terrain.

### Visual / identity (still `Math.random`)

- `src/rendering/potionParticles.ts` — cosmetic sprites
- `src/core/AudioManager.ts` — SFX variant and pitch
- `src/save/SaveService.ts` — world id (`crypto.randomUUID` / `Math.random`) and default seed string

### Lighting

- `VoxelWorld.deferredLighting`: **true** on client `Game`, **false** on `ServerGameplay`.
- Client `Game.runLightingJobs` drained `world.processLighting(budgetMs, …)` with `WORLD_LIGHT_BUDGET_MS = 2`.
- Server never called `processLighting`; mutations `relightAround` immediately.
- `LightEngine.ts` has no rendering imports. Shader compose is `rendering/worldLighting.ts`.
- `combinedLight` / `getDirectSkyLight` used by mobs/fire (simulation queries).
- Lateral sky (`LATERAL_SKY_RADIUS = 14`) and flood internals unchanged.

## Implemented

- `src/gameplay/random.ts`: `RandomSource`, `SYSTEM_RANDOM`, `systemRandomFn`, `seededRandomSource` / `seededRandomFn`, drop helpers. Re-exported from `src/gameplay/index.ts`.
- Hosts inject `systemRandomFn` into managers and explosion queue.
- `src/world/LightingAdapter.ts`: `LightingMode`, `lightingModeOf`, `processDeferredLighting`.
- `src/world/lightingState.ts`: simulation light queries + adapter re-exports.
- `Game.runLightingJobs` → `processDeferredLighting`. Perf path still `world.flushLighting()`.
- Mob/fire/shader sample imports go through `lightingState.ts`.

**Not done:** live world-seeded RNG (would change Anarchy spawn). Second LightEngine. Budget increase. GameplayKernel RNG field (kernel does not roll dice).

## Changed files

See git diff. New: `src/gameplay/random.ts`, `src/world/LightingAdapter.ts`, `src/world/lightingState.ts`, `tests/random-source.test.ts`, `tests/lighting-adapter.test.ts`. Wiring: `Game.ts`, `server/gameplay.ts`, MobManager, PlayerArrowManager, ArrowPhysics, CombatSystem, Explosion, fireSources, worldLighting.

## Architecture decisions

1. Default adapter wraps `Math.random` so live sequences stay the same. Tests inject `seededRandomFn`.
2. Lighting adapter is a **mode + scheduler gate**, not a second flood engine.
3. Immediate worlds must not run the client budgeted scheduler (`processDeferredLighting` returns 0).
4. Do not raise `WORLD_LIGHT_BUDGET_MS`. Playing stays 2 ms, loading 8 ms.

## Tests

- `tests/random-source.test.ts` — seed determinism, `rollDropCount`, scatter envelope, explosion injected RNG, `systemRandomFn` unit interval.
- `tests/lighting-adapter.test.ts` — budget still 2, immediate vs deferred, no-op on immediate, deferred still uses existing `processLighting`.

## Visual QA

Not a visual feature. Owner should confirm SP/Anarchy lighting (torch, sky, fluids) looks the same and spawn/loot is not obviously reseeded.

## Performance

No extra per-tick work. Adapter is a boolean + function call. Playing light budget still 2 ms.

## Known issues

Same full-check baseline as PR #27: authored ENOENT `bucket_empty.png` and minecart 5s timeouts. Not from this pass.

## Deferred

- World-seeded live simulation RNG (explicit product decision).
- Moving LightEngine internals.
- Phase 7.

## Next work

Owner local QA of this PR on top of #27. **Do not merge main. Do not start Phase 7.**

## Git

Branch `cursor/shared-rng-lighting-adapters-bbb1` from chest-sync `a8c9579`. Draft PR stacked on **#27**, not `origin/main`.
