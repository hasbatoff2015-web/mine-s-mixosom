# Архитектура

## Цели

Архитектура Frontier Cubes рассчитана на большую, но ограниченную browser alpha:

- детерминированная fixed-step simulation с частотой `20 TPS`;
- data-first registries вместо разбросанных switch-таблиц;
- процедурный мир, который сохраняет только изменения;
- bounded runtime systems для chunks, dropped items, mobs и projectiles;
- независимая local playability при отсутствии platform SDK;
- минимальное число production dependencies: Three.js для WebGL, Vite/TypeScript для toolchain.

Это single-player client-only приложение. Server authority, networking и ECS framework отсутствуют намеренно.

## Карта подсистем

```mermaid
flowchart TD
  Entry["main.ts"] --> Game["Game: orchestration + fixed loop"]
  Game --> Life["LifecycleManager"]
  Game --> Input["InputManager"]
  Game --> UI["GameUI"]
  Game --> World["VoxelWorld + TerrainGenerator"]
  Game --> Render["WorldRenderer + ChunkMesher + TextureAtlas"]
  Game --> Player["PlayerController"]
  Game --> Survival["SurvivalSystem"]
  Game --> Combat["CombatSystem + PlayerArrowManager"]
  Game --> Entities["MobManager + DroppedItemManager"]
  Game --> Redstone["RedstoneSystem"]
  Game --> Save["SaveService / IndexedDB"]
  Game --> Platform["YandexGamesService"]
  World --> Blocks["Block registry"]
  UI --> Inventory["Inventory + crafting"]
  Player --> World
  Entities --> World
  Redstone --> World
  Combat --> Entities
  Save --> Serialized["SerializedWorldState v1"]
```

Главный принцип: `Game` соединяет системы, но правила blocks/items/crafting, player physics, survival formulas и entity simulation остаются в отдельных модулях, которые можно тестировать без WebGL UI.

## Boot и владение ресурсами

`src/main.ts` находит canvas/UI roots, создаёт один `Game` и запускает `initialize()`.

Во время initialization параллельно:

1. открывается IndexedDB;
2. инициализируется Yandex SDK либо local no-op path;
3. строится runtime texture atlas из whitelist-файлов `public/textures`.

После этого показывается интерактивное главное меню и вызывается platform loading-ready marker. `Game` владеет renderer, scene, camera, lifecycle, audio, input, save и platform adapters. Объекты конкретного мира собраны в `GameSession` и освобождаются при выходе/смене мира.

## Fixed loop и порядок tick

Render loop использует `requestAnimationFrame`. Реальная frame delta ограничивается `MAX_FRAME_DELTA = 0.25 s`, затем накапливается в accumulator. Пока accumulator не меньше `FIXED_DT = 0.05 s`, выполняется simulation tick. Камера интерполируется между `previousPosition` и текущей позицией игрока.

Simulation продвигается только в lifecycle state `PLAYING`. Текущий tick логически выполняет:

1. world clock, scheduled block ticks и furnaces;
2. combat state: held/off-hand, shield use и cooldown;
3. player input, hunger-aware sprint gate, AABB physics и survival/environment update;
4. chunk ensure/prune и ограниченный dirty rebuild;
5. block/mob targeting, mining, melee и use action;
6. food/bow use и player projectiles;
7. mob AI/physics/projectiles;
8. mob damage, drops и explosion events;
9. dropped-item physics/pickup;
10. pressure-plate occupancy, bounded redstone propagation, primed TNT fuse и explosion events;
11. autosave check и HUD refresh.

Такой порядок даёт простой детерминированный каркас, но не заявляет bit-exact vanilla ordering.

## Lifecycle

`GameLifecycleManager` использует состояния:

```text
LOADING → MENU → PLAYING ↔ PAUSED
                    ↓
                   DEAD
PLAYING → AD / BACKGROUND → controlled resume
```

На входе в `PLAYING` audio возобновляется и Yandex `GameplayAPI.start()` вызывается idempotently. В остальных states simulation/audio останавливаются и вызывается `GameplayAPI.stop()`. Background также инициирует save.

Текущая state machine хранит только одно предыдущее состояние. Для production желательно перейти к набору независимых pause reasons, чтобы user pause, platform modal и visibility не могли ошибочно отменить друг друга.

## Data registries

### Blocks

`src/blocks/types.ts` определяет stable numeric `BlockId` и data contract: hardness, collision/light `opaque`, independent `occludesFaces`, `renderLayer`, `renderShape`, tool, tier, drops, textures, emission, flammability, gravity, liquid, replaceability, redstone power и contact damage.

`src/blocks/registry.ts` является canonical block catalog. Он строит индексы по numeric ID и string key, валидирует uniqueness и автоматически создаёт block items для definitions, которые не отключили `hasItem`.

