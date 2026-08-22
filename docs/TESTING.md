# Тестирование

## Цель

Проверки разделены на три уровня:

1. unit/component tests для чистых TypeScript systems;
2. production validation для typecheck, bundle, archive paths и размера;
3. browser/device smoke для WebGL, input, UI, lifecycle и IndexedDB.

Green unit suite не равна готовности к публикации: WebGL, browser storage, touch и Yandex lifecycle требуют отдельной проверки.

## Команды

Установка и запуск:

```bash
npm install
npm run dev
```

Отдельные проверки:

```bash
npm run typecheck
npm test
npm run build
npm run check:size
npm run check:archive
npm run benchmark:performance
```

Полный локальный pipeline:

```bash
npm run check
```

`npm run check` последовательно запускает strict TypeScript check, Vitest, production build и size/path validation. `check:archive` дополнительно отвергает `.ts`, `.map` и `.psd` в production output.

Если локальная исходная папка `assets/` доступна, перед тестированием импорта:

```bash
npm run assets:import
```

Команда должна завершиться отчётом о 161 выбранном runtime asset. В clean clone
без локального source pack этот шаг нужно пропустить: готовый whitelist уже
закоммичен в `public/textures`, а importer завершится до очистки output.

## Текущее автоматическое покрытие

Срез локального запуска **2026-08-22**:

```text
tsc --noEmit: PASS
Vitest:       27 test files, 214 tests, 214 passed
Vite build:   82 modules PASS
Size/archive: PASS, 0.96 MiB uncompressed, 165 files
Main assets:  JS 761.24 kB / 206.74 kB gzip; CSS 12.90 kB / 3.82 kB gzip
```

| Test file | Tests | Что проверяется |
| --- | ---: | --- |
| `tests/block-registry.test.ts` | 12 | Registry invariants, independent render layers, special shapes, hidden stone_stairs и replaceable cross-plant definitions |
| `tests/inventory.test.ts` | 7 | Stack insertion/remainder/removal, cursor clicks, equipment, shift move, drag API, serialization, atomic consume, durability break |
| `tests/crafting.test.ts` | 9 | Shapeless/shifted/mirrored recipes, white-bed restriction, consumption plan, core recipe outputs including brick stairs/stone plate, smelting/fuel data |
| `tests/combat.test.ts` | 7 | Cooldown/damage curve, 1.9 profiles, shield timing/reduction, axe chance, bow curve, armor formula, survival drowning/food/death/respawn |
| `tests/player-physics.test.ts` | 5 | Floor/wall sliding, fall damage, slab collision/step-up, stair generic step-up и takeoff-only jump event |
| `tests/entities.test.ts` | 9 | Dropped-item merge/pickup/cap/restore, all 8 mob models, raycast/damage, creeper, skeleton, Creative non-targetability, vertical melee guard и bounded soft separation |
| `tests/world-generation.test.ts` | 4 | Negative chunk coordinates, seed determinism, five ore vertical bands/rarity и deterministic biome vegetation across real chunks |
| `tests/world-state.test.ts` | 3 | Runtime furnace flow, modified blocks/chests/furnaces restore и placement collision guard |
| `tests/redstone.test.ts` | 8 | Power `0–15`, timed sources/TNT, all 24 lever attachment/facing/power geometry combinations, v2 orientation round-trip, v1 fallback и bounded propagation |
| `tests/visual-models.test.ts` | 10 | Atlas layout, descriptors/sheets, logical UVs, model-space conversion, corrected sheep layers, zombie classic biped UVs, targeted skeleton double-side/zombie front-side materials, spider constants and articulated rigs |
| `tests/chunk-mesher.test.ts` | 1 | Generated column cache is reused without per-face noise resampling |
| `tests/performance-stats.test.ts` | 1 | Bounded rolling average/p95/spike telemetry |
| `tests/item-rendering.test.ts` | 26 | Routing generated/handheld/block/bow, shared FP pose, bow 0.65/0.9, one front/back quad, no row-span fronts, depth `1/16`, alpha==0 span merge, 32×32 size, cache reuse, torch/arrow/lever/ladder/door generated held path, held* QA parse/defaults, idle front-facing camera |
| `tests/special-block-items.test.ts` | 7 | Lever/ladder/door held ≠ cube, placed lever intact, ladder thin N/S/E/W + selection, door UV/half/hinge/open routing, shield hidden from obtainable paths |
| `tests/stairs-slabs-icons.test.ts` | 22 | Stair/slab families, hidden stone_stairs, geometry/corners/collision/selection, slab merge/raycast, stone plate, special icon categories, pose lock |
| `tests/ladder-climbing.test.ts` | 13 | Thin ladder contact, N/S/E/W into-wall climb, back+S climb, descent clamp, gravity resume, stairs are not ladders |
| `tests/icon-scroll-fixes.test.ts` | 6 | Icon auto-fit extent, no per-item padding, Creative patch-dynamic keeps scroll/catalog, special-icon preview lighting (bright face shades, entity-light hooks stripped on clone) |
| `tests/pointer-lock.test.ts` | 6 | Inventory-close and pause-resume pointer lock: capture on Continue, not on Esc-open-pause, not while modal/coarse/already locked |
| `tests/camera-look.test.ts` | 2 | Live input rotation immediately reaches render camera between fixed ticks; fixed simulation remains `20 TPS` |
| `tests/arrow-physics.test.ts` | 2 | Full-charge launch is `3 blocks/tick`; common air drag/gravity constants and update order |
| `tests/mining.test.ts` | 3 | 1.9 harvest vs preferred-tool, hand/axe/pickaxe/shovel break times |
| `tests/lighting-physics-interaction.test.ts` | 8 | Block light, mob step-up, falling sand, primed TNT gravity, torch/button/door placement, door collision/geometry |
| `tests/vegetation-lighting.test.ts` | 8 | Vegetation lighting profile, grass-compatible tint, upward normals, FrontSide cutout, torch block light |
| `tests/explosion-performance.test.ts` | 5 | Batch relight dedupe, redstone notify dedupe, chain TNT once, 32-job budget drain, single TNT in one slice |
| `tests/lighting-torch-selection.test.ts` | 11 | Bottom-face torch lighting, cave darkness floor, warm block-light tint, wall torch attachment/size, shape-aware selection, cave-opening sky interpolation |
| `tests/entity-lighting.test.ts` | 4 | Daylight mob brightness, unlit cave darkness, warm torch tint, feet/torso/head averaging |

