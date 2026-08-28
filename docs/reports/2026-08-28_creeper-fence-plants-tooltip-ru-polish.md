# Goal

Fix six targeted gameplay/UI issues on current `origin/main` without rolling back recent accepted work (classic 1.8 combat, reduced vertical melee knockback, sprint persistence, 3D block icons, arrow pickup/vegetation collision/ArrowVisualFactory, chicken legs, stair corners, absorption heart assets, Button/Lever targeting, support-loss architecture, water fragile-decoration displacement, pointer lock, fluids, lighting, streaming):

1. Creeper death animation never played.
2. Player could jump through Fence despite 1.5 collision height.
3. Tall grass / fern / flowers / dead bush floated after the block under them was removed.
4. Golden Apple absorption HUD was mode-dependent and stacking rules needed to be explicit.
5. Item hover used native browser `title` tooltips.
6. Item/block display names were English title-case; the Yandex Games UI needs Russian names.

# Git baseline / feature branch

- `git fetch origin` then `origin/main` = `9dc3300b3e290fa2846e1498715b6762e8c04264` (`Merge pull request #7 … gameplay-ui-entity-polish-935a`).
- Working tree was clean. Created `cursor/mob-collision-tooltip-ru-polish-b257` from `origin/main` (merge-base = `9dc3300`).
- Did not work on `main`, did not continue `cursor/gameplay-ui-entity-polish-935a`, no reset/stash/rebase/force-push.

# Parallel branch safety

- Open GitHub PRs: none.
- Other cloud agents in this environment were IDLE (old lighting/audit/context runs). This run is the only active coding agent.
- Overlap files (`MobManager.ts`, `PlayerController.ts`, `Game.ts`, `GameUI.ts`, `items/registry.ts`, `blocks/registry.ts`) were edited only on this branch.
- No foreign feature branch was merged.

# Creeper death root cause

`MobManager.syncVisual()` branched `if (kind === 'creeper')` before `else if (state === 'die')`. Every creeper, including a dying one, took the fuse-pulse scale path and never received the generic death rotation/shrink.

# Death-state precedence

Death is now first:

- `state === 'die'` → generic fall/rotation (`rotation.z = progress * π/2`, scale shrink).
- else creeper fuse pulse.
- else ordinary scale/reset.

No `CreeperDeathRenderer`.

# Primed-creeper death

`update()` already skips AI while `state === 'die'`. `beginDeath` now also sets `fuseSeconds = 0`, so a fuse that was already > 0 cannot keep pulsing or explode ~0.2s later. Normal kills still emit existing loot via `finishDeath`.

Self-explosion still calls `removeMob(..., 'explosion')` immediately. No corpse, no new gunpowder drop.

# Fence root cause

Authored fence collision was already `fenceLocalBoxes(..., 1.5)`. Visual mesh/selection still use height 1.

# Existing 1.5 collision

Unchanged. Jump velocity remains `8.4`. `STEP_HEIGHT` remains `0.6`. Fence is not two blocks and not a taller visual.

# Broadphase bug

Player/mob candidate loops used `floor(aabb.minY) … floor(aabb.maxY)`. A fence lives in cell Y=n but collides to n+1.5. When feet rose above n+1 during a jump, the owning cell was no longer queried, so the player walked through the remaining 0.5 collision.

# Collision fix

Canonical helper `collisionCandidateCellRange` in `src/world/collision.ts` with `MAX_BLOCK_COLLISION_Y_OVERHANG = 0.5`. It expands minY by at most one cell. Used by `PlayerController.collidesAt` / `moveAxis` (walk, jump, step-up, sneak support, ground probe) and `voxelPhysics.collidingBoxes` (mobs, drops, falling blocks, minecarts). No 10-cell halo.

# Jump regression tests

Walk into isolated fence: blocked. Jump+forward: never crosses. Feet at cellY+1.15 still blocked. Connected and corner layouts blocked on a straight approach. Full cube still jumpable. Slab/stairs step-up unchanged. Mob `moveVoxelBody` hits the overhang.

# Vegetation support root cause

The previous support pass explicitly left generic plants out of `SUPPORT_RULES`. Breaking Grass Block under Tall Grass never enqueued a support check.

# Plant support rules

Explicit ID group, not `renderShape: 'cross'` (cobweb stays out; fire is not a plant):

- TallGrass / Fern / Dandelion / Poppy / OxeyeDaisy → GrassBlock or Dirt.
- DeadBush → Sand.

Support cell is the block directly below.

# Support integrity integration

`needsBlockSupport` / `supportCellForBlock` / `isBlockStillSupported` extended. Same neighbor queue, Map dedupe, budget 256, unloaded-support retain. After loss: plant → Air through canonical batch. `drop:false` / `hasItem:false` so no new plant items. Water can still enter replaceable plant cells; water displacement does not invent a drop.

# Golden Apple current behavior

Registry unchanged: nutrition 4, saturation 9.6, alwaysEdible, Absorption I 2400 ticks, Regeneration II 100 ticks. Damage still spends absorption before health. Expiry still zeros leftover HP. Save still has `absorption` + `absorptionTicks`.

# Creative HUD root cause

