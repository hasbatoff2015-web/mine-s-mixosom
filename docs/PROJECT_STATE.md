# Состояние проекта

Срез: **2026-08-21**. Версия: `0.1.0`, playable alpha.

Этот документ описывает фактическое состояние кода, а не желаемый feature list. Обозначения:

- **Готово** — путь от UI до runtime подключён и подходит для alpha;
- **Alpha approximation** — работает, но сознательно проще reference или имеет заметные ограничения;
- **Не реализовано** — в коде нет законченного пользовательского сценария.

## Сводка

| Область | Статус | Фактический результат |
| --- | --- | --- |
| Boot/menu/world list | Готово | Loading screen, главное меню, создание, загрузка и удаление миров, Survival/Creative |
| Main loop | Готово | Fixed update `20 TPS`, render interpolation, delta clamp, pause/background state |
| Procedural world | Готово | Seeded chunks `16×16×80`, plains/forest/desert, caves, sea, five ores, trees, cactus и biome-specific cross-plants |
| Rendering | Готово для alpha | Three.js, render-rate camera look, mip-safe padded runtime atlas, independent world passes including vegetation FrontSide cutout, budgeted chunk meshing, special/cross geometry, shape-aware selection outlines, shared item/arrow visuals и отдельный first-person pass |
| Player physics | Готово для alpha | Voxel AABB, walk/sprint/sneak/jump, step `0.6`, collision, fall damage, water/lava |
| Mining/building | Готово для alpha | Raycast, 1.9 harvest formula, hardness/tool/tier, durability, drops, thin door/torch/button placement |
| Inventory/crafting | Готово для alpha | 36 slots, 9-slot hotbar, armor/off-hand, cursor clicks, 2×2/3×3 recipes, Creative catalog |
| Chest/furnace/bed | Alpha approximation | 27-slot chest, three-slot furnace, spawn point and simple night skip |
| Basic redstone/TNT | Готово для alpha | Power `0–15`, dust attenuation, torch/lever/button/plate, gravity-driven primed TNT, budgeted batched explosions, save/restore |
| Survival | Готово для alpha | Health, hunger, saturation, exhaustion, food, armor, air, lava/fire/cactus/starvation, death/respawn |
| Combat | Готово для alpha | 1.9-style cooldown curve, melee, critical, knockback, shield, staged bow draw and shared player/skeleton arrow physics |
| Entities | Готово для alpha | 8 legacy articulated rigs, 1-block mob step-up, falling-block entities, zombie limb/pose fix, simple AI, voxel sky/block lighting on world entities |
| Day/night | Alpha approximation | 24,000-tick clock; terrain and world entities compose the same sky/block sample (`sky * daylight` vs warm torch block light) without Lambert N·L |
| Saves | Готово для alpha | IndexedDB schema 1, autosave, player/world/container/drop/mob/redstone/block-state/falling-block restore |
| Desktop input | Готово | Pointer lock, WASD, Shift sprint, C sneak, mouse, F3 debug |
| Touch/mobile | Alpha approximation | Joystick, look zone, action buttons, safe-area CSS and portrait rotate overlay |
| Responsive browser QA | Готово для заданной matrix | Все desktop/mobile viewport sizes прошли visibility/count checks; representative visual QA выполнен на `667×375` и portrait |
| Audio | Alpha approximation | Central pause/mute/volume path and small procedural WebAudio tones; no authored SFX/music |
| Yandex SDK | Alpha integration | `/sdk.js`, init fallback, LoadingAPI ready, GameplayAPI start/stop and pause/resume events |
| Automated QA | Частично готово | 143 unit/component tests in 22 files, reproducible performance benchmark and visual browser scenes; no automated WebGL, IndexedDB or full browser E2E suite |
| Public release | Не готово | Нужны provenance approval, реальные device tests, Yandex draft audit and final moderation pass |

## Мир и блоки

### Готово

- Чанк хранит `16 × 80 × 16` numeric block IDs в `Uint16Array`.
- Горизонтальные координаты процедурно не ограничены; вокруг игрока загружается настраиваемый радиус, дальние chunks удаляются из runtime cache.
- Генерация детерминирована строковым seed.
- Реализованы три биома: `plains`, `forest`, `desert`.
- Высота поверхности варьируется примерно от `38` до `68`, sea level — `48`.
- Есть bedrock floor, 3D-noise caves, редкая lava на глубине и veins для coal, iron, gold, redstone и diamond.
- Terrain decor включает oak trees, cactus и детерминированные растения: tall grass/flowers в plains, tall grass/fern/flowers в forest, dead bush в desert.
- Реестр содержит stable-ID definitions для шести replaceable `cross`-растений поверх прежних air/liquids, terrain, древесины, руд, utility/building blocks, wool, redstone и slabs/stairs. Tall grass/fern несут `lightingMode: vegetation` и `biomeTint: grass`; flowers/dead bush — тот же lighting mode без grass tint.
- Изменения мира записываются как chunk deltas, поэтому исходные procedural chunks не сохраняются целиком.
- Chunk дополнительно хранит компактные `Uint8Array` skyLight/blockLight (`0–15`) того же размера, что и blocks.
- Sand и gravel при потере опоры удаляются из сетки и становятся falling-block entity с gravity/mesh, затем возвращаются в world.
- Дверь — тонкая 2-block geometry с open/close, collision по occupied face и joint upper/lower state.

