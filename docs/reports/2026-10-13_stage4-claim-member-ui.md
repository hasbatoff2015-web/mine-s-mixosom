# Меню привата: ник на экране, playerId в удалении

## Goal

После перехода участников привата на `playerId` кнопка «Удалить» клала UUID в поле `name`. Протокол обрезает `name` до 32 символов, канонический UUID длиннее, и участник оставался в привате. В списке был виден сам UUID.

## Result

Список показывает ник. Удаление уходит в `menu_action.playerId` и снимает ровно этот id. Старая ник-запись кнопки не получает и сама не превращается в игрока.

## Implemented

- `NetworkMenuClaimMember` несёт необязательный `playerId` и отображаемый `name`.
- Меню сервера берёт ник у живого игрока, затем у сохранённой записи, иначе короткий запасной текст. Поиск по нику для этого не используется.
- Кнопка хранит полный `playerId`. Клиент отправляет его в `playerId`, не в `name`.
- Снятие участника проверяет id и заново проверяет владельца открытого привата. Офлайн-игрок снимается так же.
- Ник-запись без id остаётся в данных. В меню у неё подпись, что нужна миграция, и нет кнопки.

## Changed files

- `shared/protocol.ts`
- `server/WorldInstance.ts`
- `server/services/gameMenuActions.ts`
- `src/ui/gameMenuGui.ts`
- `src/ui/GameUI.ts`
- `tests/server/claim-member-menu.test.ts`
- `tests/claim-member-menu-ui.test.ts`
- `docs/PROJECT_STATE.md`

## Architecture decisions

Новый тип сообщения не добавлялся. Лимит `menu_action.name` не менялся: им пользуются другие действия. Добавление участника по нику осталось прежним: сервер находит ровно одну запись и сохраняет её `playerId`.

## Tests

`tests/server/claim-member-menu.test.ts` проходит меню сервера, HTML, разбор протокола и запись привата: полный UUID, обрезка `name`, офлайн, одинаковые ники, смена ника, неизвестный id, чужой приват, смена владельца, старая запись.

`tests/claim-member-menu-ui.test.ts` жмёт кнопку в `GameUI` и проверяет, что уходит полный `playerId`. Тот же обработчик клика работает и на ПК, и в ландшафте.

## Validation

| Check | Result |
| --- | --- |
| New menu tests, Stage 4 ownership, claims, claim commands, game menu, anarchy plugins, Stage 4 privilege and admin auth | PASS |
| `tests/game-menu-gui.test.ts` | PASS after Pillow was available. The first run failed only because `PIL` was not installed |
| `npm run typecheck`, `npm run typecheck:server`, `npm run check:boundaries` | PASS |
| `npm run build` | PASS, `dist/assets/index-BfLm0DO-.js` |
| `npm run build:server`, `npm run smoke:server:prod` | PASS. Anarchy, survival, peaceful, SIGTERM 0 |
| `git diff --check` | PASS |
| `npx vitest run` without a database URL | 25 failed, 3554 passed, 52 skipped, 400 files |
| `tests/server/auto-mine.test.ts` alone | PASS, 3 tests |
| PostgreSQL integration | NOT RUN. `DATABASE_URL` and `FC_TEST_DATABASE_URL` were unset |
| `npm run typecheck:sim`, manual QA, GitHub Actions | NOT RUN |

The full suite is 9 new passing tests above the previous 3544. The menu icon check passed in this environment. `auto-mine` delete failed inside the full run and passed alone, the same load flake as the previous Stage 4 run. The other failures are the existing client and combat names: arrow visuals, classic combat, fence jump, SFX pack, remote breaking overlays, ui-main, god sword mob, pet hit timing, and bow draw.

## Visual QA

Не проводилась. Ручная игра запланирована после Stage 6.

## Performance

Новых запросов к базе и обходов мира на тик нет. Ник читается только когда сервер собирает открытое меню привата.

## Known issues

Старую ник-запись по-прежнему переносит только консоль, `claim migrate-member`.

## Deferred

Панель администратора, Stage 5 и Stage 6 не делались.

## Next work

Ручная проверка меню привата на ПК и в ландшафте после Stage 6.

## Git

Ветка `cursor/admin-antidupe-postgres-foundation-26a8`. PR #129 остаётся черновиком.