`Game.refreshHud` sent `absorption: mode === 'creative' ? 0 : survival.absorption`, hiding yellow hearts while the backend could still hold 4 HP. Creative Catalog testing made this look random.

# Absorption semantics

`SurvivalSystem.applyEffect('absorption')` sets HP to `4 × (amplifier + 1)` and always writes the new duration. Ordinary apples: 0→4, 1→4, 4→4 (never 8). HUD reads `session.survival.absorption` in both modes. `heartHud` is presentation only.

# Re-eating semantics

Re-applying Absorption I replenishes to 4 HP and refreshes ticks to 2400.

# Save/expiry

Serialize/restore path unchanged. Final tick deletes the effect and zeros HP so the HUD does not keep a stale yellow heart.

# Native browser tooltip root cause

Slot/recipe HTML used `title="Item Name"` and `patchKeyedHost` copied `element.title`, so the OS/browser tooltip appeared.

# Custom tooltip architecture

One `.mc-item-tooltip` inside `.mc-stage`. Delegated `pointermove` / `pointerleave` / `pointerdown` on the modal. Item slots use `data-item-tooltip`, `data-item-id`, `aria-label`. Control buttons may keep native `title`. Catalog DOM/scroll is still patched in place (`patchCreativeDynamic`). Touch pointer types do not show the tooltip. Cursor stack stays z-index 60; tooltip is 55 with a larger offset while holding a stack.

# Responsive placement

`clampTooltipPosition`: default 12/16 px to the right/below; if overflow, flip left/up; clamp to viewport padding. Recipe Book / inventory / catalog / containers / ghost slots / armor share the same node.

# Russian localization

# Mapping architecture

`src/i18n/ru.ts` is an explicit ID → Russian map. `requiredDisplayName` is used by block and item registries. Internal IDs, texture paths, tags, recipes, saves, `/give` parsers stay English. Success `/give` text uses `definition.name` (now Russian).

# Coverage

Every `BLOCKS` key and every `ITEMS` / `obtainableItems()` id has an explicit mapping. Grammar is per-item (Деревянная кирка vs Деревянный меч, Железная кираса, etc.). Grass Block display name: **Дёрн**. Redstone dust: **Редстоуновая пыль**.

# Recipe search

`queryRecipeBook` already matches `definition.name`. After localization, `меч`, `алмаз`, `доски` find the corresponding recipes. Recipe IDs remain English.

# Tests

`tests/creeper-fence-plants-tooltip-ru.test.ts` (24/24). Targeted regression files also green: entities, player-physics, interaction-support-polish, gameplay-ui-entity-polish, heart-hud, container-ui, content-pass, block-registry, chat-commands.

Full `npm test -- --maxWorkers=2`: **848 passed / 2 failed / 850**. The two failures are the same pre-existing `authored-item-assets.test.mjs` missing source-pack files as on `main`. Typecheck / build / `check:size` / `check:archive` PASS (3.46 MiB / 188 files). Unrelated timeout thresholds were not changed.

# Browser QA

Automated cloud session cannot claim native pointer-lock / GPU inventory hover. Component tests cover death pose numbers, fence AABB, support queue, absorption math, tooltip DOM contracts and Russian coverage. A real GPU pass should still click Creative Catalog hover (Stone, Golden Apple, Diamond Sword, Water Bucket, Potion, Armor), Survival/Creative Golden Apple hearts, fence jump, plant break, and creeper kill/fuse.

# Performance

- One tooltip node, one modal pointermove, O(1).
- Support stays bounded/deduped; no world plant scan.
- Collision adds at most one extra Y cell.

# Files changed

- `src/entities/MobManager.ts` — death before creeper fuse; cancel fuse in `beginDeath`
- `src/world/collision.ts` — `MAX_BLOCK_COLLISION_Y_OVERHANG`, `collisionCandidateCellRange`
- `src/player/PlayerController.ts`, `src/entities/voxelPhysics.ts` — shared candidate range
- `src/world/placement.ts` — vegetation support group
- `src/survival/SurvivalSystem.ts` — absorption set-to-grant + duration refresh
- `src/core/Game.ts` — Creative HUD uses real absorption
- `src/i18n/ru.ts`, `src/i18n/displayNames.ts`, `src/i18n/index.ts`
- `src/blocks/registry.ts`, `src/items/registry.ts` — Russian names
- `src/ui/itemTooltip.ts`, `src/ui/GameUI.ts`, `src/ui/inventoryLayout.ts`, `src/style.css`
- `tests/creeper-fence-plants-tooltip-ru.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/ROADMAP.md`, this report

# Known limitations

- Browser/GPU confirmation of creeper death, fence feel, catalog tooltips and Russian names is still pending on a real device.
- `/give` still parses English IDs (requested).
- Plants do not drop items (`hasItem:false`).
- Tooltip is mouse-hover only; no touch long-press.
- Projectile DDA still walks voxel cells one at a time; this pass did not change arrow-vs-fence-top raycast (player/mob AABB physics was the reported bug).
- Creative damage immunity unchanged; only HUD truthfulness.

# Git / PR

Feature branch `cursor/mob-collision-tooltip-ru-polish-b257` off `origin/main` (`9dc3300`). Commit `202b2f8`. PR against `main`, not merged.