### Alpha approximation

- Нет greedy meshing: каждый видимый face становится отдельным quad. Dirty chunks перестраиваются с ограничением количества за tick.
- Нет worker generation/meshing, LOD, occlusion system и полноценного frustum-aware scheduler. Main-thread generation и meshing не запускаются в один fixed tick; rebuild ограничен числом jobs и бюджетом времени.
- Sky/block light — bounded column+spread/flood approximation, не vanilla light engine: нет RGB lightmaps и нет quasi-connectivity. Daylight масштабирует sky-contribution в shader без remesh.
- «Освещение пещер» больше не высотный fake: occluding blocks гасят sky light; torch/lava дают локальный block light. Нижние грани читают соседний voxel и больше не зануляются Lambert N·L. Cube faces усредняют 4 light samples на вершину, чтобы отверстия в землю не обрывались в pitch-black. Torch block-light visually тёплый (жёлто-оранжевый) без PointLight.
- Render classification независима от face occlusion/light semantics: opaque, alpha-tested cutout, vegetation cutout, glass translucent и water translucent имеют отдельные geometry/material paths. Leaves используют `alphaTest=0.42`, `transparent=false`, `depthWrite=true`, `DoubleSide` и сохраняют biome RGB tint. Cross-plants (`lightingMode: vegetation`) пишутся отдельным batched mesh с `FrontSide` и lighting normals `(0,1,0)`.
- Water и glass разделены по opacity/render order, однако отдельные translucent faces внутри pass всё ещё не сортируются по глубине.
- Slab имеет half-height collision, но chunk renderer пока рисует обычный cube. Stairs физически остаются full cube.
- Lever, torch/redstone torch, wire, button, pressure plate и oak door больше не рисуются full cubes. Torch ставится на пол и стену; button — на пол, стену и потолок. Ladder, bed, stairs/slabs и containers всё ещё не имеют полного набора specialized visual states/meshes.
- Bed — один блок с установкой spawn point и простым пропуском ночи.
- Basic redstone намеренно ограничен шестисоседней передачей сигнала и не моделирует directional connection shapes, quasi-connectivity или advanced components.
- Fluid simulation только локальная и нисходящая; нет уровня жидкости, бокового потока, смешивания, бесконечных источников и обновлений vanilla-класса.

## Предметы, добыча и создание

### Готово

- Data-first item registry связывает block items, resources, foods, tools, weapons, shield и четыре комплекта armor.
- В progression есть wood/stone/iron/diamond pickaxe, axe, shovel и sword; hoe и gold tools намеренно исключены.
- Gold armor присутствует, как и leather/iron/diamond armor.
- Stack validation, merge/split, left/right click semantics, durability, equipment constraints, atomic consume и serialization покрыты unit tests.
- Mining использует Java 1.9 формулу `(S/H)/30` при harvest и `/100` иначе. Preferred tool ускоряет добычу; `requiresCorrectTool` нужен только камню, рудам и furnace.
- 2×2 и 3×3 matcher поддерживает shaped, mirrored и shapeless recipes, tags и детерминированный consumption plan.
- Есть core recipes для planks, sticks, crafting table, chest, furnace, torch, ladder, white bed, door, bow/arrows/shield, tools, swords, armor, slabs/stairs и basic redstone/TNT items.
- Runtime furnace читает единые `SMELTING_RECIPES`/`FUEL_BURN_TICKS`: доступны iron/gold, sand→glass, logs→charcoal и raw foods без второй hardcoded table.
- Dropped items имеют physics, merge radius, pickup delay, pickup, cap, despawn и save/restore. Обычные cube block items рисуются atlas-cube. Sprite items (включая held torch и arrow) используют общую `GeneratedItemGeometry`: один front/back quad на весь sprite, толщина `1/16`, side spans только по opaque→transparent (`alpha == 0`) с merge соседних рёбер. Side faces — outer shell (winding совпадает с outward normal). Collapsed side UV берёт центр opaque texel, не границу с transparent neighbor. 32×32 pack не меняет model size, но диагонали дают больше 1-texel spans (у `iron_pickaxe.png` 104 merged spans). Generated item material без mob wrap-shade (voxel light для drops сохраняется). Stack size даёт до четырёх детерминированно смещённых визуальных копий без создания новых ресурсов на кадр.
- First-person предметы классифицируются как `block`, `generated`, `handheld`, `bow` или `shield`. `generated`, `handheld` и bow делят один first-person sprite pose: position `[0.50, -0.56, -0.82]`, rotation `[0, 0, 14]°` (pitch/yaw 0, screen-space roll). `scale: 0.85` — **final** Three.js uniform scale, не множитель на vanilla `0.68` (старый composed default был `0.68 * 0.52 = 0.3536`). Это временный face-on calibration, не vanilla 1.9 pipeline и не утверждённое art-значение. Канонический idle right-hand adapter (`heldItemVanillaTransform.ts`) восстанавливает `T_hand(0.56,-0.52,-0.72) * T_disp(1.13,3.2,1.13)/16 * Ry(-90°) * Rz(25°) * S(0.68)` и **не подключён** к production. Ry(−90°) — реальный display rotate (front +Z → camera −X), не basis conversion. Dev `?qaItem=` по умолчанию — isolated inspect (`qaView=front|back|left|right`), `qaView=held` возвращает first-person, `qaView=held&pose=idle` печатает FOV/aspect/matrices/projected `screen01` points (current + proposed vanilla). `qaSideDebug=1` красит UP/DOWN/LEFT/RIGHT. `held*` override только idle held transform. Textured Steve arm видна только при пустом main hand; equip, walk/idle bob, swing/mining, еда, bow texture stages `0 / 0.65 / 0.9` и blocking pose накладываются поверх base. Held torch — generated sprite; placed torch geometry не менялась. `GeneratedItemGeometry` topology/UV/winding/depth закрыты как baseline (SHA-256 lock в tests).

