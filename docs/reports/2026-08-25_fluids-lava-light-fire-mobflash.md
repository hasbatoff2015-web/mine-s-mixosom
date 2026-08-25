# Frozen generated lava, lighting flicker, Diamond /3, Fire damage, mob hurt flash

## Goal

Regression/fix pass on PR #6 after local QA: generated lava ledges that should flow, lighting flicker after lava starts moving, Diamond generation cut to ~1/3 of the current (post-increase) rate, ordinary Fire contact actually damaging the player, and a per-entity red hurt flash on successful mob hits.

## Result

Implemented. Draft PR #6 stays draft. `WORLD_LIGHT_BUDGET_MS` remains **2**. Basin pond generation (size, depth ≤ 3, irregular footprint, Stone cap) is unchanged.

## Exact Root Cause — Frozen Generated Lava

`placeLavaLakes` / `fillPondInChunk` writes source Lava into the chunk and **never** called `scheduleFluid`. That is correct for a fully enclosed basin (equilibrium, queue 0). It is wrong when a generated cell already has Air/replaceable beside or below: runtime only enqueued fluids from `applyBlockBatch(..., scheduleNeighbors)` (player edits). Worldgen lava with an open ledge stayed a cubic source until the player broke a neighbor.

Cross-chunk x=15/16 made this worse: `tryEnter` / `chunkLoaded` treat an unloaded neighbor as not-air, so even a later schedule of the lava cell would no-op until the neighbor existed, and nothing rechecked the shared face on neighbor generate.

## Lava Fix

`activateGeneratedFluidBoundaries` runs after `VoxelWorld.getChunk` generates a chunk:

- scan lava/water in the new chunk;
- `generatedFluidNeedsActivation` is true only if below or a **loaded** horizontal neighbor is replaceable (Air/Fire/replaceable non-solid) or the other liquid;
- also re-scan the four already-loaded neighbor faces that now touch this chunk.

Interior sources are not scheduled. Same `scheduleFluid` → `computeFluidUpdate` path as bucket lava. No second worldgen physics. Enclosed ponds stay idle; exposed ledges flow; shore-break still uses canonical neighbor updates.

## Exact Root Cause — Lighting Flicker

Two interacting bugs, not a too-small light budget:

1. **Abandoned sliced floods.** `addBlockLightEmitters` / `propagateBlockLight` always cleared `floodOwnerKey` after one `continueFlood` slice (`MAX_NODES_PER_SLICE = 768`). Remaining queue was dropped. Light arrays were left half-filled.

2. **Remesh of incomplete add-emitter work.** `processLighting` bumped `lightVersion` on every add-emitter slice. Combined with (1), meshes baked oscillating partial light. Region sky (`updateSkyInRegion`) also restarted from column 0 every slice (`MAX_COLUMNS_PER_SLICE = 96`), so a stone-break region (skyChanged + ~17² columns) **never completed**; `pendingLight` stayed forever. Meanwhile add-emitter remeshed every frame. Camera/chunk movement showed that churn as flicker. Raising `WORLD_LIGHT_BUDGET_MS` would only hide the restart.

Level-only lava source↔flowing (same BlockId, emission 15) still does not add/remove emitters.

## Lighting Fix

- Region sky resumes via `PendingLightJob.skyColumn`.
- Region block flood seeds once (`blockSeeded`) and `drainFlood` yields without clearing the owner.
- Add-emitter uses owner `add-emitter`, resumes, and **commits `lightVersion` only when the flood finishes**.
- In-progress region/add-emitter is continued before unlit chunk seeding so a chunk seed cannot `resetFlood` the job.
- `WORLD_LIGHT_BUDGET_MS` stays 2.

After settle: no emitter churn, stable `blockLightAt`, stable `lightVersion` while flying/turning.

## Fluid / Light Metrics

- Enclosed generated pond: only exposed boundary cells queued; interior idle.
- Synthetic enclosed basin: queue unchanged; open ledge schedules and flows.
- Cross-chunk 15/16: neighbor load activates west-face lava into east air.
- Shore break: flow, no source multiplication, then idle.
- Lighting job test: after lava settle, 30 frames of `processLighting(2)` + view-center wobble keep the same block-light sample and light versions.
- Streaming tests (`fluid-streaming`, lighting-scheduler fly) still pass at budget 2.

## Diamond

Same 20 `WORLDGEN_PINHOLE_SEEDS` × 5×5 chunks as the ore-increase sample.

| Ore | Baseline | After ×2 | This pass | vs ×2 current |
| --- | ---: | ---: | ---: | ---: |
| Coal | 28455 | ~2.00× | 56869 | unchanged |
| Iron | 23080 | ~2.00× | 46246 | unchanged |
| Gold | 7080 | ~1.99× | 14100 | unchanged |
| Redstone | 8482 | ~1.87× | 15888 | unchanged |
| Diamond | 2764 | **5035** | **1632** | **0.324×** |

Parameter: `{ minY: 3, maxY: 16, veins: 1, size: 4, extraVeinChance: 1/3 }` (was `veins: 4`). Y range and vein size unchanged. Coal/Iron/Gold/Redstone rules unchanged (diamond is last in `ORE_RULES`, extra rng does not shift other ores).

## Exact Root Cause — Ordinary Fire Damage

