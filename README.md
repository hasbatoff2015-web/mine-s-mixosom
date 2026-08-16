# Frontier Cubes — Survival Alpha

Frontier Cubes — браузерная voxel/survival-игра от первого лица на TypeScript и Three.js. Проект использует Minecraft Java Edition 1.9 только как ориентир для чисел и ощущения отдельных механик; это самостоятельная alpha с собственным кодом, интерфейсом и названием.

Текущий результат уже можно запустить и пройти как базовый survival loop: создать детерминированный мир, исследовать три биома, добывать и ставить блоки, создавать предметы, плавить руду и еду, сражаться с мобами, есть, умирать, возрождаться и продолжать игру из локального сохранения. Это не законченная игра и не обещание полного соответствия Minecraft 1.9.

## Что работает

- фиксированная симуляция `20 TPS`, отдельный render loop и pause/background lifecycle;
- чанки `16×16`, высота мира `80`, процедурные plains/forest/desert, пещеры, вода, лава, деревья, кактусы и пять типов руды;
- voxel AABB игрока: ходьба, sprint, sneak, прыжок, падение, step height, столкновения, вода и лава;
- Survival и Creative, здоровье, голод, насыщение, hunger-gated sprint, броня, еда, урон среды, смерть и respawn;
- добыча по hardness/tool/tier, прочность инструментов, drops, Q-drop, подбор и объединение предметов;
- инвентарь на 36 ячеек, hotbar, off-hand, четыре armor slots, 2×2 и 3×3 crafting, сундук и печь с единым smelting registry, включая glass/charcoal;
- melee cooldown/critical/knockback, щит с first-person HUD overlay, лук и стрелы как alpha-реализация механик 1.9;
- basic redstone: signal `0–15`, dust attenuation, torch/lever/button/pressure plate и powered TNT с визуальным четырёхсекундным fuse;
- восемь articulated мобов на локальных legacy UV sheets: cow, pig, chicken, sheep с fur layer, zombie, skeleton, creeper и spider с eyes overlay;
- независимые opaque/cutout/glass/water render layers: зелёные pixels листвы depth-writing и полностью непрозрачны, alpha holes сохраняются;
- special geometry для lever, torch/redstone torch, wire, button и pressure plate; lever поддерживает floor/wall/ceiling, on/off rotation и save/reload orientation;
- простая AI-логика, 3D/voxel-LOS hostile attacks, Creative non-targetable mode, skeleton arrows, creeper explosions и loot;
- day/night lighting, HUD, F3-панель, меню миров, настройки, desktop и touch controls;
- IndexedDB-сохранения, autosave, восстановление изменённых блоков, контейнеров, dropped items, мобов, redstone sources и primed TNT;
- базовая интеграция Yandex Games SDK с local no-op fallback.

Подробная и честная матрица готовности находится в [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md).

## Быстрый старт

Нужны Node.js `20.19+` или актуальная LTS-версия и npm.

```bash
npm install
npm run dev
```

Vite по умолчанию поднимает игру на `http://localhost:4173`. Для первого входа выберите «Играть» → «Создать новый мир».

Выбранные runtime-текстуры уже лежат в `public/textures`. Чтобы заново получить их из локального исходного набора `assets/`, выполните:

```bash
npm run assets:import
```

Импортёр использует whitelist и не публикует весь исходный resource pack. Папка
`assets/` намеренно остаётся локальной и исключена из Git: публичный репозиторий
содержит только отобранные runtime-файлы. Если локального исходника нет, команда
завершится с понятной ошибкой, не удаляя готовые `public/textures`.

## Управление

Desktop:

- `WASD` — движение;
- `Space` — прыжок;
- `Ctrl` — sprint;
- `Shift` — sneak;
- мышь — обзор;
- ЛКМ — добыча или melee-атака;
- ПКМ — использовать, поставить, есть, натянуть лук или поднять щит;
- `E` — инвентарь;
- `Q` — выбросить один предмет;
- `1–9` или колесо — hotbar;
- `F3` — debug overlay;
- `Esc` — пауза.

