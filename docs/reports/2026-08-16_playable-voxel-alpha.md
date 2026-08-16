# Goal

Создать за один проход большую запускаемую browser alpha самостоятельной voxel/survival-игры **Frontier Cubes** (`0.1.0`) с законченным базовым gameplay loop, локальными сохранениями, desktop/touch UI и подготовкой к Яндекс Играм.

Minecraft Java Edition 1.9 использовался только как проверяемый reference для отдельных чисел и механик. Цель не включала копирование кода, названия продукта, branded UI или high-risk ассетов.

Обязательный практический результат:

```text
создать seeded мир
→ исследовать и добывать ресурсы
→ создавать инструменты и экипировку
→ строить и использовать containers
→ выживать и сражаться
→ умереть/возродиться
→ сохранить, выйти и продолжить после загрузки
```

# Result

Цель playable alpha достигнута. Проект запускается как Vite/TypeScript/Three.js приложение, основные системы соединены через единый fixed-tick runtime, мир сохраняется в IndexedDB и восстанавливается после выхода.

Финальный локальный verification status:

```text
npm run typecheck     PASS
npm test              PASS — 9 files, 52 tests
npm run build         PASS — 53 modules transformed
npm run check:size    PASS
npm run check:archive PASS
```

Production output: `143` файла, `0.82 MiB` uncompressed. Main JS — `650.98 kB` (`172.48 kB` gzip), CSS — `13.81 kB`.

Статус продукта — **playable alpha**, не public-release-complete. Публикацию пока блокируют подтверждение прав на runtime textures, реальные device tests и Yandex draft/moderation pass.

# What is playable now

Игрок может:

- открыть главное меню, создать Survival или Creative world с произвольным seed, загрузить или удалить сохранение;
- исследовать процедурный plains/forest/desert world с водой, пещерами, деревьями, cactus и пятью рудами;
- ходить, sprint, sneak, прыгать, подниматься на step/slab, плавать и получать fall/environment damage;
- добывать blocks с учётом hardness/tool/tier, ломать tools по durability, подбирать и выбрасывать item entities;
- ставить blocks с collision guard, использовать crafting table, chest, furnace и bed;
- создавать предметы в 2×2/3×3 crafting, плавить iron/gold, glass, charcoal и raw food через единый smelting registry;
- управлять 36-slot inventory, hotbar, armor slots и off-hand;
- есть, восстанавливать hunger, носить armor, умирать, выбрасывать инвентарь и respawn в установленной bed point;
- сражаться melee с cooldown/critical/knockback, использовать shield и видеть raised-shield HUD overlay;
- натягивать bow, расходовать arrows и попадать projectile в mobs/blocks;
- встречать cow, pig, chicken, sheep, zombie, skeleton, creeper и spider;
- использовать basic redstone: torch, lever, timed button, pressure plate, dust `0–15`, powered TNT с visual fuse и chain explosions;
- поставить игру на паузу, изменить settings, сохранить/выйти и загрузить изменённый мир, containers, drops, mobs и redstone state.

Desktop controls: WASD, Space, Ctrl, Shift, mouse, ЛКМ/ПКМ, `E`, `Q`, `1–9`, wheel, `F3`, `Esc`. Touch layout включает joystick, look zone и отдельные action buttons; portrait показывает rotate guard.

# Implemented

## Runtime foundation

- Fixed simulation `20 TPS`, `requestAnimationFrame` rendering и camera interpolation.
- Frame-delta clamp, lifecycle states `LOADING/MENU/PLAYING/PAUSED/AD/BACKGROUND/DEAD`.
- Pause/background останавливают simulation/audio и вызывают save/platform markers.
- Settings для volume, sensitivity, render distance `2–6` и FOV `60–100`.
- F3 overlay: FPS/TPS, coordinates, chunk/biome, target, loaded chunks/faces, mobs/projectiles/drops, redstone sources/primed TNT и seed/mode.

## World and rendering

- Chunks `16×16×80`, sea level `48`, stable numeric block IDs в `Uint16Array`.
- String-seed hashing, deterministic value noise/fBm generation.
- Plains, forest, desert, terrain height, sea, caves, deep lava, bedrock, oak trees и cactus.
- Coal, iron, gold, redstone и diamond veins в заданных vertical bands.
- Runtime chunk streaming, pruning, dirty rebuild и boundary invalidation.
- Chunk modification deltas вместо сохранения полного procedural terrain.
- Scheduled falling sand/gravel и минимальные downward liquids.
- Runtime 32 px texture atlas, nearest filtering, biome tint, opaque/transparent passes, fog, day/night sky, sun/moon и selection outline.
- Исправлен runaway generation defect: mesher больше не создаёт соседние chunks во время boundary face lookup.

