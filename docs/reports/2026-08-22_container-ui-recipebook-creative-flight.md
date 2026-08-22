# 2026-08-22 Container UI, Recipe Book, Creative flight

## Goal

Finish the post–PR #2 user/UI/gameplay block in one implementation pass: chest entity model + lid animation, Minecraft-like chest/furnace/crafting GUIs, Creative catalog no longer inside block containers, Recipe Book, slot interactions, Creative double-Space flight, existing pointer-lock flow reused. Follow-up: container GUI must not pause world simulation. No general performance/mob-smoothing pass.

## Result

Implemented on `cursor/container-ui-recipebook-flight` from main `76ce4a1`. HEAD after the feature pass: `5515d19`. Follow-up visual/functional QA: `docs/reports/2026-08-22_container-ui-visual-functional-qa-fixes.md`.

## Audit

### Old container UI

`GameUI` mounted one large rounded `inventory-window` for inventory, chest, furnace and crafting table. In Creative the same window included the full item catalog, so chest/furnace/table “slid” under a huge catalog. Survival inventory already had a 2×2 crafting grid plus armor/off-hand. Slot clicks used `applySlotClick`; Creative catalog was patched via `patchInventoryDynamic` (kept).

### Chest

Contents: `VoxelWorld.chests` keyed by `x,y,z`, 27 slots (`ChestState`). Not a cube mesh anymore: `renderShape: 'chest'`, `ChunkMesher` emits `meshed.chests`, `ChestRenderer` draws shared body/lid/latch. Texture: Faithful 32x `entity/chest/normal.png` (128×128 atlas, UVs in 64-space). Legacy oak `block/chest` tile is unused for world/held/icon. Facing: `blockStates.facing` from `chestFacingFromYaw` (lock toward player, same heading as doors). Missing facing → `north`. No authored chest SFX in pack.

### Furnace

Runtime `tickFurnaces()` uses `SMELTING_RECIPES` / `FUEL_BURN_TICKS` inside the ordinary `VoxelWorld.tick()`. Container GUIs no longer enter `PAUSED`, so burn/cook continue while the furnace screen is open. `GameUI.refreshOpenInventory()` patches flame/arrow/slots from the live `FurnaceState` — no UI timer. Slots: `[input, fuel, output]`.

### Crafting

Canonical `CRAFTING_RECIPES` + matcher. 3×3 on the table, 2×2 in Survival inventory. Close now returns leftover grid (+ cursor) via `Inventory.add` / `onDrop`. No separate UI recipe copy.

### Recipe architecture

Recipes already had stable `id`s. New `recipeBook.ts` maps registries → book entries, categories from item kind/tags, search, craftable filter, optional `knownIds`. Alpha: all registry recipes are known (no advancements).

### Flight / controller

No fly state existed. Sprint on ground remains Shift; fly sprint is Ctrl. Container GUI blocks fly/move input (`resolvePlayerMoveInput`) while the world stays `PLAYING`. Pause menu still stops simulation. Recipe search is an `<input>` so Space is not added to keys (`isTypingElement`).

## Shared UI

- Logical design: width 176, furnace/crafting height 166, chest 168, slot pitch 18, item 16.
- `containerUiScale()` fits viewport, cap 4, min 0.5 so 320-wide + open book does not overflow.
- Common CSS: `.mc-backdrop` / `.mc-stage` / `.mc-panel` / `.mc-slot` / `.mc-grid` / labels / result / flame / arrow / book button / left book panel. Nearest-neighbor (`image-rendering: pixelated`).
- Player section on block containers: label Inventory, 3×9, then hotbar gap + 1×9.
- Wide: `[Recipe Book][Panel]`, composition centered. Narrow: scale down; ≤720px book may overlay left.
- No `GameUI2`. Creative E later gained Catalog/Inventory tabs (see QA-fixes report).

## Chest

- Texture source: `public/textures/entity/chest/normal.png` from Faithful/vanilla entity atlas (`scripts/import-assets.mjs` copies `entity/chest/normal.png`).
- Model: body + lid + latch, hinge at back (`CHEST_LID_PIVOT`), lock on −Z in model space then yawed by facing.
- Animation: `targetOpen` 0/1, `stepChestOpenProgress` exponential toward target using render dt / 0.05. Only the `setOpenChest(blockKey)` instance has `targetOpen=1`. Close / `enterPlaying` clears target.
- Save: slots unchanged; facing in `blockStates`; `openProgress` not saved.
- Item: `itemHeldMeshKind('chest') = 'special_model'`, icon `special_preview` category `chest`, closed geometry + entity material. `FIRST_PERSON_SPRITE_POSE` unused (not a generated sprite).
- Collision/selection: 14/16 inset box, height 14/16.

## Chest UI

- Label Chest, 3×9 chest, Inventory, 3×9 + hotbar. No side panel, no Creative catalog.
- Left click take/put/swap; right half/one; shift chest ↔ player. Cursor stack returned on close (existing add/drop policy).