На touch-устройствах доступны левый joystick, отдельная зона обзора и кнопки добычи, использования, прыжка, sprint, sneak, инвентаря и паузы. В portrait показывается экран с просьбой повернуть устройство; целевая ориентация — landscape.

## Проверка и production build

```bash
npm run typecheck
npm test
npm run build
npm run check:size
npm run check:archive
```

Полная локальная проверка одной командой:

```bash
npm run check
```

Финальный срез: typecheck green, `10` test files / `60` tests green, Vite преобразовал `54` модуля; production output — `0.86 MiB` и `153` файла.

Production-файлы появляются в `dist/`. Vite использует относительный `base: './'`, sourcemaps отключены. Скрипт размера проверяет наличие корневого `index.html`, допустимые имена файлов и официальный uncompressed-лимит архива Яндекс Игр; перед загрузкой всё равно нужно пройти draft/debug-panel QA.

## Сохранения

Миры хранятся в IndexedDB браузера (`frontier-cubes-saves`, schema version `1`). Autosave запускается примерно раз в 30 секунд игрового времени, а также при паузе, уходе в background, закрытии страницы и выходе в меню. Если IndexedDB недоступна, включается memory fallback — он подходит только для текущей вкладки и пропадает после перезагрузки.

Cloud save, экспорт/импорт мира и миграции старых схем пока не реализованы. Не очищайте данные сайта, если хотите сохранить локальные миры.

## Структура проекта

- `src/core` — главный цикл, lifecycle и WebAudio;
- `src/world` — чанки, генератор, block updates, контейнеры и сериализация изменений;
- `src/rendering` — runtime atlas и chunk meshing;
- `src/player`, `src/survival`, `src/combat`, `src/entities` — игровые системы;
- `src/blocks`, `src/items`, `src/inventory`, `src/crafting` — data-first registries и правила;
- `src/ui`, `src/input` — DOM/CSS UI и desktop/touch input;
- `src/save`, `src/yandex` — persistence и platform adapter;
- `tests` — unit/component tests;
- `docs` — состояние, архитектура, roadmap, QA и исследования.

Подробнее: [архитектура](docs/ARCHITECTURE.md), [тестирование](docs/TESTING.md), [roadmap](docs/ROADMAP.md), [числовой reference моделей мобов](docs/MOB_MODEL_REFERENCE.md), [отчёт visual parity pass](docs/reports/2026-08-16_visual-parity-pass.md) и [отчёт legacy-model/performance pass](docs/reports/2026-08-17_mob-models-performance-pass.md).

## Важные ограничения

- специальные формы блоков покрыты не полностью: lever/torch/wire/button/plate имеют non-cube visuals, но stairs, doors, ladders, bed, chest и часть collision/state semantics всё ещё упрощены;
- жидкости, освещение, pathfinding, spawning и explosion exposure существенно проще больших sandbox-игр;
- нет multiplayer, облачных сохранений, погоды, enchantments, farming, Nether/End и advanced redstone;
- UI русскоязычный; полноценная локализация не подключена;
- responsive browser QA пройден на заданных viewport sizes, однако реальные touch-устройства и Yandex draft/moderation ещё обязательны перед публичным релизом.

## Ассеты и происхождение

В `assets/` находится предоставленный локальный texture pack без файла лицензии и credits. В production импортируется только выбранный поднабор. Minecraft/Realms logos, panoramas, paintings, Mojang patterns и сторонние Forge/FML/OptiFine namespaces исключены из runtime.

Перед публичным распространением владелец проекта должен документально подтвердить происхождение и права на используемые текстуры. См. [docs/ASSET_AUDIT.md](docs/ASSET_AUDIT.md). Механические значения и их отличия от reference описаны в [docs/MINECRAFT_1_9_REFERENCE.md](docs/MINECRAFT_1_9_REFERENCE.md), требования платформы — в [docs/YANDEX_REQUIREMENTS.md](docs/YANDEX_REQUIREMENTS.md).
