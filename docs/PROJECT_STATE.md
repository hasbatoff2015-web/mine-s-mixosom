# Состояние проекта

Срез: **2026-08-25**. Версия: `0.1.0`, playable alpha.

Этот документ описывает фактическое состояние кода, а не желаемый feature list. Обозначения:

- **Готово** — путь от UI до runtime подключён и подходит для alpha;
- **Alpha approximation** — работает, но сознательно проще reference или имеет заметные ограничения;
- **Не реализовано** — в коде нет законченного пользовательского сценария.

## Сводка

| Область | Статус | Фактический результат |
| --- | --- | --- |
| Boot/menu/world list | Готово | Boot loading, главное меню, создание/загрузка миров; вход в мир идёт через `LOADING_WORLD` с реальным progress, пока initial radius не готов |
| Main loop | Готово | Fixed `20 TPS` (`advanceFixedStep`, `MAX_CATCH_UP_TICKS = 4`), RAF render, player/mob/drop/arrow interpolation, adaptive world-job budget |
| Procedural world | Готово | Seeded chunks `16×16×96`, plains/forest/desert, periodic mountains (+10…+20), deeper underground (~+15 to bedrock), connected caves, sea, five ores, thinned trees/cactus и biome-specific cross-plants; generate/light/mesh разделены и бюджетируются |
| Rendering | Готово для alpha | Three.js, render-rate camera look, mip-safe padded runtime atlas, independent world passes including vegetation FrontSide cutout, budgeted chunk meshing, special/cross geometry, shape-aware selection outlines, shared item/arrow visuals и отдельный first-person pass |
| Player physics | Готово для alpha | Voxel AABB, walk/sprint/sneak/jump, Creative double-Space flight, step `0.6`, collision, fall damage, water/lava |
| Mining/building | Готово для alpha | Shape-aware block raycast (AABB selection, not full-cell occupancy), 1.9 harvest formula, hardness/tool/tier, durability, Survival drops (Creative без collectible drops), dirty-mesh dedupe, deferred lighting flush |
| Inventory/crafting | Готово для alpha | 36 slots, 9-slot hotbar, armor (UI без off-hand), cursor clicks, 2×2/3×3 recipes, pixel container GUI, Recipe Book on crafting/Survival 2×2 (not furnace), Creative Catalog/Inventory tabs |
| Chest/furnace/bed | Готово для alpha (bed проще) | Entity chest model + lid-up animation + 27-slot GUI, furnace facing + lit front + torch-equivalent light, input/fuel/output GUI, spawn point and simple night skip |
| Basic redstone/TNT | Готово для alpha | Power `0–15`, dust attenuation, torch/lever/button/plate, gravity-driven primed TNT with TNT texture + fuse tint pulse, budgeted batched explosions, save/restore |
| Survival | Готово для alpha | Health, hunger, saturation, exhaustion, food, armor, air, lava/fire/cactus/starvation, death/respawn |
| Combat | Готово для alpha | 1.9-style cooldown curve, melee, critical, knockback, internal shield combat, staged bow draw and shared player/skeleton arrow physics |
| Entities | Готово для alpha | 8 legacy articulated rigs, 1-block mob step-up, falling-block entities, zombie limb/pose fix, simple AI, voxel lighting; **render interpolation** (pos/yaw/walkPhase) при simulation `20 TPS` |
| Day/night | Alpha approximation | 24,000-tick clock; terrain and world entities compose the same sky/block sample (`sky * daylight` vs warm torch block light) without Lambert N·L |
| Saves | Готово для alpha | IndexedDB schema 1, autosave, player/world/container/drop/mob/redstone/block-state/falling-block restore |
| Desktop input | Готово | Pointer lock, WASD, Shift sprint / fly descend, Ctrl fly sprint, double Space Creative flight, C sneak, mouse, F3 debug, **T chat** / **`/` command**, E inventory, DEV F8 chunk grid / F7 light view / F9 freeze streaming inspect; `?worldgenDebug=1` пишет surfaceY/mountain/hills/cave/cap/block на chunk HUD |
| Touch/mobile | Alpha approximation | Joystick, look zone, action buttons, safe-area CSS and portrait rotate overlay |
| Responsive browser QA | Готово для заданной matrix | Все desktop/mobile viewport sizes прошли visibility/count checks; representative visual QA выполнен на `667×375` и portrait |
| Audio | Alpha approximation | Central pause/mute/volume path and small procedural WebAudio tones; no authored SFX/music |
| Yandex SDK | Alpha integration | `/sdk.js`, init fallback, LoadingAPI ready, GameplayAPI start/stop and pause/resume events |
| Automated QA | Частично готово | unit/component tests (см. `docs/TESTING.md`), CPU job + lighting + streaming-scheduler + worldgen benchmarks и DEV `?perf=1` overlay (F8 colored chunk states, F7 light debug, F9 freeze front chunk, streaming inspector + mesh fairness HUD); no automated WebGL/IndexedDB/full browser E2E suite |
| Public release | Не готово | Нужны provenance approval, реальные device tests, Yandex draft audit and final moderation pass |