Тесты выполняются в Node и не создают настоящий browser/WebGL context.

Targeted regression pass также подтвердил кодовые fixes:

- `jumped` true только на takeoff, поэтому удержание Space не начисляет exhaustion в каждом airborne tick;
- Survival sprint запрещён при hunger `≤ 6`, Creative не ограничен hunger;
- Creative player не является hostile AI target;
- mob melee использует 3D eye distance и voxel line of sight;
- knockback игрока применяется только при `DamageResult.dealt > 0`.

## Что пока не покрыто автоматически

- full `Game` boot и lifecycle transitions;
- IndexedDB schema/transaction round trip;
- complete `SaveService`/IndexedDB save/load с player, drops и mobs;
- более широкий deterministic terrain snapshot corpus и chunk-boundary mesh regression;
- WebGL renderer, texture loading и missing-texture detection;
- DOM inventory end-to-end gestures;
- touch pointer capture, orientation change и safe-area devices;
- runtime melee/shield/bow/mob/explosion chain;
- полный `Game`-level redstone path от use/placement до chain explosion и save through `SaveService`;
- autosave при visibility/pagehide;
- Yandex SDK draft/debug-panel behavior;
- memory/performance soak.

Это P0 gaps, а не доказательство неработоспособности уже протестированных data systems.

## Выполненный browser smoke и responsive QA

На локальном dev server уже проверен базовый путь через управляемый Chromium:

- загрузка главного меню без runtime console errors;
- переход в список миров и форму создания;
- создание Survival мира с seed;
- появление terrain, HUD и hotbar;
- открытие/закрытие inventory;
- pause через `Esc`;
- «Сохранить и выйти»;
- появление мира в списке и повторная загрузка.
- загрузка сохранённого мира и respawn path;
- inventory/pause controls suppression;
- отсутствие console warnings/errors (`[]`) в финальном smoke;
- возврат viewport к исходному размеру после matrix.

