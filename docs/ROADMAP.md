# Roadmap

Roadmap начинается от фактической playable alpha `0.1.0`. Приоритеты означают:

- **P0** — необходимо для надёжной публичной alpha и отправки в Яндекс Игры;
- **P1** — качество и глубина первой крупной alpha после стабилизации;
- **P2** — расширение продукта после подтверждённого P0/P1 foundation.

Feature creep не должен блокировать P0. Всё, что прямо исключено из текущего scope, не считается «почти готовым» из-за наличия текстуры или enum entry.

## P0 — release blockers и стабилизация

### P0.1 Воспроизводимая поставка

- [ ] На чистом clone выполнить `npm ci`, `npm run assets:import`, `npm run check` и `npm run check:archive`.
- [x] Локальный pipeline после lighting/physics/interaction polish: asset import `162/162`, typecheck, 95 tests, production build, size и archive green.
- [x] Локальный pipeline после TNT explosion batching: typecheck, 108 tests, production build 70 modules, 0.92 MiB / 165 files.
- [x] Локальный pipeline после lighting/torch/selection fix: typecheck, 117 tests, production build 72 modules, 0.92 MiB / 165 files.
- [x] Локальный pipeline после entity lighting / wall-torch followup: typecheck, 123 tests, production build.
- [x] Локальный pipeline после Minecraft generated-items Phase 1: typecheck, 129 tests, production build 72 modules, 0.92 MiB / 165 files.
- [x] Локальный pipeline после vanilla FP transform audit: typecheck, 143 tests / 22 files, production build 74 modules, 0.93 MiB / 165 files.
- [x] Локальный pipeline после F2 1.21.8 held-item screenshot audit: typecheck, 150 tests / 22 files, production build 75 modules, 0.94 MiB / 165 files.
- [x] Локальный pipeline после shared held-item pose QA candidates: typecheck, 152 tests / 22 files, production build 75 modules, 0.94 MiB / 165 files.
- [x] Локальный pipeline после live held-item pose QA panel: typecheck, 156 tests / 22 files, production build 75 modules, 0.94 MiB / 165 files.
- [x] Локальный pipeline после special-item door/ladder/lever pass: typecheck, 165 tests / 23 files, production build 75 modules, 0.94 MiB / 165 files.
- [x] Локальный pipeline после stairs/slabs/special-icons pass: typecheck, 189 tests / 24 files, production build 78 modules, 0.96 MiB / 165 files.
- [x] Локальный pipeline после ladder/icon-fit/creative-scroll pass: typecheck, 206 tests / 26 files, production build 80 modules, 0.96 MiB / 165 files.
- [x] Локальный pipeline после special-icon preview lighting: typecheck, 208 tests / 26 files, production build 81 modules, 0.96 MiB / 165 files.
- [x] Локальный pipeline после inventory close pointer lock: typecheck, 211 tests / 27 files, production build 82 modules, 0.96 MiB / 165 files.
- [x] Локальный pipeline после pause resume pointer lock: typecheck, 214 tests / 27 files, production build 82 modules, 0.96 MiB / 165 files.
- [x] Локальный pipeline после pointer-lock Esc fallback: typecheck, 219 tests / 27 files, production build 82 modules, 0.97 MiB / 165 files.
- [x] Локальный pipeline после container UI / chest model / Recipe Book / Creative flight / sim-while-GUI-open: typecheck, 257 tests / 31 files, production build 90 modules, 1.00 MiB / 166 files.
- [x] Локальный pipeline после container visual/functional QA (Creative tabs, chest lid/facing, furnace lit/light, transactional Recipe Book, stable slot DOM): typecheck, 275 tests / 33 files, production build 90 modules, 1.01 MiB / 167 files.
- [x] Локальный pipeline после recipe-book layout / hover overlay / chest lid interior / furnace GUI front / Creative inventory polish: typecheck, 276 tests / 33 files, production build 90 modules, 1.01 MiB / 167 files.
- [x] Локальный pipeline после performance/world-loading/mob-smoothing pass: typecheck, 301 tests / 40 files, production build 95 modules, 1.03 MiB / 167 files.
- [x] Локальный pipeline после lighting performance / chunk seams pass: typecheck, 311 tests / 41 files, production build 96 modules, 1.04 MiB / 167 files.
- [x] Локальный pipeline после DEV chunk streaming inspector (diagnostic only, no scheduler change): typecheck, 323 tests / 42 files, production build 99 modules, 1.06 MiB / 167 files.
- [x] Локальный pipeline после chunk mesh starvation / obsolete pending cleanup: typecheck, 337 tests / 43 files, production build 100 modules, 1.07 MiB / 167 files.
- [x] Локальный pipeline после player-visible streaming latency metrics (inspector only, no scheduler change): typecheck, 349 tests / 43 files, production build 100 modules, 1.08 MiB / 167 files.
- [x] Локальный pipeline после lighting halo / flood-head scheduler fix: typecheck, 368 tests / 44 files, production build 100 modules, 1.08 MiB / 167 files.
- [ ] Зафиксировать фактические версии Node/npm для CI и README.
- [ ] Добавить CI с typecheck, tests, production build, archive/path/size checks.
- [ ] Сформировать ZIP, где `index.html` находится в корне, и проверить его распаковкой.
- [ ] Установить внутренний warning budget ниже официального лимита 100 MiB; текущая цель проекта — оставаться значительно ниже 20 MiB uncompressed.