## Мир и блоки

### Готово

- Чанк хранит `16 × 96 × 16` numeric block IDs в `Uint16Array`. Индекс `y × 256 + z × 16 + x` не содержит `WORLD_HEIGHT`, поэтому старые modification deltas остаются валидными.
- Горизонтальные координаты процедурно не ограничены; вокруг игрока загружается настраиваемый радиус, дальние chunks удаляются из runtime cache.
- Генерация детерминирована строковым seed.
- Реализованы три биома: `plains`, `forest`, `desert`.
- Высота поверхности типично `63–84` (sea level `63`); periodic mountain mask даёт широкие возвышенности примерно `+10…+20` над local baseline, с headroom `12` блоков до `WORLD_HEIGHT`.
- Есть bedrock floor (`Y 0–2`) plus a world-wide **Stone cap at Y=3** (`STONE_CAP_TOP_Y`) that caves, lava ponds and ores cannot remove, ridged 3D-noise cave networks (ветвления и chambers, carve только `y ≥ 4` и `≤ localMin(surface) - 4`), небольшие irregular cave **lava ponds** (footprint ~3–12, depth 1–3, **closed Stone basin**: shrink/reject open waterline and cave-edge drops using generator-space `terrainSolid`, not missing-chunk-as-wall; after generate ordinary ponds stay idle, queue 0; **only actually exposed** cells enter `scheduleFluid` as a safety net) и veins для coal, iron, gold, redstone (**vein attempts ×2**) и diamond (**attempts ≈ current/3**: 1 vein + 1/3 extra chance, `size` прежний).
- Forest oak density ≈ 40% прежней, desert cactus ≈ 25–30% прежней; biome-specific cross-plants без изменения самих моделей.
- Terrain decor включает oak trees, cactus и детерминированные растения: tall grass/flowers в plains, tall grass/fern/flowers в forest, dead bush в desert.
- Реестр содержит stable-ID definitions для шести replaceable `cross`-растений поверх прежних air/liquids, terrain, древесины, руд, utility/building blocks, wool, redstone, slabs/stairs, **oak/birch/spruce fences**, **rail**, **cobweb**, **fire** (без item, `renderShape: fire`). Tall grass/fern несут `lightingMode: vegetation` и `biomeTint: grass`; flowers/dead bush — тот же lighting mode без grass tint. Fire — отдельный cutout layer: 4 крайние плоскости + 2 диагонали крестом, анимированный vertical strip (`block/fire.png`), не cube и не plant-cross.
- Изменения мира записываются как chunk deltas, поэтому исходные procedural chunks не сохраняются целиком. Старые saves загружаются без crash; **неизменённый** terrain при reload перегенерируется новым worldgen (возможен seam на границе уже изменённого и нового chunk). Для visual QA гор/пещер нужен новый мир.
- Chunk дополнительно хранит компактные `Uint8Array` skyLight/blockLight (`0–15`) того же размера, что и blocks.
- Sand и gravel при потере опоры удаляются из сетки и становятся falling-block entity с gravity/mesh, затем возвращаются в world.
- Дверь — тонкая 2-block cuboid geometry (`3/16`) с open/close, collision по occupied face, joint upper/lower state и UV half/hinge как у vanilla `door_*_left/right`.
- Лестница — тонкая cutout-плоскость на боковой опоре (`NORTH/SOUTH/EAST/WEST`). Climbing: контакт с thin climb volume (не целая cell), intent = movement INTO support (`dot(wishXZ, towardSupport)`), скорость `LADDER_CLIMB_SPEED = 4.0`, без input — `LADDER_MAX_DESCENT_SPEED = 3.0`, sneak (C) удерживает. Stairs не являются ladder. `CombatSystem.onLadder` читает тот же `player.onLadder`.
- Stairs — геометрические две (или больше для corner) AABB, не full cube: facing N/S/E/W, `stairHalf` bottom/top, neighbor-derived `straight/inner_*/outer_*` без сохранения shape. Collision и selection совпадают с boxes. Игрок поднимается generic step-up `0.6`, без ladder/climb mode.
- Slabs — `slabType` bottom/top/double. Single = высота 0.5; double = полный блок. Одинаковые slab merge, разные материалы нет. Raycast проходит пустую половину.
- Targeting: `World.raycast` DDA входит в voxel, затем тестирует `selectionLocalBoxes` / `blockSelectionBoxes`. Если луч проходит через пустую часть occupied cell (rail, plate, ladder, torch, …), hit не засчитывается и DDA идёт дальше. Outline, LMB и RMB делят один VoxelHit. Default для ordinary cubes — full block. Collision и selection разделены (rail не solid, но выбирается).
- `stone_stairs` остаётся legacy ID (`hiddenFromGameplay`), не крафтится и не показывается в Creative. Получаемые stairs: oak/birch/spruce planks, cobblestone, brick, stone brick. Slab counterparts те же плюс `stone_slab`.
- `stone_pressure_plate` делит `pressure_plate` render/redstone path с oak plate. Wooden trigger = all entities/items; stone = living (player/mobs). Placement только на верхнюю опору.

