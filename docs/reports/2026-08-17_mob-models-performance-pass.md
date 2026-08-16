# Goal

Перестроить восемь мобов на корректном legacy Java model-space, исправить UV/animation/separation, найти фактический main-thread bottleneck, снизить chunk spikes, убрать atlas shimmer и не сломать lever, gameplay или production archive.

# Result

Добавлен единый model-space adapter и code-defined rigs для cow, pig, sheep, chicken, zombie, skeleton, creeper и spider. CPU meshing в изолированном benchmark ускорен в среднем с `79.148 ms` до `16.957 ms` при неизменных `229755` faces. Atlas получил mip-safe gutters/extrusion, mipmaps и anisotropy. F3, scheduler и HUD стали дешевле и информативнее. Финальный pipeline: `68/68` tests, build/size/archive green.

# Mob model root cause

Старый path смешивал `setRotationPoint` и `addBox origin`, то есть pivot и локальную геометрию трактовал как одну позицию. Из-за этого пропорции визуально дрейфовали, конечности вращались вокруг центров boxes, а разные модели требовали несвязанных ручных поправок. Дополнительно legacy V-down texture coordinates использовались как Three.js V-up.

# New model-space architecture

`src/entities/LegacyModel.ts` принимает одну или несколько `LegacyModelDefinition`, создаёт hierarchy `root → named pivot Group → textured cuboids`, объединяет совпадающие имена parts для overlay layers и сохраняет `baseRotationX/Y/Z`. Gameplay AABB/AI не зависят от render hierarchy. Полная таблица чисел и статусов точности находится в `docs/MOB_MODEL_REFERENCE.md`.

# Coordinate conversion

Контракт: `16 model units = 1 block`, default legacy ground `Y=24`. Pivot `(x,y,z)` становится `(x/16,(24-y)/16,z/16)`. Center локального `addBox(origin,size)` равен `(origin + size/2)` с отражённым знаком Y. После отражения Y Euler mapping равен `(-rx, ry, -rz)`. UV V преобразуется как `1-v`.

# Cow

Восстановлены отдельные head pivot, horns, body с `π/2`, udder и четыре длинные ноги. Front/side/rear/three-quarter QA подтвердил читаемые голову, туловище, вымя, опору ног и отсутствие вращения boxes вокруг собственных центров.

# Pig

Восстановлены 8×8×8 head, отдельный snout, legacy body pivot/rotation и короткие ноги. Four-view QA подтвердил силуэт, морду и посадку на плоскость.

# Sheep

Base skin и wool являются разными definitions/sheets, но используют общие articulated part names/pivots. Fleece имеет отдельные inflation values; тест гарантирует наличие обоих слоёв и совпадение hierarchy.

# Chicken

Использованы отдельные head, beak, wattle, body, две ноги и два wing pivots. Wing flap вычисляется от base pose, а не накапливается. Three-quarter QA после исправления V показал корректное размещение частей и sheet regions.

# Zombie

Zombie больше не переиспользует общий условный humanoid: у него собственные 64×64 definition, outer head layer, arms/legs и forward-arm pose. Walk/attack offsets добавляются к неизменной base rotation.

# Skeleton

Skeleton имеет отдельную 64×32 definition с тонкими `2×12×2` arms/legs и собственной ranged pose. Это alpha bow-pose approximation, а не полный vanilla held-item transform.

# Creeper

Head/body/four-leg pivots восстановлены по legacy layout. Fuse/gameplay logic не менялся; visual scale pulse остаётся bounded alpha approximation.

# Spider

Использованы восемь отдельных leg pivots, legacy asymmetric base Y/Z angles, neck/head/abdomen и emissive-style eyes overlay. Walk phase изменяет base angles знакопеременными offsets и не выпрямляет ноги каждый frame.

# Animation

Каждый кадр задаёт `baseRotation + offset`; ни один angle не берётся из результата предыдущего кадра. Quadrupeds используют диагональные swing signs, bipeds/chicken — противоположные стороны, spider — четыре phase pairs, zombie/skeleton — отдельные arm poses.

# Entity separation

Добавлен мягкий horizontal steering при перекрывающихся AABB по высоте. Проход allocation-free, рассматривает unordered pairs и жёстко ограничен `1024` checks/update. Это предотвращает визуальное слипание без тяжёлого rigid-body solver.

# Lever regression

Сигнал, serialization v2 и placement path не менялись. Новый automated regression строит geometry для `floor/wall/ceiling × north/south/east/west × off/on` — 24 комбинации — и проверяет non-cube vertex count, bounded geometry и разный handle transform. Старые angle/round-trip/v1 fallback tests сохранены.

# Performance root causes

Профилирование показало, что основной CPU spike создавал `ChunkMesher`: многократные registry map lookups, world coordinate/block access, neighbor lookup и noise `columnAt()` внутри visible-face path. Generation и mesh rebuild также могли попадать в один fixed tick. Mob animation/AI при 24 сущностях не был главным hotspot.

# Texture shimmer root cause

Block atlas использовал content tiles без mip levels и без изолирующего padding. На дальних поверхностях это давало unstable minification; простое включение mipmaps без gutters смешало бы соседние tiles.

# Texture atlas changes

Atlas теперь power-of-two, content tile `32×32`, cell `40×40`, gutter `4 px`. Edge/corner texels экструдируются во весь gutter, UV остаются внутри content. Magnification — nearest, minification — nearest inside mip plus linear transition between mip levels, mipmaps включены, anisotropy ограничена `4` на coarse pointer и `8` на desktop, но не выше capability.

