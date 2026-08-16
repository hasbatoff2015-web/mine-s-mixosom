# Roadmap

Roadmap начинается от фактической playable alpha `0.1.0`. Приоритеты означают:

- **P0** — необходимо для надёжной публичной alpha и отправки в Яндекс Игры;
- **P1** — качество и глубина первой крупной alpha после стабилизации;
- **P2** — расширение продукта после подтверждённого P0/P1 foundation.

Feature creep не должен блокировать P0. Всё, что прямо исключено из текущего scope, не считается «почти готовым» из-за наличия текстуры или enum entry.

## P0 — release blockers и стабилизация

### P0.1 Воспроизводимая поставка

- [ ] На чистом clone выполнить `npm ci`, `npm run assets:import`, `npm run check` и `npm run check:archive`.
- [x] Финальный локальный `npm run check` после visual parity pass: typecheck, 60 tests, build и size/archive green.
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

- [ ] Перенести chunk generation/meshing в Web Workers с cancellable priority queue.
- [ ] Внедрить greedy meshing или эквивалентное объединение coplanar faces.
- [ ] Добавить frustum/distance priority, budgets по миллисекундам и telemetry для chunk rebuild.
- [x] Разделить opaque/cutout/glass/water passes; leaves переведены на depth-writing alpha test.
- [ ] Улучшить сортировку отдельных translucent water/glass faces.
- [ ] Добавить skylight/block-light propagation и emissive updates для torch/lava.
- [ ] Устранить atlas bleeding через padding/extrusion, если появятся mipmaps/scale variants.

### P1.2 Block states и geometry

- [ ] Отдельные meshes/collision для stairs, slabs, door, ladder, bed и chest; torch, wire, lever, button и pressure plate уже получили простые non-cube visuals.
- [ ] Расширить compact block states beyond lever; lever floor/wall/ceiling orientation и v1→v2 redstone fallback уже реализованы.
- [ ] Door open/close, ladder climbing, корректный two-block bed и sleeping checks.
- [x] Powered TNT ignition, visual 4-second fuse, explosion events и chain priming реализованы для alpha.
- [x] Минимальная bounded propagation `0–15` для wire/torch/lever/button/plate/TNT реализована и покрыта unit tests.
- [ ] Добавить корректные redstone connection meshes, orientation/support rules и более точную vertical topology без расширения в advanced components.

### P1.3 World simulation

- [ ] Level-based liquids с bounded updates, боковым потоком и water/lava interaction.
- [ ] Надёжная falling-block queue через unloaded chunk boundaries.
- [ ] Более разнообразные terrain features без нарушения seed determinism.
- [ ] Spawn safety и regeneration tests по большому набору seeds.
- [ ] Сжатие/compaction chunk deltas при долгой игре.

### P1.4 Combat, AI и feedback

- [ ] Лёгкий voxel-aware pathfinding с ограниченным search budget.
- [ ] Улучшить spawn/despawn/light rules, obstacle recovery и avoidance между мобами.
- [ ] Добавить damage flash, hit particles, расширенный bow feedback и собственные SFX; first-person shield HUD уже подключён.
- [ ] Выверить projectile sweep и explosion exposure без дорогой полной физики.
- [ ] Расширить поведение существ: spider climbing, passive flee, burning drops, sheep shearing — только после core stability.
- [ ] Интеграционные combat scenarios: melee cooldown, crit, shield front/back, skeleton projectile, creeper chain damage.

### P1.5 UX и accessibility

- [ ] Settings persistence, fullscreen toggle, remappable controls и touch-layout presets.
- [ ] Полный inventory drag UX, shift-craft, tooltips с характеристиками и recipe hints.
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
| Unit/component tests | текущие 60 + P0 browser/storage integration coverage | regression grows with features |
| Production archive | значительно ниже 20 MiB target | budget per asset/system |
| Asset provenance | 100% production manifest | автоматическая проверка manifest |
