# Goal

Исправить четыре конкретных дефекта Frontier Cubes: authored bucket/potion/minecart visuals, projectile arrow geometry/UV, placement на факеле и полное удаление shield. Сохранить локальные fluid routing/timing/bucket/lava-item изменения. Не выполнять PvP 1.8 conversion, commit или push.

# Local baseline

Ветка `feat/playable-voxel-alpha`, tracking `origin/main`. HEAD = origin/main = `8935772e6edd8137a19755a8a7759d197bce4c28`. Проверены status/branch/vv/log/revisions/diff. Работа не начиналась с clean tree.

До прохода изменены docs/ARCHITECTURE.md, docs/PROJECT_STATE.md, docs/TESTING.md, scripts/benchmark-fluids.ts, src/core/Game.ts, src/entities/DroppedItemManager.ts, src/items/registry.ts, src/world/World.ts, src/world/fluids.ts, tests/fluids.test.ts (526 additions / 121 deletions). Untracked: два fluid reports от 2026-08-27, src/items/bucketInteraction.ts, tests/bucket-interaction.test.ts, dropped-item-environment.test.ts, fluid-routing.test.ts, fluid-timing.test.ts. Всё сохранено, запрещённые Git cleanup/reset/stash/restore/pull/rebase/config операции не выполнялись.

Исходный полный test run: 579/603 pass, 24 failures, 1 worker timeout, 179.41 s. Это диагностический запуск во время работы, а не атомарный снимок: один asset test успел увидеть удалённый runtime shield при ещё старом registry module. Его нельзя приписывать baseline; после синхронизации кода он проходит. Остальные известные группы — generated source CRLF fingerprint, fluid/lighting streaming budgets и CPU test timeouts. Предыдущий fluid report уже фиксировал эти классы failures. Лог: `.qa-screens/cleanup-baseline-tests.log` (локальный ignored artifact).

# User-visible bugs

- Ведра, зелья и minecart item выглядели как простые прямоугольники, несмотря на authored PNG в source pack.
- Projectile был широким полосатым крестом; рисунок и длина стрелы не совпадали с геометрией.
- Ray hit по thin torch мог стать anchor для соседнего блока/ещё одного факела.
- Shield был лишь hidden from gameplay: старые stacks всё ещё активировали block, slowdown, durability и first-person pose.

# Authored item asset root cause

Importer искал `items/bucket.png` и `items/potion.png`, которых нет. Правильные source names — bucket_empty и potion_bottle_empty. Water/lava buckets и minecart item были optional mappings, но фактические public PNG оставались procedural placeholders. Entity minecart и potion layer composition вообще отсутствовали в authored pipeline. Ручная правка только public не устранила бы воспроизводимость.

# Asset mappings found

Пути source относительно `assets/minecraft/textures`, runtime относительно `public/textures`:

| Source | Runtime | Dimensions |
| --- | --- | --- |
| items/bucket_empty.png | item/bucket.png | 32×32 |
| items/bucket_water.png | item/water_bucket.png | 32×32 |
| items/bucket_lava.png | item/lava_bucket.png | 32×32 |
| items/minecart_normal.png | item/minecart.png | 32×32 |
| entity/minecart.png | entity/minecart.png | 128×64 |
| items/potion_bottle_empty.png | item/glass_bottle.png | 32×32 |
| items/potion_bottle_drinkable.png + items/potion_overlay.png | item/potion_invisibility.png | 32×32 |
| те же layers | item/potion_regeneration.png | 32×32 |
| entity/projectiles/arrow.png | entity/arrow.png (уже совпадал, не менялся) | 64×64 |

Ни исходники, ни scope набора не расширены. Milk bucket/другие carts/другие potions не добавлялись. Лицензия pack по-прежнему требует подтверждения перед публикацией.

# Generated fallback root cause

`generateMissingTextures(false)` сохранял любой существующий PNG; неправильный 16×16 rectangle не считался stale. Force mode, наоборот, мог перезаписать authored файл procedural рисунком. Для entity minecart генерировался 32×32 прямоугольник вместо 128×64 UV sheet. Это ошибочное владение outputs, не дефект GeneratedItemGeometry или hand pose.

# Asset pipeline fix

`authored-item-assets.mjs` — required mappings, цвета эффектов, deterministic composition. Сначала прочитать все required sources и собрать outputs; missing source/unsupported bottle format прерывает import до записей. Потом overwrite восьми outputs. `png-rgba.mjs` декодирует именно non-interlaced RGBA8 bottle layers, поддерживает filters 0–4 и кодирует lossless PNG. Tint overlay RGB, затем authored bottle/cork source-over: никаких нарисованных заново контуров, blur или resize.