Definition of done: чистая машина воспроизводит тот же green build без ручных правок.

### P0.2 Права на runtime assets

- [ ] Получить от владельца исходного texture pack письменные license/credits/provenance сведения.
- [ ] Зафиксировать manifest реально импортируемых файлов и их происхождение.
- [ ] Повторно проверить production bundle: logos, panorama, paintings, Mojang patterns и сторонние product namespaces не должны попасть в `dist/`.
- [ ] Если права на среднерисковые textures не подтверждаются, заменить их собственными оригинальными assets.

Definition of done: для каждого production asset есть разрешение или собственный безопасный replacement.

### P0.3 Save integrity

- [ ] Добавить automated round-trip test полного `SerializedWorldState`: blocks, player, containers, drops и mobs.
- [ ] Ввести явный migration dispatcher для `schemaVersion`, даже если пока есть только version 1.
- [ ] Валидировать и восстанавливать повреждённые chest/furnace/mob records так же безопасно, как inventory.
- [ ] Расширить corrupt-record fixtures на redstone sources и primed TNT; invalid redstone state уже безопасно сбрасывается целиком.
- [ ] Сериализовать недостающий survival/combat state либо явно сбрасывать его и сообщать правило пользователю.
- [ ] Добавить recovery path: backup предыдущего save или экспорт/импорт JSON.
- [ ] Проверить pagehide/background save на Chrome, Safari/iOS и Android WebView-подобном окружении.

Definition of done: принудительный reload/закрытие вкладки не теряет подтверждённый progress, corrupted record не ломает список миров.

### P0.4 Runtime correctness

- [x] Runtime furnace переведён на `SMELTING_RECIPES` и `FUEL_BURN_TICKS`; glass и charcoal входят в общий path.
- [x] Последний visual QA pointer-lock overlay / icons / Creative scroll / ladder закрыт в PR #2 (`76ce4a1`). Container UI / Recipe Book / Creative flight — отдельный pass на `cursor/container-ui-recipebook-flight`.
- [ ] Проверить реальный attack meter, shield wind-up/arc, bow release, mob hit selection и weapon durability через browser smoke.
- [ ] Пройти end-to-end redstone scenario в browser: source → dust → TNT → visual fuse → explosion/chain → save/reload active fuse.
- [x] Закрыты targeted regressions: takeoff-only jump exhaustion, hunger sprint gate, Creative non-targetability, 3D+voxel-LOS melee и knockback only on dealt damage.
- [ ] Проверить lifecycle disposal при многократном create/load/quit: world meshes, mobs, arrows, drops и event listeners не должны накапливаться.
- [ ] Добавить интеграционные тесты seeded generation, chunk-boundary edits, placement inside player, chest/furnace content drops и respawn.
- [ ] Провести 10–15 minute soak: перемещение через chunks, несколько autosaves, бой, взрывы, смерть, reload.
- [ ] Исправить найденные blocker bugs без расширения feature scope.

