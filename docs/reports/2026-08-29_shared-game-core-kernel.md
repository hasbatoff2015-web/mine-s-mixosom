# 2026-08-29 — GameplayKernel (Phase 1)

## Goal

Extract a shared simulation **orchestration** layer so singleplayer and the Anarchy server tick the same system order, without rewriting mechanics or changing intended gameplay.

## Result

`Game` (singleplayer) and `WorldInstance`/`ServerGameplay` both call `tickGameplayKernel`. Managers are unchanged. Protocol, save schema, EntityHost, and geometry extraction were not touched.

Browser QA was **not** performed here.

## Current Tick Before

### Singleplayer `Game.tick`

1. `world.tick` (time, scheduled, fluids, support, furnaces)
2. `processDetachedBlocks`
3. falling spawn + `falling.update`
4. combat held ids + `player.tick` + `survival.tick` (abort on death)
5. `updateTargetAndActions` / food use
6. `arrows.tick` + collect
7. minecarts push/update/riding + prune + cart explosions enqueue
8. `mobs.update` + consume events
9. `processExplosionQueue` (mid) + abort if dead
10. extra `processSupportIntegrity` + detached
11. `drops.update`
12. pressure plates + `redstone.update` + enqueue TNT + `processExplosionQueue` (again)
13. autosave / HUD

Online client: `tickOnline` only (no world sim) — unchanged.

### Server `WorldInstance.tick` then `ServerGameplay.tick`

1. **Before world:** per-player `PlayerController.tick`, combat, survival, mining, use hold, move events
2. `world.tick`
3. falling spawn/update + detached
4. `arrows.tick` + collect + minecart push/update + cart explosions enqueue
5. `mobs.update` + consume drops/damage/explosions (enqueue only)
6. `drops.update` + collect
7. redstone plates + `redstone.update`
8. `processExplosions` once
9. `updateRiding` + network flush

## GameplayKernel

`src/gameplay/GameplayKernel.ts` sequences host hooks:

```text
world → falling → players → playerActions → projectiles → vehicles
→ mobs → mobEvents → preDropSupport → drops → redstone → explosions
```

No physics/fluid/combat reimplementation. Abort (`'abort'`) preserves SP death skipping later systems.

## Shared

- Order (one function)
- `daylightFactor` (`src/gameplay/daylight.ts`)
- Existing managers still imported by both hosts (`VoxelWorld`, `PlayerController`, `MobManager`, …)

## Hosts

- **Game:** callbacks wrap the previous SP methods; audio/HUD/FP stay in the host. `updateRedstone` no longer drains explosions (kernel `explosions` step does, matching the old second pass).
- **WorldInstance:** `tickConnectedPlayers` is the kernel `players` hook (physics + mining/use). Network/persist stay after the kernel. `updateRiding` still after the kernel.

## Daylight

One sine curve. Game sky, Game/Server `mobs.update({ daylight })`, and MobManager fallback all use it. Regression: `tests/gameplay-kernel.test.ts` compares SP/server exports and `SUNLIGHT_DAYLIGHT_MIN`.

## Double Tick Safety

`VoxelWorld.tick` is only in the `world` hook. Fluids live inside that tick, not a second kernel step. Anarchy test: `world.tickNumber` +1 per `WorldInstance.tick`. Recording host test: each step once per kernel call.

## Tests

Before: Anarchy gameplay 18 tests (PR #17). After: kernel 6 + anarchy 19 (including once-per-tick world) + physics/combat/fluids/worldgen pack 122/122 in the focused set.

`tsc --noEmit` clean. Production build/size/archive PASS 3.63 MiB / 221 files. Full `npm run check` **1063 passed / 7 failed** (authored ENOENT `bucket_empty.png` + minecart 5s timeouts, same pre-existing class as PR #17) + 1 vitest RPC timeout.

## Performance

Kernel is a straight-line function. Trace array is caller-owned and reused; production omits it. No extra entity scans.

## Remaining Duplication

- `useHeld` vs `useTargetOrItem` (Phase 2)
- Entity managers still construct Three.js meshes (Phase 4)
- `specialBlockGeometry` still under rendering (Phase 3)
- Persistence envelopes (Phase 5)
- SP vs server explosion **timing** still host-specific: SP drains the queue in `mobEvents` and again in `explosions`; server only in `explosions`. `preDropSupport` is SP-only. Intentionally preserved.

## Next work

Phase 2: unify interaction (`useHeld` / placement). Do not start it in this PR.

## Git

- Branch: `cursor/shared-game-core-kernel-bbb1` from PR #17 `bdab232`, **not** `origin/main`.
- HEAD: `f2a1b72`
- Draft PR stacked on `cursor/online-blockstates-fluid-render-respawn-bbb1`.
- Status: pushed for owner local QA. Do not merge main.
