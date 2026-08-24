# Fire arrow, fire block visual, item icons

Date: 2026-08-24  
Branch: `cursor/fluids-and-items-pass-935a`  
Draft PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/6  
Base: `main`  
**main was not merged.** **No force push.** Code is frozen pending local visual QA.

## Goal

Keep the accepted fluid visual + streaming/chunk-loading fixes. Fix fire-arrow combat so it is a trigger projectile, not a world igniter. Make placed fire look Minecraft-like (6 planes, animated). Replace unreadable fire-arrow and flint-and-steel icons and held look.

## Result

Implemented on the existing fluids branch. Fire arrows no longer place `BlockId.Fire`. Fire uses a dedicated mesher layer. Icons/strip are generated fallbacks (pack `fire_layer_0` still wins when present as a taller-than-wide strip).

## Root cause

- Flaming arrow `onBlockHit` called `tryIgniteAt` on the block above the hit, so sand/grass/wood caught fire.
- Fire used plant `renderShape: 'cross'` (2 diagonals) and a 16×16 stub tile (atlas kept only the first square of any strip).
- Fallback `item/fire_arrow.png` was an orange blob; `item/flint_and_steel.png` was a diagonal smear.
- Mob fire damage shared `burnAccumulator` with sunlight burning, which reset every tick for non-undead, so fire-arrow burn damage often never applied. Water did not clear mob `fireTicks`.

## Implemented

### Fire arrow

- `flamingArrowBlockHit()`: TNT → prime, anything else → none.
- `Game` flaming `onBlockHit` only primes TNT. Flint-and-steel still places fire via `tryIgniteAt`.
- Hit living entity: existing projectile damage + `FIRE_ARROW_IGNITE_TICKS = 100` (5 s).
- Mob burn uses `fireDamageTimer` (1 HP/s), independent of sun `burnAccumulator`.
- Water extinguishes mobs. Player extinguish-in-water was already in `SurvivalSystem`.
- Burning mobs get a shared fire overlay; first-person shows a camera-space fire overlay while `survival.fireTicks > 0`.

### Fire block visual

- `renderShape: 'fire'`.
- `fireGeometry.ts`: 4 edge planes + 2 inner X, inward taper, height slightly over 1.
- Dedicated `MeshedChunk.fire` layer + glow material from `SharedFireTexture`.
- `block/fire.png` is an 8-frame 16×128 strip; UV `offset.y` animates at 0.1 s/frame without remeshing.
- Pack `fire_layer_0` (taller than wide) is kept if imported; square stubs are regenerated.

### Icons / held

- New 16×16 flint-and-steel: C-shaped steel + separate jagged flint.
- New 16×16 fire arrow: diagonal arrow silhouette + flame on the tip, not a blob.
- Both use `handheld` pose + existing `GeneratedItemGeometry` extrusion.

## Changed files

- `src/combat/fireArrow.ts`, `src/combat/PlayerArrowManager.ts`, `src/combat/index.ts`
- `src/core/Game.ts`
- `src/entities/MobManager.ts`
- `src/blocks/types.ts`, `src/blocks/registry.ts`
- `src/rendering/fireGeometry.ts`, `src/rendering/fireTexture.ts`
- `src/rendering/ChunkMesher.ts`, `src/rendering/WorldRenderer.ts`
- `src/rendering/specialBlockGeometry.ts`, `src/rendering/FirstPersonRenderer.ts`
- `src/items/itemRenderProfiles.ts`
- `scripts/generate-missing-textures.mjs`
- `public/textures/block/fire.png`, `public/textures/item/fire_arrow.png`, `public/textures/item/flint_and_steel.png`
- Tests, dispose helpers, docs

## Architecture decisions

- Fire is a new `renderShape` and mesher layer, not a second mesher. Animation is texture offset, not remesh.
- Combat rule lives in `fireArrow.ts` so Game/flint stay separate: flint places fire, arrows do not.
- Shared fire texture/material for world fire, mob overlay, and FP overlay (one strip, one animation clock).

## Tests

`npm run check` green: typecheck, **429 tests / 50 files**, production build 106 modules, **1.12 MiB / 180 files**.

`tests/fire-arrow-and-fire.test.ts`: TNT-only block hit, ignite + periodic damage + water extinguish, 6-plane fire mesh, assets present, handheld models.

## Visual QA

This cloud environment cannot honestly screenshot WebGL. Local checklist:

- Fire arrow vs mob: damage, 5 s burn, periodic HP loss, extinguish in water, visible overlay.
- Fire arrow vs TNT: primes. vs sand/grass/wood: no fire block.
- Flint-and-steel fire: 6-plane animated flames, not a plant sprite.
- Hotbar + first-person: fire arrow reads as an arrow; flint reads as C + stone.
- Fluids and chunk streaming unchanged.

## Performance

- Fire is rare; 6 quads per cell, one extra geometry layer only when the chunk has fire.
- Animation is a uniform UV offset on a shared texture.

## Known issues / Deferred

- No fire spread, no smoke particles, not full vanilla fire (soul fire, campfire, etc.).
- Regular (non-flaming) arrows no longer prime TNT (vanilla-like; previously any arrow did).
- Entity fire overlay is simplified 6-plane, not a full vanilla entity-fire model.

## Next work

Local visual QA on this draft PR. Do not merge `main`.

## Git

Branch: `cursor/fluids-and-items-pass-935a`  
Draft PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/6  
**main was not merged.** **No force push.** Code is frozen pending local visual QA.
