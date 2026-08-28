# 2026-08-28 Glowstone / Lantern / Chain

## Goal

Add Glowstone, Lantern and Chain as first-class blocks/items on current `origin/main`, using vanilla Java light levels (15 / 15 / torch 14), existing lighting/placement/selection systems, and custom recipes. No parallel block or lighting stack.

## Result

Implemented on branch `cursor/glowstone-lantern-chain` from `73a78f4`. Glowstone is a solid emitting cube. Lantern is a Minecraft-style 3D cutout with standing and hanging states. Chain is a thin vertical hanger that lanterns can attach under. Lighting, streaming, fluids, minecart, HUD, chat and menu paths were not rewritten.

## Implemented

- Registry IDs 146–148, Creative items, RU display names, drops of the same item.
- Light: Glowstone 15, Lantern 15, Torch 14 via `BlockDefinition.emission` and existing LightEngine.
- Lantern standing (`floor`) on a top face; hanging (`ceiling`) on a bottom face or under a chain.
- Chain vertical only; stores `attachment` so a hanging column is not self-supporting from below.
- Canonical `World.raycast` selection AABBs smaller than 1×1×1 for lantern/chain.
- Recipes: shapeless Torch+Gold Ingot → Glowstone; shapeless Torch+Iron Ingot → Lantern; shaped `ISI×3` → 16 Chain.
- 3D `special_model` held/GUI for lantern and chain; glowstone uses the cube icon path.

## Changed files

- `src/blocks/types.ts`, `src/blocks/registry.ts`, `src/blocks/placement.ts`
- `src/world/placement.ts`, `src/world/collision.ts`
- `src/rendering/specialBlockGeometry.ts`, `src/rendering/ChunkMesher.ts`, `src/rendering/ItemVisualFactory.ts`
- `src/items/itemRenderProfiles.ts`
- `src/crafting/recipes.ts`, `src/i18n/ru.ts`, `src/core/Game.ts`
- `scripts/import-assets.mjs`, `scripts/generate-missing-textures.mjs`
- `public/textures/block/glowstone.png`, `lantern.png`, `chain.png`
- `tests/glowstone-lantern-chain.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`

## Architecture decisions

- New `renderShape` values `lantern` and `chain` on the existing mesher/selection/held-item switches. No second block pipeline.
- Hanging support uses `canSupportHanger` (sturdy cube/slab/stair face **or** another chain/lantern). Chain attachment mirrors lantern so breaking the ceiling cascades through the existing 256-budget neighbor queue.
- Lantern mesh is cuboids (cage, inner glow, cap) plus crossed hanger/chain planes. Chain mesh is two vanilla-style 3/16 vertical planes.
- Light budget unchanged. Emitters go through add-emitter / region relight already used by torch/lava.

## Assets

`public/textures/block/stone.png` and `gold_ore.png` are byte-identical to Faithful 32x Java 1.12.2. Glowstone was taken from that same pack (`assets/minecraft/textures/blocks/glowstone.png` → 32×32), not generated.

| Runtime | Source |
| --- | --- |
| `block/glowstone.png` | Faithful 32x 1.12.2 `blocks/glowstone.png` |
| `block/lantern.png` | Faithful 32x 1.16.5 `block/lantern.png` (32×96 animation strip; atlas uses the first 32×32 frame) |
| `block/chain.png` | Faithful 32x 1.16.5 `block/chain.png` |
| `item/lantern.png` | Faithful 32x 1.16.5 item sprite — inventory/hotbar |
| `item/chain.png` | Faithful 32x 1.16.5 item sprite — inventory/hotbar |

Lantern/chain empty inventory slots were caused by `geometryFromLocalBoxes` stretching the UV-atlas PNG across cuboids (mostly transparent). GUI now uses the authored item sprites. Held/dropped `special_model` samples the same atlas rectangles as `ChunkMesher`.

Import also tries 1.13+ `block/` and `item/` paths so a local `npm run assets:import` overwrites these from the user's pack when present. Generate-missing no longer paints glowstone/lantern/chain.

## Light levels

- **Glowstone = 15**
- **Lantern = 15**
- **Torch = 14**

## Recipes

- Glowstone: shapeless `torch + gold_ingot` → 1
- Lantern: shapeless `torch + iron_ingot` → 1
- Chain: shaped

```
I S I
I S I
I S I
```

→ **16** Chain (`I` = iron ingot, `S` = stick)

## Lantern / chain placement

- Standing lantern: click top face of a sturdy block (or chain).
- Hanging lantern: click bottom face of a sturdy block or chain.
- Chain: vertical hit only. Bottom face continues the column down (`ceiling`). Top face stands on the support (`floor`).
- Side faces rejected. Air without a hanger/sturdy face rejected. Existing torch/button/ladder support rules unchanged.

## Tests

`tests/glowstone-lantern-chain.test.ts`: registry, recipes (including 16 chains), light 15/15/14, place/break light, chunk border x=15/16, standing/hanging lantern, chain-under-chain, lantern-under-chain, support cascade, thin selection/collision, drops, save/load, cutout mesh.

Retained: fluids, lighting-torch, minecart, potion/armor HUD, chat, menu tests are unmodified.

## `npm run check`

- TypeScript: PASS
- Vitest: **898 passed / 2 failed / 900**. Failures are pre-existing `authored-item-assets.test.mjs` (no local `assets/` pack).
- Vite build: PASS (141 modules)
- Size/archive: PASS, **3.59 MiB / 219 files**

## Visual QA

Not run in this Cloud environment (no interactive GPU play session). Local QA requested by the user after push.

## Performance

No per-frame world scan. Lantern/chain are ordinary voxel cells. Support uses the existing neighbor queue. Lighting budget is unchanged.

## Known issues

- Fallback 16×16 PNGs are procedural stand-ins. If the local 1.12 pack has `glowstone.png`, re-run `npm run assets:import` to replace the fallback. Lantern/chain did not exist in 1.12; 1.14+/1.16+ files are optional mappings.
- Native browser lighting-flicker / hanging-from-chain visual QA is deferred to the user.

## Deferred

- Soul lantern, horizontal chain axis, iron nuggets, glowstone dust.
- Native-device lighting soak and first-person scale tuning.

## Next work

User local QA, then merge if accepted.

## Git

- Base: `73a78f4e16fa66ab6248e916777f8243a6b3cf01` (`origin/main`)
- Branch: `cursor/glowstone-lantern-chain`
