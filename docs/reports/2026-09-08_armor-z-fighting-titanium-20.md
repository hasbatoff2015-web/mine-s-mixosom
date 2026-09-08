# Armor z-fighting + Titanium 20

## Goal

Убрать camera-dependent flicker на пересечениях armor cuboids без изменения Minecraft-style silhouette и поднять полный Titanium set с 19 до 20 armor points.

## Result

Armor переведена из ordinary transparent queue в opaque alpha-cutout path. Пересечения shoulders, boots и leggings получают стабильный material-independent order и минимальный deterministic polygon depth bias, добавленный только после того, как dynamic QA показал остаточный coplanar pattern на косом crouch angle. Повторный QA Ruby/Titanium и регрессия существующих материалов прошли без наблюдаемого мерцания.

Titanium leggings дают 6 points; полный set даёт 20 points, 80% flat protection и десять полных HUD icons.

## Implemented

- Сохранены `alphaTest=0.1`, `depthTest=true`, `depthWrite=true`; `transparent` изменён на `false` для leather, chainmail, gold, iron, diamond, ruby, titanium и leather overlay.
- `ARMOR_PART_RENDER_PRIORITY`: body/head 0, rightArm/rightLeg 1, leftArm/leftLeg 2.
- Base `renderOrder`: 20, 21, 22. Overlay: 30, 31, 32.
- Entity-owned materials разделены по priority. Для priority 0 polygon offset выключен; priority 1 использует factor/units `-1/-1`; priority 2 — `-2/-2`.
- Geometry, UV, atlas, mesh positions/scales, player pivots, outer inflate 1 px и inner inflate 0.5 px не менялись.
- Titanium armor: helmet 3, chestplate 8, leggings 6, boots 3.

## Changed files

- `src/rendering/player/PlayerArmorVisual.ts`
- `src/items/registry.ts`
- `tests/player-armor-visual.test.ts`
- `tests/armor-hud.test.ts`
- `tests/ruby-titanium-equipment.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/reports/2026-09-08_ruby-titanium-equipment.md`
- `docs/reports/2026-09-08_armor-z-fighting-titanium-20.md`

## Architecture decisions

- Сохранён один `PlayerArmorVisual`; новая armor/rig/material system не создавалась.
- Opaque cutout исключает Three.js transparent distance sorting, сохраняя прозрачные texels через alpha test.
- `renderOrder` и polygon bias выводятся из одной part-priority policy и не зависят от equipped material.
- Малый polygon bias принят как второй уровень исправления на основании воспроизводимого QA, а не как position/scale hack. Depth test/write остаются включены.
- Flat protection formula, `MAX_ARMOR_POINTS`, protocol и authoritative equipment pipeline не менялись.

## Tests

- `npm run test -- tests/player-armor-visual.test.ts tests/armor-hud.test.ts tests/ruby-titanium-equipment.test.ts tests/player-armor-network.test.ts --maxWorkers=2`: **34/34 PASS**, 4/4 files.
- Material tests покрывают opaque cutout/depth semantics для всех armor materials и leather overlay.
- Render tests покрывают exact part priorities/orders, material independence и matching polygon bias.
- Balance/HUD tests покрывают Titanium leggings 6, total 20, reduction 80% и HUD `10 full / 0 half / 0 empty`.
- `npm run typecheck`: PASS.
- `npm run typecheck:client`: PASS.
- `npm run typecheck:server`: PASS.
- `npm run typecheck:sim`: PASS.
- `npm run check:boundaries`: PASS.
- `npm run build`: PASS, 249 modules; existing `/sdk.js` and >500 kB chunk warnings only.
- `git diff --check`: PASS.

## Visual QA

Проверен local WebGL route `?qaPlayer=1` в Codex in-app Chromium. До polygon bias при Titanium full set, crouch и oblique rotation воспроизводился меняющийся тонкий pattern в shoulder/body overlap. После factor+units bias повторно проверены:

- Ruby full set: front/back/oblique, walk, sprint, sneak, jump, attack.
- Titanium full set: front/back/oblique, walk, sprint, sneak, jump, attack.
- Iron and Diamond full-set regression.
- Leather full set и untinted overlay поверх tinted base.
- Shoulders, boots center seam и leggings seam на крайних yaw значениях.

Наблюдаемого camera-dependent flicker после финального исправления нет. Browser warn/error console пуст.

## Performance

Geometry и texture caches не менялись. Per-player material clones остаются bounded; part priority может создать отдельные owned clones для трёх значений bias, но не добавляет per-frame allocations, scans или material mutations.

## Known issues

Известного воспроизводимого z-fighting после финального QA нет. Остаточный низкий риск связан с различиями depth precision/WebGL drivers на реальных устройствах; policy покрыта deterministic property tests, но не GPU matrix. Polygon offset применяется только к overlapping priority 1/2 armor parts.

## Deferred

- Отдельная физическая mobile/GPU matrix и длительный вращательный soak.
- Armor toughness, penetration, wear mechanics и first-person armor остаются вне scope.

## Next work

При следующем device QA повторить медленный полный оборот камерой на Ruby/Titanium full sets и проверить низкоточные mobile GPUs; менять geometry/inflate только в отдельной задаче при доказанном driver-specific regression.

## Git

- Branch: `codex/ruby-titanium-assets`.
- Starting HEAD: `5d7769f455c78a4da8894d29ed1e50d1853d8bea` (Ruby/Titanium integration already present on the branch).
- No commit, push, merge, rebase or protocol bump performed in this task.