Contact fire already dealt **1 HP / 20 ticks** on the canonical `damage('fire')` path and already cleared `contactFire` on exit. Two layers hid it in real play:

1. `'fire'` / `'lava'` were **not** in `ARMOR_BYPASS_SOURCES`. Armor reduced 1 HP to 0 (`ignored`), so no health change and no hurt flash. Lava’s 4 HP still got through.
2. Full hunger + saturation heals **1 HP / 10 ticks**, faster than fire’s 1/20, so HUD sat at 20 even without armor.

Visual overlay used `isOnFire` (`contactFire || fireTicks || arrowFireTicks`) and looked correct.

## Fire vs Lava Damage

| Source | Contact | Cadence | After exit |
| --- | ---: | --- | --- |
| Ordinary Fire | 1 HP | every 20 ticks (1 HP/s) while AABB overlaps Fire | **immediate stop** (`contactFire` false; `fireTimer` resets if no other burn) |
| Lava | 4 HP | every 10 ticks, plus `ignite(300)` afterburn (shared 1 HP / 20 ticks while `fireTicks`) | **afterburn preserved** |
| Fire Arrow | — | timed `arrowFireTicks` | **preserved**; leaving Fire does not clear it |
| Water | — | — | still clears arrow + lava timers |

Fire and lava now bypass armor. Food regen is suppressed while `contactFire` or `inLava`. Tick-based (`FIXED_DT`), not FPS. Hurt flash/kick come from existing `SurvivalSystem.onDamage`.

## Mob Hurt Flash

- Trigger: `MobManager.damage` when `amount > 0` and source is not `'fire'` (player/projectile/explosion). Miss / 0 damage / fire DOT do not flash.
- Duration: `MOB_HURT_FLASH_SECONDS = 0.22` (same order as player flash). Decay uses `deltaSeconds` on the 20 TPS update.
- Tint: `applyMobHurtTint` multiply/overlay on per-entity `userData.entityLight` after `applySampledEntityLight`. Texture stays readable; not a solid red silhouette.
- Shared materials: `VoxelVisualFactory.texturedMaterial` is unchanged; `onBeforeRender` already copies per-object `uEntityLight`.
- Repeated hits restart `hurtFlashSeconds` to 0.22 (no intensity stack).
- Fire overlay: `syncFireOverlay` unchanged; burning + hit → short red tint → overlay remains.
- Death: flash may start; `beginDeath` / `removeMob` still runs on schedule; overlay geometry disposed; no extra materials per hit.
- Gameplay (HP formula, knockback, AI) unchanged aside from the existing `hurt` state.

## Tests

Targeted: lava boundary / shore / cross-chunk, diamond /3 vs 5035, lighting settle, fire vs lava vs arrow vs armor/hunger, mob flash (11–20 in the pass request).

Full `npm run check`: **56 files, 517 tests**, production 117 modules, 1.15 MiB / 180 files. `WORLD_LIGHT_BUDGET_MS = 2`.

## Manual QA

### A. GENERATED LAVA

- New world; find 3–5 lava ponds.
- Closed ponds stay still.
- Open edge / air below → lava flows.
- No frozen cubic ledge.

### B. BREAK SHORE

- Break 1–3 Stone; lava flows; no source explosion; idle after settle.

### C. LIGHTING

After flow: fly, turn, cross chunk, leave and return. Lighting must not flicker. Budget stays 2 ms.

### D. STREAMING

`?perf=1&chunks=1` Creative fly near lava during/after flow, then into new chunks. No persistent LIGHT/FLUID backlog, no multi-second holes.

### E. DIAMOND

Visibly rarer. Coal/Iron/Gold/Redstone unchanged.

### F. ORDINARY FIRE

Flint and Steel → stand in Fire → HP drops, less than Lava → leave → burn stops immediately.

### G. LAVA

Enter lava → stronger damage → leave → existing afterburn remains.

### H. MOB HURT FLASH

Hit hostile and passive: short red model. Neighbor same kind stays normal. Repeat hits restart flash. Burning mob keeps fire overlay after the tint.

## Architecture decisions

- Boundary activation is worldgen → canonical fluid queue, not a second solver.
- Lighting resume instead of budget increase.
- Diamond cut by attempts, not Y/size.
- Fire/lava stay distinct timers; only bypass armor + pause regen on contact.
- Mob flash is entity light, not material.color.

## Changed files

- `src/world/fluids.ts`, `src/world/World.ts`, `src/world/LightEngine.ts`, `src/world/Generator.ts`, `src/world/streamingScheduler.ts`
- `src/survival/SurvivalSystem.ts`, `src/entities/MobManager.ts`
- `src/core/Game.ts`, `src/debug/chunkStreamingRuntime.ts`
- tests + docs listed in Git.

## Known issues / Deferred

- WebGL visual approval of SCREEN 1/2 is the user’s local QA; this pass is logic + unit tests.
- Region block-light still scans the AABB on first seed (cheap vs restarting every slice).
- Multiplayer/network hurt protocol out of scope.

## Next work

User local QA freeze on this SHA. Do not merge main.

## Git

Branch `cursor/fluids-and-items-pass-935a`. Ordinary push. PR #6 remains draft.

- Implementation / HEAD: `d3955a0d090b75b6ede43268479ddea564d42164`
- Previous verified HEAD: `2edccb0`
- Working tree clean after push
- `main` not merged; no force push