Numeric IDs лежат в chunk arrays и saves. Их нельзя переиспользовать для другого блока без migration.

### Items и inventory

`src/items/registry.ts` содержит discriminated unions для block/resource/food/tool/weapon/shield/armor. Max stack, durability, tool stats, food values и equipment constraints приходят из definition, а не из UI.

`Inventory` владеет 36 ordinary slots, armor record и off-hand. Все getters возвращают clones, поэтому внешняя система не может тихо изменить внутренний stack. Serialization валидируется при restore.

### Crafting и smelting

Recipes в `src/crafting/recipes.ts` поддерживают exact item, `anyOf` и tags. Matcher нормализует occupied bounds, умеет shifted/mirrored shaped recipes и shapeless backtracking, возвращая consumption plan.

`VoxelWorld.tickFurnaces()` использует те же `findSmeltingRecipe()` и `getFuelBurnTicks()`, что data layer и tests. Iron/gold, glass, charcoal и raw foods проходят через один canonical registry; output count, cooking time и max stack берутся из definitions.

## World model

### Chunks

`Chunk` хранит blocks в плотном `Uint16Array` длиной `16 × 80 × 16`. Индекс:

```text
index = y × 16 × 16 + z × 16 + x
```

`VoxelWorld` переводит world coordinates в chunk/local coordinates через floor division и positive modulo, что корректно работает с отрицательными X/Z.

### Generation

`TerrainGenerator` хеширует строковый seed и использует собственные value-noise/fBm helpers. Column generation выбирает biome и height; chunk pass заполняет bedrock/stone/top layers/water, затем вырезает caves, размещает ores и decor. Итоговые height/biome каждого столбца сохраняются в `Chunk.surfaceHeights`/`biomeCodes`, чтобы mesher не повторял noise sampling для каждого видимого face.

Генератор не читает browser state или wall clock, поэтому базовый terrain воспроизводим по seed. Loot, часть explosions и некоторые runtime decisions используют `Math.random()` и не являются replay-deterministic.

### Modifications и block entities

При `setBlock(..., record = true)` изменение сохраняется в:

```text
Map<chunkKey, Map<linearBlockIndex, BlockId>>
```

При повторной генерации chunk delta накладывается поверх base terrain. Chest/furnace states хранятся отдельно по world block key `x,y,z`. Redstone сохраняет только source/primed-entity state, а derived wire power пересчитывает после restore.

Scheduled block queue ограничена, за tick обрабатывается bounded число updates. Она обслуживает falling blocks и минимальный downward liquid path.

## Rendering

`TextureAtlas.create()` собирает нужные block textures в power-of-two canvas atlas. Содержимое tile — `32×32`, вокруг него экструдируется gutter `4 px`; UV указывают только на content. Pixel art использует nearest magnification, `NearestMipmapLinearFilter`, mipmaps, ограниченную renderer-capability anisotropy и sRGB. Это снижает shimmer и не даёт mip levels смешивать соседние tiles. Missing texture получает заметный magenta/black fallback. Raw `assets/` остаётся локальным и исключён из публичного Git; воспроизводимая runtime-копия состоит из 150 whitelist-файлов в `public/textures`, включая 10 entity sheets/layers.

`ChunkMesher` проходит плотный block array, читает соседние chunk arrays один раз на build и добавляет только faces, у которых сосед не `occludesFaces`. Cube hot path развёрнут по шести направлениям и не вызывает `world.getBlock()`/`columnAt()` на каждый face. Geometry содержит positions, normals, UV и vertex colors. Grass/leaves получают biome RGB tint из chunk column cache; приблизительная cave light и face-direction shade также записаны в vertex color. `opaque` больше не выбирает render material.

`WorldRenderer` создаёт независимые material paths:

- opaque `MeshLambertMaterial` без blending;
- cutout material с `alphaTest=0.42`, `transparent=false`, depth test/write для leaves и alpha sprites;
- translucent glass material с opacity `0.52`;
- отдельный translucent water material с opacity `0.70` и более поздним render order.

Dirty chunks перестраиваются с лимитом jobs и бюджетом миллисекунд; generation и meshing не совмещаются в один fixed tick, а repeated dirty changes coalesce. Дальние chunk visuals освобождают geometry. Selection outline — отдельный line mesh.

`BlockDefinition.renderShape` маршрутизирует non-cube blocks в расширяемые builders. Сейчас lever строится из stone base и pivoted handle; torch/redstone torch — crossed planes, wire — ground quad, button — малый cuboid, pressure plate — тонкая plate. Mesher всё ещё не объединяет faces; stairs/doors/beds/containers остаются следующим geometry extension point.

## Player, survival и combat

### PlayerController

Позиция игрока привязана к центру ступней. Collision resolver строит AABB, двигает его по Y/X/Z, ограничивает displacement ближайшим solid collision box, затем пробует step-up. Slabs получают half-height collision; cactus — inset box.

