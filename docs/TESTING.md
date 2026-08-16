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

Команда должна завершиться отчётом о 150 выбранных runtime assets. В clean clone
без локального source pack этот шаг нужно пропустить: готовый whitelist уже
закоммичен в `public/textures`, а importer завершится до очистки output.

## Текущее автоматическое покрытие

Срез локального запуска **2026-08-17**:

```text
tsc --noEmit: PASS
Vitest:       12 test files, 68 tests, 68 passed
Vite build:   PASS
Size/archive: PASS, 0.86 MiB uncompressed, 153 files
Benchmark:    81 generated/meshed chunks + 600 updates with 24 mobs
Main assets:  JS 674.39 kB / 179.47 kB gzip; CSS 13.81 kB / 4.05 kB gzip
```

| Test file | Tests | Что проверяется |
| --- | ---: | --- |
| `tests/block-registry.test.ts` | 9 | Registry invariants plus independent render layers and special-shape classification |
| `tests/inventory.test.ts` | 7 | Stack insertion/remainder/removal, cursor clicks, equipment, shift move, drag API, serialization, atomic consume, durability break |
| `tests/crafting.test.ts` | 8 | Shapeless/shifted/mirrored recipes, white-bed restriction, consumption plan, core recipe outputs, smelting/fuel data |
| `tests/combat.test.ts` | 7 | Cooldown/damage curve, 1.9 profiles, shield timing/reduction, axe chance, bow curve, armor formula, survival drowning/food/death/respawn |
| `tests/player-physics.test.ts` | 4 | Floor/wall sliding, fall damage, slab collision/step-up и takeoff-only jump event |
| `tests/entities.test.ts` | 9 | Dropped-item merge/pickup/cap/restore, all 8 mob models, raycast/damage, creeper, skeleton, Creative non-targetability, vertical melee guard и bounded soft separation |
| `tests/world-generation.test.ts` | 3 | Negative chunk coordinates, seed determinism, five ore vertical bands и relative rarity sanity |
| `tests/world-state.test.ts` | 3 | Runtime furnace flow, modified blocks/chests/furnaces restore и placement collision guard |
| `tests/redstone.test.ts` | 8 | Power `0–15`, timed sources/TNT, all 24 lever attachment/facing/power geometry combinations, v2 orientation round-trip, v1 fallback и bounded propagation |
| `tests/visual-models.test.ts` | 8 | Atlas layout, 8 descriptors/10 sheets, logical UVs, model-space conversion, sheep layers, spider constants, bounds and articulated textured rigs |
| `tests/chunk-mesher.test.ts` | 1 | Generated column cache is reused without per-face noise resampling |
| `tests/performance-stats.test.ts` | 1 | Bounded rolling average/p95/spike telemetry |

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
3. pointer lock acquire/release, blur и `Esc`;
4. WASD, jump, sprint, sneak, edge protection, step/slab collision;
5. mine/place, корректный target outline и запрет placement внутри игрока;
6. hotbar `1–9` и wheel, Q-drop/pickup;
7. inventory left/right click, armor/off-hand, crafting 2×2/3×3;
8. chest/furnace open/close/save, block destruction drops contents;
9. food, fall/water/lava/cactus damage, death, respawn и bed spawn;
10. melee cooldown/crit, shield front/back, bow with/without arrow;
11. passive/hostile spawn, skeleton shot, creeper fuse/explosion, loot pickup;
12. lever/button/plate → dust levels → primed TNT visual fuse/explosion/chain;
13. F3 overlay, shield overlay, settings FOV/sensitivity/render distance/volume;
14. pause/background/resume without hidden simulation;
15. save/quit/reload and world/redstone state comparison.

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

Финальный production check после legacy-model/performance pass пройден: `56` модулей, `153` файла, `0.86 MiB` uncompressed; main JS `674.39 kB` (`179.47 kB` gzip), CSS `13.81 kB` (`4.05 kB` gzip). После каждого следующего `npm run build` повторно проверить:

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