Importer больше не удаляет весь public/textures. `npm run assets:import -- --items-cleanup` выполняет scoped обновление, не переписывая остальной curated pack. Полный import тоже использует required authored outputs. Procedural entries этих восьми assets удалены из fallback, поэтому даже `--force` не возвращает заглушки. Удалён единственный obsolete runtime asset `public/textures/item/shield.png` и его import mapping; source shield sheets сохранены. Старый runtime PNG восстановим из Git.

# Bucket / potion / minecart QA

Локально просмотрены реальные authored arrow/bottle/overlay/minecart sheet и итоговые bucket/potion/minecart PNG. Итоговые bottle silhouettes, glass/cork, tint и прозрачность присутствуют. Source→runtime byte equality проверена для direct copies; composition deterministic, alpha-source-over и opaque bottle pixels проверены tests. Повторный import и force fallback в изолированном temp fixture не меняют authored bytes.

GeneratedItemGeometry, ItemVisualFactory и production first-person sprite pose не изменены. Inventory/held/ground используют те же runtime texture keys. Minecart entity exterior переведён с full-sheet box UV на panel UV существующего TexturedCuboid adapter (logical64×32); opaque floor/inner lining/wheels/TNT cargo не менялись. Geometry cache предотвращает накопление одинаковых box geometries при создании carts.

Browser inventory/held/minecart acceptance пока заблокирован; PNG inspection не считается заменой.

# Arrow root cause

Старый mesh растягивал неверный crop по поперечной оси. Комментарий о 32×32/24×5 не соответствовал реальному 64×64 sheet: top содержит два mirrored 32×10 профиля, а crop 48×10 захватывал второй head. U шёл поперёк ширины вместо длины; первая normal была вдоль Z при плоскости XZ. Центрированный mesh наполовину заходил в стену при hit position около поверхности.

# Arrow geometry before

Два full-length crossed quads, 0.96 длины × 0.20 ширины, 4 triangles, одинаковый stretched crop для всего projectile. Ни отдельного shaft, ни head, ни хвостового fin region.

# Arrow geometry after

Одна cached BufferGeometry: shaft 0.028×0.028, z −0.82…−0.025; pyramid head radius 0.035, tip z +0.065; две alpha-cutout feather quads только z −0.82…−0.60, span 0.17. Общая длина 0.885. Пять shaft quads + четыре head triangles + два feather quads = **18 triangles**, один mesh/draw call. Нормали вычислены из геометрии; bounds/finite values протестированы.

# Arrow UV / orientation

Первый authored профиль смотрит в +U: wood x8..25/y4..5, head x26..31, feathers x0..8/y0..9. UV по pixel centers для shaft/head; tail cutout сохраняет authored alpha. U сопоставлен longitudinal +Z. `ARROW_FORWARD=(0,0,1)` общий для player manager, skeleton manager и QA harness. Изменены только orientation adapter imports/calls в менеджерах, не ArrowPhysics/launch speed/gravity/drag/damage/collision rules.

Normal/fire variants используют одну geometry/texture и два voxel-lit materials. Flame остаётся существующим tint distinction, не billboard и не новый physics path. Fire material создаётся каноническим createEntityMaterial, чтобы сохранить lighting shader hook.

# Arrow stuck QA

Тест реального PlayerArrowManager по ±X/±Y/±Z: при прежнем 0.035 backoff tip находится на 0.03 внутри поверхности, хвост >0.8 снаружи; quaternion и inGround pose стабильны после tick/interpolation. Skeleton использует тот же 0.035 backoff, то есть тот же 0.03 tip penetration. Модель больше не центрирована на impact; камера её не переориентирует.

Существующий ArrowQaHarness расширен: inspect/wall/ground/flying/stress, front/back/side/top/angle, normal/fire; stress 120 arrows и renderer.info counters в HUD. Реальный browser screenshot/shot acceptance не выполнен из-за блокировки.

# Torch placement root cause

Game переводил любой non-replaceable hit в adjacent destination; факел selectable, но не full block. Torch/button/lever ветки проверяли ориентацию, но не реальную опору. Ladder проверял только solid, pressure plate/rail тоже использовали общий solid flag. Это смешивало selection, anchor и sturdy support.

# Placement-anchor rules

`world/placement.ts::canUseAsPlacementAnchor`: solid, non-liquid, non-replaceable. Torch/RedstoneTorch/button/lever/wire/vegetation/fire/liquid не anchors. Solid special shape (например chest/slab/stair) может быть anchor для обычного блока, но не обязательно опорой attachment. Replaceable vegetation — same-cell replacement, не соседний floating block. Torch не помечался replaceable ради обхода.

# Attachment-support rules