## Blocks, items, inventory and crafting

- 69 block definitions, включая terrain/liquids, три wood family, пять ores, utility/building blocks, 16 wool colors, slabs/stairs и basic redstone/TNT.
- Data-first block/item registries с unique ID/key tests.
- Wood/stone/iron/diamond pickaxe, axe, shovel и sword; gold tools и hoe намеренно исключены.
- Leather/iron/gold/diamond armor, shield, bow, foods и resources.
- Stack validation, merge/split, cursor left/right click, equipment constraints, durability, atomic consume и serialization.
- 36 ordinary slots, 9-slot hotbar, four armor slots и off-hand.
- Shaped, mirrored и shapeless 2×2/3×3 crafting с tags и deterministic consumption plan.
- 27-slot chest, three-slot furnace, container content drops при разрушении.
- Furnace использует единые `SMELTING_RECIPES` и `FUEL_BURN_TICKS`, включая sand→glass и logs→charcoal.
- Dropped-item physics, merge, pickup delay, partial pickup, cap, despawn и save/restore.

## Player and survival

- Feet-anchored voxel AABB `0.6×1.8`, sneak height `1.5`, step height `0.6`.
- Axis collision, wall sliding, step-up, slab collision и sneak edge guard.
- Walk/sprint/sneak, jump, gravity, fall damage, water/lava movement.
- `PlayerTickResult.jumped` true только в tick takeoff; удержание jump не повторяет exhaustion в воздухе.
- Survival sprint блокируется при hunger `≤ 6`; Creative не использует hunger gate.
- Health, hunger, saturation, exhaustion, regeneration, starvation и hurt resistance.
- Air/drowning, lava/fire/cactus hazards.
- Release-1.9-style armor reduction без implicit toughness.
- Food hold/use, death flow, inventory/equipment drop и respawn.
- Creative не расходует основные blocks/arrows/durability, не получает survival damage и не является hostile AI target.

## Combat and entities

- Quadratic attack cooldown с `+0.5 tick`, item profiles, critical conditions и sprint knockback.
- Mob melee reach `3` blocks, mob AABB raycast и block occlusion.
- Shield wind-up `5 ticks`, frontal arc, 66% melee reduction, projectile block, movement slowdown, durability и HUD visual.
- Bow 20-tick charge curve, arrow requirement in Survival, projectile gravity/block/mob collision.
- Player knockback применяется только при `DamageResult.dealt > 0`; blocked/i-frame ignored hit не сдвигает игрока.
- Bounded dropped-item, mob и projectile managers с explicit dispose.
- Eight mob kinds, health/size/speed/range/damage/loot data.
- Idle/wander/chase/attack/hurt/die states, direct steering, voxel collision, line of sight, spawning/despawn caps.
- Hostile melee использует 3D distance между eye positions и voxel LOS, поэтому не атакует через стену или другой этаж.
- Creative остаётся центром spawning/despawn, но исключён из hostile target selection.
- Skeleton projectiles, creeper fuse/radial explosion, mob loot и save/restore.
- Собственные procedural low-poly box models вместо legacy entity sheets.

## Basic redstone and TNT

- Отдельный bounded `RedstoneSystem`, подключённый к fixed tick, placement, mining и explosion changes.
- Six-neighbour dust propagation `15 → 0` с attenuation на единицу.
- Redstone torch, toggle lever, timed stone button и pressure plate.
- Plate occupancy учитывает игрока, mobs и dropped items.
- Powered TNT удаляется как block, создаёт visual primed entity и взрывается после `4 s`.
- TNT использует общий radial damage/block destruction pipeline; затронутый explosion TNT получает короткий fuse для chain reaction.
- Save/restore sources, button remaining time и primed TNT remaining fuse; derived wire power пересчитывается.
- Bounds: до `2,048` sources, `64` primed TNT, `512` propagation steps/update и `8,192` queued updates.

## UI, saves and platform adapter

- Loading, main menu, world list, create world, settings, controls, pause, inventory/container и death screens.
- HUD: crosshair, hotbar, health/hunger, mining progress, real attack strength, hand/shield visuals и toasts.
- Desktop pointer lock и unified desktop/touch input.
- Responsive safe-area CSS, compact landscape inventory и portrait rotate overlay.
- `controls-suppressed` скрывает touch gameplay controls на menus/modals; исправлено перекрытие UI.
- IndexedDB database `frontier-cubes-saves`, save schema `1`, autosave примерно каждые 30 игровых секунд.
- Saves содержат player/world modifications, inventory/equipment, chest/furnace, drops, mobs, redstone sources и primed TNT.
- Memory fallback при недоступной IndexedDB.
- Yandex adapter: `/sdk.js`, graceful local no-op, SDK init, LoadingAPI ready, GameplayAPI start/stop и pause/resume events.

