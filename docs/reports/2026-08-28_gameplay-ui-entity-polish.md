# Goal

Nine targeted gameplay/UI/entity fixes after recent Codex passes: half-height melee pop, sprint persistence, 3D inventory block icons, inventory close button placement, arrows through vegetation, chicken legs, stair inner/outer occupancy, player arrow pickup, and Golden Apple yellow absorption hearts.

This is not a systems rewrite. Classic 1.8 horizontal combat, fluids, support-loss, Button/Lever targeting, Pointer Lock, authored items, ArrowVisualFactory geometry and Shield removal stay in place.

# Git baseline

- `origin/main` = `67afc97de1b5c752ae1fa02b46bfe6687ff4852c` (`fix: polish interactions support arrows input and mob recoil`)
- Working tree started clean; branch `cursor/gameplay-ui-entity-polish-935a`
- No reset/stash/force-push

# Vertical KB product adaptation

One documented adapter: `FRONTIER_MELEE_VERTICAL_SCALE = 0.67` in `CombatSystem`. It multiplies only the vertical base kick (`0.4×20`) and extra Y (`0.1×20`). Horizontal 8 b/s and sprint extra XZ ×10 are untouched. Naive `Y/2` was rejected because gravity undershoots apex.

Player and mob share `applyKnockback` / `applyExtraKnockback`.

# Before trajectory

Measured Java-1.8-like flat apex (previous pass):

- NORMAL rise ≈ 1.153108
- SPRINT rise ≈ 1.708834

# After trajectory

Harness vs discrete move → gravity 0.08 → drag 0.98:

- NORMAL: initial Y 5.36 b/s, first Δy 0.268, apex **0.576** (tick 4), land tick 8
- SPRINT: initial Y 6.70 b/s, first Δy 0.335, apex **0.841** (tick 5), land tick 10

Targets were 0.5765 / 0.8544 ± 0.05.

# Horizontal KB regression

Initial XZ impulse remains **8 / 18** b/s. Wall contact remains 0.69999.

Open-field 20-tick XZ is **1.80024 / 4.44323** (was 2.04988 / 5.02435). That is not a halved vector: lower apex lands earlier, so grounded drag (`0.6×0.91`) applies for more of the 20 ticks. Air-phase XZ drag is unchanged.

# Sprint persistence

`sprintNeedsRelease` and `resetSprintAfterHit()` removed from `PlayerController`. `sprinting` is recomputed each tick from `movement.sprint && forward > 0.05 && !sneak && !water && !lava`.

`completeMeleeAttack` still multiplies attacker XZ by 0.6.

Intentional simplification vs Java 1.8 W-tap. Hurt resistance remains the hit limiter.

# Removed sprint release latch

No leftover `sprintNeedsRelease = false` dead flag. Tests: held W+sprint → successful extra hit → next tick `player.sprinting === true`.

# 3D inventory icons

`usesBlockModelIcon` → `special_preview` for block items whose held mesh is not `generated` (cubes, stairs, slab, chest, fence, rail, button, plate, furnace, logs, ores, wool, …).

Bake path is the existing `ItemIconRenderer` + `ItemVisualFactory.createItemModel` + `prepareSpecialIconPreview` (orthographic, nearest, face vertex colors). Cached data URL. Temp preview geometry/materials disposed after each bake.

# Icon baking/cache

Startup `bake()` walks `special_preview` items once. Opening inventory 100 times reuses URLs. Generated sprites (apple, sword, bow, arrow, bucket, torch, door, ladder, plants) stay 2D. Torch/door/ladder keep generated held meshes, so their GUI icons are not fake cubes.

# UI close-button layout

Close `×` is a `.mc-stage` sibling to the right of `.mc-panel`, not `position:absolute` over the «Инвентарь» tab. `containerUiScaleWithClose` adds `MC_CLOSE_GUTTER` (20 logical px). Hit box `max(44px, 12×scale)`. Safe-area margin on the right. Same `data-ui="close"` callback / pointer-lock path.

# Projectile vegetation collision

`World.raycast` option `geometry: 'selection' | 'collision'` (default selection). Collision uses `blockCollisionBoxes` (empty for non-solid). Player and skeleton arrows pass `{ geometry: 'collision' }`. TallGrass, Fern, flowers, DeadBush, Fire are skipped; Stone/slabs/stairs/doors/fences still hit. Cobweb remains non-solid with in-cell ×0.25 slowdown.

# Chicken legs root cause

`CHICKEN_MODEL` already had 3×5×3 legs at pivots `(-2,19,1)` / `(1,19,1)`. This pack's `entity/chicken` sheet has a **transparent** vanilla island at logical `[26,0]`; `alphaTest` discarded the meshes. Yellow leg/foot lives near `32,0`.

# Model reference / fix

UV changed to `[29,0]`. Box origin/size/pivots unchanged. Cow/pig/sheep/zombie/skeleton/creeper/spider rigs not edited.

# Stairs corner root cause

`EAST_INNER_*` / `EAST_OUTER_*` occupancy was already 3-quad vs 1-quad. `resolveStairShape` treated a perpendicular neighbor on the high/`facing` side as inner, which filled the convex outside.

