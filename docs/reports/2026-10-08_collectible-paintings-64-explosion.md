# Картины 64×64 и дроп от взрыва

Дата: 2026-10-08. Follow-up к Draft PR #126 на ветке `cursor/collectible-paintings`.

## GIT

- `origin/main` до работы: `995a31cba319abd787c646de86c4611da024f41c`
- feature HEAD до работы: `2bf8f05597ac169bfd980fdae4159526cff6feff`
- merge-base до работы совпадал с `origin/main`. Ahead/behind: 4 / 0.
- PR #126 был OPEN, DRAFT, MERGEABLE.
- Повторный `git fetch` перед коммитом — в конце этого отчёта, после того как SHA коммита известен.

## ASSET FIX

- Было: 20 файлов, каждый 1254×1254, 8-bit RGB, суммарно 25 576 926 байт (24.39 MiB).
- Стало: каждый файл строго 64×64, 8-bit RGB (color type 2), без альфы. Сумма 153 312 байт (0.15 MiB). Минимум 3698 байт, максимум 10 033 байт.
- Алгоритм: Pillow `Image.resize((64, 64), Image.Resampling.NEAREST)`. Это разовый локальный проход. Pillow не добавлен в зависимости игры.
- Каждый выходной пиксель совпал с пикселем исходника по целочисленной nearest-выборке. Новых смешанных цветов нет. Композиция, имена файлов и item id не менялись. Рамка в PNG не добавлялась.
- Production build по `check:size`: было 34.52 MiB, стало 10.27 MiB. Минус 24.25 MiB, около 70%.
- Теоретический decoded RGBA всех двадцати: 20 × 64 × 64 × 4 = 327 680 байт (320 KiB). Это не замер GPU.

## ASSET TEST

`tests/collectible-painting-assets.test.ts` требует width 64 и height 64, ровно 20 канонических имён, отсутствие `.png.png`, валидный PNG, color type 2, bit depth 8, размер файла меньше 256 KiB и совпадение texture key с реестром. Ожидание 1254 удалено.

## EXPLOSION ROOT CAUSE

`DestroyedBlock` хранил только `previous: BlockId`. Какая картина висит, лежало в `BlockRenderState.paintingItemId`. `ExplosionQueue.process` вызывает `onContents`, затем `applyBlockBatch`, и `writeBlockRaw` удаляет state клетки. После batch id уже не прочитать из мира, поэтому взрыв не мог восстановить предмет.

## EXPLOSION FIX

`resolveExplosion` читает `world.getBlockState` до любой мутации и кладёт копию в `DestroyedBlock.previousState`. Поле общее для любого блока, не `paintingItemId` внутри explosion core. После `destroyedToMutations` + `applyBlockBatch` snapshot в результате взрыва по-прежнему содержит id. Дроп вызывает уже существующий `collectiblePaintingDropItemId(previous, previousState)`.

## DROP PATH

- Сервер: `ServerGameplay.processExplosions` → `spawnDroppedStack(createItemStack(paintingItemId, 1), Vec3(x+0.5, y+0.3, z+0.5))`. Это шлёт `itemDrop` и создаёт обычную item entity.
- Одиночная игра: `Game.processExplosionQueue` → `onContents` → тот же helper → `Game.spawnDroppedStack`.
- Gamemode рядом стоящего игрока не участвует. Creative player break по-прежнему ничего не роняет. Взрыв роняет.
- Обычные блоки от TNT не начали выпадать.

## EDGE CASES

- Только опора: камень снят взрывом радиуса 0.8, картина вне сферы. Следующий tick support cleanup роняет один точный предмет.
- Опора и картина в одном взрыве: один предмет. Второй tick не добавляет копию.
- `canDestroy: () => false`: клетка остаётся, дропа нет.
- Пустой state и `paintingItemId: 'not_a_painting'`: блок исчезает, предмета нет, падения нет.
- Четыре картины и два перекрывающихся job в одной очереди: четыре entity, у каждой count 1, в том числе две одинаковые `painting_07`. `seen` не даёт второй дроп с той же клетки. maxStack 1 не склеивает их в стек 2.
- Крипер, TNT minecart и мощный TNT идут в тот же `processExplosions`. Отдельной копии логики нет. Сцена «крипер стоит у картины» в браузере не запускалась.

## TESTS

Локально, не GitHub CI.

- Картины, ассеты, взрыв картин, аукцион, геометрия, item rendering, explosion-performance, TNT profiles, placed TNT, TNT minecart (клиент и сервер), server TNT types, creeper fuse network, claim-anchor blocks, support, world snapshot, network block state, dropped items, world border, chunk streaming inspector: **269 passed / 22 files**.
- Отдельно до этого прогона explosion + asset: **10 passed / 2 files**.
- `npm run typecheck`, `typecheck:client`, `typecheck:server`: пустой вывод.
- `node scripts/check-import-boundaries.mjs`: Import boundaries OK.
- `npm run build`, `npm run build:server`, `npm run check:size`: exit 0. Build 10.27 MiB.

## MANUAL QA

Chrome, `http://127.0.0.1:5173/`.

- `?qaUi=creative`: 20 картин, общего блока нет. Tooltip 01, 05, 09, 11, 20 — прежние русские строки, hint `rgb(255, 255, 85)`.
- `?qaPainting=1`: рамка того же размера, дубовая. Арт резкий, nearest, без зеркала. «Hmm» и «МУСЯ ЭТО ТЫ / НЕТ ЭТО НЕ МУСЯ» читаются. Мелкие подписи стали грубее, потому что исходник 1254 сжат в 64 пикселя. Обрезки PNG не было.
- Взрыв в браузере не подрывался. Дроп проверен `ServerGameplay.tick`.

Кадры: `creative-catalog-bottom`, `tooltip-01`, `tooltip-05`, `tooltip-09`, `tooltip-11`, `tooltip-20`, `painting-row`, `painting-south`, `painting-east`, `painting-north`, `painting-west`, `painting-oblique`.

## KNOWN UNTESTED

- Живой TNT/крипер в браузере и два клиента.
- Полный `new Game()` для одиночного взрыва. Локальный путь зафиксирован тем, что тело `processExplosionQueue` вызывает тот же helper и не смотрит gamemode. Серверные тесты гоняют очередь, batch и `spawnDroppedStack`.
- Полный многотысячный suite не запускался.
