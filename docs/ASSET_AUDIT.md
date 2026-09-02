# Аудит локальных ассетов

## Обновление 2026-08-27: authored items вместо generated placeholders

Проверены реальные PNG и их содержимое; исходники не менялись. Это локальный импорт существующего пользовательского pack, не утверждение о лицензии/авторстве.

| Source относительно assets/minecraft/textures | Runtime относительно public/textures | Размер |
| --- | --- | --- |
| items/bucket_empty.png | item/bucket.png | 32×32 |
| items/bucket_water.png | item/water_bucket.png | 32×32 |
| items/bucket_lava.png | item/lava_bucket.png | 32×32 |
| items/minecart_normal.png | item/minecart.png | 32×32 |
| entity/minecart.png | entity/minecart.png | 128×64 |
| items/potion_bottle_empty.png | item/glass_bottle.png | 32×32 |
| items/potion_bottle_drinkable.png + items/potion_overlay.png | item/potion_invisibility.png | 32×32 |
| те же authored layers | item/potion_regeneration.png | 32×32 |
| entity/projectiles/arrow.png (уже точная копия) | entity/arrow.png, без изменения PNG | 64×64 |

Root cause: неверные optional names `items/bucket.png` / `items/potion.png`, отсутствующие potion compositions/entity minecart mapping; сохранённые 16px прямоугольные fallback items и 32px entity placeholder не перезаписывались обычной missing-only генерацией. Correct Water/Lava/Minecart mappings существовали optional, но текущие runtime PNG всё равно были placeholders. Теперь восемь целевых outputs принадлежат required authored pipeline, всегда overwrite; forced fallback их не рисует. Для сохранения остальных curated textures запускать `npm run assets:import -- --items-cleanup`. Полный import также использует эти правила, но может обновить остальные whitelist assets.

Potion composition: tint overlay `[127,131,146]` invisibility / `[205,92,171]` regeneration из data table, authored bottle сверху; сохраняются alpha, cork/glass pixels и pixel grid, без resize/blur/procedural silhouette. PNG byte equality и повторяемость проверены тестами. `GeneratedItemGeometry`, extrusion, GUI/ground/held factory и общий pose не менялись.

Arrow sheet не является item sprite: top row содержит два mirrored 32×10 профиля, нижняя 20×10 область — cross/end patch, остальное transparent. Новый mesh использует wood/head/feather crops первого профиля, не весь sheet на длинных crossed planes. Minecart exterior использует logical64×32 panel UV, не full sheet на каждой стенке.

`public/textures/item/shield.png` удалён вместе с импортным mapping; source shield sheets оставлены. Восстановить прежний runtime PNG можно из Git, но runtime механика намеренно удалена.

Дата аудита: 2026-08-16; runtime whitelist пересверен 2026-08-17
Источник: `assets/`
Исходная папка во время аудита не изменялась.

Публичный Git-репозиторий намеренно не содержит исходную папку `assets/`: она
исключена через `.gitignore`, чтобы не распространять высокорисковые файлы без
подтверждённой лицензии. В репозиторий входят только 161 выбранный runtime-файл
в `public/textures`; их происхождение всё равно нужно подтвердить до релиза.

## Короткий вывод

`assets/` — не небольшой набор отдельных картинок, а извлечённое содержимое старого Java resource pack примерно эпохи Minecraft 1.12.x. На это указывают старая структура `textures/blocks` / `textures/items` и одновременно контент 1.12: concrete, glazed terracotta, parrots, advancements, recipe book и knowledge book. Это не точное доказательство версии: корневой `pack.mcmeta` отсутствует.

Набор хорошо покрывает визуальную часть требуемой alpha: базовые блоки, все пять руд, 16 цветов шерсти, инструменты, броню, еду, HUD, контейнеры, восемь нужных мобов, солнце/луну и частицы. Однако он не содержит звуков, музыки, геометрии моделей, blockstates, рецептов, локализации или лицензии. Для браузерной игры нужен выборочный importer/atlas и собственная геометрия.