Visual parity pass дополнительно использовал три детерминированные WebGL-сцены:

- Forest: пять перекрывающихся крон подтвердили полностью непрозрачные зелёные pixels leaves, сохранённые alpha holes и отдельную translucent water surface;
- Mobs: одновременно проверены cow, pig, chicken, sheep, zombie, skeleton, creeper и spider с локальными sheets, fur/eyes overlays и pivot hierarchy;
- Lever: floor/wall/ceiling pairs подтвердили неподвижную base, противоположные on/off handle angles и non-cube torch/wire/button/plate;
- после этих сцен в browser log не было runtime/WebGL warning/error, кроме служебных debug-сообщений Vite.

First-person/items pass добавил dev-only `?qaItem=` harness и реальный Survival smoke:

- пустая рука, apple, stone block, iron pickaxe, bow и shield визуально проверены как отдельная WebGL geometry, а не DOM-картинка;
- drops-сцена подтвердила textured generated items, atlas-cube block item и bounded stack copies;
- Q-drop в Survival уменьшил hotbar stack и создал тот же textured world visual;
- F3 после world + viewmodel passes показал `180 FPS`, frame `5.56 ms`, fixed `20 TPS`, `112290` triangles и `88` calls; item cache сохранил один generated texture;
- pointer-lock вызвал `WrongDocumentError` только при управляемом automation click в in-app browser; это ограничение среды автоматизации, не воспроизведённый runtime defect игры.

Feel/polish pass повторно проверен во встроенном браузере на локальном dev server:

- в реальном Creative-мире пустой main hand показывает компактную textured Steve arm, а apple/feather/coal/stick/sword скрывают отдельную руку и сохраняют читаемый контур;
- `?qaItem=` подтвердил одинаковую cached generated geometry для held/dropped item, глубину и stack copies; stone остаётся настоящим atlas cube;
- `?qaItem=iron_pickaxe` — isolated inspect (front, центр, без bob/swing, orthographic); overlay печатает spans/UV/depth;
- `?qaItem=iron_pickaxe&qaSideDebug=1` — textured front, dim back, стороны UP red / DOWN green / LEFT blue / RIGHT yellow;
- `?qaItem=iron_pickaxe&qaView=left` / `qaView=right` / `qaView=back` — лёгкий угол и тыл;
- `?qaItem=iron_pickaxe&qaView=held&pose=idle` — first-person; overlay печатает camera FOV/aspect, matrices, axis stages, silhouette landmarks `screen01` и F2 2048×1152 comparison (proposed vanilla не applied; comparison camera фиксирована на F2 16:9 FOV70). Residual idle bob заморожен. `held*` knobs работают только здесь;
- `?qaPose=subtle|balanced|stronger` — QA candidate shared pose (не production). Можно сузить отдельным `held*`;
- `?qaPoseCompare=1&qaView=held&pose=idle&qaPose=balanced` — цикл 1–8 / `[` `]` по pickaxe, sword, coal, arrow, stick, apple, bow, torch без правки query;
- `?qaItem=iron_pickaxe&qaView=held&pose=idle` — live pose panel справа: sliders/numeric для X/Y/Z/Pitch/Yaw/Roll/Scale, RESET production (`0.67, -0.29, -0.70` / `1, -90, 34` / `0.60`) / subtle/balanced/stronger, COPY POSE/QUERY/TS. Смена предмета pose не сбрасывает. Только DEV;
- `?qaItem=iron_pickaxe&qaView=held&pose=idle&heldScale=0.60&heldX=0.67&heldY=-0.29&heldZ=-0.70&heldPitch=1&heldYaw=-90&heldRoll=34` — `held*` knobs работают только при `qaView=held`;
- bow standby/partial/full используют локальные `bow_pulling_0/1/2` textures, vanilla pull thresholds `0.65/0.9`, movement slowdown и плавный FOV zoom. Mesh лука не изгибается.

Minecraft generated-item geometry audit (локальный visual QA всё ещё нужен):

