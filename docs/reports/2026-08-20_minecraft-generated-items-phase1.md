# Minecraft generated items — Phase 1

Дата: 2026-08-20  
Ветка: `cursor/minecraft-item-pipeline-rework-935a`  
База: `64c79b69eed0fa38f37945ddb6550d8548527c8e`

## Goal

Приблизить стандартные held items к vanilla Minecraft `item/generated` / `item/handheld` pipeline на текущей архитектуре (`GeneratedItemGeometry`, `ItemVisualFactory`, `itemRenderProfiles`, `FirstPersonRenderer`), без family meshes (`e63881e`) и без row-span front geometry (`20dae02`).

## Result

Phase 1 реализован в существующих модулях. Front/back — цельные quads, толщина `1/16`, side spans по `alpha == 0`, 32×32 pack не меняет model size. Generated и handheld делят один first-person pose через Minecraft→Three.js adapter. Held torch и arrow идут через generated sprite. Bow — texture swap с порогами `0.65/0.9`. `npm run check` зелёный. Commit/push не делались — нужен локальный visual QA.

## Implemented

- Vanilla-like generated geometry: один front, один back, mirrored U, depth `0.0625`.
- Side faces только на opaque→transparent boundaries, merge соседних spans одного facing.
- Texture resolution мапится в фиксированные 16×16 model units.
- Routing: swords/pickaxes/axes/shovels/stick → handheld; обычные sprites → generated; torch held → generated; stone → block cube; bow → generated override path.
- Общий first-person pose для generated, handheld и bow.
- Bow pull textures: `0+` → `pulling_0`, `>=0.65` → `pulling_1`, `>=0.9` → `pulling_2`. Убран extra bow pose offset.
- Cache: PNG scan и geometry один раз на texture path.

## Changed files

- `src/rendering/GeneratedItemGeometry.ts`
- `src/items/itemRenderProfiles.ts`
- `src/rendering/ItemVisualFactory.ts`
- `src/rendering/FirstPersonRenderer.ts`
- `tests/item-rendering.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/TESTING.md`
- `docs/reports/2026-08-20_minecraft-generated-items-phase1.md`

Не менялись: `specialBlockGeometry` (placed torch), `ArrowVisualFactory` (projectile), `MINECRAFT_1_9_REFERENCE.md`.

## Architecture decisions

- Не создавать параллельные `*2` системы. Доправить `GeneratedItemGeometry` на `64c79b6`.
- Front силуэт = alpha texture, не meshed pixels.
- `item/handheld` не получает отдельную 3D tool geometry: кирка остаётся generated sprite.
- Vanilla Euler `[0,-90,25]` не копируется в Three.js: Y=-90 — basis conversion (камера MC vs Three.js -Z).
- Held torch ≠ placed torch.

## Tests

`npm run check`: typecheck PASS, 21 files / 129 tests PASS, Vite 72 modules, 0.92 MiB / 165 files.

Новые/расширенные проверки в `tests/item-rendering.test.ts`: один front/back, нет row-span fronts, depth `1/16`, alpha==0 + span merge, 32×32 size, routing, bow thresholds, cache, torch/arrow generated path.

## Visual QA

В этой среде visual WebGL QA не выполнялся. Unit-тесты подтверждают geometry/routing. Локальный список — в секции Manual QA отчёта агента.

## Performance

PNG decode + alpha scan в `preload()` один раз на texture. Geometry/material кэшируются по path. Нет per-frame rebuild. Стороны — spans, не pixel cubes. Static 32×32 silhouette обычно десятки–сотни tris и допустима, потому что mesh кэширован.

## Known issues / Deferred

- Door/button/lever/cross по-прежнему classified `generated` для pose, но held mesh остаётся cube (вне representative Phase 1).
- Shield entity, chest inventory, slab/stairs inventory, leather overlay — не трогались.
- Block first-person pose не приоритет Phase 1; stone cube без изменений.
- First-person имеет project-level hand offset и global scale vs literal vanilla `0.68`.
- Локальный visual QA не пройден.

## Next work

Локально проверить representative items. После QA — commit по явной просьбе. Затем special cases (shield, inventory block models), не family meshes и не row-span fronts.

## Git

Ветка и HEAD как на старте Phase 1. Working tree dirty. Commit/push не выполнялись.