## Furnace UI

- Label Furnace. Grid: input (top) / flame (remaining burn) / fuel (bottom) | progress arrow (cook/200) | output.
- Output rejects arbitrary insert (`furnaceAccepts(2) === false`). Input only smeltable; fuel only `getFuelBurnTicks > 0`.
- Shift: smeltable → input, fuel → fuel, else player inventory; output → player.
- Recipe Book: smelting registry is **not** shown in Furnace UI (product decision in the QA-fixes pass). Flame/arrow still read live `FurnaceState`.
- Open furnace GUI does not pause the world. `tickFurnaces()` keeps advancing; flame/arrow/result update from live state.

## Crafting UI

- Label Crafting, 3×3, arrow, larger result slot, Inventory + hotbar.
- Matcher is canonical. Take result consumes via `consumeCraftingGrid`. Shift-take crafts while inventory can accept.
- Close returns leftover grid items; overflow uses `onDrop` (world drop path).
- Survival inventory keeps 2×2 + armor and has a Recipe Book filtered to `gridSize <= 2`.

## Recipe Book

- Button (book icon) on crafting table and Survival inventory. Toggles a left panel; not a new modal; does not touch pointer lock. Furnace has no book button.
- Session prefs: `recipeBookOpen.crafting` / `.furnace`. Search resets on open.
- Search: display name, item id, recipe id, case-insensitive, grid patch only (focus kept).
- Tabs: crafting ALL / EQUIPMENT / BUILDING / FOOD / REDSTONE / MISC; furnace ALL / FOOD / BUILDING / MISC. Empty tabs hidden except ALL.
- Show All / Show Craftable; inventory mutation re-queries craftable. Uncraftable in All: red `.uncraftable` buttons.
- Click craftable: return current grid to inventory if possible, then place min ingredients. Shift: fill `maxRecipeFill` (≤64). If grid cannot be returned safely → no destroy.
- Uncraftable: ghost cells (translucent; missing tinted); not real stacks; any grid edit clears ghost.
- Variants with the same result: right-click cycles.
- Unlock strategy: all canonical recipes known. `queryRecipeBook({ knownIds })` is the future hook. **Not** vanilla advancements.

## Creative Flight

- Allowed only when `session.summary.mode === 'creative'` (`creativeFlightAllowed` every tick). Survival double Space never flies.
- Edge `jump && !jumpHeld`. Window 7 ticks at 20 TPS. First press arms; second within window toggles; timeout does not toggle; key repeat is not a second tap.
- Enter: `isFlying=true`, `velocity.y=0`. Exit: gravity returns, no teleport.
- WASD camera-yaw horizontal. Space hold ascend, Shift hold descend, neither → hover to 0. Ctrl + movement → `CREATIVE_SPRINT_FLY_SPEED` (~×2).
- Landing uses `landed` (downward collision), not mere `onGround`, so takeoff on dirt does not immediately cancel. Side walls do not cancel.
- Collision stays (walls, ceiling, floors, stairs, slabs, doors). Flying sets `onLadder=false` and skips ladder vertical rewrite.
- Creative→Survival: `creativeFlightAllowed=false` clears fly same tick. `isFlying` not serialized (`restore`/`teleport` clear it).
- GUI: world still ticks; WASD/look/attack/use/flight are blocked. Pause menu: simulation stopped. Space in recipe search is typing-filtered.

## Pointer Lock

Existing `closeInventoryAndResumeLook` → `enterPlaying` → `tryRequestPointerLock`. Esc gameplay → browser unlock → pause → Continue → overlay on failure. Container close (E / × / Esc while inventory open) uses the same path. Recipe Book does not release/request lock. `tests/pointer-lock.test.ts` 11/11 green.

## Save Compatibility

- Chest contents: same `chests` map, 27 slots. Old worlds load; default facing north.
- Furnace slots/burn/cook unchanged.
- Crafting grid / recipe search / book open: runtime only.
- Flight: runtime only. Survival cannot load into fly.

## Architecture decisions

- **A. Simulation pause** = lifecycle not `PLAYING` (`PAUSED` / `AD` / `BACKGROUND` / `DEAD` / menu). Frame loop does not accumulate ticks.
- **B. Gameplay modal / input block** = container GUI open while staying `PLAYING`. `openGameplayModal()` releases pointer lock and actions; `resolvePlayerMoveInput` zeroes WASD/jump/sprint/sneak/descend/flySprint; attack/use are consumed without world actions.
- Opening Survival/Creative inventory, chest, furnace, or crafting table uses **B**, never **A**. Recipe Book is a panel inside B and does not change lifecycle.
- Esc Pause menu uses **A** (`openPauseMenu` → `setState('PAUSED')`). Pointer-lock flow unchanged: Esc gameplay → unlock → Pause → sim paused; Continue → `enterPlaying` → existing lock/fallback.
- Furnace UI is a view of `VoxelWorld.tickFurnaces()`. No second game loop and no “tick furnace only while GUI open” exception.