Критичное ограничение по происхождению: пакет использует пространства имён и совместимые раскладки Minecraft, содержит прямой логотип Minecraft, Realms, паттерны `mojang`, панораму мира и лист картин. Эти файлы нельзя включать в релиз без ручного подтверждения прав. Пространство имён `minecraft` само по себе нормально для Java resource pack и не доказывает копирование, но в наборе нет `LICENSE`, `README`, `credits` или другой записи об авторстве.

Статусы ниже означают рекомендуемое использование в текущей alpha. Они не утверждают, что конкретный файл уже подключён в runtime: после сборки это следует сверить с import manifest/кодом.

## Методика и ограничения проверки

- Рекурсивно проинвентаризированы все файлы и каталоги.
- Все 1 999 PNG были открыты декодером; битых PNG не обнаружено.
- Все 22 `.mcmeta` разобраны как JSON; синтаксически ошибочных файлов нет.
- Проверены размеры и визуально просмотрены репрезентативные block/item/GUI/entity/environment файлы.
- Поиск по именам не нашёл `LICENSE`, `LICENCE`, `COPYING`, `README`, `CREDITS`, `pack.mcmeta` или `pack.png`.
- Байт-в-байт сравнение с эталонным Minecraft JAR не выполнялось: в проекте нет сертифицированного эталона. Поэтому этот документ не называет остальные текстуры «оригинальными» или «скопированными» только по сходству имён.

## Сводная инвентаризация

| Показатель | Значение |
| --- | ---: |
| Всего файлов | 2 058 |
| Всего каталогов внутри `assets/` | 91 |
| Общий размер | 3 774 943 байта (3,60 MiB) |
| PNG | 1 999 |
| `.properties` (MC Patcher/OptiFine CTM) | 37 |
| `.mcmeta` (JSON-анимации) | 22 |
| Прочие форматы | 0 |
| Файлы со пробелами в имени | 0 |
| Пути с заглавными буквами | 0 |
| Максимальная длина относительного пути | 95 символов |

### По пространствам имён

| Пространство | Файлов | Размер, байт | Назначение |
| --- | ---: | ---: | --- |
| `minecraft/` | 2 028 | 3 676 617 | Основной resource pack, CTM и OptiFine GUI |
| `realms/` | 26 | 74 067 | Интерфейс Minecraft Realms; нашей игре не нужен |
| `forge/` | 3 | 4 085 | Forge GUI/items; нашей игре не нужен |
| `fml/` | 1 | 20 174 | Forge Mod Loader GUI; нашей игре не нужен |

### `minecraft/textures/`

| Категория | Файлов | Состав | Размер, байт |
| --- | ---: | --- | ---: |
| `blocks/` | 497 | 475 PNG + 22 `.mcmeta` | 725 593 |
| `items/` | 340 | 340 PNG | 466 823 |
| `entity/` | 267 | 267 PNG | 1 172 353 |
| `gui/` | 48 | 48 PNG | 640 929 |
| `environment/` | 5 | 5 PNG | 175 988 |
| `models/armor/` | 12 | 12 PNG; это только текстуры, не модели | 13 284 |
| `font/` | 2 | 2 PNG bitmap-font sheets | 13 531 |
| `misc/` | 3 | 3 PNG | 20 893 |
| `map/` | 2 | 2 PNG | 1 585 |
| `painting/` | 1 | 1 PNG | 275 332 |
| `particle/` | 1 | 1 PNG | 8 158 |

### Дополнительные старые расширения resource pack

- `minecraft/mcpatcher/`: 849 файлов, включая 812 PNG и все 37 `.properties`.
- Из них 833 файла относятся к connected textures обычного и 16 цветов stained glass; ещё по 5 файлов — bookshelf, sandstone и red sandstone; один файл — `textures/icons.png`.
- `minecraft/optifine/textures/icons.png`: один GUI sheet.
- CTM-конфигурации используют старые numeric block IDs (`20`, `47`, `102`) и напрямую не применимы в Three.js renderer.

## Форматы и размеры

Базовое разрешение блока/предмета — 32×32, то есть это преимущественно 2× pixel-art pack относительно классических 16×16 текстур.

