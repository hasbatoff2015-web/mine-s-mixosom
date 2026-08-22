# 2026-08-22 Container UI visual/functional QA fixes

## Goal

Corrective pass on `cursor/container-ui-recipebook-flight` after local visual QA against screenshots: giant Creative player slots, Creative Catalog/Inventory tabs, chest icon/orientation/lid/z-fighting, slot hover flicker, Recipe Book layout and A→B mixing, deliberate Furnace Recipe Book removal, furnace facing + lit front + torch-equivalent light. No Creative Flight rewrite, no general performance/mob pass.

## Result

Root causes identified in code, then fixed. `npm run check` green. Commit `fix: polish container UI recipes and furnace visuals` on `cursor/container-ui-recipebook-flight`. No merge of main, no force push.

## Creative Inventory

- **Giant slots root cause:** Creative still used legacy `.inventory-window` while `playerInventoryHtml` emitted `.mc-grid` / `.mc-slot`. `--mc-slot` only applied under `.mc-stage`. `.inventory-grid` used `repeat(9, minmax(34px, 1fr))` and `.slot { width: 100% }`, so the gold chestplate cell stretched across the panel. Catalog stayed smaller (`minmax(32px, 46px)`).
- **Fix:** Creative E is a `.mc-backdrop` / `.mc-stage` / `.mc-panel` screen with localization tabs **Каталог** / **Инвентарь**. Canonical `--mc-slot` (`max-width`, `flex: none`). No per-item size hack.
- **Catalog tab (default):** full obtainable catalog, 9-column compact grid, vertical wheel scroll. Bottom: **only 9 hotbar slots**. No 3×9, no armor.
- **Inventory tab:** catalog hidden (not destroyed). Armor + 3×9 + shared hotbar. Same slot size as chest/furnace/crafting.
- **Scroll:** `[data-creative-catalog]` stays in DOM across Catalog → Inventory → Catalog. Item interaction patches hotbar/inventory slots only.
- Tab switch does not recreate inventory state, cursor stack, or pointer-lock policy.

## Chest

- **Icon small/dark root cause:** chest already used `special_preview` + auto-fit + sRGB, but `ItemVisualFactory.preload()` did not wait on `entity/chest/normal`. `TextureLoader.load` raced `ItemIconRenderer.bake()` → black/small cached preview. Closed coplanar lid/body also darkened the bake.
- **Future-proof:** any `itemHeldMeshKind === 'special_model'` is `special_preview` (`generic` pose if the shape has no category). Size/color-space/unlit clone are automatic. Entity textures for special previews are preloaded before bake. Per-category orientation only.
- **Facing root cause:** `chestFacingFromYaw` equalled `doorFacingFromYaw` (look direction). Vanilla chest facing is latch/front via look **opposite**. Yaw 0 (look north) stored north, latch on −Z away from the player.
- **Fix:** `chestFacingFromYaw` / `furnaceFacingFromYaw` are opposite-of-look, **separate** from doors. `chestYaw` already maps latch −Z to stored facing.
- **Lid down root cause:** `chestLidAngle` was negative Three.js `xRot` around the rear hinge → front edge went down.
- **Fix:** positive `t * CHEST_OPEN_ANGLE`. Contract: `chestLidFrontTopY(open) > chestLidFrontTopY(closed)`.
- **Z-fighting root cause:** not ChunkMesher (cube faces already skipped for `renderShape: 'chest'`). Entity overlap: lid minY = body maxY (10/16) and latch south vs body north at z = 1/16.
- **Fix:** `CHEST_LID_SEAM = 1/64`, omit lid `down` and latch `south`. No large `polygonOffset`.

## Hover

- **Flicker root cause:** every world tick `refreshOpenInventory()` → `patchContainerDynamic` replaced `body`/`player` `innerHTML`. `:hover` died with the remounted `<button>`. Furnace flame/arrow made this every tick.
- **Fix:** slot buttons keep identity; only `data-sig` changes rewrite contents. Flame `--p` and arrow width update via `[data-progress]`. Hover uses inset `box-shadow`, not outline-offset.

## Recipe Book

