# Управление инвентарём, drag и мобильное разделение

Дата: 2026-10-07.

## Goal

Довести клики инвентаря до контракта, близкого к Java, добавить pointer drag, выброс за панель на fine pointer, отдельную цель выброса на coarse pointer и диалог количества. Однопользовательский мир и Anarchy должны вызывать одну и ту же мутацию. Ручной выброс во время дуэли остаётся запрещённым.

## Result

Слот больше не меняется на `pointerdown`. Fine и coarse фиксируют жест на `pointerup`. Пустой coarse backdrop не выбрасывает предмет и не уносит иконку курсора. Справа от панели, под крестиком, на `(pointer: coarse)` есть цель выброса. Долгое касание слота игрока открывает «Количество». Сервер по-прежнему читает стек сам. `PROTOCOL_VERSION` остаётся 4.

## Implemented

- `slotKey.ts` разбирает ключ слота один раз: mutable, output, virtual, creative, invalid.
- `inventoryActions.ts`: shift quick-move, drop из слота и курсора, `move_stack`, split в пустую ячейку, hotbar/offhand swap, collect, drag distribute, quick-move matching.
- `isManualDropAction` покрывает `drop_selected`, `drop_cursor` и `drop_slot`. Проверка стоит в `ServerGameplay.applyInventory` до мутации.
- Жест: 8 px и 350 ms. Отмена указателя ничего не коммитит. Превью drag клиентское.
- Диалог шириной 132 логических px. Стартовое число `ceil(count / 2)`. `РАЗДЕЛИТЬ` требует пустой обычный слот и `selected < count`. Порядок назначения: первая пустая ячейка 9..35, затем 0..8, источник пропускается, слияние не делается.
- Клавиатура при открытом инвентаре забирает Q, Ctrl+Q, 1–9 и F у наведённого слота. Закрытый инвентарь их не трогает. Escape и E сначала закрывают диалог количества.

## Changed files

- `src/inventory/slotKey.ts`, `stackAmount.ts`, `inventoryActions.ts`, `inventoryUiAction.ts`
- `src/ui/inventoryPointerGesture.ts`, `inventoryKeys.ts`, `mobileDropTarget.ts`, `GameUI.ts`, `itemTooltip.ts`, `src/style.css`
- `shared/protocol.ts`, `server/gameplay.ts`
- `tests/inventory-controls.test.ts`, `inventory-pointer-gesture.test.ts`, `inventory-mobile-cursor.test.ts`
- `tests/mobile-polish-contracts.test.ts`, `mobile-layout-rects.test.ts`, `tests/server/duels-world.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

Клиент шлёт намерение: ключи, кнопку, необязательные count / all / slot / signature. Сервер читает инвентарь, курсор, броню, вторую руку, сетку крафта, сундук, печь, режим и окно. Подпись стека — только compare-and-reject. Несовпадение отменяет действие и не создаёт предмет. Count режется по живому стеку.

Локальный `GameUI` без `submitAction` вызывает тот же `applyInventoryUiAction`, затем `onDrop`. Онлайн только отправляет сообщение. Превью drag очищается до ответа сервера.

Диалог количества висит на backdrop, а не внутри `.mc-stage`, поэтому ему отдельно копируется `--mc-ui-scale`. В ширину stage он не входит.

Визуал цели выброса совпадает с уже нарисованным крестиком: `max(44px, 22px * scale)`, а не отдельный квадрат 20. Логический зазор 6. Hit: 0 влево, 10 вправо, 4 вверх и вниз, умноженные на scale.

## Tests

Поведенческие, не поиск строки. Локально, это не GitHub CI.

- `npx vitest run` по 18 файлам инвентаря, жестов, контейнеров, крафта, печи, сундука, портального сундука, God Sword, mobile layout и дуэлей: **169 passed / 18 files**.
- `./node_modules/.bin/tsc --noEmit`, `tsc -p tsconfig.client.json --noEmit`, `tsc -p tsconfig.server.json`: пустой вывод.
- `node scripts/check-import-boundaries.mjs`: Import boundaries OK.
- `npm run build` и `npm run build:server`: собрались. Предупреждение Vite про чанк больше 500 kB было и раньше.

Дуэльный тест чистит стартовый инвентарь. Во время запрета не меняются инвентарь и курсор и не появляется drop entity для `drop_selected`, `drop_cursor` (включая count 1), `drop_slot` на 1, на 4 и `all`. `move_stack` в это время проходит. Чужой игрок по-прежнему может выбросить.

## Visual QA

Headless Chrome. Физического телефона нет.

Мобильные кадры: 844×390, touch emulation, `(pointer: coarse)` совпал, scale 2.

- Панель: 352×366 CSS px. Ширина ровно 176×2. Высота по содержимому, как у существующего `.mc-panel`; константа 166 по-прежнему только бюджет масштаба.
- Крестик: 44×44, left 580, top 12, bottom 56.
- Цель выброса: 44×44, left 580, top 68, bottom 112. Зазор 12 px = 6×2. `display: grid`.
- Hit: left 580, top 60, right 644, bottom 120. Левый край совпадает с визуалом. Вправо +20 px, вверх и вниз по 8 px.
- Диалог: ширина 264 px = 132×2, центр совпал с центром панели. На стеке 64 показано `32 / 64`. После разделения на 20 счётчики `44`, `20` и прежние `8`.
- Desktop 1366×768 без touch emulation: coarse false, цель `display: none`, панель 704 px шириной = 176×4.

Кадры: `mobile-inventory-drop-target`, `mobile-drag-follow`, `mobile-drop-armed`, `mobile-amount-dialog`, `mobile-post-split`, `desktop-inventory`.

Не проверялось живым миром: появление сущности дропа в мире, сундук/печь/верстак руками, книга рецептов руками, Creative God Sword руками. Это закрыто тестами мутации и протокола.

## Performance

Пока инвентарь закрыт, жест не сканирует слоты. Распределение и перенос уходят одним сообщением в конце жеста, не на каждый пиксель. Подсветка цели выброса только на клиенте.

## Known issues

Нарисованный размер цели выброса равен крестику (`22` логических, минимум 44 CSS px), а не отдельному квадрату 20. Hit при этом считается от фактического визуального прямоугольника и влево не растёт.

## Deferred

Отдельная иконка выброса вместо CSS-треугольника. Диалог количества на слотах сундука, печи и крафта. Физический телефон.

## Next work

Ждать явную команду `можем мержить`. PR #121 и #123 на момент пуша не влиты и в эту ветку не подмешивались.

## Git

- `origin/main` до и после работы: `de2843bcfe8ee3c8ebe9901b0ebeed2fb4b331a7` (merge PR #122). За время работы main не сдвинулся.
- Ветка: `cursor/inventory-controls-drag-mobile-split-1661`.
- Открытые чужие PR, которые трогают контейнеры, но не влиты: #121 (печь и яблоки), #123 (урон мобов). Отдельного PR на эти же inventory controls не было.
- Rebase и force push не делались. В main не коммитилось. Production не выкладывался.
