# Состояние проекта

Срез: **2026-08-16**. Версия: `0.1.0`, playable alpha.

Этот документ описывает фактическое состояние кода, а не желаемый feature list. Обозначения:

- **Готово** — путь от UI до runtime подключён и подходит для alpha;
- **Alpha approximation** — работает, но сознательно проще reference или имеет заметные ограничения;
- **Не реализовано** — в коде нет законченного пользовательского сценария.

## Сводка

| Область | Статус | Фактический результат |
| --- | --- | --- |
| Boot/menu/world list | Готово | Loading screen, главное меню, создание, загрузка и удаление миров, Survival/Creative |
| Main loop | Готово | Fixed update `20 TPS`, render interpolation, delta clamp, pause/background state |
| Procedural world | Готово | Seeded chunks `16×16×80`, plains/forest/desert, caves, sea, five ores, trees, cactus |
| Rendering | Готово для alpha | Three.js, runtime atlas, independent opaque/cutout/glass/water passes, special block geometry, fog, biome tint |
| Player physics | Готово для alpha | Voxel AABB, walk/sprint/sneak/jump, step `0.6`, collision, fall damage, water/lava |
| Mining/building | Готово для alpha | Raycast, break progress, hardness/tool/tier, durability, drops, placement collision guard |
| Inventory/crafting | Готово для alpha | 36 slots, 9-slot hotbar, armor/off-hand, cursor clicks, 2×2/3×3 recipes, Creative catalog |
| Chest/furnace/bed | Alpha approximation | 27-slot chest, three-slot furnace, spawn point and simple night skip |
| Basic redstone/TNT | Готово для alpha | Power `0–15`, dust attenuation, torch/lever/button/plate, powered TNT fuse/explosion/chain, save/restore |
| Survival | Готово для alpha | Health, hunger, saturation, exhaustion, food, armor, air, lava/fire/cactus/starvation, death/respawn |
| Combat | Готово для alpha | 1.9-style cooldown curve, melee, critical, knockback, shield, bow and player arrows |
| Entities | Готово для alpha | 8 articulated mobs with local legacy UV sheets, simple AI, loot, ranged skeleton, creeper explosion |
| Day/night | Alpha approximation | 24,000-tick clock, sky/light/fog transition, sun and moon meshes; no block light propagation |
| Saves | Готово для alpha | IndexedDB schema 1, autosave, player/world/container/drop/mob/redstone restore, memory fallback |
| Desktop input | Готово | Pointer lock, keyboard, mouse buttons and wheel, F3 debug |
| Touch/mobile | Alpha approximation | Joystick, look zone, action buttons, safe-area CSS and portrait rotate overlay |
| Responsive browser QA | Готово для заданной matrix | Все desktop/mobile viewport sizes прошли visibility/count checks; representative visual QA выполнен на `667×375` и portrait |
| Audio | Alpha approximation | Central pause/mute/volume path and small procedural WebAudio tones; no authored SFX/music |
| Yandex SDK | Alpha integration | `/sdk.js`, init fallback, LoadingAPI ready, GameplayAPI start/stop and pause/resume events |
| Automated QA | Частично готово | 60 unit/component tests in 10 files plus visual browser scenes; no automated WebGL, IndexedDB or full browser E2E suite |
| Public release | Не готово | Нужны provenance approval, реальные device tests, Yandex draft audit and final moderation pass |

## Мир и блоки

### Готово

- Чанк хранит `16 × 80 × 16` numeric block IDs в `Uint16Array`.
- Горизонтальные координаты процедурно не ограничены; вокруг игрока загружается настраиваемый радиус, дальние chunks удаляются из runtime cache.
- Генерация детерминирована строковым seed.
- Реализованы три биома: `plains`, `forest`, `desert`.
- Высота поверхности варьируется примерно от `38` до `68`, sea level — `48`.
- Есть bedrock floor, 3D-noise caves, редкая lava на глубине и veins для coal, iron, gold, redstone и diamond.
- Terrain decor включает oak trees и cactus.
- Реестр содержит 69 block definitions, включая air/liquids, terrain, три вида древесины, пять руд, utility/building blocks, 16 цветов wool, basic redstone и slabs/stairs.
- Изменения мира записываются как chunk deltas, поэтому исходные procedural chunks не сохраняются целиком.
- Sand и gravel имеют простой scheduled gravity update; water/lava умеют ограниченно течь вниз.

