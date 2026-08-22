# 2026-08-22 Ladder climbing, icon auto-fit, Creative scroll

## Goal

Fix three visual-QA findings on `cursor/minecraft-item-pipeline-rework-935a` HEAD `0db0a01` before merge: special 3D icons too small, Creative catalog scroll reset on slot clicks, missing ladder climbing. Do not change `GeneratedItemGeometry` or `FIRST_PERSON_SPRITE_POSE`. No chest/furnace/recipe-book/flight/perf work. No commit/push.

## Result

Implemented. Stairs/slabs geometry untouched. Sneak (C) already existed, so ladder hold is included.

## Special icons

**Root cause:** `ItemIconRenderer` sized the ortho camera from a **bounding sphere × category padding** (stairs 1.18, slab 1.22, button 2.35, plate 1.42). Sphere radius is the AABB diagonal/2, so the model sat in a small part of the square. Button padding made tiny cuboids even smaller.

**Auto-fit:** after the shared isometric rotation `[30, 225, 0]`, take world `Box3` size XY (camera looks down −Z) and set ortho half-extent to `max(w,h)/2 / SPECIAL_ICON_FILL` with `FILL = 0.86`. One function `orthographicFitExtent` for every `special_preview`. No per-item scale. Padding fields removed.

Bake still once; cache by item id. Ordinary cubes / generated sprites unchanged.

Checked ids: oak/birch/spruce/cobble/brick/stone_brick stairs; all family slabs; stone_button; oak and stone pressure plates.

## Creative scroll

**Root cause:** `handleInventorySlot` → `renderInventory()` did `modal.remove()`, created a new backdrop, and rewrote **all** innerHTML including the catalog. `.inventory-window` is the overflow scroller, so remount reset `scrollTop` to 0. Not a browser quirk; full remount.

**Fix:** mount catalog once (`data-creative-catalog`). Later updates patch only `[data-inventory-dynamic]` + `#cursor-stack` via `patchInventoryDynamic`. Event delegation on the modal stays. No `setTimeout` scroll restore. Close/reopen may start at top (acceptable).

## Ladder climbing

**Contact:** `ladderClimbBox` = visual thin plane + `LADDER_CONTACT_PADDING` 0.15 into the open cell + `LADDER_TOP_PADDING` 0.2. Not whole-voxel occupancy. Far side of the cell / neighbour cell does not contact.

**Intent:** `dot(normalize(wishXZ), towardSupport) ≥ 0.25` where wish comes from yaw + WASD (same as walk). Face + W and back + S both climb. Away does not. Along-wall (A/D) does not climb.

**Speeds (vanilla 0.2 / 0.15 block/tick):** `LADDER_CLIMB_SPEED = 4.0`, `LADDER_MAX_DESCENT_SPEED = 3.0`. No input → −3 b/s. Fast fall onto ladder clamped. Sneak → 0 (hold). Jump from ground at the bottom is kept if there is no climb intent.

**Top/bottom:** step-up allowed while on ladder so the lip is walkable; top padding keeps contact one moment past the last rung. Bottom: overlap the padded volume while standing on the floor.

**State:** `PlayerController.onLadder` is canonical. `CombatSystem.onLadder` now reads it (was always false). Not serialized.

**Not a second controller.** Stairs still generic step-up only.

## Tests

See `npm run check` in the user report. New: `tests/ladder-climbing.test.ts`, `tests/icon-scroll-fixes.test.ts`. Pose lock and GeneratedItemGeometry tests remain.

## Deferred

- Chest/furnace/recipe book/creative flight/general perf.
- Two-block bed / sleeping.
- Generated sprite icon margins (not a reported problem).
- Vanilla-perfect ladder horizontal clamp 0.15 b/tick (kept normal along-wall walk).

## Git

No commit / push (per task).