| Категория | Фактические размеры PNG |
| --- | --- |
| Все PNG, наиболее частые | 1 618 × `32×32`; 151 × `128×128`; 57 × `128×64`; 39 × `512×512`; 35 × `256×128`; 32 × `256×256` |
| `blocks/` | 453 × `32×32`; 13 × `32×128`; 4 × `32×1024`; по одному `32×96`, `32×160`, `32×640`, `64×1024`, `64×2048` |
| `items/` | все 340 × `32×32` |
| `entity/` | в основном `128×64`, `128×128`, `256×128`, `256×256`; также несколько `64×64`, `32×32`, `512×512` и strip-форматов |
| `gui/` | 32 × `512×512`; 8 × `256×256`; 6 × `32×32`; по одному `256×32`, `32×128` |
| `environment/` | `64×64`, `256×128`, `256×256`, 2 × `128×512` |
| `mcpatcher/` | 811 × `32×32`, один `512×512` |
| `realms/` | 26 небольших/GUI изображений разных размеров от `16×28` до `620×332` |

Все размеры совместимы с WebGL, но spritesheet/animation strips нельзя импортировать как одиночную квадратную плитку.

Особые анимированные файлы:

| Файл | Размер | Как интерпретировать |
| --- | ---: | --- |
| `minecraft/textures/blocks/water_still.png` | 32×1024 | 32 вертикальных кадра 32×32; параметры в соседнем `.mcmeta` |
| `minecraft/textures/blocks/water_flow.png` | 64×2048 | 32 вертикальных кадра 64×64 |
| `minecraft/textures/blocks/lava_still.png` | 32×640 | 20 кадров 32×32; `.mcmeta` задаёт 38-шаговую последовательность туда/обратно |
| `minecraft/textures/blocks/lava_flow.png` | 64×1024 | 16 кадров 64×64 |
| `minecraft/textures/blocks/fire_layer_0.png` | 32×1024 | 32 кадра 32×32 |
| `minecraft/textures/blocks/fire_layer_1.png` | 32×1024 | 32 кадра 32×32 |

Также анимированы portal, magma, sea lantern, rough prismarine и command blocks, но они не нужны основному alpha scope.

## Структура

```text
assets/
  fml/textures/gui/                 # 1 FML sheet
  forge/textures/{gui,items}/       # 3 Forge textures
  minecraft/
    mcpatcher/
      ctm/                          # 848 CTM files
      textures/icons.png
    optifine/textures/icons.png
    textures/
      blocks/                       # block tiles + animation metadata
      items/                        # flat item sprites
      entity/                       # legacy entity UV sheets
      environment/                  # sun, moon, precipitation, End sky
      font/                         # bitmap font sheets
      gui/                          # HUD/menu/container sheets
      map/
      misc/
      models/armor/                 # armor UV sheets only
      painting/
      particle/
  realms/textures/gui/              # 26 Realms UI assets
```

В наборе нет `models/*.json`, `blockstates/*.json`, `sounds.json`, аудиофайлов или рецептов. Название `models/armor` вводит в заблуждение: там только PNG UV sheets.

## Что будем использовать для alpha

Ниже пути указаны относительно `assets/`. Для runtime следует копировать только whitelist в отдельную структуру или собирать atlas; исходники оставлять неизменными.

### Terrain, руды и жидкости