### Alpha approximation

- Нет greedy meshing: каждый видимый face становится отдельным quad. Dirty chunks перестраиваются с ограничением количества за tick и adaptive ms budget; один chunk в `pendingMesh` пока ждёт rebuild.
- Нет worker generation/meshing, LOD, occlusion system и полноценного frustum-aware scheduler. Pipeline на кадре: generate (unlit, radius = renderDistance+1) → incremental light → mesh visible radius. Visible chunk не мешится без neighbor light context. PLAYING: generation больше не вытесняет mesh навсегда — nearby/urgent ready mesh получает bounded slot даже на generation-кадре (`streamingScheduler.ts`). Halo pending mesh не конкурирует с wanted visible set. **lit→meshStart в несколько секунд из-за skip-all-mesh-on-gen снят**. Lighting flood mutex больше не останавливает очередь на blocked head; distant in-progress flood может быть preempted ради near unlock (`docs/reports/2026-08-23_lighting-halo-scheduler-starvation.md`). DEV inspector разделяет **prefetch lifetime** (`lit→meshStart`) и **player-visible latency** (`WANTED→VISIBLE`, `READY-WANTED WAIT`). `WORLD_LIGHT_BUDGET_MS = 2` сохранён; дальние края radius 6 всё ещё streaming, но очередь не зависает на 20–160 s из-за blocked head.
- Sky/block light **намеренно упрощены ради frame pacing**, не vanilla 1:1. Sky — только вертикальные столбцы (opaque режет доступ к небу; water/leaves −1; cross-plants не меняют sky). Горизонтальный 6-pass spread **удалён**. Block light — bounded flood от emitters (torch 14, burning furnace = torch, lava 15). `final` в shader: `max(sky * daylight, warm * block)` + cheap face shade. Lighting jobs **resumable** (`WORLD_LIGHT_BUDGET_MS = 2` в PLAYING, 8 на loading). Chunk несёт `lightVersion` / `meshedLightVersion`. Visible mesh ждёт neighbor light context + 1-chunk lighting halo. Daylight — shader uniform, не world relight. Light writes не dirty-ят geometry на каждый voxel; coalesced visual update после job.
- «Освещение пещер» больше не высотный fake: occluding blocks гасят sky light; torch/lava дают локальный block light. Нижние грани читают соседний voxel и больше не зануляются Lambert N·L. Cube faces усредняют 4 light samples на вершину, чтобы отверстия в землю не обрывались в pitch-black. Torch block-light visually тёплый (жёлто-оранжевый) без PointLight.
- Render classification независима от face occlusion/light semantics: opaque, alpha-tested cutout, vegetation cutout, fire cutout, glass translucent и water translucent имеют отдельные geometry/material paths. Leaves используют `alphaTest=0.42`, `transparent=false`, `depthWrite=true`, `DoubleSide` и сохраняют biome RGB tint. Cross-plants (`lightingMode: vegetation`) пишутся отдельным batched mesh с `FrontSide` и lighting normals `(0,1,0)`. Fire использует glow cutout с UV-анимацией кадра (без remesh).
- Water и glass разделены по opacity/render order, однако отдельные translucent faces внутри pass всё ещё не сортируются по глубине.
- Lever, torch/redstone torch, wire, button, pressure plate, oak door, ladder, stairs, slabs и chest больше не рисуются full cubes. Torch ставится на пол и стену; button — на пол, стену и потолок; ladder — только на боковую сторону solid support; pressure plate — только на верхнюю грань solid support. Chest — отдельная entity-модель (body/lid/latch) с Faithful `entity/chest/normal` texture. Placement facing = opposite of look (latch/front к игроку), отдельно от door look-facing. Крышка открывается назад-вверх вокруг заднего hinge (`chestLidAngle` > 0); lid/body разделены `CHEST_LID_SEAM = 1/64`, latch-south omitted, **lid underside (`down`) присутствует** чтобы внутренняя сторона крышки не была прозрачной. Furnace — cube с `blockStates.facing` (тоже opposite-of-look) и lit front `furnace_front_on` при `burnTime > 0`; emission = `torchBlockEmission()`. Bed всё ещё не имеет specialized mesh.
- Bed — один блок с установкой spawn point и простым пропуском ночи.
- Basic redstone намеренно ограничен шестисоседней передачей сигнала и не моделирует directional connection shapes, quasi-connectivity или advanced components.
- Fluid simulation: source + flowing (`fluidLevel` 8 / 1–7, `fluidFalling`), down-first then sideways, optional drop-direction preference, water ~7 cells / 5 ticks, lava shorter / 30 ticks, budgeted queue (48 updates, 1.5 ms, cap 2048). Water + lava source → obsidian; water + flowing lava → cobblestone. Render uses world-space **corner heights** and same-fluid face culling (not per-cell cuboids). Level-only changes remesh without relight. Distant fluids (chebyshev > min(meshRadius, 2)) pause in-queue. Worldgen lava — небольшие **enclosed** basin ponds (не scatter и не giant Y=12 sheets). `activateGeneratedFluidBoundaries` ставит в очередь только клетки с Air/replaceable/другой жидкостью рядом или снизу, включая x=15/16 когда соседний chunk появляется. Ordinary enclosed pond остаётся idle (queue 0).