- `diamond_sword`, `iron_pickaxe`, `stick` — handheld sprite, видна FRONT texture, тонкий depth; `iron_pickaxe.png` 32×32 даёт 104 merged side spans (много 1-texel на диагонали — это контур, не баг merge);
- `coal`, `apple`, `arrow` — generated sprite, не voxel cubes и не projectile mesh;
- `torch` — held generated sprite, placed world cuboid без изменений;
- `lever` — held generated sprite from `block/lever.png` (vanilla 1.21.8 item JSON); placed lever base+handle;
- `ladder` — held generated sprite from `block/ladder.png`; placed thin plane on N/S/E/W support;
- `oak_door` — held generated composite of upper+lower block textures; placed 3/16 cuboid with half/hinge UV;
- `bow` — texture stages на том же generated mesh;
- `stone` — atlas cube control.
- `?qaItem=lever&qaView=held`, `?qaItem=ladder&qaView=held`, `?qaItem=oak_door&qaView=held`.
- `?qaArrow=1` показал три real-texture arrow visuals на разных траекториях с общей physics update;
- mob QA спереди/сзади/сбоку подтвердил длинные base sheep legs под коротким wool overlay, readable two-sided skeleton ribs и чистый zombie headwear cutout;
- `?qaTime=night` ставит факел, соседние plants и каменный навес, чтобы был виден block light.
- Mass TNT: F3 строка `boom Q pending/processed vx destroyed · cpu/relight ms sky N`. Одиночный TNT должен закрыться за один tick; 32/64 — очередь дренируется без зависания вкладки. Radius/power/cap не уменьшались.
- F3 в реальном forest-мире: около `178–180 FPS`, frame `5.56 ms`, p95 `5.70 ms`, fixed `20 TPS`, tick примерно `0.94–1.16 ms`, `81/81` chunks, `137358` faces, `125852` triangles, `96` calls и `16` mobs;
- browser automation не смог синтетически отправить pointer-lock movement через доступный locator API. Camera regression поэтому отдельно доказан unit test: изменение input между fixed ticks сразу меняет render camera; физический fast-mouse smoke на целевом устройстве остаётся обязательным.

Последний CPU benchmark после vegetation/projectile pass:

```text
generation: avg 15.400 ms, p95 18.375 ms, max 22.401 ms
meshing:    avg 18.222 ms, p95 23.071 ms, max 47.373 ms
scan:       avg 16.728 ms, p95 21.610 ms, max 27.269 ms
geometry:   avg  1.479 ms, p95  2.041 ms, max 19.774 ms
mob tick:   avg  0.896 ms, p95  1.650 ms, max  2.643 ms (24 mobs)
faces:      233331 across the benchmark world
```

Responsive pass дополнительно выполнен на всех заданных размерах:

- desktop: `1920×1080`, `1366×768`, `1280×720`, `1024×768` и малое окно;
- mobile landscape: `932×430`, `844×390`, `800×360`, `768×360`, `740×360`, `720×360`, `667×375`;
- на каждом размере прошли visibility/count checks ключевых UI элементов;
- на representative `667×375` визуально проверены inventory, pause и settings;
- в portrait визуально проверен fullscreen rotate overlay.

Во время responsive QA touch look/joystick/actions оказались поверх menus/modals. Дефект исправлен: `controls-suppressed` скрывает gameplay controls вне активной игры.

Во время smoke был найден и исправлен бесконечный рост генерации на границе chunk meshing: lookup соседнего face больше не создаёт новый chunk. Это хороший regression candidate для будущего integration test.

Browser viewport matrix закрывает layout baseline, но не заменяет реальные Safari/iOS/Android, multi-touch и Yandex draft. После изменений main loop, combat, entities, redstone или rendering страницу нужно полностью reload-ить до следующей оценки.

## Desktop manual matrix

Все обязательные размеры уже прошли visibility/count checks:

- `1920×1080`;
- `1366×768`;
- `1280×720`;
- `1024×768`;
- небольшое свободно изменяемое окно.

Следующие functional scenarios всё ещё нужно полноценно пройти, особенно после финальной сборки:

1. loading → main menu, нет горизонтального/вертикального scroll;
2. create/list/load/delete world;
3. pointer lock acquire/release, blur и `Esc`; закрытие inventory по E/Close и pause «Продолжить» сразу возвращают lock без повторного click по canvas; Esc из gameplay открывает pause с видимым курсором;
4. WASD, jump, Shift sprint, C sneak, edge protection, step/slab collision;
5. mine/place, 1.9-like break times, thin torch/button/door/ladder, stairs/slabs (half/double, facing, top stairs), запрет placement внутри игрока;
6. hotbar `1–9` и wheel, Q-drop/pickup;
7. inventory left/right click, armor/off-hand, crafting 2×2/3×3;
8. chest/furnace open/close/save, block destruction drops contents;
9. food, fall/water/lava/cactus damage, death, respawn и bed spawn;
10. melee cooldown/crit, shield front/back, bow with/without arrow;
11. passive/hostile spawn, skeleton shot, creeper fuse/explosion, loot pickup, mob 1-block step-up, zombie limbs;
12. lever/button/plate → dust levels → primed TNT gravity/fuse/explosion/chain, falling sand entity, torch block light;
13. F3 overlay, 3D shield/viewmodel, settings FOV/sensitivity/render distance/volume;
14. pause/background/resume without hidden simulation;
15. save/quit/reload and world/redstone/block-state/falling-block comparison.

## Stairs / slabs / special icons visual QA

Последний pass перед merge ветки `cursor/minecraft-item-pipeline-rework-935a`. Полный checklist также в `docs/reports/2026-08-22_stairs-slabs-special-icons-pass.md`.

Stairs:

- oak + birch/spruce, cobblestone, bricks, stone bricks;
- facing N/S/E/W, bottom и top half;
- серия вверх и вниз обычным WASD (не climb);
- боковое столкновение, jump, corner join;
- `stone_stairs` нет в Creative/крафте.

Slabs:

- bottom / top / double merge одинакового материала;
- разные материалы не merge;
- стоять на 0.5, проходить под top slab;
- held и icon — half, не full cube.

Pressure plates:

- oak и stone: thin model, placement на верхнюю опору, icon, activation.

Icons:

- Creative / survival inventory / hotbar;
- special 3D icons максимально крупные в slot (auto-fit, не мелкий padding);
- stairs/slabs/button/plates не почти чёрные: oak/birch/brick/stone цвета как у texture/held;
- `stone_button` не stone cube;
- ordinary cubes без regression;
- held generated pose без изменений.

Creative scroll:

- прокрутить каталог вниз, взять/положить/shift-click — scroll не прыгает наверх.

Ladder:

- стена 5–10 блоков, лестницы вверх;
- лицом + W вверх; спиной + S вверх;
- no input — медленно вниз; C sneak — удержание;
- от стены — отцепиться; падение на ladder — clamp;
- верх/низ; N/S/E/W; stairs рядом не дают climb.

## Mobile/touch manual matrix

Все landscape targets из platform checklist прошли browser visibility/count checks:

- `932×430`;
- `844×390`;
- `800×360`;
- `768×360`;
- `740×360`;
- `720×360`;
- `667×375`.

На `667×375` inventory/pause/settings уже прошли representative visual QA, portrait overlay также подтверждён. На реальных устройствах всё ещё проверить:

- joystick reaches full movement vector and releases on pointercancel;
- look zone не конфликтует с action buttons;
- mine/use hold и release не «залипают»;
- jump/sprint/sneak toggles понятны и доступны;
- inventory/pause buttons не перекрываются safe-area/notch;
- все 9 hotbar slots видимы и нажимаются;
- health/hunger и critical UI не закрыты controls;
- inventory помещается по высоте `360 px`, нужные sections scrollable;
- multi-touch movement + look + action работает;
- portrait показывает rotate overlay;
- возврат в landscape не пересоздаёт мир, не теряет open-state/save и не запускает background simulation.

Responsive browser layout считается пройденным; реальные Safari/iOS и Android tests остаются обязательными.

## Save/load regression scenario

Создать фиксированный seed, затем:

1. добыть блоки по обе стороны chunk boundary;
2. поставить несколько blocks, chest, furnace и bed;
3. положить уникальные stacks в chest/furnace, экипировать armor/shield;
4. выбросить item и оставить его неподобранным;
5. дождаться/создать mobs, нанести одному damage;
6. включить lever/button, запустить TNT и сохранить мир с незавершённым fuse;
7. изменить позицию, view, health/hunger и selected slot;
8. дождаться autosave, затем save-and-quit;
9. reload страницы и загрузить мир;
10. сравнить все перечисленные fields, active sources/remaining fuse и отсутствие duplicated entities/items;
11. повторить после pagehide/background и после forced tab close.

