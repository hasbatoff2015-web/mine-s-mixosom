# Реферальная программа

## Goal

Серверная реферальная программа для Anarchy: код, ссылка Яндекс Игр, принятие, 3 часа активной игры, кит `referral_starter`, VIP за 3 друзей и PREMIUM за 5, без замены оплаченного ранга.

## Result

Реализовано в одной feature-ветке. Production, VPS и архив Яндекс Игр не обновлялись. Живой SDK Яндекса не запускался. Локальная тестовая PostgreSQL миграцию `0011` и конкурентные операции прошла.

## Implemented

- Код 8 символов на серверный UUID, постоянный в scope `deployment + mode + world`.
- Payload `ref_CODE` читает существующий `YandexGamesService`. Принятие только по кнопке.
- Активные секунды считает сервер. AFK 5 минут. Удержание клавиши и поворот камеры не копят время.
- Порог 10 800 секунд подтверждает связь один раз. Пороги 3 и 5 выдают VIP и PREMIUM на 7 дней один раз.
- Эффективный ранг — максимум оплаченного и реферального. `grant()` для реферальной награды не вызывается.
- Кит `referral_starter` из существующего хранилища китов. Квитанция сохраняется вместе с инвентарём.
- Меню «Друзья → Приглашения». Старые друзья, чат и телепорт не заменены.
- `/referral` и DEV-команды только при `FC_REFERRAL_DEV=1` и правах оператора.

## Changed files

- `server/referral/*`, `server/db/referralMigration.ts`, `server/db/migrationManifest.ts`
- `server/WorldInstance.ts`, `server/config.ts`, `server/services/donationRanks.ts`, `server/services/gameMenu.ts`
- `shared/referral.ts`, `shared/protocol.ts`, `shared/gameMenu.ts`
- `src/ui/gameMenuGui.ts`, `src/ui/GameUI.ts`, `src/ui/containerTheme.ts`, `src/style.css`
- `src/yandex/YandexGamesService.ts`, `src/yandex/referralIntent.ts`, `src/core/Game.ts`
- `src/save/types.ts`, `src/save/snapshot.ts`
- тесты `tests/server/referral*.test.ts`, `tests/referral-menu.test.ts`
- `docs/REFERRAL_PROGRAM.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

- Не вторая система аккаунтов. UUID уже есть.
- Не таблица событий на каждый тик. Монотонное сравнение `active_seconds`.
- Не `DonationRankService.grant()` для реферальной награды: он заменяет оплаченную запись.
- Квитанция кита в `players.json`, потому что инвентарь и PostgreSQL — разные хранилища.
- `PROTOCOL_VERSION` не повышен: новые поля и действия необязательны для старого клиента.

## Tests

- Коды, приглашения, 3 часа через перезапуск, AFK, двусмысленный flush, ранги, кит: `tests/server/referral.test.ts`, `tests/server/referral-activity.test.ts`.
- Мир, повтор кита после рестарта, полный инвентарь, WebSocket: `tests/server/referral-world.test.ts`.
- PostgreSQL `0011`, конкурентное принятие, одно подтверждение: `tests/server/referral-postgres.integration.test.ts` при `FC_TEST_DATABASE_URL`.
- Меню: `tests/referral-menu.test.ts`.
- Рядом прогнаны `kit.test.ts`, `donation-ranks.test.ts`, `migration-manifest.test.ts`.
- `npm run test:server` без `FC_TEST_DATABASE_URL`: 1243 passed, 69 skipped. Интеграции PostgreSQL в этом прогоне пропущены. Отдельный прогон `referral-postgres.integration.test.ts` с локальной тестовой базой прошёл. Хостовый наблюдатель рефералов учтён в счётчиках `playerJoin`, `blockPlaced` и `blockBroken`.

## Visual QA

Игровой клиент в браузере с настоящим SDK не открывался. Проверены HTML раздела, прокрутка списка (`mc-referral-list`), высота экрана и отсутствие отдельного диалога авторизации в разметке. Телефон и черновик Яндекса остаются владельцу.

## Performance

На тике нет SQL. У приглашённого с ещё не подтверждённой связью несколько арифметических операций на тик. Запись в базу примерно раз в 30–45 секунд на такого игрока, плюс выход и остановка. Открытие меню — несколько точечных запросов, не обход мира.

## Known issues

- Незаписанное окно секунд при падении процесса может потеряться. Записанное не откатывается.
- Эвристика активности не является античитом.
- Подписанный `uniqueID` не доказывает отдельный вход в аккаунт Яндекса.

## Deferred

- Часы на Survival и Peaceful, пока режим не добавлен в `FC_REFERRAL_ACTIVITY_MODES`.
- Настройка предметов `referral_starter` владельцем через `/kit create`.
- Проверка payload на черновике Яндекс Игр и миграция production.

## Next work

Владелец проверяет DEV и черновик по чеклисту в `docs/REFERRAL_PROGRAM.md`. Merge и выкладку делает только он.

## Git

Ветка от `origin/main` `fd9e8d91`. Draft PR, без merge и без деплоя.
