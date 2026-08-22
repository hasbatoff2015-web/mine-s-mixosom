# 2026-08-22 Container UI layout / visual polish

## Goal

Corrective pass on `cursor/container-ui-recipebook-flight` after local screenshots: Recipe Book layout (stretched book, text categories), hover outline, chest lid interior, furnace GUI icon facing, Creative Inventory tab overflow, armor silhouettes, catalog scrollbar overlap. No Creative Flight rewrite, no performance/mob pass, no merge of `main`.

## Result

Root causes identified in code, then fixed. `npm run check` green. Commit `fix: polish recipe book and container UI layout` on `cursor/container-ui-recipebook-flight`. Ordinary push. No force, no merge main.

## Recipe Book

- **Stretched book / wrong chrome:** toggle lived in the recipe panel toolbar (`width/height: 100%` on a flex-grown row) and as a stage sibling overlapping the panel.
- **Fix:** Recipe Book is a separate left `aside`. Book toggle is a square button **inside the craft row**, left of 2×2/3×3, closed and open. Image uses `--mc-item` + `object-fit: contain`. Furnace still has no book.
- **Categories:** vertical icon column. `Все` stays text. Building=bricks, equipment=iron pickaxe, food=apple, redstone=dust, misc=gunpowder. Search + crafting-table craftable toggle in the book toolbar. Pager shows `1/N`.
- **A→B / ghost / shift / close / 2×2 filter:** unchanged transactional `placeCraftingRecipe`. Re-tested in `container-ui.test.ts`.

## Hover

- **Root cause:** hover mixed the slot bevel (`inset` light bottom-right) with a full white inset shadow, producing an L-shape. Recipe grid `innerHTML` replace could still drop `:hover`.
- **Fix:** white outline is a `::after` overlay (`pointer-events: none`, inset `box-shadow`, opacity 0/1). Bevel unchanged. Recipe buttons patch in-place by `data-recipe-id` + `data-sig`, same identity policy as slots.

## Chest lid interior

- **Root cause:** lid `down` face was omitted to avoid coplanar z-fighting with body top. After lid-up animation that underside is what the camera sees → transparent lid interior.
- **Fix:** restore lid `down`. `CHEST_LID_SEAM = 1/64` still separates closed planes. Latch south stays omitted. Orientation / hinge / icon pipeline unchanged.

## Furnace icon

- **Root cause:** block items used `textures.side` before `front`. Furnace GUI tile was `furnace_side` (back/side, no opening). World facing was already correct.
- **Fix:** `blockItemIconTexture()` prefers `front`. Furnace → `block/furnace_front`, crafting table → `block/crafting_table`. Not a special-preview brightness hack. Cubes with no `front` stay on `all`/`side`.

## Creative Inventory

- **Overflow root cause:** Inventory tab put armor **beside** the 9-column grid (`18 + 8 + 162 > 176` inner). `margin-top: auto` + `min-height: 222` opened a huge gap. Catalog scrollbar sat on column 9 (`9×18` filled the panel).
- **Fix:** armor column above the 3×9 (Minecraft-like), grid full width, no offhand slot. Catalog panel 195 logical with right gutter `max(16px, 8×scale)`. Armor empty slots show helmet/chest/legs/boots silhouettes via `::before` mask; hidden when the slot has an item (`:has(img)`).

## Self-QA

Automated: typecheck + **276** tests / 33 files, including icon tabs, no offhand, furnace front GUI texture, lid interior face, Creative width, flight 8/8, pointer lock 11/11.

**Browser visual (this environment):** not a substitute for local GPU QA. Treat as **manual**:

- Recipe Book closed/open, book button left of 3×3, icon tabs, no stretch, no overlap.
- Hover hold on empty/occupied/recipe slots.
- Chest open lid interior texture.
- Furnace icon front in hotbar/catalog.
- Creative Catalog scroll (column 9 fully visible); Inventory tab bounds, armor icons, no offhand.

## Tests

See `npm run check` in the agent final report.

```text
tsc --noEmit PASS
Vitest 33 files / 276 tests PASS
Vite 90 modules
Size/archive 1.01 MiB / 167 files
JS 795.55 kB / 216.39 gzip; CSS 25.36 kB / 5.89 gzip
```

## Architecture decisions

- Book toggle placement is craft-row, not recipe-panel chrome.
- Cube GUI tiles prefer authored `front`.
- Lid interior is geometry, not DoubleSide / polygonOffset.
- Hover overlay is independent of bevel box-shadow.

## Deferred

GPU confirmation of lid interior albedo and hover-for-seconds; real-device Creative E.

## Git

Branch `cursor/container-ui-recipebook-flight`. Ordinary push. No force, no merge main.