Controller отвечает только за movement/physics state и сообщает fall damage callback. Health ownership остаётся в `SurvivalSystem`.

`PlayerTickResult.jumped` true только в tick реального takeoff (`jump && grounded && !liquid`). Поэтому удерживаемая кнопка не повторяет jump exhaustion каждый airborne tick.

### SurvivalSystem

SurvivalSystem хранит health, hunger, saturation, exhaustion, absorption, air/fire timers, difficulty, hurt resistance и spawn point. Он принимает context, а не напрямую управляет UI. Armor stats читаются через узкий `Inventory.getSlot` contract.

Damage pipeline:

```text
requested damage
→ hurt-resistance filtering
→ optional armor formula
→ absorption
→ health/death callbacks
```

Orchestrator применяет mob knockback только когда возвращённый `DamageResult.dealt > 0`, поэтому fully blocked или i-frame ignored hit не создаёт движение без урона. Survival sprint input отдельно блокируется при hunger `≤ 6`; Creative этот gate не использует.

### CombatSystem

CombatSystem хранит attack cooldown и shield state. Melee result вычисляет strength/damage/critical/knockback, но не изменяет health цели — это делает orchestrator через MobManager/SurvivalSystem.

`PlayerArrowManager` владеет ограниченным набором player arrows, выполняет sub-step movement, gravity и выбирает ближайшее block/mob intersection.

## Entities

### DroppedItemManager

Dropped items имеют bounded capacity, pickup delay, despawn timer, simple voxel physics, merging, partial pickup и serialization. `onPickup` возвращает реально принятую inventory count, поэтому полный inventory не удаляет предмет из мира.

### MobManager

MobManager владеет mob entities и skeleton projectiles. Definitions задают size, health, speed, ranges, damage, cooldown и loot. Runtime state machine включает idle/wander/chase/attack/hurt/die.

Вместо тяжёлого pathfinding используется direct steering плюс voxel collision/line of sight. Hostile melee сравнивает 3D distance между eye positions и требует voxel LOS. `playerTargetable: false` сохраняет player-centred spawning/despawn для Creative, но убирает игрока из hostile target selection. Events `playerDamage`, `explosion` и `drop` накапливаются и потребляются `Game`, что сохраняет границу между entity simulation и player inventory/health/world destruction.

Caps зависят от coarse pointer profile. Restore может принудительно создать сохранённых мобов в пределах общего hard cap.

`VoxelVisualFactory` разделяет простые colored item/projectile boxes и textured entity cuboids. `TexturedCuboidGeometry` вычисляет legacy cross-layout UV для всех шести faces из logical offset/width/height/depth; normalized UV одинаковы для 1× и 2× physical sheets. Entity materials используют nearest, sRGB, no mipmaps и alpha test.

`LegacyModel` является единым adapter для code-defined rigs: `16 model units = 1 block`, legacy Y направлен вниз, default ground plane равен `Y=24`. `rotationPoint` создаёт `Group pivot`, а `addBox origin` остаётся локальным центром cuboid; Euler X/Z меняют знак после отражения Y. Несколько definitions могут добавлять boxes в parts с одинаковыми именами — так base sheep и wool остаются разными слоями на общих pivots.

Cow, pig, chicken, sheep, zombie, skeleton, creeper и spider имеют отдельные legacy definitions. Sheep добавляет inflated fur layer, spider — eyes overlay. Animation всегда вычисляет `baseRotation + bounded offset`, поэтому pose не накапливает ошибку. Soft horizontal mob separation использует не более `1024` unordered pair checks за update. Physics AABB остаётся в `MobDefinition` и не зависит от visual mesh. Числовой reference и честные пометки exact/approx находятся в `MOB_MODEL_REFERENCE.md`.

## Basic redstone

`RedstoneSystem` — отдельная bounded simulation над `VoxelWorld`. `Game` вызывает `notifyBlockChanged()` после placement, mining и explosion destruction, затем обновляет систему один раз за fixed tick.

Состояние разделено на:

- source map для torch, lever, button и pressure plate;
- derived `wirePower` map со значениями `0–15`;
- dirty queue/set для ленивого распространения;
- bounded collection primed TNT;
- очередь explosion events для общего `Game.explode()` pipeline.

Dust распространяет сигнал по шести voxel-соседям, уменьшая уровень на единицу. Torch постоянна, lever переключается use action, button хранит оставшееся pulse time, pressure plate получает occupancy из positions игрока, мобов и dropped items.

Powered TNT удаляется из мира и становится отдельным Three.js visual с default fuse `4 s`. После fuse RedstoneSystem выдаёт typed explosion event; `Game` применяет radial damage/block destruction и коротко primes TNT, затронутый взрывом, создавая chain reaction.

