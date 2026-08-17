# Goal

Одним проходом довести ощущение от камеры, first-person предметов, лука/стрел, трёх проблемных мобов и растительности до согласованной playable-alpha планки, не ломая fixed `20 TPS`, локальные незакоммиченные изменения и уже работающий survival loop.

# Camera judder root cause

Pointer input обновлял yaw/pitch чаще simulation loop, но world camera читала углы из `PlayerController`, обновляемого только раз в `50 ms`. При высокой частоте кадров обзор визуально стоял несколько frames, затем перескакивал на очередной simulation angle. Это была временная квантизация render state, а не низкий FPS или ошибка interpolation позиции.

# Camera fix

`applyImmediateRenderLook()` применяет live `InputManager.yaw/pitch` к world camera каждый `requestAnimationFrame`; gameplay physics и сериализуемый player view продолжают обновляться fixed ticks. Новый тест меняет input между simulation ticks и проверяет немедленный camera rotation, одновременно фиксируя контракт `20 TPS`/`0.05 s`.

# Empty hand

Пустой main slot показывает отдельный Steve-arm cuboid с настоящей `entity/steve.png` и legacy UV region рукава. Геометрия и поза компактны в нижнем правом углу. При любом held main-hand item arm полностью скрывается, поэтому предмет больше не выглядит приклеенным поверх второй независимой руки.

# Held items

Block items остаются объёмными atlas cubes. Handheld/generated/bow/shield получают собственные profiles и stable transforms; feather, coal, stick, apple, sword и pickaxe визуально проверены в браузере. Поза вычисляется из базового preset на каждом frame и не накапливает transform drift.

# Generated item geometry

Плоский box заменён на `GeneratedItemGeometry`: front/back повторяют sprite, боковые грани строятся только по переходам opaque→transparent в alpha mask. Соседние horizontal/vertical edges объединяются в spans, поэтому нет кубика на каждый пиксель. Глубина `0.08`, geometry/material/texture кэшируются и используются и first-person, и dropped items. Это не bit-exact Mojang `ItemModelGenerator`: side UV — boundary-strip approximation.

# Dropped item rendering

`DroppedItemManager` использует тот же `ItemVisualFactory`: block item — настоящий cube, обычный item — silhouette mesh с толщиной. Bob/rotation и thresholds `1/2/17/33` дают максимум четыре bounded stack copies без создания новых GPU resources во frame loop. В QA проверены apple, feather, coal, sticks и stone.

# Bow states

В whitelist и runtime подключены `bow_pulling_0/1/2`. First-person renderer дискретно выбирает standby/partial/full texture по draw progress, добавляет небольшое дрожание полного натяжения, Game ограничивает скорость множителем `0.2`, блокирует sprint и плавно сужает FOV максимум на `8°`.

# Arrow physics

Player и skeleton используют общий `ArrowPhysics` в blocks/tick. Full charge равен `3 blocks/tick`; каждый tick выполняются movement/continuous segment collision, затем air drag `0.99` или water drag `0.6` и gravity `0.05`. Gaussian inaccuracy нормализуется к исходной launch speed. Damage зависит от текущей скорости. Block hit переводит projectile в `inGround` до восьмисекундного bounded lifetime.

# Arrow visual

`ArrowVisualFactory` загружает локальный `entity/projectiles/arrow.png`, использует legacy arrow region и создаёт общий crossed-plane mesh с ориентацией по velocity. Geometry, material и texture создаются один раз на factory; полёт не оставляет trail meshes.

# Skeleton projectile reuse

`Game` владеет одним `ArrowVisualFactory` и передаёт его `PlayerArrowManager` и `MobManager`. Skeleton shot использует тот же drag, gravity, water behavior, block collision, in-ground representation, orientation и cleanup; отличаются только aim compensation, launch speed/inaccuracy и player-damage routing.

# Zombie fix

Сравнение реального sheet и front/side/three-quarter QA подтвердило корректность существующих biped dimensions, pivots и UV. Регрессией оказался полупрозрачный fringe outer headwear. Исправление локальное: `alphaTest=0.45` только для inflated headwear; guessed offsets и глобальные mob-material изменения не добавлялись.