### Alpha approximation

- UI реализует cursor clicks и часть shift-transfer сценариев, но не выводит все возможности `Inventory` API: например, drag distribution есть в data layer и tests, но не оформлена как полноценный pointer-drag UX.
- Chest одиночный и содержит 27 slots; double chest и lock/name semantics отсутствуют.
- Печь обновляется только во время симуляции мира; открытие container UI ставит игру на паузу.
- Нет recipe book, подсказок неизвестных рецептов и массового craft по shift-click.
- First-person generated/handheld pose калибруется по Java screenshots: крупнее, правее/ниже, pitch/yaw 0 (face-on). Это не bit-exact JSON copy, **не** vanilla idle matrix и **не утверждённое** art-значение. Vanilla reconstruction есть в коде как diagnostic adapter, без production switch. Off-hand кроме щита, shield entity, chest inventory mesh и leather overlay остаются вне текущего pass.

## Игрок и survival

### Готово

- Feet-anchored AABB `0.6 × 1.8`, sneak height `1.5`, step height `0.6`.
- Скорости walk/sprint/sneak, jump velocity и основные формулы ориентированы на reference; точные отличия перечислены в `MINECRAFT_1_9_REFERENCE.md`.
- Collision resolver двигает по осям, поддерживает wall sliding, step-up и защиту от схода с края в sneak.
- Render camera получает текущие yaw/pitch непосредственно из input каждый animation frame; физика и gameplay остаются на fixed `20 TPS`, поэтому mouse-look не квантуется simulation ticks.
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
- Bow использует 20-tick charge curve, три pulling textures, плавный FOV zoom и movement slowdown, расходует arrows в Survival, повреждает bow и создаёт projectile с gravity/block/mob collision.
- MobManager подключён к main tick и save/restore.
- Passive: cow, pig, chicken, sheep. Hostile: zombie, skeleton, creeper, spider.
- AI имеет idle/wander/chase/attack/hurt/die states, caps, distance spawning/despawn, line of sight и voxel collision.
- Hostile melee использует реальную 3D-дистанцию между eye positions и voxel line of sight, поэтому не бьёт игрока на другом этаже или через стену.
- Creative player остаётся центром spawning/despawn, но не передаётся hostile AI как target.
- Player и skeleton используют общий arrow visual/physics basis: blocks-per-tick velocity, continuous segment collision, air drag `0.99`, water drag `0.6`, gravity `0.05 block/tick²`, speed-based damage и in-ground state. Creeper имеет fuse/radial explosion, hostile hits передаются в shield/armor/survival, смерть моба создаёт loot drops.
- Player knockback применяется только если `SurvivalSystem.damage()` реально нанёс damage; shield/armor/i-frame ignored hit не сдвигает игрока.
- Все восемь видов используют articulated pivot rigs и собственные local legacy entity sheets. У sheep исправлена длина base legs при сохранённом коротком wool overlay; skeleton torso двусторонний только для читаемости рёбер; zombie left limbs берут mirrored classic `64×32` UV (`[40,16]`/`[0,16]`), а forward-arms pose задаётся положительным Three.js Euler (`+1.2` / `+1.55`), не Minecraft-значением `-1.2`. Spider сохраняет emissive-style `spider_eyes` overlay; gameplay hitboxes независимы от visuals.
- `LegacyModel` отделяет `rotationPoint` от локального `addBox origin`, переводит Y-down model-space в Three.js и хранит неизменяемую base pose. Константы и уровни точности перечислены в `MOB_MODEL_REFERENCE.md`.
- World entities (mobs, drops, arrows, falling blocks, primed TNT) берут яркость и тёплый torch tint из тех же `skyLight`/`blockLight`, что и terrain: три sample (feet/torso/head), `createEntityMaterial` без Lambert N·L, мягкий wrap-shade не ниже `0.76`.
- Generic `TexturedCuboidGeometry` строит шесть независимых UV faces из logical texture offset/size; 2× sheets нормализуются так же, как 1×. Entity sheets используют sRGB/nearest; block atlas использует mipmaps, четырёхпиксельную extrusion-зону и ограниченную anisotropy.