Definition of done: основной survival loop воспроизводимо проходит дважды — до reload и после reload.

### P0.5 Yandex lifecycle и moderation QA

- [ ] Разделить причины паузы: user pause, platform pause/ad, document hidden и lost focus не должны взаимно отменять друг друга.
- [ ] Убедиться, что `LoadingAPI.ready()` вызывается один раз после исчезновения blocking loader.
- [ ] Сверить `GameplayAPI.start/stop` с реальным доступом игрока к управлению.
- [ ] Проверить Yandex pause/resume events поверх открытого pause menu и inventory.
- [ ] Проверить подавление browser-native gestures, context menu, scroll и accidental navigation.
- [ ] Пройти Yandex draft/debug panel и актуальный checklist из `YANDEX_REQUIREMENTS.md`.

Definition of done: draft не сообщает lifecycle/ready/path ошибок, а platform resume не запускает поставленную пользователем на паузу игру.

### P0.6 Обязательная browser/device matrix

- [x] Desktop `1920×1080`, `1366×768`, `1280×720`, `1024×768` и малое окно прошли browser visibility/count checks.
- [x] Mobile landscape `932×430`, `844×390`, `800×360`, `768×360`, `740×360`, `720×360`, `667×375` прошли browser visibility/count checks.
- [x] На representative `667×375` визуально проверены inventory, pause и settings; portrait overlay проверен отдельно.
- [x] Исправлено перекрытие menus/modals touch controls.
- [ ] На реальных устройствах проверить portrait → landscape без reload/потери state и multi-touch controls.
- [ ] Пройти функциональные keyboard/mouse и touch scenarios: mining, inventory, crafting, chest, furnace, combat, redstone и save/load.
- [ ] Зафиксировать minimum acceptable FPS/TPS и memory ceiling на слабом целевом устройстве.

Definition of done: нет overlap/cutoff/blocking input defects, simulation держит 20 TPS в установленном render distance.

## P1 — качество большой alpha

### P1.1 Rendering и world performance

- [ ] Перенести chunk generation/meshing в Web Workers с cancellable priority queue, если device profiling после текущего CPU pass подтвердит необходимость.
- [ ] Внедрить greedy meshing или эквивалентное объединение coplanar faces.
- [x] Добавить budgets по jobs/миллисекундам, generation/mesh scheduling и F3 telemetry для chunk rebuild; frustum/distance priority остаётся следующим этапом.
- [x] Adaptive per-frame world-job budget, dirty-mesh Set-dedupe, neighbor remesh только на X/Z boundary, `LOADING_WORLD` until initial radius ready, entity render interpolation at 20 TPS.
- [x] Simplified column sky + bounded block light, resumable light jobs (`WORLD_LIGHT_BUDGET_MS`), lighting halo, `lightVersion`/`meshedLightVersion`, DEV chunk-border overlay.
- [x] Lighting flood mutex no longer stops the queue on a blocked head; near unlock neighbors outrank distant halo; obsolete floods are abandoned.
- [x] Разделить opaque/cutout/glass/water passes; leaves переведены на depth-writing alpha test.
- [ ] Улучшить сортировку отдельных translucent water/glass faces.
- [x] Добавить lightweight skylight/block-light contribution в chunk meshing; torch/lava обновляют свет локально, без full-world rebuild.
- [x] Block-break path: skip lighting when sky-class+emission unchanged; vertical sky columns only (no 6-pass); light writes no longer dirty neighbor meshes.
- [x] Убрать Lambert N·L с terrain (pitch-black bottoms), тёплый torch block-light в shader, shape-aware selection outline.
- [x] Wall torch flush to supporting face, thicker cuboid matching outline; entity lighting from voxel sky/block (feet/torso/head); cube-face 4-tap smooth lighting at cave openings.
- [x] Добавить power-of-two atlas, mipmaps, `4 px` padding/extrusion и ограниченную anisotropy для снижения bleeding/shimmer.

