# Goal

Переработать first-person / held visuals всех **non-block** предметов так, чтобы они были объёмными 3D-объектами со своей формой, а не текстурой на кубе или плоским прямоугольником. Block items оставить cube-like. Не создавать вторую item-rendering систему и не ломать lighting / dropped items / first-person swap.

# Result

`ItemVisualFactory` теперь маршрутизирует по `itemVisualKind`:

- `block-cube` — прежний atlas UV cube (stone, dirt, planks, door, button, …);
- `special-torch` — cuboid stick тех же размеров/UV, что world torch;
- `generated` — extruded silhouette из alpha mask (tools, weapons, arrow, food, armor, bow, shield, resources).

First-person generated/handheld yaw увеличен, чтобы читалась толщина. Geometry/materials по-прежнему кэшируются; кадр не строит новые меши.

# Implemented

- `itemVisualKind()` отделён от pose category (`block` / `torch` / `generated` / `handheld` / `bow` / `shield`).
- `createTorchItemGeometry()` в `specialBlockGeometry.ts`: `TORCH_WIDTH × TORCH_HEIGHT × TORCH_WIDTH`, UV crop `TORCH_TEXTURE_UV`, pivot в центре.
- `GeneratedItemGeometry` больше не кладёт целую текстуру на один front/back quad: front/back собираются из opaque row spans + прежние merged side spans. Depth `0.10`.
- Factory `createItemModel` / `preload` идут по visual kind, а не по `item.kind === 'block'`.
- First-person transforms: torch stick pose; generated ≈ `[12, -48, 18]` scale `0.48`; handheld ≈ `[14, -55, 22]` scale `0.52`. Bow charge pose не менялся.

# Changed files

- `src/items/itemRenderProfiles.ts`
- `src/rendering/specialBlockGeometry.ts`
- `src/rendering/GeneratedItemGeometry.ts`
- `src/rendering/ItemVisualFactory.ts`
- `tests/item-rendering.test.ts`
- `tests/lighting-physics-interaction.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/TESTING.md`
- `docs/reports/2026-08-20_held-item-3d-visuals.md` — this file

# Architecture decisions

Одна фабрика, три kind. Torch не генерируется из item PNG: world torch уже имеет корректный stick, его нужно переиспользовать. Tools/arrow достаточно общего extrusion — отдельная arrow mesh factory для held item не нужна (`ArrowVisualFactory` остаётся для projectile). Button/door/lever остаются block-cube: это block items, пользователь просил не менять cube held visual.

Pose category `torch` нужна, потому что Y-up cuboid нельзя крутить тем же yaw, что extruded XY sprite, иначе палка ляжет плашмя.

# Tests

Добавлены/обновлены проверки visual-kind audit по всему registry, torch bounds, generated thickness, silhouette `frontSpans > 1`, cache reuse, first-person torch category. Lighting-physics test больше не ожидает `generated` для torch/button/door.

`npm run check` green: 21 files / 128 tests; production 0.93 MiB / 165 files.

# Visual QA

Headless cloud agent не строит first-person WebGL screenshots. Сцены A–E нужно пройти локально (torch, arrow, pickaxe, другие non-block, stone/dirt cube).

# Performance

- Torch/cube geom: 24 verts, cache по `block.id`.
- Generated geom: строится один раз на texture path в `preload` / first load, не в RAF и не в 20 TPS.
- First-person update по-прежнему только transform на уже существующей модели; swap только при смене item id.

# Known limitations

- First-person angles — project-tuned, не bit-exact vanilla JSON display.
- В Node/Vitest generated factory без `document` использует 1×1 placeholder; реальный silhouette проверяется через `createGeneratedItemGeometry` mask и runtime `preload`.
- Door/button/lever в руке остаются кубами (block items).
- Hoe / gold tools по-прежнему вне registry.

# Deferred

- Точный vanilla first-person translation/rotation dump.
- Special-shape builders для door/button/lever items, если понадобится не-cube held visual.
- GUI inventory icons 3D preview.

# Next recommended work

Локально проверить сцены A–E и при необходимости подкрутить только профили transform, не геометрию.

# Git

Работа на `cursor/lighting-torch-selection-fix-935a`. Commit/push не делались — по явной просьбе пользователя до подтверждения.
