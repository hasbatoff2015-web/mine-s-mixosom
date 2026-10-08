# Коллекционные картины

Дата: 2026-10-08.

## Goal

Двадцать коллекционных картин, которые администратор получает через Creative или существующий `/give` и вешает руками. После установки картина — обычный persistent объект мира: переживает restart, видна другим, снимается, падает точным предметом, подбирается и продаётся на аукционе.

## Result

Есть 20 предметов и один общий блок `BlockId.CollectiblePainting = 170`. Вариант хранится в `paintingItemId` повешенного стека. Система не отличает «оригинал» от копии из Creative и не ограничивает число копий. В Survival нет крафта, дропа с мобов, лута и worldgen. Авторасстановки нет и задела под неё тоже нет.

## Implemented

- Предметы `painting_01_villager_hmm` … `painting_20_tiger_musya`: `resource`, `maxStack: 1`, `hiddenFromGameplay`, `creativeCatalog`, теги `collectible`, `painting`, `collectible_painting`, `painting:01`…`painting:20`. Русские имена и жёлтые описания — из существующих таблиц i18n. Английские имена нужны поиску аукциона.
- Общий блок не имеет своего предмета (`hasItem: false`), поэтому в Creative нет 21-й «пустой» картины. `placesBlockId` у всех двадцати указывает на блок 170.
- ПКМ только по вертикальной грани твёрдой опоры. Пол, потолок, жидкость, слабая опора и чужой приват отклоняются. Creative, держащий землю, не может подставить block id 170 и получить картину без дизайна. Survival списывает один предмет внутри `commitBlock`. Creative не списывает.
- Граница мира прежняя: целевой x=10000 запрещён, грань камня на 9999 в сторону 9998 разрешена.
- Слом в Survival и снятие опоры роняют ровно тот `paintingItemId`, который был в клетке. Слом игроком в Creative ничего не роняет. Повторный tick опоры не дублирует дроп. Неизвестный id не роняет предмет и не попадает в URL текстуры.
- `PaintingRenderer` рисует одну дубовую рамку и арт вне 32px-атласа. `ChunkMesher` для `painting` пустой. Свет берётся из того же daylight/sky/block, что и у чанков.
- Save/restore и сеть принимают `paintingItemId` только из белого списка. `WORLD_SCHEMA_VERSION` остаётся 1. `paintingVersion` растёт только от клеток картин.
- Аукцион без особой цены. Описание попадает в уже жёлтый hint. Для CANCELLED/EXPIRED по-прежнему «Заберите этот предмет».
- `/?qaPainting=1` — пустая dev-сцена рендерера. Это не сид мира и не спавн на сервере.

## Changed files

- `public/textures/painting/collectibles/painting_01`…`painting_20` — `git mv` с `.png.png` на `.png`, пиксели те же
- `src/items/collectiblePaintings.ts`, `src/items/types.ts`, `src/items/registry.ts`, `src/items/index.ts`, `src/items/itemRenderProfiles.ts`
- `src/i18n/ru.ts`, `src/i18n/en.ts`
- `src/blocks/types.ts`, `src/blocks/registry.ts`
- `src/world/painting.ts`, `src/world/World.ts`, `src/world/placement.ts`, `src/world/blockGeometry.ts`
- `src/gameplay/useInteraction.ts`, `src/core/Game.ts`, `server/gameplay.ts`, `shared/protocol.ts`
- `src/rendering/PaintingRenderer.ts`, `src/rendering/WorldRenderer.ts`, `src/rendering/ChunkMesher.ts`, `src/rendering/specialBlockGeometry.ts`
- `src/ui/auctionGui.ts`, `src/ui/GameUI.ts`
- `src/dev/PaintingQaHarness.ts`, `src/main.ts`
- `tests/collectible-paintings.test.ts`, `tests/collectible-painting-assets.test.ts`, `tests/server/collectible-painting-auction.test.ts`
- `tests/block-geometry.test.ts`, `tests/item-rendering.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

Один блок и двадцать предметов. Копия из Creative и картина на стене — один item id. Количество на сервере задают администраторы, а не проверка «ровно одна копия». Нет таблицы координат, respawn после находки и спавна при старте.

Дроп встроен в уже существующие четыре места: survival break в `Game` и `ServerGameplay`, плюс `processDetachedBlocks` в обоих. Отдельной системы дропа от взрыва нет.

## Tests

Локально, это не GitHub CI.

- `npx vitest run` по `collectible-paintings`, `collectible-painting-assets`, `collectible-painting-auction`, `block-geometry`, `item-rendering`: **48 passed / 5 files**.
- `npm run typecheck`, `typecheck:client`, `typecheck:server`: пустой вывод. Повторный `tsc --noEmit` и `tsc -p tsconfig.client.json` после dev-сцены тоже пустые.
- `node scripts/check-import-boundaries.mjs`: Import boundaries OK.
- `npm run build`, `npm run build:server`, `npm run check:size`: собрались. `check:size` завершился 0. Предупреждение Vite про чанк больше 500 kB было и раньше.
- Прыжок на полный куб в `tests/creeper-fence-plants-tooltip-ru.test.ts` падает и на дереве до этих правок (`ae4e8c1`), с тем же `y = 1.796735617757474`. Физику игрока не менял.

Покрыто тестами: 20 имён и описаний, каталог без общего блока, отсутствие рецептов/печи/лута мобов/`Generator.ts`, четыре стороны, отказ пола/потолка/воды/травы/подделки/привата, Creative не тратит стек, граница 10000/9998, точный дроп и его отсутствие в Creative, один дроп с двух опор, prune/restore с отбрасыванием `../../something`, сеть, геометрия без зеркала, свет рендерера, maxStack 1, сундук, портал, подбор, аукцион по минимальной цене, поиск RU/EN, покупка, cancel/expire/claim, relist и restart `AuctionService`.

## Visual QA

Chrome на `http://127.0.0.1:5173/`, окно около 1400×900.