| Игровой ресурс | Конкретные файлы | Примечание |
| --- | --- | --- |
| Air | файл не нужен | Прозрачная ячейка registry |
| Grass | `minecraft/textures/blocks/grass_top.png`, `grass_side.png`, `grass_side_overlay.png`, `dirt.png` | `grass_top` и overlay серые/ tint-ready; нужен biome tint. Низ — dirt |
| Dirt | `minecraft/textures/blocks/dirt.png` | 32×32 |
| Stone | `minecraft/textures/blocks/stone.png` | 32×32 |
| Cobblestone | `minecraft/textures/blocks/cobblestone.png` | 32×32 |
| Bedrock | `minecraft/textures/blocks/bedrock.png` | 32×32 |
| Sand | `minecraft/textures/blocks/sand.png` | 32×32 |
| Sandstone | `sandstone_top.png`, `sandstone_normal.png`, `sandstone_bottom.png` | Отдельные top/side/bottom |
| Gravel | `minecraft/textures/blocks/gravel.png` | 32×32 |
| Oak Log | `log_oak.png`, `log_oak_top.png` | Side/end |
| Oak Leaves | `minecraft/textures/blocks/leaves_oak.png` | Серый tint-ready лист с alpha; нужен biome tint и alpha-test |
| Cactus | `cactus_side.png`, `cactus_top.png`, `cactus_bottom.png` | Отдельные стороны |
| Water | `water_still.png`, `water_flow.png` и обе `.mcmeta` | Нужна нарезка кадров, прозрачный material и анимация |
| Lava | `lava_still.png`, `lava_flow.png` и обе `.mcmeta` | Нужна нарезка кадров и emissive/light логика |
| Coal Ore | `minecraft/textures/blocks/coal_ore.png` | 32×32 |
| Iron Ore | `minecraft/textures/blocks/iron_ore.png` | 32×32 |
| Gold Ore | `minecraft/textures/blocks/gold_ore.png` | 32×32 |
| Redstone Ore | `minecraft/textures/blocks/redstone_ore.png` | 32×32 |
| Diamond Ore | `minecraft/textures/blocks/diamond_ore.png` | 32×32 |

### Building и utility

| Игровой ресурс | Конкретные файлы | Примечание |
| --- | --- | --- |
| Oak Planks / Slab / Stairs | `minecraft/textures/blocks/planks_oak.png` | Slab/stairs используют ту же плитку и собственную геометрию |
| Cobble Slab / Stairs | `minecraft/textures/blocks/cobblestone.png` | Отдельные PNG не нужны |
| Stone Bricks | `minecraft/textures/blocks/stonebrick.png` | 32×32 |
| Glass | `minecraft/textures/blocks/glass.png` | Использовать базовую плитку; CTM пока не подключать |
| Torch | `minecraft/textures/blocks/torch_on.png` | Crossed planes/custom mesh, alpha-test |
| Crafting Table | `crafting_table_top.png`, `crafting_table_front.png`, `crafting_table_side.png`; низ можно взять из `planks_oak.png` | 32×32 faces |
| Furnace | `furnace_top.png`, `furnace_side.png`, `furnace_front_off.png`, `furnace_front_on.png` | On/off state |
| Chest | `minecraft/textures/entity/chest/normal.png` | 128×128 legacy entity UV; требуется собственный chest mesh/UV |
| Wooden Door | `door_wood_upper.png`, `door_wood_lower.png`; inventory sprite `minecraft/textures/items/door_wood.png` | Alpha-test, два block states |
| White Bed | `minecraft/textures/entity/bed/white.png` | 128×128 entity UV; нет простой block tile |
| Break progress | `minecraft/textures/blocks/destroy_stage_0.png` … `destroy_stage_9.png` | 10 оверлеев 32×32; **локальный pack reference only**. Runtime ships original Frontier masks at `public/textures/gui/destroy/destroy_stage_0.png` … `_9.png` (same 10-stage contract). Mojang sheets must not be committed. |

### Все 16 цветов wool

Найдены ровно все 16 классических вариантов, каждый 32×32:

`wool_colored_white.png`, `wool_colored_orange.png`, `wool_colored_magenta.png`, `wool_colored_light_blue.png`, `wool_colored_yellow.png`, `wool_colored_lime.png`, `wool_colored_pink.png`, `wool_colored_gray.png`, `wool_colored_silver.png`, `wool_colored_cyan.png`, `wool_colored_purple.png`, `wool_colored_blue.png`, `wool_colored_brown.png`, `wool_colored_green.png`, `wool_colored_red.png`, `wool_colored_black.png`.

Все находятся в `minecraft/textures/blocks/`. Старое имя `silver` соответствует light gray. В Survival whitelist должен выдавать только `wool_colored_white`; остальные 15 — Creative-only, как требует ТЗ.

### Basic redstone и TNT