## Tests

```text
npm run check PASS
tsc --noEmit PASS
Vitest 33 files / 275 tests PASS (after QA-fixes pass; feature pass was 31/257)
Vite 90 modules
Size/archive 1.00 MiB / 166 files
JS 787.86 kB / 214.34 gzip; CSS 20.00 kB / 5.03 gzip
```

New: `tests/chest-model.test.ts` (9), `tests/container-ui.test.ts` (12), `tests/creative-flight.test.ts` (8), `tests/gameplay-modal.test.ts` (9). Pointer lock 11/11, ladder, held items, special icons, stairs/slabs remain green.

## Manual QA

### Chest

- Place chests facing N/S/E/W; lock on front; Faithful chest texture, not oak cube.
- Open: that lid only animates up; close: it closes. Neighbor chests stay shut.
- 27 slots persist after close/reopen/reload.
- Survival and Creative: compact Chest + Inventory + hotbar, **no Creative catalog**.
- Left / right / shift clicks; no dup/loss. Held/hotbar/Creative chest icon is the chest model.
- Double chest: not in this scope.

### Furnace

- Input / flame / fuel / arrow / output layout.
- Put ore + coal; flame shrinks, arrow fills **while the GUI stays open**. Close/reopen still shows the same live `FurnaceState`.
- Shift-click routing. **Product follow-up:** Recipe Book was removed from Furnace entirely (see QA-fixes report). `SMELTING_RECIPES` remain the simulation source.
- Creative vs Survival: same furnace GUI.

### Crafting

- Manual 3×3 → result; take consumes; shift-take multi-craft if space.
- Close with leftover ingredients → they return (or drop if full). Reopen empty grid.
- Recipe Book: search, categories, All/Craftable, ghost, real placement, shift-fill.

### Recipe Book

- Open/close left panel; composition stays on screen (1280×720 … 2560×1440).
- Typing in search does not fly / does not close on letter E.
- Uncraftable visible as red + ghost; craftable moves real stacks.

### Flight

Creative: A double Space fly; B Space up; C Shift down; D WASD; E Ctrl+W faster; F hover; G double Space in air fall; H descend onto ground → off; I wall; J ceiling; K stairs/slabs; L ladder nearby does not take over; M open E while flying → no movement; N close E → still flying if airborne; O switch Survival → gravity.

Survival: double Space = jump only.

### Pointer lock

Inventory / chest / furnace / crafting close, pause Continue, Esc fallback overlay — same as PR #2.

## Changed Files

Modified:

- `scripts/import-assets.mjs`
- `src/blocks/placement.ts`
- `src/blocks/registry.ts`
- `src/blocks/types.ts`
- `src/core/Game.ts`
- `src/core/constants.ts`
- `src/input/InputManager.ts`
- `src/inventory/inventory.ts`
- `src/items/itemIcons.ts`
- `src/items/itemRenderProfiles.ts`
- `src/player/PlayerController.ts`
- `src/player/index.ts`
- `src/rendering/ChunkMesher.ts`
- `src/rendering/ItemVisualFactory.ts`
- `src/rendering/WorldRenderer.ts`
- `src/rendering/specialBlockGeometry.ts`
- `src/style.css`
- `src/ui/GameUI.ts`
- `src/ui/inventoryLayout.ts`
- `src/world/collision.ts`
- `docs/PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/TESTING.md`
- `docs/YANDEX_REQUIREMENTS.md`

New:

- `public/textures/entity/chest/normal.png`
- `src/core/gameplayModal.ts`
- `src/player/creativeFlight.ts`
- `src/rendering/ChestRenderer.ts`
- `src/rendering/chestModel.ts`
- `src/ui/containerInteractions.ts`
- `src/ui/containerStrings.ts`
- `src/ui/containerTheme.ts`
- `src/ui/recipeBook.ts`
- `tests/chest-model.test.ts`
- `tests/container-ui.test.ts`
- `tests/creative-flight.test.ts`
- `tests/gameplay-modal.test.ts`
- `docs/reports/2026-08-22_container-ui-recipebook-creative-flight.md`

## Deferred

- Double chest (never existed; not added).
- Vanilla recipe advancement / criteria unlocks (all recipes treated as known; `knownIds` hook only).
- Authored chest open/close sounds (none in game/resource assets; procedural WebAudio only).
- Bed specialized mesh.
- Pointer-drag slot distribution UX.
- General FPS/chunk-remesh/mob interpolation (explicitly out of this pass).

## Git

- branch: `cursor/container-ui-recipebook-flight`
- HEAD: `76ce4a1d43b00db255ec423d4363b627aebf7fef` (dirty working tree, uncommitted implementation)
- no commit / no push / not merged to main