- **Furnace:** product decision — no book button, no left panel, no ghost recipes. `SMELTING_RECIPES` still drive `tickFurnaces()`.
- **Button overlap root cause:** `.mc-book-button { position: absolute; left: calc(-22px * var(--mc-ui-scale)); }` sat on the panel border.
- **Fix:** flex sibling. Closed: `[button][panel]`. Open: `[recipe panel][gap][main]`; toggle lives in the book toolbar.
- **Category overflow:** `grid-template-columns: repeat(3, 1fr)` plus RU «Строительство». Now flex-wrap, ellipsis, smaller font. Panel stays 147 logical.
- **A→B mix root cause:** `handleRecipeClick` ghost-pathed uncraftable B from **inventory counts excluding grid A**, so A stayed in `craftSlots` while ghost HTML overlaid B.
- **Fix:** always `placeCraftingRecipe`: return previous real grid atomically; abort (keep A) if inventory cannot accept it; then place real or empty+ghost. Ghost is never an `InventoryStack`.
- **Craftable / shift:** quantities via `craftingNeedCounts` / `maxRecipeFill`, including `inventoryAndGridCounts`. 2×2 filters `gridSize`. Shift fill capped at max stack.
- **Self-audit covered in tests:** empty→A, A→B, A→uncraftable B, abort-on-full, A→B→A conservation, split stacks, 2×2 vs 3×3. Manual: search focus, rapid click, close leftovers.

## Furnace

- **Facing:** same opposite-of-look helper as chest, remapped only on furnace cube faces (`furnaceCubeFaceSlot`). Doors unchanged.
- **Lit texture:** Faithful mapping `furnace_front_on.png` (32×32, lower opening painted). Only FRONT uses `textures.litFront` while `burnTime > 0`. Top/side unchanged.
- **Source of truth:** `FurnaceState.burnTime`, not a stored `lit` flag. GUI open does not affect world lit/light.
- **Light:** `blockEmissionAt` = `torchBlockEmission()` while burning, else definition emission (0). `LightEngine` seed/propagate uses that. Burn 0↔>0 dirties the light neighborhood and `relightAround(..., recomputeSky=false)`.
- Save/load with `burnTime > 0` seeds lit + light on `getChunk`.

## Self-QA

Automated: typecheck + 275 tests including Creative layout contract, slot identity, special preview, chest lid/facing/topology, furnace N/S/E/W + lit/light + restore, recipe transactions, Creative flight 8/8, pointer lock 11/11.

**Browser visual (this environment):** not a substitute for the user’s local GPU pass. No Chromium visual walkthrough of lid flicker, hover-for-seconds, or Faithful chest albedo was completed here. Treat the following as **manual QA**:

- Creative E tabs, wheel scroll, no giant slots, Catalog→Inventory→Catalog scroll.
- Chest icon size/color in hotbar; N/S/E/W latch; lid up; several chests + camera stripe.
- Hover empty/occupied, mouse still for seconds.
- Crafting book button/panel/categories; A→B, ghost, shift, search, All/Craftable, close.
- Furnace: no book, facing, fuel → lit front + light, GUI stays open, fuel end → unlit/light off.

## Tests

```text
tsc --noEmit PASS
Vitest 33 files / 275 tests PASS
Vite 90 modules
Size/archive 1.01 MiB / 167 files
JS 793.27 kB / 215.81 gzip; CSS 22.02 kB / 5.30 gzip
```

`npm run check` green (typecheck + test + build + size/archive).

## Changed files

See git commit. Principal: `GameUI.ts`, `inventoryLayout.ts`, `containerInteractions.ts`, `recipeBook.ts`, `containerTheme.ts`, `containerStrings.ts`, `style.css`, `chestModel.ts`, `ChunkMesher.ts`, `ItemIconRenderer.ts`, `ItemVisualFactory.ts`, `itemIcons.ts`, `itemIconPreview.ts`, `World.ts`, `LightEngine.ts`, `placement.ts`, `registry.ts`, `Game.ts`, `import-assets.mjs`, `public/textures/block/furnace_front_on.png`, tests, docs.

## Architecture decisions

- Doors stay look-aligned; chest/furnace use opposite-of-look independently.
- Lit furnace light is derived emission, not a second block ID.
- Recipe Book is a crafting UX, not a furnace requirement.
- Slot DOM identity is a tested patch policy, not a CSS hover hack.

## Deferred

GPU confirmation of chest seam and hover stability; real-device Creative E. No furnace recipe book to restore.

## Next work

Follow-up local QA polish: `docs/reports/2026-08-22_container-ui-layout-visual-polish.md`.

## Git

Branch `cursor/container-ui-recipebook-flight`. Commit message `fix: polish container UI recipes and furnace visuals`. Ordinary push. No force, no merge main.