# Partially implemented

- Chunk meshing отсекает невидимые faces, но не использует greedy merge, workers, LOD или advanced scheduling.
- Cave light — height-based vertex approximation; нет flood-fill skylight/block light.
- Transparent blocks используют общий упрощённый pass без полной per-face sorting.
- Slab имеет half-height collision, но визуально остаётся cube; stairs физически full cube.
- Door, ladder, torch, bed и redstone components не имеют полных specialized models/orientation/support rules.
- Bed — один block с spawn point и простым night skip.
- Liquids текут только ограниченно вниз; нет levels, lateral flow, mixing и source rules.
- Basic redstone — шестисоседняя approximation без directional dust topology, quasi-connectivity, torch burnout и advanced components.
- Mob AI использует direct steering вместо pathfinding и может застревать на сложном terrain.
- Spawn/light/despawn/loot/explosion exposure проще reference.
- Inventory data layer поддерживает drag distribution, но UI не предоставляет полный pointer-drag UX; нет recipe book и shift-craft.
- Chest только одиночный; furnace обновляется только во время active simulation, поэтому paused container UI останавливает cooking.
- Settings не сохраняются, UI русскоязычный, нет remapping/accessibility modes.
- Yandex integration покрывает lifecycle baseline, но не authorization, cloud saves, ads, payments, leaderboards или achievements.
- Responsive browser QA пройден, но real-device touch/multi-touch/rotation ещё не выполнен.

# Changed files

## Project/tooling

- `package.json`, `package-lock.json` — Three.js/Vite/TypeScript/Vitest dependencies и scripts.
- `tsconfig.json`, `vite.config.ts` — strict TS, archive-safe relative base, production configuration.
- `index.html`, `src/main.ts`, `src/style.css` — application entry, SDK path, canvas/UI roots и responsive presentation.
- `.gitignore` — исключает dependencies/build output и raw `/assets/` из публичного Git history.
- `scripts/import-assets.mjs` — whitelist import из raw `assets/`; сначала проверяет доступность `sourceRoot` и только затем очищает/пересобирает output.
- `scripts/check-build.mjs` — production root/path/source/size checks.
- `README.md` — запуск, controls, state и limitations.

## Runtime source

- `src/core/**` — orchestration, fixed loop, lifecycle, audio и constants/events.
- `src/world/**` — chunk storage, noise/generation, raycast, scheduled updates, containers и modifications.
- `src/rendering/**` — texture atlas, chunk mesher и world renderer.
- `src/blocks/**`, `src/items/**` — registries и definitions.
- `src/inventory/**`, `src/crafting/**` — stacks, equipment, recipe matcher, recipes и smelting/fuel data.
- `src/player/**`, `src/survival/**`, `src/combat/**` — movement, hazards, damage, melee/shield/bow и player arrows.
- `src/entities/**` — dropped items, mobs, voxel visuals/models/physics и projectiles.
- `src/redstone/**` — basic power propagation, sources, primed TNT, events и serialization.
- `src/input/**`, `src/ui/**` — desktop/touch input, menus, HUD и inventory/container UI.
- `src/save/**`, `src/yandex/**` — IndexedDB schema/service и platform adapter.

## Runtime assets, tests and docs

- `public/textures/**` — 140 whitelisted runtime textures; raw `assets/` проинспектирован, но не изменялся и не включён в Git.
- `tests/block-registry.test.ts`
- `tests/inventory.test.ts`
- `tests/crafting.test.ts`
- `tests/combat.test.ts`
- `tests/player-physics.test.ts`
- `tests/entities.test.ts`
- `tests/world-generation.test.ts`
- `tests/world-state.test.ts`
- `tests/redstone.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`
- `docs/MINECRAFT_1_9_REFERENCE.md`, `docs/YANDEX_REQUIREMENTS.md`, `docs/ASSET_AUDIT.md`
- `docs/reports/2026-08-16_playable-voxel-alpha.md`

# Architecture decisions