| Ресурс | Конкретные файлы | Примечание |
| --- | --- | --- |
| Redstone Dust | `blocks/redstone_dust_dot.png`, `redstone_dust_line0.png`, `redstone_dust_line1.png`; item `items/redstone_dust.png` | Варианты соединения выбирает runtime |
| Redstone Torch | `blocks/redstone_torch_on.png`, `redstone_torch_off.png` | Crossed planes/custom mesh |
| Lever | `blocks/lever.png` | Основание можно брать из stone; нужна собственная геометрия |
| Button / Pressure Plate | `blocks/stone.png` и/или `blocks/planks_oak.png` | Отдельных named textures нет; это не blocker, так как поверхность наследуется от материала |
| TNT | `blocks/tnt_top.png`, `tnt_side.png`, `tnt_bottom.png` | Полное покрытие блока |

### Предметы, инструменты, бой и еда

Все перечисленные item sprites имеют размер 32×32 и находятся в `minecraft/textures/items/`.

- Wood tools: `wood_pickaxe.png`, `wood_axe.png`, `wood_shovel.png`, `wood_sword.png`.
- Stone tools: `stone_pickaxe.png`, `stone_axe.png`, `stone_shovel.png`, `stone_sword.png`.
- Iron tools: `iron_pickaxe.png`, `iron_axe.png`, `iron_shovel.png`, `iron_sword.png`.
- Diamond tools: `diamond_pickaxe.png`, `diamond_axe.png`, `diamond_shovel.png`, `diamond_sword.png`.
- Bow: `bow_standby.png`, `bow_pulling_0.png`, `bow_pulling_1.png`, `bow_pulling_2.png`; ammunition `arrow.png`; projectile UV также есть в `minecraft/textures/entity/projectiles/arrow.png`.
- Shield source sheets остаются нетронутыми в assets, но не импортируются и не используются runtime (полное удаление механики 2026-08-27).
- Leather armor icons: `leather_helmet.png`, `leather_chestplate.png`, `leather_leggings.png`, `leather_boots.png`. Overlay-файлы тоже присутствуют, но окрашивание не требуется.
- Iron armor icons: `iron_helmet.png`, `iron_chestplate.png`, `iron_leggings.png`, `iron_boots.png`.
- Gold armor icons: `gold_helmet.png`, `gold_chestplate.png`, `gold_leggings.png`, `gold_boots.png`.
- Diamond armor icons: `diamond_helmet.png`, `diamond_chestplate.png`, `diamond_leggings.png`, `diamond_boots.png`.
- Armor UV sheets для отображения на модели: `minecraft/textures/models/armor/{leather,iron,gold,diamond}_layer_1.png` и `_layer_2.png`; для leather также есть overlay sheets.
- Еда из обязательного scope: `beef_raw.png`, `beef_cooked.png`, `porkchop_raw.png`, `porkchop_cooked.png`, `chicken_raw.png`, `chicken_cooked.png`, `apple.png`.
- Базовые материалы/дропы: `coal.png`, `iron_ingot.png`, `gold_ingot.png`, `diamond.png`, `stick.png`, `flint.png`, `feather.png`, `leather.png`, `bone.png`, `string.png`, `gunpowder.png`, `rotten_flesh.png`.
- `bread.png` присутствует, но по ТЗ нужен максимум как Creative item, без farming chain.
- Иконки блоков для dropped items/inventory можно брать из block atlas; отдельные item sprites для каждого блока не обязательны.

Hoe и gold tools в наборе есть, но в текущий scope не входят.

Runtime whitelist после feel/polish pass включает все три `bow_pulling_*` стадии и отдельный `entity/projectiles/arrow.png`. Bow variants используются только готовыми cached item meshes; projectile sheet обрезается до legacy arrow region общим `ArrowVisualFactory` для player и skeleton.

Для generated held/dropped items импортируются исходные PNG, а объёмная форма строится в runtime из alpha mask. Это не добавляет новых производных bitmap-файлов и не меняет provenance исходного sprite.

### GUI/HUD

Функционально подходят следующие sheets:

| Назначение | Файл | Размер | Решение |
| --- | --- | ---: | --- |
| Сердца, hunger, armor, crosshair, experience/прочие полосы | `minecraft/textures/gui/icons.png` | 512×512 | Использовать нужные regions после подтверждения происхождения; лишние XP regions не подключать |
| Hotbar, selection и button regions | `minecraft/textures/gui/widgets.png` | 512×512 | Кандидат для HUD; допустим CSS fallback |
| Inventory + 2×2 craft/off-hand layout | `minecraft/textures/gui/container/inventory.png` | 512×512 | Кандидат; recipe-book regions можно игнорировать |
| Crafting Table | `minecraft/textures/gui/container/crafting_table.png` | 512×512 | Кандидат для 3×3 UI |
| Furnace | `minecraft/textures/gui/container/furnace.png` | 512×512 | Есть input/fuel/output и progress regions |
| Chest | `minecraft/textures/gui/container/generic_54.png` | 512×512 | Можно crop/масштабировать для 27/54 slots или воспроизвести layout в CSS |
| Creative inventory | `minecraft/textures/gui/container/creative_inventory/*` | 4 PNG | Можно использовать только если CSS inventory не покрывает задачу |

Эти sheets заметно перерисованы в едином 32px стиле, но сохраняют совместимую с Minecraft раскладку. Поэтому они относятся к категории «можно для внутренней alpha по пользовательскому разрешению, перед публикацией подтвердить авторство». Логотипы/title/panorama из той же GUI-папки использовать нельзя без отдельной проверки.

### Нужные entities

Текстуры всех восьми мобов из ТЗ присутствуют:

| Entity | Файл(ы) | Размер основного sheet |
| --- | --- | ---: |
| Cow | `minecraft/textures/entity/cow/cow.png` | 128×64 |
| Pig | `minecraft/textures/entity/pig/pig.png` | 128×64 |
| Chicken | `minecraft/textures/entity/chicken.png` | 128×64 |
| Sheep | `minecraft/textures/entity/sheep/sheep.png`, внешний слой `sheep/sheep_fur.png` | 128×64 |
| Zombie | `minecraft/textures/entity/zombie/zombie.png` | 128×128 |
| Skeleton | `minecraft/textures/entity/skeleton/skeleton.png` | 128×64 |
| Creeper | `minecraft/textures/entity/creeper/creeper.png` | 128×64 |
| Spider | `minecraft/textures/entity/spider/spider.png`, опциональный слой `entity/spider_eyes.png` | 128×64 |

Все 10 перечисленных sheets/layers теперь входят в runtime whitelist и копируются в `public/textures/entity`. Дополнительно импортируются `entity/steve.png` для empty-hand arm и `entity/projectiles/arrow.png` для общего projectile visual. Игра использует собственные `TexturedCuboidGeometry`, articulated pivot rigs и анимации; физические hitboxes по-прежнему задаются отдельно. Текстуры визуально стилизованы/перерисованы, но происхождение полного набора должно быть подтверждено владельцем.

### Растительность

В runtime whitelist добавлены шесть block sprites: `tall_grass.png`, `fern.png`, `dandelion.png`, `poppy.png`, `oxeye_daisy.png`, `dead_bush.png`. Они рендерятся crossed quads внутри chunk cutout geometry. Отдельные flower/grass item drops, dyes и farming chain намеренно не подключены.

### Environment и particles

- `minecraft/textures/environment/sun.png` — 64×64, подходит для day/night.
- `minecraft/textures/environment/moon_phases.png` — 256×128, подходит после нарезки atlas; для alpha достаточно одной фазы.
- `minecraft/textures/environment/rain.png` и `snow.png` — оба 128×512; найдены, но погода не обязательна текущему scope.
- `minecraft/textures/particle/particles.png` — 256×256 legacy particle atlas; можно использовать выбранные regions после ручной проверки.
- `minecraft/textures/blocks/fire_layer_0.png` и `fire_layer_1.png` подходят для fire/lava overlay после нарезки кадров.
- `minecraft/textures/misc/underwater.png` существует, но можно заменить собственным полупрозрачным overlay.

## Что найдено, но пока не использовать