# Chunk CPU optimization

Block registry получил O(1) indexed definition lookup. Generated chunks сохраняют height/biome arrays. Mesher сканирует плотный `Uint16Array`, заранее получает четыре neighbor arrays, разворачивает шесть cube faces и использует cached columns для light/tint. Face count эталонного мира остался `229755`.

# Worker architecture

Worker не добавлен. Изолированный профиль подтвердил конкретный main-thread mesh hotspot и после его устранения дал примерно `4.7×` improvement среднего времени. Scheduler уже не совмещает generation и meshing в tick. Worker остаётся P1-кандидатом после замеров на слабом целевом устройстве; преждевременный перенос потребовал бы protocol/cancellation/copying без доказанной необходимости этого прохода.

# Rendering optimization

`WorldRenderer.rebuildDirty(maxChunks,timeBudgetMs)` ограничивает jobs и прекращает batch после бюджета. Dirty state coalesces повторные изменения; prune освобождает geometry. Sky interpolation переиспользует Colors, player interpolation — Vector3, projection matrix обновляется только при заметном FOV delta.

# HUD/render-loop optimization

HUD обновляется `10 Hz`, DOM text/class/style меняются только при новом значении. F3 текст пересобирается раз в семь ticks и показывает frame avg/p95/spike, tick avg/spike, rendered/loaded/dirty chunks, generation/mesh jobs and timings, faces/triangles/calls и entity counts. Rolling samples хранятся в bounded typed arrays.

# Before/after benchmarks

Repro command: `npm run benchmark:performance`, seed `legacy-model-performance`, 81 chunks and 600 timed mob updates after warm-up.

| Metric | Before | After isolated snapshot | Change |
|---|---:|---:|---:|
| Chunk generation avg | 12.556 ms | 12.422 ms | -1.1% |
| Chunk generation p95 | 15.259 ms | 14.782 ms | -3.1% |
| Meshing avg | 79.148 ms | 16.957 ms | -78.6% |
| Meshing p95 | 93.306 ms | 21.530 ms | -76.9% |
| Meshing max | 123.038 ms | 34.559 ms | -71.9% |
| Mob tick, 24 mobs avg | 0.760 ms | 0.755 ms | -0.7% |
| Visible faces | 229755 | 229755 | unchanged |

Повторные samples на занятом desktop host заметно меняются вместе с generation control metric, поэтому таблица использует парные изолированные snapshots; script сохранён для воспроизведения на target devices. Browser baseline при 27 mobs стоя: `180 FPS`, frame avg `5.56 ms`, p95 `5.70 ms`; после 36 s exploration: `172 FPS`, frame avg `5.68 ms`, p95 `5.70 ms`, spike `11.20 ms`.

# Visual QA

Через dev-only `?qaMob=<kind>&view=<front|side|rear|three-quarter>` выполнены отдельные four-view checks cow/pig и three-quarter checks остальных шести. QA выявил и исправил V-axis inversion, после чего chicken/zombie/skeleton/creeper/spider повторно проверены; browser log не содержал runtime/WebGL errors. Harness отсутствует в production bundle (`qaMob`, `MobQaHarness`, view labels не найдены в `dist`). Финальная повторная browser navigation после atlas/performance edits была заблокирована политикой встроенного browser tool и не обходилась альтернативным способом.

# Tests

`npm run check` завершён: `12` test files, `68/68` tests. Новое покрытие включает conversion math, per-model constants/layers/bounds, mip-safe atlas layout, column-cache hot path, rolling telemetry, mob separation и все 24 lever geometry states.

# Build

Vite: `56 modules transformed`. Main JS `674.39 kB` (`179.47 kB gzip`), CSS `13.81 kB` (`4.05 kB gzip`). Production archive: `0.86 MiB`, `153 files`; size и forbidden-extension/path checks пройдены. Vite сохраняет известные warnings о внешнем `/sdk.js` и main chunk >500 kB; они не нарушают текущий check budget.

# Yandex checks

Production path/archive validator пройден; `/sdk.js` остаётся внешним platform script, local SDK fallback не изменён. Ранее выполненная desktop/mobile responsive matrix и lifecycle smoke остаются green для затронутых UI paths. Yandex draft/debug-panel, реальные mobile devices, ads/auth/cloud и moderation не проверялись в этом проходе и не объявляются готовыми.

# Known remaining issues

- Нет worker generation/meshing, greedy meshing, frustum priority и block-light propagation.
- Main production JS превышает рекомендованный Vite warning threshold `500 kB`, хотя весь archive лишь `0.86 MiB`.
- Финальный post-atlas screenshot/reload не получен из-за browser security block; до релиза нужен повторный manual device/WebGL smoke.
- Mob poses/AI/separation остаются alpha approximations: нет полного vanilla bow transform, pathfinding, spider climbing, breeding/shearing и exact spawn rules.
- Asset license/provenance, Yandex draft и real-device matrix остаются release blockers.

# Next recommended work

Сначала повторить visual/performance smoke на слабом target device и Yandex draft, сохранив F3/benchmark snapshots. Если mesh spikes всё ещё нарушают 20 TPS, вынести generation/meshing в cancellable priority worker protocol; иначе следующий более выгодный rendering step — greedy meshing и frustum/distance priority. Параллельно закрыть asset provenance и full save/browser E2E P0 gaps без расширения feature scope.