### P1.2 Block states и geometry

- [x] Тонкая 2-block oak door с open/close, collision и UV half/hinge; torch wall/floor; button floor/wall/ceiling; ladder world plane + side placement; stairs/slabs geometry+collision+icons. Bed и chest всё ещё ждут specialized meshes.
- [x] Расширить compact block states: door half/open/hinge/facing, torch attachment, button/lever orientation, ladder facing, slabType, stairHalf; stair corner shape derived; v1→v2 redstone fallback уже реализован.
- [x] Door open/close на use; ladder climbing (into-wall wish, slow descent, sneak hold). Корректный two-block bed и sleeping checks ещё нет.
- [x] Powered TNT ignition, visual 4-second fuse, explosion events и chain priming реализованы для alpha.
- [x] Mass TNT больше не вызывает per-block `relightAround`; `ExplosionQueue` + `applyBlockBatch` держат chain в budgeted ticks.
- [x] Минимальная bounded propagation `0–15` для wire/torch/lever/button/plate/TNT реализована и покрыта unit tests.
- [ ] Добавить корректные redstone connection meshes, orientation/support rules и более точную vertical topology без расширения в advanced components.

### P1.3 World simulation

- [ ] Level-based liquids с bounded updates, боковым потоком и water/lava interaction.
- [x] Gravity-driven primed TNT и falling-block entities для sand/gravel; unloaded-chunk queue всё ещё упрощена.
- [ ] Более разнообразные terrain features без нарушения seed determinism.
- [ ] Spawn safety и regeneration tests по большому набору seeds.
- [ ] Сжатие/compaction chunk deltas при долгой игре.

### P1.4 Combat, AI и feedback

- [x] Практичный 1-block mob step-up без отдельного pathfinder; полный voxel-aware search всё ещё P1.
- [ ] Улучшить spawn/despawn/light rules и obstacle recovery; bounded soft separation между мобами уже реализована.
- [x] Подключить базовые first-person arm/item poses для swing/mining, walk, еды, bow charge и shield block.
- [x] Убрать 20 TPS quantization из render camera, разделив live input look и fixed simulation state.
- [x] Добавить cached alpha-silhouette depth geometry для generated held/dropped items и три стадии bow texture.
- [x] Phase 1 vanilla-like `item/generated`: один front/back quad, толщина `1/16`, span detection `alpha == 0`, 32×32 в тех же 16×16 model units, общий first-person pose для generated/handheld, held torch sprite, bow pull `0.65/0.9`.
- [x] First-person sprite pose calibration: shared scale/position/roll, pitch/yaw 0, dev `held*` QA overrides.
- [x] Generated-item geometry audit: outer-shell winding, texel-center side UV, inspect/`qaSideDebug` harness, `iron_pickaxe.png` span diagnostics. Topology закрыта как baseline.
- [x] Vanilla idle first-person right-hand matrix reconstruction + held matrix QA overlay. Production pose не переключали: нет доказанного screenshot match projected points.
- [x] F2 Java 1.21.8 2048×1152 silhouette landmark audit: 1.9==1.21.8 idle matrix; «edge-on» = неверная метрика `front·look`; Y-bias vs F2 остаётся. Production не переключали.
- [x] Shared held-item pose: цель сменена с pixel-perfect F2 на visual Minecraft-like; QA candidates subtle/balanced/stronger + `qaPoseCompare`. Production pose не переключали.
- [x] Live held-item pose QA panel: sliders/numeric/copy/reset, item switch без сброса pose. Production pose и geometry не менялись.
- [x] Production shared held-item pose записан из manual visual QA: `[0.67, -0.29, -0.70]`, `[1, -90, 34]°`, scale `0.60`. Yaw −90° не заменять.
- [x] Special block-item pass: lever/ladder/door held generated; ladder world plane + climbing; door cuboid UV; button/plate/stairs/slab special inventory cuboids + auto-fit icons.
- [x] Chest world/item visual: entity atlas, body/lid/latch, held special_model. Double chest всё ещё вне scope.
- [x] Унифицировать player/skeleton arrow physics/visual basis и оставить попавшие в блок стрелы видимыми до timeout.
- [x] Добавить deterministic biome vegetation через chunk-batched crossed quads без отдельных scene objects.
- [ ] Добавить damage flash, hit particles, расширенный bow feedback, use-анимации для дополнительных предметов и собственные SFX.
- [ ] Довести off-hand, все item categories и transforms до более точного vanilla parity без потери общего cache pipeline.
- [ ] Выверить projectile sweep и explosion exposure без дорогой полной физики.
- [ ] Расширить поведение существ: spider climbing, passive flee, burning drops, sheep shearing — только после core stability.
- [ ] Интеграционные combat scenarios: melee cooldown, crit, shield front/back, skeleton projectile, creeper chain damage.