- Все 849 файлов `minecraft/mcpatcher/`: CTM для стекла/bookshelf/sandstone не поддерживается обычным atlas и не нужен для P0/P1.
- `minecraft/optifine/**`, `fml/**`, `forge/**`, `realms/**`: интеграции этих продуктов в игре нет.
- Контент вне ТЗ: Nether/End, potions/brewing, enchanting/anvil, villagers/trading, lapis, emerald economy, command blocks, portal, beacon, guardians, dragon, shulkers, horses, llamas, parrots, boats, banners и т. п.
- Farming assets (`wheat_stage_*`, carrots, potatoes, beetroots, farmland, seeds): farming прямо исключён из текущего прохода.
- Advanced redstone (`repeater`, `comparator`, piston, observer, hopper, dispenser, dropper): прямо исключено из текущего scope.
- Minecraft 1.12 additions за пределами reference 1.9: concrete, concrete powder, glazed terracotta, parrots, recipe-book/advancement GUI и связанные items/entities.
- `minecraft/textures/map/**`, `painting/**`, большинство `misc/**`, `font/**`: геймплейной alpha не нужны; часть имеет повышенный provenance risk.
- 15 colored bed entity sheets можно оставить Creative-only/deferred; Survival bed достаточно white.
- `steve.png` и `alex.png` пока не нужны для first-person alpha и требуют ручной проверки происхождения.

## Чего в наборе нет

| Отсутствующее | Влияние | Безопасный fallback |
| --- | --- | --- |
| Звуки и музыка | Нет ни одного audio-файла и `sounds.json` | Централизованный AudioManager + тишина или собственные WebAudio SFX; ничего не скачивать из Minecraft |
| Лицензия/credits/история происхождения | Нельзя документально подтвердить права на отдельные файлы | Получить от владельца подтверждение авторства/источника; до этого исключить high-risk assets из публичной сборки |
| `pack.mcmeta` и `pack.png` | Нельзя точно определить pack format/версию | Использовать набор как raw source, не как устанавливаемый resource pack |
| JSON block models и blockstates | Нельзя автоматически восстановить геометрию slabs/stairs/door/torch/chest/bed | Собственные data-driven block definitions и geometry builders |
| Entity models/rigs/animations | В source pack есть только UV sheets | Реализованы собственные textured cuboid rigs и pivot animation state machine |
| Собственный логотип/название игры | Имеющийся logo — Minecraft и непригоден | Оригинальный текстовый CSS logo/нейтральный wordmark |
| Облачная текстура overworld | `clouds.png` отсутствует | Процедурные плоские облака или временно без облаков |
| Mobile/touch icons и rotate-device art | Старый Java pack этого не покрывает | CSS/inline SVG из простых геометрических форм или текстовые labels |
| Отдельные sprites для slab/stairs/button/pressure plate | Named PNG нет | Наследовать block material; это нормальная практика и не требует placeholder art |
| Shield source sheets | Исходные entity UV остаются в assets | Не импортировать: механика и runtime asset удалены |
| Рецепты, loot tables, registry data, локализация | В `assets` только визуальные ресурсы | Описать в собственных TypeScript data registries |

## Технические рекомендации импорта

1. Не подключать `assets/` целиком как публичный статический каталог. Использовать whitelist и копировать только реально нужные файлы в отдельную runtime-папку/atlas; исходник оставить нетронутым.
2. Для всех pixel-art textures применять nearest-neighbor (`NearestFilter`) и отключить линейное размытие. В atlas добавить padding/extrusion, чтобы mip/UV не подтягивал соседние плитки.
3. Color textures загружать как sRGB; data/alpha masks не преобразовывать повторно.
4. Grass top, grass overlay и oak leaves требуют biome tint. Без tint они выглядят серыми.
5. Glass/leaves/door/torch/particles требуют корректных alpha-test/transparent passes; water — отдельного прозрачного pass.
6. `.mcmeta` браузер сам не понимает. Importer должен нарезать вертикальные strips и учитывать `frametime`, `frames`, `interpolate`.
7. Chest, bed, shield, armor и mobs используют legacy UV sheets; нельзя класть их в block atlas как обычную 32×32 плитку.
8. GUI sheets нужно crop-ить по regions или воспроизводить slots в HTML/CSS. Растягивание всего 512×512 листа как одного окна даст пустые области и неверный layout.
9. CTM `.properties` привязаны к старым numeric IDs. В alpha использовать базовые `glass.png`/sandstone textures; connected textures отложить.
10. Полный исходный набор занимает только 3,60 MiB, но выборочный import всё равно предпочтительнее из-за времени загрузки, provenance и жёсткого лимита распакованной production-сборки 100 MiB.