### Alpha approximation

- Нет greedy meshing: каждый видимый face становится отдельным quad. Dirty chunks перестраиваются с ограничением количества за tick.
- Нет worker generation/meshing, LOD, occlusion system и полноценного frustum-aware scheduler.
- «Освещение пещер» — высотный коэффициент vertex color, а не flood-fill block light/skylight.
- Render classification независима от face occlusion/light semantics: opaque, alpha-tested cutout, glass translucent и water translucent имеют отдельные geometry/material paths. Leaves используют `alphaTest=0.42`, `transparent=false`, `depthWrite=true` и сохраняют biome RGB tint.
- Water и glass разделены по opacity/render order, однако отдельные translucent faces внутри pass всё ещё не сортируются по глубине.
- Slab имеет half-height collision, но chunk renderer пока рисует обычный cube. Stairs физически остаются full cube.
- Lever, torch/redstone torch, wire, button и pressure plate больше не рисуются full cubes. Door, ladder, bed, stairs/slabs и containers всё ещё не имеют полного набора specialized visual states/meshes.
- Bed — один блок с установкой spawn point и простым пропуском ночи.
- Basic redstone намеренно ограничен шестисоседней передачей сигнала и не моделирует directional connection shapes, quasi-connectivity или advanced components.
- Fluid simulation только локальная и нисходящая; нет уровня жидкости, бокового потока, смешивания, бесконечных источников и обновлений vanilla-класса.

## Предметы, добыча и создание

### Готово

- Data-first item registry связывает block items, resources, foods, tools, weapons, shield и четыре комплекта armor.
- В progression есть wood/stone/iron/diamond pickaxe, axe, shovel и sword; hoe и gold tools намеренно исключены.
- Gold armor присутствует, как и leather/iron/diamond armor.
- Stack validation, merge/split, left/right click semantics, durability, equipment constraints, atomic consume и serialization покрыты unit tests.
- Mining учитывает hardness, правильный tool type, tier и item mining speed; неподходящий инструмент медленнее и может не дать drop.
- 2×2 и 3×3 matcher поддерживает shaped, mirrored и shapeless recipes, tags и детерминированный consumption plan.
- Есть core recipes для planks, sticks, crafting table, chest, furnace, torch, ladder, white bed, door, bow/arrows/shield, tools, swords, armor, slabs/stairs и basic redstone/TNT items.
- Runtime furnace читает единые `SMELTING_RECIPES`/`FUEL_BURN_TICKS`: доступны iron/gold, sand→glass, logs→charcoal и raw foods без второй hardcoded table.
- Dropped items имеют physics, merge radius, pickup delay, pickup, cap, despawn и save/restore.

### Alpha approximation

- UI реализует cursor clicks и часть shift-transfer сценариев, но не выводит все возможности `Inventory` API: например, drag distribution есть в data layer и tests, но не оформлена как полноценный pointer-drag UX.
- Chest одиночный и содержит 27 slots; double chest и lock/name semantics отсутствуют.
- Печь обновляется только во время симуляции мира; открытие container UI ставит игру на паузу.
- Нет recipe book, подсказок неизвестных рецептов и массового craft по shift-click.

## Игрок и survival

### Готово

- Feet-anchored AABB `0.6 × 1.8`, sneak height `1.5`, step height `0.6`.
- Скорости walk/sprint/sneak, jump velocity и основные формулы ориентированы на reference; точные отличия перечислены в `MINECRAFT_1_9_REFERENCE.md`.
- Collision resolver двигает по осям, поддерживает wall sliding, step-up и защиту от схода с края в sneak.
- Есть water/lava state, плавучесть/drag, утопление, lava/fire/cactus damage и fall damage после трёх блоков.
- Survival считает health/hunger/saturation/exhaustion, regeneration/starvation и hurt resistance.
- Sprint в Survival доступен только при hunger выше `6`; удержание jump начисляет jump exhaustion только в tick фактического отрыва от земли.
- Armor использует release-1.9 damage formula; toughness выключена по умолчанию как более поздняя 1.9.1-механика.
- Food use требует удержания, consumable проверяет hunger cap.
- Death выбрасывает survival inventory/equipment, показывает экран смерти и возвращает игрока в spawn point.
- Creative не расходует blocks/arrows/durability и не получает survival/environment/mob/explosion damage.

