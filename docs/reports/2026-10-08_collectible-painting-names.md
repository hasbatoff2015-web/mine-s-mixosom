# Имена коллекционных картин

Дата: 2026-10-08. Follow-up к Draft PR #126 на ветке `cursor/collectible-paintings`.

## GIT

- До merge: `origin/main` `3bb1a847abfaf1ea98432bbab9b273417a4cb6e7`, feature HEAD `a6246680689916eec1716d1b5d77d8e1d8bfc0c7`, merge-base `995a31cba319abd787c646de86c4611da024f41c`, ahead/behind 6/5. PR #126 был OPEN DRAFT и CONFLICTING.
- Обычный merge `origin/main` → feature: `0257075d56da26ecb4f5e9006edc1431b1534926`. Rebase не использовался.
- Конфликты: `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `server/gameplay.ts`. Остальные пересечения (`docs/ARCHITECTURE.md`, `shared/protocol.ts`, `src/core/Game.ts`, `src/ui/GameUI.ts`, `src/world/World.ts`) слились сами. В `Game.ts` выровнены скобки вокруг уже слитого дропа картины и яблока с листвы.

## DISPLAY NAMES

Русские имена: `Коллекционная картина #1` … `Коллекционная картина #20`. Английские: `Collectible Painting #1` … `Collectible Painting #20`. Номера без ведущего нуля. Описание всех двадцати: `коллекционный предмет`. Жёлтый hint по-прежнему `.mc-item-tooltip-hint`.

Item id не менялись. `Коллекционная картина #20` остаётся `painting_20_tiger_musya`. Уникальных экземпляров, UUID и лимита копий нет.

## MAIN SYNC

Сохранены `furnace_lit`, `welcome.furnacesLit`, `chunk_data.furnacesLit`, открытый `furnace_sync`, яблоко с каждой пятой листвы и крафт из main. Дроп картины от взрыва и ручной слом остались.

## TESTS

Локально, не GitHub CI. В репозитории нет `.github/workflows`.

- Картины, ассеты, взрыв, аукцион, геометрия, item rendering, furnace lit/sync/crafting, leaf apples, content, crafting, container, support, snapshot, network block state, explosion-performance: **276 passed / 23 files**.
- `npm run typecheck`, `typecheck:client`, `typecheck:server`: пустой вывод.
- `node scripts/check-import-boundaries.mjs`: Import boundaries OK.
- `npm run build`, `npm run build:server`, `npm run check:size`: exit 0. Production build 10.28 MiB.

## MANUAL QA

Chrome, `http://127.0.0.1:5173/?qaUi=creative`. В каталоге 20 слотов `painting_*`, общего блока нет. Порядок `#1` … `#20`. Tooltip `#1`, `#5`, `#9`, `#11`, `#20`: заголовок `Коллекционная картина #N`, строка `коллекционный предмет`, computed color `rgb(255, 255, 85)`. GUI аукциона в браузере не открывался. Имя лота, поиск и история проверены `AuctionService`.