## Файлы и категории для ручной проверки происхождения

### Высокий риск — не включать до подтверждения

| Путь/маска | Причина |
| --- | --- |
| `minecraft/textures/gui/title/minecraft.png` | Прямой логотип Minecraft |
| `minecraft/textures/gui/title/edition.png` | Фирменный title/edition overlay |
| `realms/textures/gui/title/realms.png` и весь `realms/**` | Брендинг и UI Minecraft Realms |
| `minecraft/textures/entity/banner/mojang.png` | Паттерн с названием/символикой Mojang |
| `minecraft/textures/entity/shield/mojang.png` | Паттерн с названием/символикой Mojang |
| `minecraft/textures/painting/paintings_kristoffer_zetterstrand.png` | Лист узнаваемых игровых картин; автор указан в имени, права не документированы |
| `minecraft/textures/gui/title/background/panorama_0.png` … `panorama_5.png` | Панорама узнаваемого Minecraft world/menu, источник не указан |
| `minecraft/textures/misc/unknown_pack.png` | Похоже на стандартный placeholder resource-pack icon; источник не указан |
| `fml/**`, `forge/**`, `minecraft/optifine/**`, `minecraft/mcpatcher/textures/icons.png` | Чужие продуктовые/мод-loader UI namespaces; игре не нужны |

### Средний риск — подтвердить перед публичным релизом

- `minecraft/textures/gui/icons.png`, `widgets.png`, `container/**`, `font/ascii.png`, `font/ascii_sga.png`: стилистически изменены, но сохраняют точные legacy sheet/layout conventions.
- `minecraft/textures/entity/steve.png` и `alex.png`: имена и UV layout относятся к стандартным персонажам; визуально skins изменены, но происхождение не зафиксировано.
- `minecraft/textures/particle/particles.png`, `models/armor/**` и все legacy entity UV sheets: выглядят частью цельного переработанного pack, но лицензии нет.
- Весь `minecraft/textures/blocks/**` и `items/**`: выборочная визуальная проверка grass/stone/tools/ores показала 32px перерисованный стиль, однако это не заменяет подтверждение авторства каждого исходника.
- Весь `minecraft/mcpatcher/ctm/**`: вероятно пользовательские connected-texture variants, но нет credits/license; в alpha всё равно не используется.

### Что нельзя заключить автоматически

- Совпадение имени файла с vanilla (`stone.png`, `zombie.png` и т. п.) ожидаемо для любого совместимого resource pack и не является доказательством совпадения пикселей.
- Размер 32×32/128×64 и legacy UV layout указывают на совместимость, а не сами по себе на источник рисунка.
- Внутренние дубликаты (например, dirt/stone, повторно используемые как GUI backgrounds, или базовые sandstone tiles в CTM) являются нормальным переиспользованием внутри pack и не доказывают внешнее копирование.

## Итоговое решение

- Для P0/P1 импортировать только перечисленные core block/item/environment файлы и, после подтверждения владельца, нужные GUI regions.
- Для текущей alpha использовать только перечисленные mob sheets/layers плюс явно нужные Steve arm/arrow projectile assets с собственными geometry adapters; остальные entity assets не импортировать.
- Не использовать Minecraft/Realms logos, panorama, paintings, Mojang patterns и сторонние namespace UI.
- Недостающие branding, touch UI, clouds, geometry и audio закрывать собственным кодом/нейтральными placeholders, не скачивая Minecraft assets.
- Перед публичным релизом получить короткое письменное подтверждение происхождения пользовательского texture pack и отдельно пройти high-risk список.
