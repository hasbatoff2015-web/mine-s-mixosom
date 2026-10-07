# Online Shift+double-click и зона выброса

Дата: 2026-10-07.

## Goal

Довести Shift+double-click в онлайне до bulk transfer после того, как первый Shift-клик уже опустошил слот. Перерисовать мобильную зону выброса: это приёмник справа по центру окна, а не вторая кнопка под крестиком.

## Result

Клиент шлёт `quick_move_matching` с merge-identity hint. Сервер выбирает живые стеки фиксированной исходной стороны и переносит их существующими правилами. Зона выброса — `div` 26×34 логических пикселя, абсолютно по центру высоты панели. Fine pointer её не показывает.

## Implemented

- `itemMergeIdentity` — идентичность без count. `quickMoveMatching` принимает её как hint.
- Если слот origin ещё содержит тот же стек, образец берётся из него. Если слот уже пуст, образец — первый живой стек исходной группы с той же идентичностью.
- Несовместимый стек в origin не двигается. Подсказка не создаёт предмет. `result` и `creative` по-прежнему отклоняются.
- `.mc-mobile-drop-target` снят с flex-колонки под крестиком. Rail тянется на высоту панели, зона стоит `top: 50%`. Armed state — более яркие чернила и внешнее свечение, без inset bevel.
- Hit по-прежнему: 0 влево, 10 логических вправо, 4 вверх и вниз.

## Changed files

- `src/inventory/inventoryActions.ts`, `src/inventory/inventoryUiAction.ts`, `src/ui/GameUI.ts`
- `src/ui/mobileDropTarget.ts`, `src/style.css`, `shared/protocol.ts`
- `tests/inventory-controls.test.ts`, `tests/inventory-pointer-hit-test.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

Клиент владеет намерением. Сервер читает живой инвентарь. `signature` у `quick_move_matching` — фильтр, не compare-and-reject по count и не предмет для вставки. `PROTOCOL_VERSION` остаётся 4: поле уже было в сообщении.

`quickMoveMatchingSourceKeys` не пересчитывает сторону после мутации. Первый Shift-клик уносит origin, второй проход сканирует ту же сторону и пропускает пустой origin.

## Tests

Локально, это не GitHub CI.

- `npx vitest run` по 24 файлам инвентаря, жестов, контейнеров, крафта, сундука, портального сундука, брони, God Sword, mobile layout и дуэлей: **231 passed / 24 files**.
- `npx tsc --noEmit`, `tsc -p tsconfig.client.json --noEmit`, `tsc -p tsconfig.server.json`: пустой вывод.
- `node scripts/check-import-boundaries.mjs`: Import boundaries OK.
- `npm run build` и `npm run build:server`: собрались. Предупреждение Vite про чанк больше 500 kB было и раньше.

Новые проверки: последовательный Shift-клик и hinted bulk для main, hotbar, сундука, портального сундука, печи, крафта и брони; пустой origin без hint отклоняется; чужой предмет и выдуманный diamond не создают стек; клиент без ACK шлёт `click` + `quick_move_matching` с signature, и серверный apply переносит оба стека.

## Visual QA

Headless Chrome, touch emulation 844×390 и desktop 1366×768.

- Крестик остаётся сверху. Зона ниже него, `centerDelta` относительно `.mc-panel` равен 0 на инвентаре, сундуке, печи и верстаке.
- Зона 39×51 CSS px при scale 1.5 (26×34 logical), `role="img"`, не `button`.
- Отпускание в зазоре между панелью и зоной и на пустом правом краю панели: apple×8 остаётся, drops пуст.
- Отпускание на зоне: drop apple×8. Armed — внешнее свечение, без inset.
- Касание зоны без drag: drops пуст, стек на месте.
- Desktop: `display: none`. Drag слот 0 → слот 5 переносит apple×8, drops пуст.

Кадры: `mobile-drop-zone-inventory`, `mobile-drop-zone-armed`, `mobile-drop-zone-chest`, `mobile-drop-zone-furnace`, `mobile-drop-zone-crafting-table`, `mobile-drop-zone-released`, `desktop-inventory-no-drop-zone`.

## Known issues

Живой сокет с искусственной задержкой для Shift+double-click не поднимался. Доказательство — apply двух сообщений на серверный инвентарь без промежуточного снимка клиенту.

## Deferred

Физический телефон. Появление сущности дропа на земле в живом мире.

## Next work

Ждать явную команду `можем мержить`. PR #125 остаётся draft.

## Git

- До этого прохода feature HEAD: `b081b43803361fb8253000dd5c216f4a0db10c17`.
- `origin/main` на старте прохода: `a14ec3ad3a810e7392f27e1803adac9f547cebd5`. Merge-base совпадал с ним. `main` за проход не сдвигался, merge не потребовался.