# Skeleton torso fix

Только skeleton body box получил `doubleSided`, чтобы thin torso/ribs/spine читались спереди и сзади. Material cache учитывает side mode. Zombie body и остальные обычные cuboids остаются `FrontSide`; regression test проверяет обе стороны этого контракта.

# Sheep fix

Base skin legs увеличены с `4×6×4` до `4×12×4`, поэтому коричневые ноги достигают земли. Wool leg overlay остаётся `4×6×4` с inflate `0.5` и заканчивается выше; это убирает впечатление парящего тела, не меняя physics AABB.

# Vegetation blocks

Добавлены stable block IDs `130–135`: tall grass, fern, dandelion, poppy, oxeye daisy и dead bush. Все non-solid, non-occluding, replaceable, cutout, `renderShape: cross`, без item/drop/farming/dye semantics. Raycast видит растение для разрушения, а placement заменяет его cell. Mesher пишет две пересекающиеся плоскости растения в общий cutout buffer чанка; отдельных scene objects нет.

# Biome decoration generation

Растения создаются детерминированно тем же seeded chunk RNG после trees/cactus. Forest получает плотный tall-grass/fern undergrowth и редкие flowers, plains — умеренный tall grass и dandelion/poppy/oxeye daisy, desert — редкие dead bushes рядом с cactus. Generator проверяет air target, grass/sand support, surface выше sea level и уже занятые tree/cactus cells.

# Performance

F3 в реальном forest-мире держал примерно `178–180 FPS`, fixed `20 TPS`, frame `5.56 ms` (`p95 5.70 ms`), tick около `0.94–1.16 ms`, `81/81` chunks, `137358` faces, `125852` triangles, `96` calls и `16` mobs. CPU benchmark: generation avg/p95 `15.400/18.375 ms`, meshing `18.222/23.071 ms`, scan `16.728/21.610 ms`, geometry `1.479/2.041 ms`, 24-mob tick `0.896/1.650 ms`; benchmark world `233331` faces.

# Visual QA

Во встроенном браузере проверены реальный Creative forest world, empty/held/drop item scenes, три bow stages, три arrow trajectories, mob views и отдельные plains/forest/desert vegetation scenes. Skeleton ribs читаются с двух сторон, sheep feet стоят на земле, zombie headwear чистый, растения соответствуют биомам. Browser API не позволил синтетически передать pointer-lock movement; fast physical mouse rotation остаётся ручной проверкой, а timing regression закрыт точным unit test и live render path audit.

# Tests

Финальный набор: TypeScript green, `15` файлов / `83` Vitest tests green. Новые проверки покрывают live render look, generated silhouette depth/sides, empty-hand visibility, common arrow constants, projectile texture mesh, vegetation definitions/determinism и targeted mob materials/leg lengths.

# Build

Importer: `161/161` runtime assets. Vite: `63` modules. Production: `0.90 MiB`, `164` files; main JS `693.81 kB` (`184.82 kB` gzip), CSS `12.90 kB` (`3.82 kB` gzip). Size/archive checks green. Dev-only `ItemQaHarness`, `ArrowQaHarness` и `VegetationQaHarness` tree-shaken и отсутствуют в `dist`.

# Known remaining issues

- Нужен physical fast-mouse/pointer-lock smoke на целевых устройствах; browser automation не умеет генерировать нужный movement event в этом окружении.
- Попавшие стрелы пока нельзя поднять: они остаются `inGround` только до timeout.
- Arrow visual — cropped crossed-plane approximation, не полный vanilla `ModelArrow` cuboid.
- Generated side UV/spans не заявляют bit-exact Mojang `ItemModelGenerator`.
- Некоторые special block items (например torch/lever) в hand/ground всё ещё используют block-cube representation.
- Off-hand кроме shield не прошёл отдельную parity-полировку.
- Vegetation не имеет drops, dyes, farming или spreading semantics.
- Реальные mobile multi-touch, Yandex draft и asset provenance approval остаются release blockers.
