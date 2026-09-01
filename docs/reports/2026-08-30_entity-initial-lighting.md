# 2026-08-30 — Initial entity lighting (Online Anarchy)

## Goal

Join-time / restored Anarchy mobs must receive current world light on the client visual without requiring a hurt flash. Dynamic spawns must stay correct. Do not rewrite LightEngine. Do not raise `WORLD_LIGHT_BUDGET_MS`.

## Exact root cause

Online client skips `MobManager.update()` (`shouldRunClientWorldSimulation` is false). Light was applied:

1. Once in `spawn()` via `applyMobLight`.
2. Again only if `hurtFlashSeconds > 0` (`syncVisual` / `tickRemoteVisuals`).

Join order: `entity_snapshot` often arrives before the chunk is generated or before deferred `processLighting` fills `skyLight` / `blockLight`. `getSkyLight` / `getBlockLight` on a missing or unready deferred chunk return **0**. That dark RGB was stored on `userData.entityLight` and never refreshed.

Hitting the mob set `hurtFlashSeconds` → the next visual pass sampled the **now-lit** chunk → lighting “fixed”. Mobs spawned after streaming already sampled a lit world, so they looked correct.

This existed before Phase 6. LightEngine flood was not the bug.

## Initial vs dynamic

| Path | First `applyMobLight` | Later refresh before this fix |
|---|---|---|
| Join / restore snapshot | Unlit / missing chunk → dark | Only hurt |
| Dynamic spawn after streaming | Lit chunk → correct | Only hurt (stayed correct) |
| Singleplayer `update()` | After world is playing | Every 20 TPS tick |

## Lighting fix

`syncVisual` always calls `applyMobLight` at the **displayed pose**. Same contract on drop / falling / arrow / primed-TNT interpolate. Hurt still tints via `applyMobHurtLight`; it is no longer the initializer.

`HeadlessEntityHost.applyLight` remains a no-op. No Three.js on the server.

### 2026-09-01 finalize

PR #30 mob/drop/falling/arrow/TNT paths were already correct. `MinecartManager.interpolateVisuals` still only set pose, so join-time carts could stay dark until a later `update()` (which online never runs). Interpolate now calls `applyLight` at the displayed pose. Tests added: two-mob isolation, minecart interpolate, skeleton snapshot restore.

## LightEngine

Unchanged. No flood, sky, block-light, or scheduler edits.

## Budget

`WORLD_LIGHT_BUDGET_MS` remains **2**.

## Tests

`tests/entity-initial-lighting.test.ts`:

1. Join-time spawn on deferred unlit surface is dark; after `recomputeChunkSky` + `interpolateVisuals`, light is correct and `hurtFlashSeconds === 0`.
2. Dynamic spawn after lighting is correct immediately.
3. Light is already correct **before** `applyAuthoritativeHurt`.
4. Day vs night compose without hurt.
5. `applyEntitySnapshots` + `applyInterpolatedEntityVisuals` path.
6. Dropped-item visual sync without a sim tick.
7. Two join-time mobs: both lit after interpolate; hurt A does not change B.
8. Join-time minecart interpolate without `update()`.
9. Skeleton `entity_snapshot` restore without hurt.

Targeted with hurt-flash / entity-lighting / entity-host / death-animation / lighting-adapter: **48/48** in 7 files (includes 10 `entity-initial-lighting`). Interpolation / Anarchy / lighting packs **188/188**. `tsc` clean. Production Vite build PASS.

## Visual QA (owner)

A11: daytime join, nighttime join, hit already-lit mob, later spawn, fly between chunks, two clients.

## Next work

Phase 7 tooling split on a **separate** branch from this HEAD. **Do not merge main. Do not start Phase 8.**

## Git

- PR **#30** `cursor/entity-initial-light-fix-bbb1` from Phase 6 `2e21bf3`. Keep open.
- Finalize branch `cursor/entity-initial-light-finalize-37a2` from `068b7df`. **Do not merge main. Do not start Phase 7.**