`canAttachToFace` принимает world/cell/face и проверяет полное покрытие boundary collision rectangles (не union AABB). Allowed shapes cube/slab/stairs; inset chest, thin door, fence и non-solid decorations не sturdy. Slab верх/низ/double и stair solid base/stepped face различаются. Torch только floor/wall, ceiling rejected; button/lever сохраняют все orientations; ladder только wall через тот же predicate. Rail/plate/wire/door требуют floor. При same-cell replacement опора ищется под destination.

Запрет выполняется до write/consume. Game action tests покрывают stone, slab merge, stairs, door, chest, furnace, rail, plate, wire, torch matrix, vegetation replacement. Bucket interaction сохранён отдельно вместе с исходными regression tests.

**Support-loss не реализован:** удаление опоры после placement пока не вызывает автоматический break/drop. Это явно deferred, не скрытая гарантия.

# Shield removal scope

Удалены ItemId.Shield, ItemKind/shield definition union, registry entry/tags, render category/profile, gameplay obtainability, import mapping и runtime icon. `/give shield` отвергается unknown-item path; crafting recipe отсутствует. Source assets не удалены. Runtime слово shield остаётся только в минимальной legacy item migration.

# Combat changes

Удалены DEFAULT_SHIELD constants, ShieldConfig/HitOptions/HitResult, arc/chance helpers, using/active/disable/windup counters, set/resolve/disable methods, shield movement multiplier, durability/block sound и axe-disable branch. Mob/player-hit Game dispatch → SurvivalSystem.damage с armor, затем исходный knockback при dealt>0. Generic held/offhand IDs можно хранить без blocking. Старые combat поля игнорируются, unknown held/offhand IDs очищаются при restore.

Attack cooldown, strength offset, attack speed/damage profiles, crit, sprint knockback, armor formula, invulnerability, bow charge и arrow trajectory не перенастроены. Это не PvP 1.8.

# First-person changes

Удалены shieldRaised frame state, offhand-shield branch, blocking pose/constants и неиспользуемые offhand render holders/models. Generic inventory offhand API сохранён. Main item generated pose/empty arm/equip/bob/swing/mining/food/bow stages/fire/potion overlays не заменены. input.using сохранён: bow/food/potions/buckets продолжают существующие действия; bow slowdown0.2 остаётся, idle/sword/axe movement multiplier1.

# Save migration

`inventory/legacyItems.ts::migrateLegacyStack` возвращает null только для старого shield ID, не изменяя input. До validation используется в Inventory.deserialize (36 slots, armor, offhand), World.restore (chest/furnace slots с сохранением остальных fields/timers), DroppedItemManager.restore. Другие invalid IDs по-прежнему валидируются/отклоняются; не добавлен blanket catch для всего inventory. Предыдущая restoreBucketInventory normalization/overflow сохранена и совместно протестирована. Combat.restore не воскрешает obsolete state.

# Tests

Targeted **205/205, 19 files**, 10.45 s, включая authored pipeline, arrow model/physics/fire, placement, shield migration/damage, chat, item rendering, crafting/inventory, potions, fluids/routing/timing/buckets/lava items. Typecheck/build PASS; size/archive PASS **3.45 MiB /186 files**, main JS958.78 kB/gzip268.17 kB,126 modules. `git diff --check` PASS.

Полный `npm test -- --maxWorkers=2`: **633/656 pass, 23 failures, 1 worker error**, 209.07 s. `npm run check` с default workers: typecheck PASS, **630/656 pass, 26 failures, 2 worker errors**, 162.86 s; pipeline остановился на test stage. Build/size/archive поэтому выполнены отдельно и PASS. Эти full runs предшествуют одному дополнительному тесту minecart panel/cache; он входит в финальный targeted rerun.

Failure groups: 3 fluid-streaming и 1 lighting-scheduler assertion (`14816.667 ms` vs `<8000`), неизменённый GeneratedItemGeometry raw fingerprint (`e71967bd`; нормализация CRLF→LF даёт ожидаемый `be428190`), CPU timeouts в fire/sunlight/minecart/worldgen/lighting. При default concurrency дополнительно timeout в hostile spawn, lava multi-seed, mob flash, streaming sim. Targeted cleanup tests не падают. Expectations/timeouts/fingerprint не ослаблялись; renderer/physics файл fingerprint не менялся. Полные логи `.qa-screens/cleanup-full-tests.log`, `cleanup-canonical-check.log`.

# Browser QA

**BLOCKED, не PASS.** Browser skill использован для проверки доступного сеанса. Ранее navigation/reload localhost4173 было явно отклонено policy; в текущем проходе browser.tabs и user.openTabs пусты. Не использовались обходы через alternate host/browser/CDP/standalone Playwright. Нет честных WebGL screenshots A–F или FPS numbers. Для завершения acceptance нужен разрешённый browser session.