## Предметы, добыча и создание

### Готово

- Data-first item registry связывает block items, resources, foods, tools, weapons, shield (internal/hidden), четыре комплекта armor, **flint and steel**, **golden apple**, **glass bottle**, **invisibility/regeneration potions**, **buckets**, **fire arrow** и **minecart**.
- В progression есть wood/stone/iron/diamond pickaxe, axe, shovel и sword; hoe и gold tools намеренно исключены.
- Gold armor присутствует, как и leather/iron/diamond armor.
- Stack validation, merge/split, left/right click semantics, durability, equipment constraints, atomic consume и serialization покрыты unit tests.
- Mining использует Java 1.9 формулу `(S/H)/30` при harvest и `/100` иначе. Preferred tool ускоряет добычу; `requiresCorrectTool` нужен только камню, рудам и furnace.
- 2×2 и 3×3 matcher поддерживает shaped, mirrored и shapeless recipes, tags, детерминированный consumption plan и **remainders** (lava bucket → empty bucket).
- Есть core recipes для planks, sticks, crafting table, chest, furnace, torch, ladder, white bed, door, bow/arrows, tools, swords, armor, slabs/stairs (включая birch/spruce/brick/stone brick; без hidden `stone_stairs`) и basic redstone/TNT/`stone_pressure_plate`. **Minecart** — shaped 5× Iron Ingot U (`I I` / `III`), в Recipe Book через `CRAFTING_RECIPES`. Shield recipe временно снят: предмет скрыт из obtainable gameplay.
- Runtime furnace читает единые `SMELTING_RECIPES`/`FUEL_BURN_TICKS`: доступны iron/gold, sand→glass, logs→charcoal и raw foods без второй hardcoded table. Lit visual/light выводятся из `FurnaceState.burnTime > 0`, не из отдельного `lit` flag. LightEngine читает `world.blockEmissionAt`.
- Dropped items имеют physics, merge radius, pickup delay, pickup, cap, despawn и save/restore. Обычные cube block items рисуются atlas-cube. Sprite items (включая held torch и arrow) используют общую `GeneratedItemGeometry`: один front/back quad на весь sprite, толщина `1/16`, side spans только по opaque→transparent (`alpha == 0`) с merge соседних рёбер. Side faces — outer shell (winding совпадает с outward normal). Collapsed side UV берёт центр opaque texel, не границу с transparent neighbor. 32×32 pack не меняет model size, но диагонали дают больше 1-texel spans (у `iron_pickaxe.png` 104 merged spans). Generated item material без mob wrap-shade (voxel light для drops сохраняется). Stack size даёт до четырёх детерминированно смещённых визуальных копий без создания новых ресурсов на кадр.
- First-person предметы классифицируются как `block`, `generated`, `handheld`, `bow` или `shield`. Held mesh отдельно: `block_cube` / `generated` / `special_model`. `generated`, `handheld` и bow делят один first-person sprite pose: position `[0.67, -0.29, -0.70]`, rotation `[1, -90, 34]°`, `scale: 0.60` (**final** Three.js uniform, не множитель на vanilla `0.68`). Значения выбраны вручную через live QA calibrator; yaw −90° — намеренный visual result, не порт vanilla matrix и не candidate 8/18/32°. Канонический idle right-hand adapter (`heldItemVanillaTransform.ts`) остаётся diagnostic-only. Dev `?qaItem=` по умолчанию — isolated inspect (`qaView=front|back|left|right`), `qaView=held` возвращает first-person с live panel; RESET TO PRODUCTION возвращает эти числа. `qaSideDebug=1` красит UP/DOWN/LEFT/RIGHT. `held*` / `qaPose` override только idle held transform. Textured Steve arm видна только при пустом main hand; equip, walk/idle bob, swing/mining, еда, bow texture stages `0 / 0.65 / 0.9` и blocking pose накладываются поверх base. Held torch/lever/ladder — generated sprite по vanilla 1.21.8 item JSON (`layer0` = block texture); oak_door — generated из runtime-композиции `oak_door_upper`+`oak_door` (в pack нет `item/oak_door.png`). Button/pressure plate/stairs/slabs/chest — `special_model`. **Любой** `special_model` идёт в `special_preview` (unknown shape → `generic` pose): auto-fit, sRGB, preview-only unlit clone, entity textures preloaded before `bake()`. Нет per-item brightness/scale. Chest icon использует тот же pipeline + `entity/chest/normal`. Ordinary cubes остаются 2D atlas tile; cube с `textures.front` (furnace, crafting table) использует front, не side. Creative E — отдельный `.mc-stage` с вкладками Каталог / Инвентарь (localization), catalog width 195 logical. Catalog: прокручиваемая сетка + gutter чтобы scrollbar не перекрывал 9-й столбец + только 9 hotbar slots; Inventory tab: armor слева сверху с силуэтами, без offhand, 3×9 на полную ширину + hotbar, без каталога. Catalog DOM/scroll сохраняется при переключении вкладок. Live `refreshOpenInventory()` патчит slot/recipe contents in-place (`data-sig`), hover — `::after` white overlay. Recipe Book только у crafting table и Survival 2×2 (кнопка в craft row, icon tabs); Furnace GUI без книги. Placement рецепта транзакционный: вернуть grid → затем real или ghost.

