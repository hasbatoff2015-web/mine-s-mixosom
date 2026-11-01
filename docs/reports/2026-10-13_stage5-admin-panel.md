# Панель администратора

## Goal

Маленькая закрытая панель для двух равных администраторов. Она выглядит как меню игры и открывается только на loopback-слушателе Stage 4.

## Result

Страница `/admin/` отдаётся приватным HTTP. Игровой порт её не содержит. Разделы читают уже существующие данные мира, книги Мегакоинов, журнала и наблюдений антидюпа.

## Implemented

- Вход по токену, cookie Stage 4, выход с CSRF.
- Игроки: поиск, карточка, инвентарь через `AdminInspectionService`, кик текущего соединения, бан и снятие бана по `playerId`.
- Экономика: баланс и история этого режима. Установка точного баланса и запись журнала идут одной транзакцией PostgreSQL.
- Антидюп: сохранённые инциденты и книга ресурсов без скана на открытие. Ручная проверка не чаще раза в 15 секунд.
- Журнал и состояние этого процесса.
- Сборка `dist/admin` входит в выпуск.

## Changed files

Сервер: `server/admin/http.ts`, `assets.ts`, `bans.ts`, `panelHost.ts`, `server/AnarchyServer.ts`, `server/WorldInstance.ts`, `server/economy/postgresAuthority.ts`, `server/db/audit.ts`, `server/resources/accounting.ts`.

Клиент панели: `admin-ui/`. Сборка: `vite.admin.config.ts`, `scripts/copy-admin-assets.mjs`, `scripts/release-ops.mjs`.

Документы: `docs/ADMIN.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`.

## Architecture decisions

Новый процесс и общий админ на три мира не добавлялись. Публичный игровой HTTP не получил маршрутов `/admin`. Правка баланса не обёрнута второй независимой транзакцией: аудит пишется в той же транзакции, что и `setBalance`. Повтор `requestId` callback не вызывает.

Бан хранится в `plugin-data` мира и проверяется до публикации входа. Новый `sessionToken` даёт новый id и баном не покрывается.

## Tests

`tests/server/stage5-admin-panel.test.ts`, `tests/server/stage5-admin-world.test.ts`, `tests/admin-ui-visual.test.ts`, `tests/admin-panel-ui.test.ts`, `tests/server/stage5-admin-economy.integration.test.ts`.

## Validation

| Check | Result |
| --- | --- |
| Stage 5 HTTP, world, visual, UI text, Stage 4 lifecycle and auth | PASS |
| Admin balance integration on disposable PostgreSQL | PASS. Same request does not pay twice. A different payload does not move the balance. A new request sets 800 |
| `tests/server/megacoin.integration.test.ts` and `postgres-foundation.integration.test.ts` on that database | PASS, 28 tests |
| `npm run typecheck`, `typecheck:server`, `check:boundaries` | PASS |
| `npm run typecheck:sim` | FAIL. Unchanged missing DOM and `virtual:player-skin-content-hashes` |
| `npm run build` | PASS, `dist/assets/index-BfLm0DO-.js` |
| `npm run build:admin` | PASS. JS 12.33 kB, CSS 4.45 kB |
| `npm run build:server`, `npm run smoke:server:prod` | PASS |
| `git diff --check` | PASS |
| `npx vitest run` without a database URL | 24 failed, 3561 passed, 53 skipped, 405 files |
| GitHub Actions | NOT RUN |

The 24 names are the previous client and combat failures. `auto-mine` did not fail in this run. One extra skip is the new PostgreSQL file when `FC_TEST_DATABASE_URL` is unset. A full run against a role named `postgres` wrapped domain errors because that word sits in source paths; the rerun above used another role and passed.

## Visual QA

Сверка токенов с `src/uiTokens.css`. Ручная игра в браузере не проводилась.

## Performance

На тик игры новых запросов и сканов нет. Открытие антидюпа читает уже лежащий журнал. Полный просмотр только по кнопке.

## Known issues

Без PostgreSQL кик, бан и правка баланса не выполняются. История аудита тоже. Бан не переживает смену `playerId`.

## Deferred

Резервные копии — Stage 6. Общая панель на три процесса не делалась.

## Next work

Независимый просмотр PR и ручная проверка после Stage 6.

## Git

Ветка `cursor/admin-antidupe-postgres-foundation-26a8`. PR #129 остаётся черновиком.