### Alpha approximation

- Movement использует экспоненциальный response/friction, а не bit-exact vanilla physics.
- Sneak height/eye, terminal velocity и единый block reach намеренно отличаются от Java 1.9 reference.
- Suffocation и void перечислены как damage sources, но отдельный стабильный runtime detector для них не завершён.
- Armor durability и многие secondary effects не воспроизводятся полноценно.
- Difficulty не выбирается в UI; runtime использует `normal`.

## Бой и сущности

### Готово

- CombatSystem реализует quadratic attack cooldown с `+0.5 tick`, item attack profiles, critical conditions и sprint knockback.
- Melee target выбирается raycast по mob AABB и не проходит сквозь voxels; entity reach ограничен тремя блоками в runtime.
- Shield активируется после 5 ticks, замедляет движение, проверяет фронтальную дугу, снижает melee damage на 66% и полностью блокирует фронтальный projectile damage в рамках alpha.
- Bow использует 20-tick charge curve, расходует arrows в Survival, повреждает bow и создаёт projectile с gravity/block/mob collision.
- MobManager подключён к main tick и save/restore.
- Passive: cow, pig, chicken, sheep. Hostile: zombie, skeleton, creeper, spider.
- AI имеет idle/wander/chase/attack/hurt/die states, caps, distance spawning/despawn, line of sight и voxel collision.
- Hostile melee использует реальную 3D-дистанцию между eye positions и voxel line of sight, поэтому не бьёт игрока на другом этаже или через стену.
- Creative player остаётся центром spawning/despawn, но не передаётся hostile AI как target.
- Skeleton стреляет, creeper имеет fuse и radial explosion, hostile hits передаются в shield/armor/survival, смерть моба создаёт loot drops.
- Player knockback применяется только если `SurvivalSystem.damage()` реально нанёс damage; shield/armor/i-frame ignored hit не сдвигает игрока.
- Все восемь видов используют articulated pivot rigs и собственные local legacy entity sheets. Sheep имеет отдельный `sheep_fur` layer, spider — emissive-style `spider_eyes` overlay; gameplay hitboxes остаются независимыми от visuals.
- Generic `TexturedCuboidGeometry` строит шесть независимых UV faces из logical texture offset/size; 2× sheets нормализуются так же, как 1×. Pixel art загружается sRGB/nearest без mipmaps.

### Alpha approximation

- AI использует direct steering, а не pathfinding/navigation mesh: мобы могут застревать на сложном terrain.
- Spawn rules, light checks, despawn, sunlight burning, loot chance и damage — gameplay approximation, а не полная таблица Java 1.9.
- Нет breeding, taming, shearing, animal drops по burning state, skeleton equipment, spider climbing и сложных special cases.
- Projectile/explosion physics не моделируют точный swept volume/exposure/raycast sampling vanilla.
- Shield disable-by-axe реализован в combat helper, но текущие мобы не атакуют топорами.
- Нет enchantments, potion effects, experience и advanced combat feedback.

## Basic redstone и TNT

### Готово

- `RedstoneSystem` подключён к main fixed tick и получает notifications после placement/break/explosion changes.
- Dust переносит мощность `15 → 0` по шести соседям с затуханием на единицу за wire cell.
- Redstone torch является постоянным source; lever переключается use action; stone button даёт timed pulse; oak pressure plate реагирует на игрока, мобов и dropped items.
- Powered TNT превращается в отдельную visual primed entity, исчезает как block и взрывается после `4 s`.
- TNT explosion использует общий radial damage/block destruction pipeline. Разрушенный взрывом TNT получает короткий случайный fuse, поэтому возможна chain reaction.
- Active sources, остаток button pulse и primed TNT с оставшимся fuse сохраняются/восстанавливаются. Redstone state v2 также хранит lever attachment/facing; v1 получает fallback `floor/north`. Derived wire power не хранится и пересчитывается после restore.
- Lever состоит из stone base и отдельной handle с pivot/rotation; placement поддерживает floor/wall/ceiling и четыре wall facings. Powered change инвалидирует chunk mesh.
- Torch/redstone torch используют crossed planes, dust — ground quad с power tint, button — малый выступ, pressure plate — тонкую горизонтальную plate.
- Propagation bounded: queue и число шагов за update ограничены; отдельный test проверяет budget.

### Alpha approximation