### Alpha approximation

- UI реализует cursor clicks, shift-transfer chest↔inventory, furnace routing и Recipe Book на crafting/Survival 2×2 (отдельная левая панель, кнопка книги в craft row, icon categories, search / All-Craftable, transactional real vs ghost). Полноценный pointer-drag distribution остаётся в data layer.
- Chest одиночный и содержит 27 slots; double chest и lock/name semantics отсутствуют. Lid `openProgress` — runtime-only. Lid underside — `down` face с `CHEST_LID_SEAM`.
- Печь тикает в общем world tick независимо от открытого GUI. Flame/arrow патчатся live. Recipe Book в печи сознательно отсутствует. GUI icon печи — `block/furnace_front`, не side.
- Recipe Book читает `CRAFTING_RECIPES`. `SMELTING_RECIPES` остаются источником furnace simulation, не UI-книги. Все crafting registry recipes считаются known/unlocked. Нет vanilla advancement unlocks.
- First-person generated/handheld/bow pose записан из manual visual QA: `[0.67, -0.29, -0.70]`, `[1, -90, 34]°`, scale `0.60`. Это **не** vanilla idle matrix и не pixel-perfect F2. Live panel и `qaPose` candidates остаются QA-only. Off-hand кроме щита, shield entity и leather overlay остаются вне текущего pass. Слот второй руки в container GUI скрыт.

## Игрок и survival

### Готово

