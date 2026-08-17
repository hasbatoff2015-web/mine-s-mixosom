# First-person items pass — 2026-08-17

## Что сделано

Старые DOM-картинки руки/предмета/щита заменены настоящим WebGL first-person render pass. Пустая рука остаётся видимой, выбранный hotbar item меняется без пересоздания модели каждый кадр, off-hand shield получает отдельную позицию. Runtime state управляет equip, idle/walk bob, единичным swing, циклом mining, едой, натяжением лука и поднятием щита.

Dropped items больше не используют цветные placeholder-кубы. Block item получает текстурированный куб из runtime atlas, остальные предметы — тонкую двустороннюю alpha-tested модель из собственного PNG. Тот же pipeline работает для first-person и world entities.

## Архитектура

```text
Item registry + block registry
          ↓
itemRenderProfiles (category + immutable context transforms)
          ↓
ItemVisualFactory (cached textures/materials/geometries)
       ↙                                     ↘
FirstPersonRenderer                    DroppedItemManager
separate scene/camera                  bob/rotation/stack copies
```

`Game` создаёт один `ItemVisualFactory` после `TextureAtlas` и передаёт его обоим consumers. `FirstPersonRenderer` рисуется после world scene через `clearDepth()`. `renderer.info` сбрасывается один раз перед world pass, поэтому F3 суммирует world и viewmodel, а не показывает только три вызова второго прохода.

Resources принадлежат factory и освобождаются централизованно. First-person model заменяется только при изменении item id; frame update изменяет существующие transforms. Dev-only `ItemQaHarness` загружается динамически по `?qaItem=` и отсутствует в production bundle.

## Классификация предметов

| Категория | Правило | Примеры | World visual |
| --- | --- | --- | --- |
| `block` | `ItemDefinition.kind === 'block'` | stone, furnace, planks | UV-cube из block textures |
| `generated` | ресурс, еда, броня, обычный item | apple, coal, ingot | тонкая PNG-модель |
| `handheld` | tool или sword | pickaxe, axe, shovel, sword | тонкая PNG-модель с tool transform |
| `bow` | weapon `bow` | bow | отдельный charge pose |
| `shield` | kind `shield` | shield | main/off-hand blocking pose |

Registry coverage test проверяет наличие каждого non-block item PNG и всех block face textures в импортированном whitelist. В этом проходе он обнаружил устаревший `block/furnace_front_off`; registry приведён к реально импортируемому `block/furnace_front`.

## Transform presets

Значения ниже — project-tuned alpha equivalents display contexts, а не заявление о точной копии Java 1.9. Позиция задаётся в first-person camera space, rotation — в градусах в исходной таблице, scale — uniform.

| Category | First-person position | Rotation XYZ | Scale | Ground scale |
| --- | --- | --- | ---: | ---: |
| block | `[0.46, -0.31, -0.80]` | `[24, -42, 16]` | `0.28` | `0.30` |
| generated | `[0.48, -0.29, -0.76]` | `[3, -18, -12]` | `0.31` | `0.38` |
| handheld | `[0.49, -0.30, -0.76]` | `[2, -18, -10]` | `0.39` | `0.38` |
| bow | `[0.48, -0.28, -0.79]` | `[0, -16, -5]` | `0.36` | `0.40` |
| shield | `[0.47, -0.31, -0.82]` | `[5, -18, -8]` | `0.42` | `0.40` |

GUI context пока нейтрален: position/rotation zero, scale one. Animation offsets каждый кадр накладываются заново поверх immutable base preset, поэтому equip/use/swing не накапливают transform drift.

В качестве reference boundary использован API display contexts `FIRST_PERSON_RIGHT_HAND`, `GROUND` и `GUI` из Forge 1.9.4 documentation: [ItemCameraTransforms](https://skmedix.github.io/ForgeJavaDocs/javadoc/forge/1.9.4-12.17.0.2051/net/minecraft/client/renderer/block/model/ItemCameraTransforms.html). Точные vanilla JSON values остаются будущей отдельной parity-задачей.

## Dropped rendering

- фактическая physics entity, pickup delay, merge, cap, despawn и serialization не менялись;
- root entity продолжает bob по Y и медленно вращаться;
- stack thresholds bounded: `1 → 1`, `2…16 → 2`, `17…32 → 3`, `33+ → 4` copies;
- offsets фиксированы и не создают случайный visual churn;
- изменение количества обновляет children только при переходе между thresholds;
- block/item geometries, materials и textures разделяются через cache.

## Интеграция с gameplay

- hotbar selection и inventory state задают main/off-hand model;
- attack, успешная добыча, placement и lever/button interaction запускают swing;
- удержание food/bow/shield передаёт фактический progress/state;
- Q-drop создаёт тот же textured visual в мире и сохраняется обычным dropped-item serializer;
- resize обновляет aspect отдельной first-person camera;
- F3 показывает category и размеры block-geometry/item-texture caches.

## Проверка

Автоматический pipeline:

```text
assets:import  150/150
tsc --noEmit  PASS
Vitest        13 files / 75 tests PASS
Vite          59 modules PASS
Archive       0.87 MiB / 153 files PASS
Main JS       685.11 kB / 182.37 kB gzip
CSS           12.90 kB / 3.82 kB gzip
```

`tests/item-rendering.test.ts` добавил 7 проверок: categories, contexts, полное texture coverage, real block/generated models, cache reuse, stack-copy thresholds и first-person reset/poses. Entity regression дополнительно проверяет настоящий textured dropped block visual.

В browser QA проверены empty hand, apple/eat, stone block, iron pickaxe, bow, shield и mixed drops. В настоящем Survival world Q-drop уменьшил hotbar stack и показал текстурированный предмет. После исправления renderer telemetry F3 показал `180 FPS`, frame `5.56 ms`, fixed `20 TPS`, `112290` triangles, `88` calls, `16` mobs и `1` drop.

Изолированный benchmark на текущем загруженном хосте: generation avg/p95 `19.378/28.614 ms`, meshing `25.666/39.978 ms`, mob tick с 24 mobs `0.945/1.796 ms`. Эти wall-clock значения зависят от нагрузки машины; browser F3 и отсутствие per-frame allocations важнее как проверка этого visual pass.

Production grep не нашёл `qaItem`, `ItemQaHarness` или `item QA` в `dist`.

## Известные ограничения

- arm использует компактную встроенную Steve-like texture, пользовательские skins не подключены;
- non-block item — тонкий box с прозрачными боками, а не pixel-extruded contour mesh;
- bow визуально меняет pose/scale, но texture frames натяжения пока не переключаются;
- shield использует item texture, а не отдельную полноценную banner/model geometry;
- off-hand рассчитан прежде всего на shield; dual-wield polish отсутствует;
- transforms настраивались визуально для этой камеры/FOV и не являются exact vanilla values;
- dev browser automation не смогло получить pointer lock в чужом root document (`WrongDocumentError`); обычный runtime input этим не признан сломанным.

## Логичный следующий этап

1. Отполировать off-hand и двуручные взаимодействия.
2. Добавить bow pull texture frames и use-анимации для дополнительных item types.
3. Проверить каждый registry item в автоматической screenshot matrix, включая прозрачность и редкие block faces.
4. Импортировать/описать exact Java 1.9 display transforms и сравнить с текущими alpha presets по категориям.
5. При подтверждённой необходимости заменить flat generated model на кэшируемую pixel-extruded geometry.