Serialization version 2 хранит active sources, lever attachment/facing, остаток timed button и primed TNT с оставшимся fuse. Restore принимает version 1 и назначает старому lever безопасную ориентацию `floor/north`. Wire power намеренно не сохраняется как производное состояние.

Default safety bounds: до `2,048` sources, `64` primed TNT, `512` propagation steps за update и `8,192` queued updates. Это basic redstone approximation без directional dust shapes, quasi-connectivity и advanced components.

## UI и input

`GameUI` строит screens/modals как DOM, а не рисует интерфейс в WebGL. Это упрощает responsive layout и debugging. Inventory UI оперирует теми же `ItemStack`/matcher APIs, что и tests.

HUD получает фактический attack strength и `shieldRaised`; при активном shield отдельный first-person overlay показывает blocking state.

`InputManager` нормализует desktop и touch в общий `MoveInput` плюс edge-triggered attack/use flags. Desktop использует pointer lock; touch создаёт joystick, look zone и action buttons.

CSS применяет safe-area insets, compact landscape layouts и portrait rotation overlay. UI не должен менять simulation напрямую: callbacks возвращаются в `Game`.

`GameUI` также переключает `#app.controls-suppressed`, поэтому touch look/joystick/actions скрыты на menus и modals и не перехватывают pointer input поверх UI.

HUD обновляется с частотой `10 Hz` и меняет DOM только при изменившемся значении. F3 собирает rolling frame/tick average, p95/spike, chunk generation/mesh jobs и timings, dirty/rendered/loaded chunks, faces/triangles/draw calls и entity counts; текст пересобирается примерно `2.9 Hz`, а не каждый render frame.

## Persistence

```mermaid
flowchart LR
  Generator["Seeded base terrain"] --> World["VoxelWorld"]
  Delta["Chunk modifications"] --> World
  World --> Snapshot["SerializedWorldState v1"]
  Player["Player + inventory"] --> Snapshot
  Containers["Chests + furnaces"] --> Snapshot
  Entities["Drops + mobs"] --> Snapshot
  RedstoneSave["Sources + primed TNT"] --> Snapshot
  Snapshot --> IDB["IndexedDB worlds store"]
  IDB --> Restore["Generate + apply deltas + restore session"]
```

`SaveService` делает structured clones на границе storage и сортирует summaries по `updatedAt`. Autosaves сериализуются через promise chain, чтобы параллельные записи не обгоняли друг друга.

Если IndexedDB отсутствует, используется in-memory Map. Это graceful degradation, но не durable save.

## Yandex adapter

`YandexGamesService` изолирует optional SDK:

- `initialize()` ловит отсутствие или ошибку SDK;
- `loadingReady()` отправляется не более одного раза;
- `gameplayStart/Stop()` idempotent;
- platform pause/resume events переводятся в lifecycle callbacks;
- local development не блокируется `/sdk.js`.

Ads, authorization, cloud saves, leaderboards и payments находятся вне текущего adapter scope.

## Performance boundaries

В коде уже есть несколько hard/bounded limits:

- frame delta cap `0.25 s`;
- один новый chunk за normal gameplay tick;
- один или два dirty chunk rebuild за tick в зависимости от pointer profile плюс `4/7 ms` soft budget;
- periodic chunk pruning;
- scheduled block queue max `4096`, processing max `64/tick`;
- dropped item cap default `128`;
- desktop/mobile mob and projectile caps, separation до `1024` pairs/update;
- player arrow cap `48`, lifetime `8 s`.
- redstone source/TNT/queue/steps caps.

Эти ограничения защищают main thread от неограниченного роста, но не заменяют profiling. Воспроизводимый `npm run benchmark:performance` отдельно измеряет 81 chunk generation/meshing и 600 updates для 24 mobs. Текущий профиль не оправдывает worker migration в этом проходе: сначала устранён подтверждённый synchronous mesh hot path; worker остаётся архитектурным следующим шагом для слабых устройств и больших render distances.

## Правила расширения

- Новый block: выделить новый stable `BlockId`, добавить registry definition, runtime texture whitelist и tests; при special shape добавить model/collision/state явно.
- Новый item: definition + texture + recipe/drop path + stack/equipment tests.
- Новая save field: обновить `SerializedWorldState`, validation, round-trip test и migration policy.
- Новая simulation system: fixed tick ownership у `Game`, bounded collections, explicit dispose и serializable state при необходимости.
- Redstone extension: сохранять derived/sourced state boundary, bounded propagation и общий explosion event contract; advanced component не должен обходить эти ограничения.
- Platform feature: держать за adapter boundary; local mode должен оставаться playable.
- Asset: сначала provenance/license, затем whitelist import; наличие файла в raw `assets/` не означает разрешение на runtime use.