Подготовлены URL и ручные шаги A–F в docs/TESTING.md, ArrowQaHarness поддерживает все требуемые направления/состояния. PNG просмотр и CPU/unit/component проверки не выдаются за browser validation.

# Performance

Arrow 18 triangles вместо4, но всё ещё один mesh/draw call на projectile. 240 sequential shots → активный cap48, geometry1/materials2/texture1, после dispose manager scene пустая. Это CPU resource-identity test, не GPU/FPS измерение. Shader hook сохранён у normal/fire. Minecart box geometry shared by dimensions/role. PNG composition выполняется только build-time; нет новых per-frame scans. Placement rectangle coverage вызывается только на use action, не fixed tick. Meshing/lighting/fluid budgets не менялись этим cleanup.

`npm run benchmark:fluids` завершён (exit0): water spread max tick2.443 ms, lava1.567 ms; compute update p95 water0.12358 ms/lava0.05544 ms. Hills сохранили 134/42 cells,12 falling cells,3 landing columns, lateWrites0, queue0 — те же topology results, что до cleanup. Dry/fluid mesh14.645/25.233 ms,512/704 faces. Streaming benchmark остаётся проблемным: nearMissingMax17,783.333 ms, wanted p95~5,183–5,200 ms; это не green performance acceptance. Лог `.qa-screens/cleanup-benchmark-fluids.log`.

`npm run benchmark:performance` завершён (exit0):81 chunks/373193 faces; generation p95 27.717 ms, meshing p95 55.939 ms, mesh-scan p95 53.358 ms, CPU geometry upload p95 2.667 ms;24 mobs tick average0.851 ms/p95 1.049 ms,600 samples. Это CPU baseline, не browser FPS. Лог `.qa-screens/cleanup-benchmark-performance.log`. Финальный targeted rerun:205/205,19 files,10.45 s, включая дополнительную minecart UV/cache проверку; typecheck повторно PASS.

# Files changed

Новые: scripts/authored-item-assets.mjs, scripts/png-rgba.mjs, src/world/placement.ts, src/inventory/legacyItems.ts, tests/authored-item-assets.test.mjs, tests/arrow-visual-cleanup.test.ts, tests/placement-support.test.ts, tests/shield-removal.test.ts, этот report.

Изменены в cleanup: scripts/import-assets.mjs, scripts/generate-missing-textures.mjs; 8 runtime PNG + удалённый shield PNG; src/combat/CombatSystem.ts, PlayerArrowManager.ts; src/entities/MobManager.ts, DroppedItemManager.ts; src/core/Game.ts; src/items/types.ts, registry.ts, itemRenderProfiles.ts; src/inventory/inventory.ts; src/rendering/ArrowVisualFactory.ts, FirstPersonRenderer.ts, minecartGeometry.ts; src/dev/ArrowQaHarness.ts, ItemQaHarness.ts; src/world/World.ts; tests/block-registry, chat-commands, combat, crafting, held-item-vanilla-transform, inventory, item-rendering, potion-effects-hud, special-block-items; docs/PROJECT_STATE, ROADMAP, ARCHITECTURE, TESTING, ASSET_AUDIT, MINECRAFT_1_9_REFERENCE.

Предыдущие uncommitted fluid files/reports остаются частью общего working tree. GeneratedItemGeometry.ts, ItemVisualFactory.ts и ArrowPhysics.ts без diff.

# Known limitations

- Browser acceptance A–F и GPU/FPS measurement заблокированы, задача не объявляется полностью визуально принятой.
- Support-loss после разрушения опоры deferred.
- Full-suite baseline CRLF/performance/timeouts требуют отдельного расследования; не скрыты настройками tests.
- Source pack license/provenance не подтверждён для публичного релиза.
- Source-copy/composition tests требуют локальный пользовательский assets pack (исходная папка не хранится в Git); importer при его отсутствии выдаёт ошибку и не стирает public textures.
- Full import обновляет весь whitelist; для этого cleanup использован scoped mode, чтобы сохранить unrelated curated textures.

# Next step: PvP 1.8 pass

Сначала завершить browser QA данного cleanup. Затем отдельная пользовательская задача на PvP 1.8: уточнить no-cooldown attack cadence, sword blocking (если требуется), damage/crit/sprint/knockback/invulnerability contracts и их regression matrix. Shield не возвращать. **В этом проходе PvP 1.8 НЕ реализован.**

# Git status

HEAD/origin/main остаются `8935772`, ветка не менялась, working tree dirty by design. Commit/push/config/clean/reset/stash/restore/pull/rebase/force не выполнялись. Из material files удалён только авторизованный obsolete runtime shield PNG, восстанавливаемый из Git; source assets и чужие untracked файлы сохранены.