- Это компактная шестисоседняя сеть, а не полная redstone topology Java 1.9.
- Нет repeater, comparator, piston, observer, dispenser/dropper, hopper, torch burnout и block-specific powered behavior за пределами TNT.
- Dust connection shape/power пока не получает отдельную визуализацию на block mesh.

## UI, input и lifecycle

### Готово

- DOM/CSS screens: loading, main menu, world list, create world, settings, controls, pause, death.
- HUD: crosshair, hotbar, selected item, health/hunger, mining progress, attack meter container, hand animation, toasts и F3 debug.
- При активном щите HUD показывает отдельный first-person shield overlay.
- Settings: volume, mouse sensitivity, render distance `2–6`, FOV `60–100`.
- Desktop pointer lock и keyboard/mouse controls.
- Touch joystick/look/buttons и landscape layout with safe-area insets.
- Lifecycle states: `LOADING`, `MENU`, `PLAYING`, `PAUSED`, `AD`, `BACKGROUND`, `DEAD`.
- Только `PLAYING` продвигает fixed simulation; остальные states останавливают audio и GameplayAPI marker.

### Alpha approximation

- Attack meter получает фактическую силу текущего `CombatSystem`; расширенный combat browser smoke всё ещё нужен.
- Настройки не сохраняются между sessions.
- Все заданные desktop/mobile размеры прошли browser visibility/count checks; на `667×375` визуально проверены inventory, pause и settings, отдельно проверен portrait overlay.
- Во время QA найдено и исправлено перекрытие menus/modals touch controls: `controls-suppressed` скрывает look zone, joystick и action buttons вне gameplay.
- Rotation state-preservation и multi-touch поведение всё ещё нужно проверить на реальных устройствах.
- Тексты интерфейса на русском; Yandex language helper пока не подключён к localization table.
- Fullscreen button, rebindable controls и accessibility mode не реализованы.

## Сохранения и платформа

### Готово

- IndexedDB database `frontier-cubes-saves`, object store `worlds`, save schema `1`.
- World summary хранит id, name, seed, mode, timestamps и play time.
- Сохраняются player position/velocity/view, health/hunger/saturation, selected slot, spawn point, inventory/equipment, time, block modifications, chest/furnace state, dropped items, mobs, redstone sources и primed TNT.
- Autosave interval — 30 seconds игрового времени; дополнительные saves выполняются при pause, background, pagehide, закрытии container и выходе в меню.
- Повреждённый inventory не блокирует загрузку всего мира: используется empty inventory fallback.
- Yandex adapter безопасно работает без SDK локально, вызывает `LoadingAPI.ready()` после interactive menu и маркирует gameplay start/stop.

### Alpha approximation / не реализовано

- Нет save migrations, backup slots, integrity checksum, export/import и recovery UI.
- Полное survival state не сериализуется: exhaustion, absorption, air/fire timers и combat cooldown восстанавливаются не полностью.
- Memory fallback не переживает reload.
- Нет Yandex player authorization, cloud data, leaderboards, ads, payments и achievements.
- Pause reasons представлены простым state machine; перед релизом нужно проверить конкуренцию user pause, tab hidden и platform pause/resume.
- Yandex archive/debug-panel/moderation validation не является завершённой только потому, что SDK adapter существует.

## Автоматическая проверка

На момент этого среза локально проходят:

```text
TypeScript: tsc --noEmit — PASS
Vitest:     10 files, 60 tests — PASS
Vite build: 54 modules — PASS
Size/archive: 0.86 MiB / 153 files — PASS
Main JS: 666.52 kB / 176.91 kB gzip; CSS: 13.81 kB
```

Покрыты registries, excluded item scope, stack/inventory operations, crafting/smelting data и runtime furnace flow, combat formulas, shield/bow helpers, survival basics, takeoff-only jump event, voxel player physics, placement guard, deterministic generation/ore bands/negative chunk coordinates, world modifications/containers restore, dropped items, Creative non-targetability/3D mob melee, mob manager и basic redstone/TNT. Пробелы и ручная матрица перечислены в `TESTING.md`.

## За пределами текущей alpha

Не реализованы multiplayer, server authority, accounts/cloud worlds, weather, farming, enchantments, brewing, Nether/End, villagers/trading, experience progression, advanced redstone, pistons/hoppers, vehicles, bosses и моддинг API. Это осознанно не подменяется заглушками в P0.