- `?qaUi=creative`: в каталоге 231 слот, из них ровно 20 с `data-item-id`, начинающимся на `painting_`. `collectible_painting` отсутствует. Имена и hint в DOM совпали с заданными русскими строками, включая 01, 05, 09, 11 и 20.
- Наведение показало tooltip. У `.mc-item-tooltip-hint` computed color `rgb(255, 255, 85)`, это `#ffff55`. На кадрах видны «Хмм...», «Крик» и «Муся» с жёлтым текстом описания.
- `?qaPainting=1`: два ряда по десять разных артов, отдельные кадры south/east/north/west. Рамка квадратная, дубовая, общая. Арт резкий, ближайшая фильтрация, без зеркала: «Hmm» и «МУСЯ ЭТО ТЫ / НЕТ ЭТО НЕ МУСЯ» читаются. Oblique показывает толщину рамки у каменной стены. Консоль — только `[vite] connected`.

Кадры: `creative-catalog-bottom`, `tooltip-01`, `tooltip-05`, `tooltip-09`, `tooltip-11`, `tooltip-20`, `painting-row`, `painting-south`, `painting-east`, `painting-north`, `painting-west`, `painting-oblique`.

Живой Survival-слом в браузере, два клиента и ручной GUI аукциона не поднимались. Слом, опора и аукцион проверены тестами выше.

## Performance

Production build: **34.52 MiB**, 450 файлов. Двадцать PNG — **24.39 MiB** (1254×1254, 8-bit RGB, без альфы). `check:size` проходит порог 100 MiB. Внутренний ориентир «заметно ниже 20 MiB» эти файлы уже превышают. Пиксели не пережимались и не уменьшались. Если все двадцать декодировать в RGBA, это около 120 MiB несжатой памяти GPU. Серверный бандл 1.6 MB, картины в симуляцию не тащат Three.js.

## Known issues

Исходные файлы — 1254×1254, а не 64×64. Это расхождение с ранней приёмкой размера; байты оставлены как в коммите текстур.

Взрыв по-прежнему не роняет обычные блоки. Картина, уничтоженная взрывом напрямую, не выпадает. Снятие опоры роняет точный предмет.

Прыжок на куб в тесте забора падает на базе до картин. К этому изменению не относится.

## Deferred

Ручная развеска администраторами. Нет worldgen, случайных координат, таблицы спавна, поиска свободной точки, базы исходных координат, восстановления после находки и respawn потерянной картины. Уменьшение PNG и дроп от взрыва не делались.

## Next work

Администраторы сами вешают нужное число копий. Рынок задаёт цену через Auction House. Мержить только по явной команде.

## Git

- Ветка: `cursor/collectible-paintings`.
- До картин feature HEAD: `ae4e8c1346249bb381ab779bd50a2934dc6e47ab` (текстуры ещё как `.png.png`).
- `origin/main` на старте: `995a31cba319abd787c646de86c4611da024f41c`. Ветка была впереди на 1, merge-base совпадал с main.
- Коммит задачи: `0ae9ec9fd83d7f2b7bdd419e65c080c37d12579c`. Force-push не используется.