Отдельно повредить один inventory/container/mob record в test fixture: список миров и остальные records должны продолжить загружаться.

## Seeded world checks

Для каждого test seed полезно фиксировать не screenshot всей карты, а небольшую стабильную выборку:

- numeric seed;
- biome/height для известных coordinates;
- hash нескольких chunk block arrays;
- наличие каждой ore только в разрешённом Y range;
- отсутствие out-of-range block IDs;
- одинаковый результат для нового `TerrainGenerator(seed)`;
- корректность floor division около X/Z `-1`, `-16`, `-17`, `0`, `15`, `16`.

Decoration у края chunk нужно проверять отдельно, потому что текущий placer намеренно не строит дерево через соседний chunk.

## Combat/entity regression scenarios

- Удар рукой, sword, pickaxe, shovel и axe на empty/half/full cooldown.
- Critical только при падении и charge threshold; sprint hit не становится critical.
- Shield неактивен первые 4 ticks, активен с 5-го; фронт и тыл дают разные результаты.
- Projectile shield block и durability damage.
- Bow: слишком короткое удержание не стреляет, Survival требует arrow, Creative не требует.
- Arrow сталкивается с ближайшим mob/block и не проходит сквозь wall.
- Каждый passive loot stack валиден для item registry.
- Skeleton projectile наносит player damage; Creative игнорирует damage.
- Creeper fuse отменяется/продолжается по ожидаемому range, explosion не ломает bedrock/слишком hard blocks.
- Redstone dust показывает `15, 14, …, 0`, timed button гаснет, plate реагирует на player/mob/drop и powered TNT detonates after 80 ticks.
- Save/restore сохраняет source/fuse state, но пересчитывает derived wire power; взрывом primed TNT запускает chain.
- Mob death/remove/dispose не оставляет scene children; repeated world load не увеличивает entity count.

## Performance/soak

Минимальный soak — 15 минут активной игры:

- двигаться по прямой достаточно далеко для repeated ensure/prune;
- менять render distance `2 → 6 → 2`;
- добывать/ставить blocks и создавать dirty chunks;
- держать passive/hostile populations близко к caps;
- вызвать несколько explosions и много drops;
- выполнить несколько autosaves и один reload.

Собирать минимум:

- FPS и подтверждение fixed `20 TPS`;
- loaded chunk count и rendered face count из F3;
- dropped item/mob/projectile counts;
- `performance.memory` там, где API доступен;
- long tasks, frame spikes, console errors и unhandled rejections;
- save duration/size.

Failure signs: монотонный рост scene children после pruning/load, duplicated pickups, autosave backlog, постоянные multi-frame mesh stalls и значимый drift от 20 TPS.

## Production/archive validation

Финальный production check после feel/polish pass пройден: `63` модуля, `164` файла, `0.90 MiB` uncompressed; main JS `693.81 kB` (`184.82 kB` gzip), CSS `12.90 kB` (`3.82 kB` gzip). Dev-only item/arrow/biome QA harness symbols в `dist` отсутствуют. После каждого следующего `npm run build` повторно проверить:

- `dist/index.html` существует в корне;
- paths relative и работают при размещении не в `/`;
- `/sdk.js` остаётся platform path и local absence не блокирует меню;
- нет `.ts`, `.map`, `.psd`, raw source pack, tests и docs;
- нет имён с пробелами или кириллицей;
- uncompressed total укладывается в project budget и официальный лимит;
- high-risk assets из `ASSET_AUDIT.md` отсутствуют;
- hard reload direct entry не даёт 404;
- Yandex draft debug panel видит ready/gameplay calls в правильные моменты.

## Правило завершения P0 regression

Изменение считается проверенным для release branch, когда:

- typecheck, все tests, build, size и archive checks green;
- основной desktop smoke green;
- browser viewport matrix, representative mobile landscape и portrait overlay green;
- real-device touch/rotation smoke green;
- save/load round trip green;
- нет новых console errors/unhandled rejections;
- известное ограничение либо исправлено, либо честно записано в `PROJECT_STATE.md`/report и не является moderation blocker.