# Inner/outer occupancy fix

Front (facing-dir) perpendicular neighbor → `outer_left/right`. Back neighbor → `inner_left/right`. CCW = left. Mesh, `blockCollisionBoxes`, and selection all call `resolveStairShape` + `stairLocalBoxes`. 16 occupancy fixtures cover 4 facings × inner/outer × left/right.

# Arrow pickup

`PlayerArrowManager.tryCollect` after `tick`: resting/`inGround`, pickup delay elapsed, AABB overlap (0.5 box + 0.2 pad). Survival: `Inventory.addItem('arrow', 1)`; leftover > 0 keeps the entity. Creative: remove entity, no stack grant. Pickup tone 660 Hz (existing item-pickup pitch).

Age resets on embed so the 60s ground timer is not eaten by flight time. Flying timeout stays 8s.

# Player vs skeleton semantics

Java 1.8 `EntityArrow.canBePickedUp`: player = 1 (inventory), skeleton = 0 (never). Skeleton projectiles have no collect path.

# Inventory-full behavior

`addItem` returning leftover leaves the world arrow. No duplicate grant. Removal is exactly once.

# Golden Apple

Registry unchanged: Absorption I 2400 ticks, Regeneration II 100 ticks, alwaysEdible. No instant heal of the 20 HP pool. `MAX_HEALTH` stays 20.

# Existing absorption backend

`SurvivalSystem.applyEffect('absorption')` still sets `absorption = max(absorption, 4×(amp+1))`. Damage spends absorption before health.

# Yellow-heart HUD

`absorptionHudIcons` emits only filled/half yellow icons (no empty yellow slots) to the right of the 10 red hearts. Assets: `public/textures/gui/heart_absorption_full.png` / `heart_absorption_half.png`.

# Effect expiry

`tickStatusEffects`: when absorption ticks reach 0, `absorption = 0`. Serialize/restore keeps remaining HP plus `absorptionTicks` so HUD after load is correct and expiry still runs.

# Tests

- `tests/gameplay-ui-entity-polish.test.ts` (new): 3D icon routing, close-button HTML, 16 stair occupancies, vegetation raycast, arrow pickup/full/creative/skeleton, absorption lifecycle/save
- Updated: `combat.test.ts`, `classic-combat-integration.test.ts`, `mob-polish.test.ts`, `shield-removal.test.ts`, `stairs-slabs-icons.test.ts`, `special-preview-contract.test.ts`, `container-ui.test.ts`, `heart-hud.test.ts`, `visual-models.test.ts`

Targeted set green. Full suite 824/826; 2 failures are missing authored source-pack files in this environment, unrelated. Unrelated timeout thresholds not changed.

`typecheck` / `build` / `check:size` / `check:archive` PASS (3.46 MiB / 188 files).

# Browser QA

Automated session cannot claim native pointer-lock combat. Component tests cover KB numbers, sprint flag, raycast, pickup, HUD math, occupancy and close-button DOM contract. Visual catalog/chicken/stair screenshots still need a GPU session (see Known limitations).

# Responsive QA

`containerUiScaleWithClose` checked for 932×430, 844×390, 800×360, 768×360, 740×360, 720×360, 667×375: panel + 44px close stays inside width.

# Performance

Icon bake is startup/first-request, then cache. Arrow collect removes the visual. Vertical KB adds no per-hit allocations. No new CombatSystem2 / ArrowManager2 / InventoryRenderer2.

# Files changed

- `src/combat/CombatSystem.ts` — vertical scale constants
- `src/player/PlayerController.ts` — removed sprint latch
- `src/items/itemIcons.ts` — block-model GUI icons
- `src/rendering/ItemIconRenderer.ts` — comment / bake loop already special_preview
- `src/rendering/specialBlockGeometry.ts` — inner/outer resolve
- `src/world/World.ts` — collision-mode raycast
- `src/entities/MobManager.ts` — projectile collision raycast
- `src/entities/mobModels.ts` — chicken UV
- `src/combat/PlayerArrowManager.ts` — ground lifetime, tryCollect, BlockId import
- `src/core/Game.ts` — collect, HUD absorption, save/restore absorption ticks
- `src/survival/SurvivalSystem.ts` — expiry, serialize ticks
- `src/save/types.ts` — optional absorption fields
- `src/ui/heartHud.ts`, `src/ui/GameUI.ts`, `src/ui/containerTheme.ts`, `src/style.css`
- `public/textures/gui/heart_absorption_*.png`
- tests + docs listed above

# Known limitations

- Torch/door/ladder GUI icons remain generated 2D because their held mesh is `generated`; changing that would alter first-person pose.
- 20-tick open knockback distance is shorter after the height cut because of grounded drag, not because XZ impulse changed.
- Skeleton arrows are not pickable (Java 1.8).
- Creative pickup does not inflate the arrow stack.
- Other status effects besides absorption still are not fully serialized.
- Native GPU screenshots of 3D catalog icons / chicken walk / stair corners were not captured in this cloud session.

# Git status

Branch `cursor/gameplay-ui-entity-polish-935a` off `67afc97`. See the PR for the delivered commit.