| Решение | Причина / следствие |
| --- | --- |
| Fixed `20 TPS`, render отдельно | Предсказуемые gameplay formulas; pause не продвигает simulation |
| `Game` как orchestrator, системы отдельно | Player/survival/combat/entities/redstone тестируются без WebGL UI |
| Data-first block/item/recipe registries | Один источник stats/drops/crafting/smelting, меньше hardcoded divergence |
| Stable numeric BlockId | Компактный `Uint16Array`; изменение ID требует save migration |
| Procedural base + chunk deltas | Не хранить полный voxel world; save растёт только от edits |
| Bounded managers/queues | Ограничить main-thread work для chunks, items, mobs, projectiles и redstone |
| Event boundary для damage/drop/explosion | Entity/redstone systems не владеют player inventory, health или world destruction |
| DOM/CSS UI поверх WebGL | Проще responsive layout, menus/inventory и browser inspection |
| Runtime texture whitelist | Не публиковать весь raw pack, уменьшить размер и provenance surface; importer preflight защищает output, если sourceRoot отсутствует |
| IndexedDB primary, memory fallback | Большой local voxel save; local play не блокируется storage failure |
| Yandex adapter с local no-op | SDK failure не блокирует development/main menu; platform calls изолированы |
| Derived state не сохраняется | Wire power пересчитывается; sources/fuses являются canonical saved state |

# Asset usage

Исходный `assets/` содержит `2,058` файлов, около `3.60 MiB`: `1,999` PNG, `37` properties и `22` `.mcmeta`. В наборе нет audio, `sounds.json`, model/blockstate JSON, `LICENSE`, credits или pack metadata.

Для runtime импортированы только 140 выбранных textures в `public/textures`:

- terrain/building/utility/redstone blocks;
- five ores и 16 wool colors;
- resources, food, tools, swords, armor, bow/arrow/shield;
- sun/moon и particle sheet.

Не включены Minecraft/Realms logos, title panorama, paintings, Mojang patterns и Forge/FML/OptiFine product namespaces. Mob visuals созданы кодом и не используют legacy entity UV sheets.

Поскольку GitHub-репозиторий публичный, raw `/assets/` целиком исключён из commit через `.gitignore`. В историю попадут только curated 140 runtime textures из `public/textures`. Importer сначала preflight-проверяет локальный `assets/minecraft/textures`, поэтому отсутствие непубликуемого source pack не приводит к очистке уже подготовленного runtime output.

Критический release blocker: владелец должен подтвердить происхождение и права на production texture subset. Полная инвентаризация и risk categories находятся в `docs/ASSET_AUDIT.md`.

# Tests performed

## Automated

Финальный `npm run check` green:

- TypeScript strict check — PASS;
- Vitest — `9` файлов, `52` теста, все PASS;
- Vite production build — PASS, `53` modules transformed;
- size/path validation — PASS;
- archive source-file validation — PASS.

Покрыты:

- unique registries, required/excluded scope и block items;
- stack/inventory/equipment/durability/serialization;
- crafting matcher, smelting/fuel data и runtime furnace flow;
- combat cooldown, shield, bow, armor и survival formulas;
- player wall/fall/slab physics, placement guard и takeoff-only jump event;
- negative chunk coordinates, seed determinism и ore bands;
- modified blocks/chest/furnace restore;
- dropped items, all eight mobs, targeting/damage, creeper и skeleton projectile;
- Creative non-targetability и vertical/LOS melee guard;
- redstone attenuation, button/plate timing, powered TNT `4 s`, save/restore и propagation budget.

Targeted regression fixes подтверждены: jump exhaustion только при takeoff, hunger sprint gate, Creative не targetable, mob melee использует 3D+voxel LOS, knockback только при реально нанесённом damage.

## Browser QA

Проверены main menu, world list/create, new-world render/HUD, inventory, pause, save-and-quit, saved-world load, death/respawn и settings. Финальный console warnings/errors result — `[]`.

Все заданные sizes прошли visibility/count checks:

- desktop: `1920×1080`, `1366×768`, `1280×720`, `1024×768` и малое окно;
- mobile landscape: `932×430`, `844×390`, `800×360`, `768×360`, `740×360`, `720×360`, `667×375`.

Representative visual QA выполнен на `667×375` для inventory, pause и settings. Portrait rotate guard проверен отдельно. Найдено и исправлено перекрытие menus/modals touch controls. После matrix viewport возвращён к исходному размеру.

# Performance observations

- Fixed simulation budget — `20 TPS`; frame delta ограничен `0.25 s`.
- Новый chunk добавляется постепенно, dirty rebuild ограничен одним chunk на coarse pointer и двумя на desktop tick; дальние chunks pruning выполняется периодически.
- Item/mob/projectile/redstone collections и update queues имеют hard bounds.
- Исправлен бесконечный chunk expansion из boundary meshing; после fix новый QA world становится playable вместо застревания на loading.
- Production output мал: `0.82 MiB`, `143` файла.
- Main JS `650.98 kB` (`172.48 kB` gzip); Vite сообщает неблокирующее предупреждение о chunk >500 kB. Code splitting остаётся P1 optimization.
- Vite также предупреждает, что обычный platform script `/sdk.js` не bundlится без `type="module"`; путь оставлен намеренно для Yandex-hosted archive и должен быть подтверждён в draft.
- Mesher пока создаёт отдельный quad на каждый visible face и работает на main thread — главный ожидаемый hotspot больших render distances.
- Полный длительный soak с memory timeline и реальные weak-mobile FPS/TPS measurements ещё не выполнены; устойчивые hardware performance claims не делаются.