- Feet-anchored AABB `0.6 × 1.8`, sneak height `1.5`, step height `0.6`.
- Скорости walk/sprint/sneak, jump velocity и основные формулы ориентированы на reference; точные отличия перечислены в `MINECRAFT_1_9_REFERENCE.md`.
- Creative flight: только `gameMode === creative`, double Space в окне 7 ticks (edge keydown), `CREATIVE_FLY_SPEED = 10.9` / sprint `21.6` / vertical `7.5`. Shift descend, Ctrl fly-sprint, hover без gravity, landing (`landed`) выключает полёт, collision остаётся, flying перекрывает ladder. `isFlying` не пишется в save.
- Collision resolver двигает по осям, поддерживает wall sliding, step-up, ladder climb/descent и защиту от схода с края в sneak. Solid collision — массив boxes на клетку (`blockCollisionBoxes`): stairs/slabs/cactus/door/chest используют фактическую форму. Ladder collision для ходьбы нет (non-solid); climb volume отдельно в `ladderMotion.ts`.
- Render camera получает текущие yaw/pitch непосредственно из input каждый animation frame; физика и gameplay остаются на fixed `20 TPS`, поэтому mouse-look не квантуется simulation ticks. Hurt camera roll — только `camera.rotation.z` (render offset); yaw/pitch и aim не меняются.
- Визуальные transforms мобов, drops, player arrows и primed TNT/falling blocks интерполируются на render frame (`alpha = accumulator / FIXED_DT`). AI, hitbox, damage и collision читают только simulation pose. Teleport/spawn/коррекции ≥ 6 блоков делают snap.
- Есть water/lava state, плавучесть/drag, утопление, lava/fire/cactus damage и fall damage после трёх блоков. Fire contact — AABB overlap с `BlockId.Fire` (`PlayerController.inFire` / `aabbOverlapsBlockType`), **1 HP / 20 ticks** while intersecting Fire; damage идёт через canonical armor mitigation (`fire`/`lava` **не** bypass). Выход из Fire сразу гасит `contactFire` (нет afterburn от ordinary Fire). Lava: 4 HP / 10 ticks + linger `ignite(300)`, тоже через armor. `FIRE_ARROW` (≈100 ticks) — отдельный таймер. Вода гасит arrow/lava/sunlight, не ordinary-fire contact (его и так нет вне клетки). First-person burning overlay — два нижних flame quad (shared fire strip, opacity 0.76), не 6-plane block перед камерой. Успешный health damage (`SurvivalSystem.onDamage`, `dealt > 0`) даёт короткий red flash и bounded hurt kick. Cobweb сильно замедляет игрока/мобов (`movementMultiplier` 0.15) и стрелы. Fence collision height 1.5.
- Survival считает health/hunger/saturation/exhaustion, regeneration/starvation и hurt resistance. Status effects: absorption, regeneration (heal-over-time), invisibility (hostile `playerTargetable` false; first-person empty-hand arm hidden while the effect is active, held item can remain). Drinkable potions: invisibility **3 min** (`3600` ticks), regeneration **1 min** (`1200` ticks). Active invis/regen show a small bottom-right HUD chip (potion icon, Russian name, `M:SS` countdown) and a soft lower-screen swirl particle overlay from `textures/particle/particles.png`. Effects не сериализуются (reload сбрасывает таймеры, absorption в save есть).
- Sprint в Survival доступен только при hunger выше `6`; удержание jump начисляет jump exhaustion только в tick фактического отрыва от земли.
- Armor использует release-1.9 damage formula; toughness выключена по умолчанию как более поздняя 1.9.1-механика.
- Food use требует удержания, consumable проверяет hunger cap.
- Death выбрасывает survival inventory/equipment, показывает экран смерти и возвращает игрока в spawn point. Death messages идут в локальный чат (`deathMessage(source)`).
- Локальный чат (без сети): T открывает поле, `/` открывает с префиксом `/`, Enter отправляет, Esc закрывает, Up/Down — история. Команды через `src/chat` registry: `/help`, `/gamemode`, `/time`, `/give`, `/tp`, `/seed`, `/clear`, `/kill`.
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
- Shield активируется после 5 ticks, замедляет движение, проверяет фронтальную дугу, снижает melee damage на 66% и полностью блокирует фронтальный projectile damage в рамках alpha. Сам предмет временно скрыт из obtainable gameplay; combat/renderer остаются internal.
- Bow использует 20-tick charge curve, три pulling textures, плавный FOV zoom и movement slowdown, расходует arrows в Survival, повреждает bow и создаёт projectile с gravity/block/mob collision.
- MobManager подключён к main tick и save/restore.
- Passive: cow, pig, chicken, sheep. Hostile: zombie, skeleton, creeper, spider.
- AI имеет idle/wander/chase/attack/hurt/die states, caps, distance spawning/despawn, line of sight и voxel collision. Hostile **surface night** spawn ≈ ×0.5 (`SURFACE_NIGHT_HOSTILE_SPAWN_FACTOR`). Dark cave hostiles spawn separately (low sky, solid floor, no lava/water), max **1 new cave hostile per chunk per spawn event**, local radius-12 density guard; not a permanent 1-mob-per-chunk lock. Passive spawn path unchanged.
- Hostile melee использует реальную 3D-дистанцию между eye positions и voxel line of sight, поэтому не бьёт игрока на другом этаже или через стену.
- Creative player остаётся центром spawning/despawn, но не передаётся hostile AI как target.
- Player и skeleton используют общий arrow visual/physics basis: blocks-per-tick velocity, continuous segment collision, air drag `0.99`, water drag `0.6`, gravity `0.05 block/tick²`, speed-based damage и in-ground state. **Fire arrow** — shapeless `arrow + lava_bucket` (остаётся empty bucket), projectile с оранжевым tint. Попадание: обычный урон стрелы + `igniteTicks` 100 (5 с) по живой цели; TNT block праймится; TNT minecart детонирует сразу; обычные блоки **не** поджигаются. Горение: `FIRE_CONTACT` / `FIRE_ARROW` / `SUNLIGHT` / lava — раздельные причины, общий overlay. **Все hostile** (`isHostileMob`) горят под прямым дневным солнцем (`daylight ≥ 0.82` и skylight ≥ 14), не vanilla undead whitelist. Player и passive не горят от солнца. Creeper имеет fuse/radial explosion, hostile hits передаются в shield/armor/survival, смерть моба создаёт loot drops.
- `MinecartManager`: 3D open-top entity (`minecartGeometry.ts`, texture `entity/minecart`), не item billboard. Opaque full-width inner floor (`MINECART_FLOOR_TOP = 0.16` above the 2/16 rail strip). **ON_RAIL** (`cart.rail`) uses rail-constrained W/S; end of a loaded track converts `alongSpeed × tangent` to world velocity and enters **OFF_RAIL** (gravity, voxel collision, ground friction `0.78`/tick, no W/A/S/D). Crossing a real rail cell re-snaps after a 4-tick grace. Ride Use; **Shift** (sprint edge) dismounts to a clear neighbor, on- or off-rail. LMB (attack edge) breaks a cart that is nearer than the block hit; Survival drops Minecart via `DroppedItemManager` (unprimed TNT cart also drops TNT); Creative removes without a world drop (`dropsForBrokenMinecart`); ridden and primed TNT carts are ignored. Player AABB push проектируется на tangent. TNT Use → variant `tnt` (не rideable); Flint entity-first prime, fuse 80 ticks, no Fire block; Fire Arrow — immediate explode (cart AABB taller than the rim so the cargo is hittable). Save `minecarts?` (position/velocity/variant/fuse/`onRail`). Isolated rail follows player look axis; EW visual yaw `π/2`. Practical, не vanilla bit-exact.
- Player knockback применяется только если `SurvivalSystem.damage()` реально нанёс damage; shield/armor/i-frame ignored hit не сдвигает игрока.
- Все восемь видов используют articulated pivot rigs и собственные local legacy entity sheets. У sheep исправлена длина base legs при сохранённом коротком wool overlay; skeleton torso двусторонний только для читаемости рёбер; zombie left limbs берут mirrored classic `64×32` UV (`[40,16]`/`[0,16]`), а forward-arms pose задаётся положительным Three.js Euler (`+1.2` / `+1.55`), не Minecraft-значением `-1.2`. Spider сохраняет emissive-style `spider_eyes` overlay; gameplay hitboxes независимы от visuals.
- `LegacyModel` отделяет `rotationPoint` от локального `addBox origin`, переводит Y-down model-space в Three.js и хранит неизменяемую base pose. Константы и уровни точности перечислены в `MOB_MODEL_REFERENCE.md`.
- World entities (mobs, drops, arrows, falling blocks, primed TNT) берут яркость и тёплый torch tint из тех же `skyLight`/`blockLight`, что и terrain: три sample (feet/torso/head), `createEntityMaterial` без Lambert N·L, мягкий wrap-shade не ниже `0.76`. Успешный mob damage (не fire DOT) ставит per-entity `hurtFlashSeconds` (~220 ms) и multiply-tint в `userData.entityLight`; shared `VoxelVisualFactory` materials не мутируются.
- Generic `TexturedCuboidGeometry` строит шесть независимых UV faces из logical texture offset/size; 2× sheets нормализуются так же, как 1×. Entity sheets используют sRGB/nearest; block atlas использует mipmaps, четырёхпиксельную extrusion-зону и ограниченную anisotropy.