### Alpha approximation

- AI использует direct steering плюс 1-block step-up, а не pathfinding/navigation mesh: сложный terrain всё ещё может застревать.
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
- Powered TNT превращается в отдельную visual primed entity с gravity/voxel collision, исчезает как block и взрывается после `4 s`.
- TNT explosion использует общий radial pipeline, но apply идёт batch: один lighting pass на slice, chain TNT без повторного `setBlock`. Mass TNT стоит в `ExplosionQueue` с time/job/voxel budget.
- Active sources, остаток button pulse и primed TNT с оставшимся fuse сохраняются/восстанавливаются. Redstone state v2 также хранит lever attachment/facing; v1 получает fallback `floor/north`. Derived wire power не хранится и пересчитывается после restore.
- Lever состоит из stone base и отдельной handle с pivot/rotation; placement поддерживает floor/wall/ceiling и четыре wall facings. Powered change инвалидирует chunk mesh.
- Torch/redstone torch — cuboid `0.22×0.88` с UV crop opaque региона torch.png; wall torch основанием касается стены, пламя наружу/вверх. Dust — ground quad с power tint, button — малый выступ на любой стороне, pressure plate — тонкую горизонтальную plate.
- Propagation bounded: queue и число шагов за update ограничены; отдельный test проверяет budget.

### Alpha approximation

- Это компактная шестисоседняя сеть, а не полная redstone topology Java 1.9.
- Нет repeater, comparator, piston, observer, dispenser/dropper, hopper, torch burnout и block-specific powered behavior за пределами TNT.
- Dust connection shape/power пока не получает отдельную визуализацию на block mesh.

## UI, input и lifecycle

### Готово

- DOM/CSS screens: loading, main menu, world list, create world, settings, controls, pause, death.
- HUD: crosshair, hotbar, selected item, health/hunger, mining progress, attack meter container, toasts и F3 debug.
- Рука, выбранный предмет и щит рендерятся геометрией в отдельной first-person Three.js scene после мира; прежние DOM image overlays удалены.
- Settings: volume, mouse sensitivity, render distance `2–6`, FOV `60–100`.
- Desktop pointer lock и keyboard/mouse controls: sprint на Shift, sneak/crouch на C; touch buttons не изменены.
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
- Сохраняются player position/velocity/view, health/hunger/saturation, selected slot, spawn point, inventory/equipment, time, block modifications, optional blockStates, chest/furnace state, dropped items, falling blocks, mobs, redstone sources и primed TNT.
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
Vitest:     22 files, 143 tests — PASS
Vite build: 74 modules — PASS
Size/archive: 0.93 MiB / 165 files — PASS
Main JS: 729.55 kB / 196.63 kB gzip; CSS: 12.90 kB / 3.82 kB gzip
```

Покрыты registries, excluded item scope, stack/inventory operations, item render routing/generated geometry (including `iron_pickaxe.png` span counts, outer-shell winding, inspect QA params and closed-baseline source/topology fingerprints), shared first-person sprite pose, `held*` QA overrides, vanilla idle first-person matrix adapter (not production-wired), crafting/smelting data и runtime furnace flow, combat formulas, shield/bow helpers, survival basics, player physics, generation/state, dropped items, mob manager и basic redstone/TNT. Пробелы и ручная матрица перечислены в `TESTING.md`.

## За пределами текущей alpha

Не реализованы multiplayer, server authority, accounts/cloud worlds, weather, farming, enchantments, brewing, Nether/End, villagers/trading, experience progression, advanced redstone, pistons/hoppers, vehicles, bosses и моддинг API. Это осознанно не подменяется заглушками в P0.