# Yandex compliance checks

Проверено в коде/production output:

- SDK path — `/sdk.js`;
- `YandexGamesService` ловит SDK init failure и оставляет local game playable;
- `LoadingAPI.ready()` вызывается idempotently после появления интерактивного menu;
- `GameplayAPI.start()/stop()` привязаны к lifecycle;
- platform pause/resume listeners подключены;
- audio и simulation останавливаются вне `PLAYING`;
- visibility/pagehide инициируют save;
- Vite `base: './'` поддерживает archive-relative assets;
- `dist/index.html` находится в корне;
- production paths без пробелов/кириллицы;
- `.ts`, `.map`, `.psd`, tests/docs/raw pack не попадают в production;
- uncompressed archive `0.82 MiB`, значительно ниже официального лимита;
- landscape responsive matrix и portrait guard прошли browser QA;
- context menu/scroll/game gestures подавляются на игровом canvas/UI path.

Остаётся проверить в реальном Yandex draft/debug panel: фактические ready/gameplay events, platform pause ordering, iOS storage behavior и moderation checklist. Ads/auth/cloud/payments намеренно не подключены.

# Known issues

- Нет письменного подтверждения лицензии/provenance production textures.
- Реальные Safari/iOS/Android devices, multi-touch и portrait→landscape state preservation не проверены.
- Yandex draft/debug-panel/moderation pass не выполнен.
- Lifecycle хранит одно previous state, а не независимые pause reasons; user/platform/background pause ordering требует усиления.
- Save schema не имеет migration dispatcher, backup/export/import и полного corrupt-record recovery.
- Exhaustion/absorption/air/fire/combat cooldown сохраняются не полностью.
- Special block geometry/collision/state частичны; stairs full cube, slab render не half-height.
- Lighting, transparent sorting, liquids, mob pathfinding и explosion exposure — alpha approximations.
- Settings не persistent, localization только русская.
- Main JS больше Vite recommendation `500 kB`.
- Нет automated WebGL/IndexedDB/full Game E2E suite и длительного resource-leak soak.

# Deferred intentionally

- Multiplayer, server authority и accounts.
- Yandex cloud worlds, ads, payments, leaderboards и achievements.
- Weather, farming, breeding, experience, enchantments и brewing.
- Nether/End-like dimensions, bosses и late-game progression.
- Villagers/trading, vehicles и modding API.
- Advanced redstone: repeater, comparator, piston, observer, hopper, dispenser/dropper и automation.
- Full vanilla-equivalent fluids, lighting, pathfinding и every special block state.
- Hoe, gold tools и контент, прямо исключённый из alpha scope.

# Recommended next work

1. Получить license/provenance подтверждение или заменить неподтверждённые production textures.
2. Пройти real-device Safari/iOS/Android touch, multi-touch и rotation test.
3. Загрузить финальный archive в Yandex draft, проверить ready/gameplay/pause events и moderation/debug panel.
4. Добавить independent pause reasons вместо одного previous lifecycle state.
5. Добавить full IndexedDB/GameSession round-trip tests, migrations и recovery/export path.
6. Выполнить 15-minute chunk/entity/redstone/explosion/autosave soak с memory/long-task measurements.
7. После P0 перейти к workers/greedy meshing, special block geometry и более точным lighting/liquids/pathfinding.
8. Добавить settings persistence, localization tables и accessibility/control customization.

# Git information

- Origin: `https://github.com/hasbatoff2015-web/mine-s-mixosom.git`
- Repository visibility: public (`private: false`); удалённая `main` была пустой до первой публикации этого проекта.
- Target branch: `main`
- Commit message: `feat: build playable voxel survival alpha`
- Push policy: обычный push, **без force-push**.
- Raw `/assets/` намеренно не включён в Git из-за отсутствующей лицензии/high-risk provenance; commit содержит curated 140 runtime textures в `public/textures`.
- Commit hash и фактический push outcome будут указаны в финальном ответе после выполнения Git-операций. Включить собственный hash в этот же commit невозможно: изменение отчёта создало бы новый hash.
