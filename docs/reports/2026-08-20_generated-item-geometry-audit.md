# Generated-item geometry audit and inspect QA

Дата: 2026-08-20  
Ветка: `cursor/minecraft-item-pipeline-rework-935a`

## Goal

Остановить подбор held pose на глаз. Сверить `GeneratedItemGeometry` с Minecraft `item/generated` / `item/handheld` (front/back/depth/spans/UV/shading), добавить isolated inspect + side-debug QA, исправить найденный root cause. Контрольный asset — `iron_pickaxe.png`. Pose не утверждать.

## Result

Span/merge/depth/front-back уже были правильными. «Зубья» на кирке — в основном 1-texel stair-steps диагонали 32×32 плюс две реальные ошибки оболочки: inverted side winding и collapsed UV на границе texel (nearest мог брать transparent neighbor). Mob wrap-shade затемнял DOWN/LEFT стороны. Isolated inspect/`qaSideDebug` добавлены. Production held pose **не менялся** (`scale 0.85` по-прежнему временный baseline). `npm run check` green. Commit/push не выполнялись.

## Implemented

- Isolated `?qaItem=` inspect: центр, крупно, без bob/swing, простой фон, `qaView=front|back|left|right`.
- `qaSideDebug=1`: front texture, dim back, стороны UP red / DOWN green / LEFT blue / RIGHT yellow.
- Overlay + `console.info('[item-geom]')`: texture size, opaque count, spans по facing, raw edges, depth, bounds, verts/tris, UV ranges.
- `qaView=held` — прежний first-person; `held*` только там.
- Outer-shell winding для side faces.
- Collapsed side UV = центр opaque texel.
- Generated item material `wrap: false` (voxel light drops сохраняется).

## Changed files

- `src/rendering/GeneratedItemGeometry.ts`
- `src/rendering/ItemVisualFactory.ts`
- `src/rendering/worldLighting.ts`
- `src/rendering/heldItemQa.ts`
- `src/dev/ItemQaHarness.ts`
- `tests/item-rendering.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/TESTING.md`
- `docs/MINECRAFT_1_9_REFERENCE.md`
- `docs/reports/2026-08-20_generated-item-geometry-audit.md`

Не менялись: `specialBlockGeometry` (placed torch), `ArrowVisualFactory`, lighting/torch world path, first-person pose numbers, block item cubes.

## Architecture decisions

- Debug живёт в существующем `ItemQaHarness`, не во второй renderer-системе.
- `qaSideDebug` строит отдельную geometry с vertex colors и не пишет её в production cache.
- Pose не крутили в этом pass: сначала inspect URLs.

## Tests

`npm run check`: typecheck PASS, 21 files / 135 tests PASS, Vite 73 modules, 0.93 MiB / 165 files. Main JS 725.87 kB / 195.20 kB gzip.

Regression: `faces front, back and every side family out of the item volume` (`dot(normal, expectedFacing) > 0.99` for FRONT/BACK/UP/DOWN/LEFT/RIGHT plus plus-mask winding). `uses texel-center collapsed UV so nearest-filter stays on the opaque pixel` (32×32, collapsed UV inside opaque texel, not on boundary, not in transparent neighbor).

## Visual QA

Cloud WebGL visual QA не выполнялся. Unit-тесты закрывают spans `iron_pickaxe.png`, winding и UV. Локальные URL — в ответе агента.

## Known issues / Deferred

- Held pose `0.85` / `[0.50, -0.56, -0.82]` / roll 14° не утверждён.
- 32×32 диагонали легитимно «зубчатые»; это не баг merge.
- Door/button/lever/cross held mesh по-прежнему cube.

## Git

Commit `fix: correct generated item side rendering` on `cursor/minecraft-item-pipeline-rework-935a`. No merge to `main`.