### P1.5 UX и accessibility

- [ ] Settings persistence, fullscreen toggle, remappable controls и touch-layout presets.
- [x] Pixel Minecraft-like container GUI для chest / furnace / crafting table / Survival 2×2 inventory; Recipe Book слева на crafting/Survival (кнопка книги в craft row, icon categories, search, All/Craftable, transactional ghost vs placement); Furnace без Recipe Book; Creative Catalog/Inventory tabs (без offhand, armor silhouettes, catalog scrollbar gutter).
- [x] Chest entity model + opposite-of-look facing + lid-up hinge; furnace facing + lit front + torch-equivalent block light from burn state.
- [x] Creative double-Space flight (7 ticks, collision, landing, Ctrl sprint, Shift descend, ladder override).
- [ ] Полный inventory drag UX, tooltips с характеристиками и vanilla advancement recipe unlocks.
- [ ] Масштаб UI, high-contrast mode, reduced motion и keyboard focus navigation в меню.
- [ ] Русская и английская localization tables с выбором через Yandex environment.
- [ ] Понятные save/error/loading states вместо console-only diagnostics.

### P1.6 Platform features по продуктовой необходимости

- [ ] Guest-safe optional authorization flow.
- [ ] Компактная cloud metadata sync; не пытаться помещать полный voxel save в 200 KB player data.
- [ ] Rewarded/interstitial ads только после корректного lifecycle и без влияния на основной survival loop.
- [ ] Privacy/consent/analytics policy до подключения telemetry.

## P2 — расширения после стабилизации

Возможные направления, не обещанные текущей alpha:

- weather и атмосферные эффекты;
- biome expansion, структуры и более глубокая exploration progression;
- experience, enchantments, potion-like effects;
- farming и animal breeding;
- advanced redstone, pistons, hoppers и automation;
- дополнительные dimensions, bosses и late-game progression;
- cloud world transfer и optional accounts;
- multiplayer/server authority;
- modding/data-pack API.

Каждое направление сначала получает отдельный scope, save migration plan, performance budget, asset provenance и tests. Наличие неиспользуемых textures в `assets/` не является основанием для автоматического включения feature.

## Метрики, которые стоит вести

| Метрика | P0 target | P1 direction |
| --- | ---: | ---: |
| Fixed simulation | без устойчивого падения ниже `20 TPS` | 20 TPS на слабом целевом mobile |
| Initial interactive menu | измерить в Yandex draft | уменьшать p95 |
| New-world time to control | измерить desktop/mobile | progressive generation без длинного freeze |
| Runtime JS errors | `0` в smoke/soak | `0` в release regression |
| Save round-trip loss | `0` для schema 1 fields | migrations + backup |
| Unit/component tests | текущие 83 + P0 browser/storage integration coverage | regression grows with features |
| Production archive | значительно ниже 20 MiB target | budget per asset/system |
| Asset provenance | 100% production manifest | автоматическая проверка manifest |