### Alpha approximation

- AI использует direct steering плюс 1-block step-up, а не pathfinding/navigation mesh: сложный terrain всё ещё может застревать.
- Spawn rules, light checks, despawn, sunlight burning (all hostiles, not vanilla undead-only), loot chance и damage — gameplay approximation, а не полная таблица Java 1.9.
- Нет breeding, taming, shearing, animal drops по burning state, skeleton equipment, spider climbing и сложных special cases.
- Projectile/explosion physics не моделируют точный swept volume/exposure/raycast sampling vanilla.
- Shield disable-by-axe реализован в combat helper, но текущие мобы не атакуют топорами.
- Нет enchantments, experience и advanced combat feedback. Potion items (invisibility / regeneration) и golden apple effects есть; brewing stand нет.

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
- HUD: crosshair, hotbar, selected item, health/hunger, mining progress, attack meter container, active potion effect chips (bottom-right), toasts и F3 debug.
- Рука, выбранный предмет и щит рендерятся геометрией в отдельной first-person Three.js scene после мира; прежние DOM image overlays удалены.
- Settings: volume, mouse sensitivity, render distance `2–6`, FOV `60–100`.
- Desktop pointer lock: inventory/chest close = programmatic relock; Esc из PLAYING открывает pause через `pointerlockchange` без второго `exitPointerLock`; Continue делает один `tryRequestPointerLock()`. Если Chrome отклоняет relock после Esc, PLAYING остаётся и показывается overlay «Нажмите, чтобы продолжить» только после фактического failure. Focus-lost не считается programmatic и не запрашивает lock сам.
- Touch joystick/look/buttons и landscape layout with safe-area insets.
- Lifecycle states: `LOADING`, `MENU`, `PLAYING`, `PAUSED`, `AD`, `BACKGROUND`, `DEAD`.
- Только `PLAYING` продвигает fixed simulation; остальные states останавливают audio и GameplayAPI marker.
- Container/modal ≠ simulation pause: inventory, Creative catalog, chest, furnace, crafting table и Recipe Book остаются в `PLAYING`. Мир, печи и сущности тикают; WASD / look / attack / use / flight блокируются. `Esc` → Pause menu — единственный обычный gameplay путь в `PAUSED`.

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
- Сохраняются player position/velocity/view, health/hunger/saturation, selected slot, spawn point, inventory/equipment, time, block modifications, optional blockStates, chest/furnace state, dropped items, falling blocks, mobs, redstone sources, primed TNT и optional minecarts.
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
Vitest:     53 files, 495 tests — PASS
Vite build: 116 modules — PASS
Size/archive: 1.15 MiB / 180 files — PASS
Main JS: 934.02 kB / 259.29 kB gzip; CSS: 27.02 kB / 6.28 kB gzip
```

Покрыты registries, excluded item scope, stack/inventory operations, item render routing/generated geometry (including `iron_pickaxe.png` span counts, outer-shell winding, inspect QA params and closed-baseline source/topology fingerprints), shared first-person sprite pose, `held*` / `qaPose` QA overrides, live pose calibrator helpers, `qaPoseCompare` parse, vanilla idle first-person matrix adapter (not production-wired), crafting/smelting data и runtime furnace flow, combat formulas, shield/bow helpers, survival basics, player physics, generation/state, dropped items, mob manager и basic redstone/TNT. Пробелы и ручная матрица перечислены в `TESTING.md`.

## За пределами текущей alpha

Не реализованы multiplayer, server authority, accounts/cloud worlds, weather, farming, enchantments, brewing stand, Nether/End, villagers/trading, experience progression, advanced redstone, pistons/hoppers, bosses и моддинг API. Drinkable potions, rails и minecart в этой alpha есть как practical approximation, без brewing/powered rails. Это осознанно не подменяется заглушками в P0.
