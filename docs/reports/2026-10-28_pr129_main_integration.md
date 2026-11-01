# Интеграция PR #129 с актуальным main

## Goal

Собрать черновик PR #129 (`c90d78d`, ветка `cursor/admin-antidupe-postgres-foundation-26a8`) с актуальным `origin/main` (`6c402836`) на отдельной ветке. Сохранить продавца из main и долговременную, идемпотентную продажу из PR. Не вливать результат в `main`, не деплоить и не запускать миграции на DEV или production.

## Result

Ветка `cursor/integrate-antidupe-main-78a0` содержит обычный merge. История `main` и исходной ветки PR не переписывалась. Force push не использовался. Production и DEV-базы не трогались. Локальный тест ходил только в `127.0.0.1` и во временные базы `fc_bk_src_*` / `fc_bk_dst_*`, которые тест сам удаляет.

`origin/main` на момент сборки оставался `6c4028361e3e7d84412fe928942e68a251f7d9e8`.

## Implemented

- Продавец: `role: seller` и поле `stock`. Запас — сохранённая подпись. Покупка его не уменьшает и не считает лимитом. Нехватка баланса и места в инвентаре по-прежнему отклоняет покупку до выдачи предмета.
- Покупка у продавца в Postgres требует UUID `clientRequestId`. Списание идёт через `withdrawSource` с источником `TRADER_PURCHASE` и этим UUID. Повтор того же запроса не списывает деньги второй раз и не выдаёт второй стак. Если резерв ещё лежит, выдаётся количество из резерва.
- Параллельная покупка того же NPC получает `SELLER_BUSY_ERROR`, пока первая не отпустила блокировку.
- Неуспешное списание удаляет только новый резерв и не выдаёт предмет. Резерв, который уже был на диске, остаётся для восстановления.
- `recoverSellerPurchases` под теми же блокировками: оплаченный источник даёт один стак в `returns`, неоплаченный резерв удаляется без предмета. Удаление NPC не выбрасывает postgres-резерв до этого шага.
- JSON по-прежнему связывает покупку с `pairId`. Повтор того же UUID не списывает второй раз, пока строка есть в истории. Пустой баланс не мешает такому повтору.
- `sellDurable` и восстановление продажи скупщику сохранены.
- `buyer_action` принимает `role`, `stock` и `clientRequestId`.
- Исключение участника привата идёт по `playerId`. У контейнера остаётся `data-menu-context`. Запись без id не получает кнопку исключения.
- Пятый аргумент `CurrencyPort.withdraw` — строка pair id либо `EconomyCommandRequest`. На Postgres строка является source id.

## Changed files

Слияние относительно `origin/main` затрагивает файлы антидюпа, админки, Postgres и продавца. Конфликты разрешены в:

- `server/services/buyer.ts`
- `shared/protocol.ts`
- `src/ui/gameMenuGui.ts`
- `docs/ARCHITECTURE.md`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`

Дополнительно к разрешению конфликтов изменены `server/economy/currencyPort.ts`, `server/economy/postgresAuthority.ts`, `server/services/economy.ts`, `server/WorldInstance.ts`, `tests/server/buyer.test.ts`, `tests/live-form-patch.test.ts` и `tests/server/stage6-backup-restore.integration.test.ts`.

## Architecture decisions

Promise экономики нельзя читать как синхронный `{ ok }`. Покупка у продавца ждёт `thenResult`. Для Postgres источник списания — id покупки, он же UUID запроса. Повтор с другим количеством завершает уже записанный резерв, а не новое количество из пакета.

Синхронная загрузка не удаляет postgres-резерв: решение принимает `hasEconomicSource` после старта. JSON по-прежнему смотрит `findTransactionByPairId`, потому что этого метода нет у Postgres-порта.

`stock` не стал складом, который кончается. Так продавец работает на main, и тесты прямо покупают больше сохранённого числа.

## Tests

- `npx tsc --noEmit` — без ошибок.
- `npx tsc --noEmit -p tsconfig.server.json` — без ошибок.
- `npm run check:boundaries` — без ошибок.
- `npm run build` — клиент собран.
- `npm run build:server` — `dist/server/index.mjs` собран.
- `npx tsc --noEmit -p tsconfig.sim.json` — 9 ошибок DOM и `virtual:player-skin-content-hashes`. Тот же разрыв `tsconfig.sim.json` уже был на `origin/main`. Это не регрессия слияния.
- Целевые наборы: `buyer.test.ts`, `buyer-plugin.test.ts`, `live-form-patch.test.ts`, `claim-member-menu-ui.test.ts`, `claim-member-menu.test.ts`, `game-menu.test.ts`, `stage6-backup.test.ts` — 103 passed.
- Повторно, с `FC_TEST_DATABASE_URL=postgresql://ubuntu@127.0.0.1:5432/fc_local_test`: stage 6 restore, economy, stage 3C buyer recovery, money-request boundary. Restore прошёл. Три теста `stage6-backup.test.ts` (B13, B14, T5) превысили 5 с, пока параллельно шёл полный набор. В полном наборе этих трёх падений нет.
- Полный `npx vitest run` без `FC_TEST_DATABASE_URL`: 3963 passed, 26 failed, 65 skipped. 24 падения совпадают с уже известными на `origin/main` и на базе слияния: кэш геометрии вагонетки 4 вместо 3, `mobileSneak` читает `mode` у `undefined`, прыжок на забор 1.797 вместо >1.9, нет модуля `PIL`, нет Pillow, невидимость прячет предмет в руке, в `public/audio/sfx` 27 файлов вместо 26, броня и голова удалённого игрока, 13 оверлеев добычи без `readMeshSkyLight`.
- Два падения `tests/server/anarchy-server.test.ts` (break с `ok: true` вместо `reach`, yaw дуэли 0 вместо 1.25) в том же полном прогоне не воспроизвелись отдельно: файл целиком, 29 тестов, прошёл. Это нагрузка полного прогона, не стабильная регрессия продавца.
- Новые случаи в `buyer.test.ts`: повтор JSON-запроса при нулевом балансе, один стак за оплаченный postgres-резерв и удаление неоплаченного, сохранение оплаченного резерва при удалении NPC, отказ postgres-списания без предмета.

## Visual QA

Игровой браузерный проход не запускался. Разметка меню привата проверяется `live-form-patch` и `claim-member-menu-ui`: кнопка исключения несёт `playerId`, контейнер сохраняет `data-menu-context`.

## Performance

Отдельный профиль не снимался. Блокировка продавца держится до конца Promise, чтобы вторая покупка не прошла мимо списания.

## Known issues

- 24 падения полного набора и 9 ошибок `typecheck:sim` уже есть на `origin/main`. Здесь они не исправлялись.
- `stock` продавца не ограничивает покупку.
- Повтор JSON-запроса больше не зависит от истории из 100 записей. Завершённая покупка лежит в `settledPurchases` и переживает обрезку `economy/transactions` и перезапуск. Подробности: `docs/reports/2026-10-28_seller-json-replay.md`.
- Полный набор один раз показал два нестабильных падения Anarchy. Изолированный повтор их не подтвердил.

## Deferred

- Не вливать эту ветку в `main`, пока её не примут ревью.
- Не менять статус и историю PR #129.
- Не деплоить и не мигрировать DEV или production.

## Next work

Ревью интеграции. Отдельно, не в этом сливе, можно разобрать 24 старых падения и `tsconfig.sim.json`, который тянет `megaZombieModel.ts` в DOM и Vite virtual module.

## Git

- База: `origin/main` `6c4028361e3e7d84412fe928942e68a251f7d9e8`.
- Влитый коммит PR: `c90d78d9b22f1c3c67deb6797365a6afb866c149`.
- Исходная ветка PR и её рабочая копия с незакоммиченным `tests/server/stage6-backup-restore.integration.test.ts` не изменялись этим коммитом.
- Интеграционная ветка: `cursor/integrate-antidupe-main-78a0`.
