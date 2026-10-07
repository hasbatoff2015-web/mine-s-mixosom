# Hit-test под pointer capture, online double-click и shift-matching

Дата: 2026-10-07.

## Goal

Исправить три дефекта follow-up к PR #125: desktop drag внутри инвентаря выбрасывал предмет, online double-click зависел от RTT, Shift+double-click в обычном инвентаре мог вернуть стек на исходную сторону.

## Result

Pointer capture на `.mc-backdrop` оставлен. Цель `pointermove` и `pointerup` определяется по `document.elementFromPoint`. Drag на другую ячейку переносит, сливает или меняет стеки. Выброс прямым drag остаётся только на настоящем backdrop снаружи панели. Второй клик онлайн уходит как `collect_matching` до прихода снимка. Bulk quick-move сканирует только исходную сторону.

## Implemented

- `inventoryPointerHit.ts`: один разбор зоны. Порядок: диалог количества, координаты мобильного выброса, слот, заблокированный контрол, панель, backdrop.
- `GameUI.pointerSample`: pointerdown читает `event.target`. Активный жест читает координаты.
- `#cursor-stack` и `.mc-item-tooltip` остаются `pointer-events: none`, в том числе inline. Если hit всё же попал в них, берётся следующий элемент из `elementsFromPoint`.
- `resolveSlotClick` помнит `firstClickExpectedPickup`. Второй ЛКМ в пределах 250 мс шлёт только `collect_matching`.
- `quickMoveMatchingSourceKeys` фиксирует сторону до мутации. Изменившийся за этот проход стек пропускается.

## Changed files

- `src/ui/inventoryPointerHit.ts`, `src/ui/GameUI.ts`, `src/inventory/inventoryActions.ts`
- `tests/inventory-pointer-hit-test.test.ts`, `tests/inventory-controls.test.ts`, `tests/inventory-mobile-cursor.test.ts`, `tests/mobile-layout-rects.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

Клиент по-прежнему шлёт намерение. `elementFromPoint` выбирает только UI-цель. Сервер читает живой стек, совместимость, count и запрет ручного выброса в дуэли. `PROTOCOL_VERSION` остаётся 4.

`AnarchyClient.send` пишет один WebSocket-кадр на вызов. `AnarchyServer` обрабатывает `message` по порядку. Поэтому пара `click` + `collect_matching` не зависит от того, успел ли снимок обновить локальный курсор.

Старые DOM-тесты сами диспатчили `pointerup` на целевой слот. Они не моделировали ретаргет после `setPointerCapture`, поэтому проходили на сломанном hit-test. Новый тест диспатчит move/up на backdrop и подставляет физический элемент через `elementFromPoint`.

## Tests

Локально, это не GitHub CI.

- `npx vitest run` по 24 файлам инвентаря, жестов, контейнеров, крафта, сундука, портального сундука, брони, God Sword, mobile layout и дуэлей: **215 passed / 24 files**.
- `npx tsc --noEmit`, `tsc -p tsconfig.client.json --noEmit`, `tsc -p tsconfig.server.json`: пустой вывод.
- `node scripts/check-import-boundaries.mjs`: Import boundaries OK.
- `npm run build` и `npm run build:server`: собрались. Предупреждение Vite про чанк больше 500 kB было и раньше.

## Visual QA

Headless Chrome, настоящие `Input.dispatchMouseEvent` / `Input.dispatchTouchEvent`, без мока `elementFromPoint`. На `pointerup` `event.target` был `.mc-backdrop`, а `elementFromPoint` возвращал слот под курсором.

Desktop 1366×768, `(pointer: coarse)` = false:

- слот 0 → пустой слот 4: apple×8 в слоте 4, drops пуст;
- apple×8 → apple×3: merge до 11;
- apple → stone: swap;
- меч → armor-head: остаётся в слоте, drops пуст;
- шлем → armor-head: надет;
- пустая область `.mc-panel`: отмена;
- крестик: отмена;
- настоящий backdrop: drop apple×8;
- курсор RMB снаружи: 1, затем LMB: оставшиеся 7;
- распределение ЛКМ по слотам 1–3: 2/2/2, курсор 2.

Mobile 844×390, touch emulation, coarse true:

- tap: apple уходит в курсор, хотя `pointerup` пришёл на backdrop;
- drag слот 0 → слот 4: перенос, drops пуст;
- drag на пустой backdrop: отмена;
- drag на цель выброса: drop apple×8.

Кадры: `desktop-drag-slot-to-slot`, `desktop-drag-helmet`, `desktop-drag-outside-drop`, `desktop-drag-distribute`, `mobile-drag-slot-to-slot`, `mobile-drop-target-release`.

## Performance

Hit-test на move/up — один `elementFromPoint` и при необходимости `elementsFromPoint`. Пока инвентарь закрыт, жест не сканирует слоты.

## Known issues

Нарисованный размер цели выброса по-прежнему равен крестику. Это не менялось.

## Deferred

Живой мир: появление сущности дропа на земле и сундук/печь руками. Мутация и `onDrop` покрыты тестами и Chrome-harness. Долгое касание в этом проходе повторно гонялось vitest-ом, не отдельным Chrome-жестом. Online double-click проверен сообщением без ACK, не живым сокетом с искусственной задержкой.

## Next work

Ждать явную команду `можем мержить`. PR #125 остаётся draft.

## Git

- До работы `origin/main`: `de2843bcfe8ee3c8ebe9901b0ebeed2fb4b331a7`. Feature HEAD: `cde850a5613a4626268441750bb91d090983081e`.
- Во время работы в `main` влился PR #123 (`a14ec3ad3a810e7392f27e1803adac9f547cebd5`). В ветку сделан обычный merge, без rebase и force push.
