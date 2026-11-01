# Реестр привязки внешнего id

Дата: 2026-10-15

## Goal

Сохранить на сервере соответствие уже проверенного id Яндекса и существующего `playerId`, не подменяя UUID и не включая вход.

## Result

Миграция `0008` создаёт `player_identity_links`. Запись делает только внутренний `bindVerifiedProviderIdentity`. Объект без `verified: true` отклоняется. Сокет и протокол этот метод не вызывают.

## Schema

Составной уникальный ключ: `deployment_id`, `server_mode`, `world_id`, `provider`, `provider_user_id`.

Второй уникальный ключ: `deployment_id`, `server_mode`, `world_id`, `player_id`, `provider`.

Провайдер пока только `yandex`. Поиск идёт по этим ключам, отдельных индексов нет. `0001`–`0007` не менялись.

## Conflicts

Повтор той же пары — `already_linked`, одна строка. Чужой UUID на тот же внешний id — `provider_conflict`. Второй внешний id на тот же UUID — `player_conflict`. Строка не переносится и не стирается. Неверный UUID и игрок, которого нет в переданном мире, не пишутся. Выключенная база отвечает `unavailable` и гостевой вход не трогает.

## Tests

`tests/server/provider-identity-links.test.ts` гоняет правила на памяти с теми же ограничениями уникальности. Это не PostgreSQL. Живой тест `provider-identity-links.integration.test.ts` включается только при `FC_TEST_DATABASE_URL` и своей схеме. Если переменной нет, он не запускался.

## Visual QA

Не нужна. На DEV и PROD миграция не применялась.

## Performance

Обычный тик, движение и вход гостя эту таблицу не читают.

## Known issues

Проверки подписи Яндекса нет. Без неё реестр не выбирает персонажа.

## Deferred

Stage C: `getPlayer({ signed: true })`, проверка подписи на сервере, добровольная привязка, вход с другого устройства.

## Git

Отдельный коммит на `cursor/admin-antidupe-postgres-foundation-26a8`. PR #129 остаётся черновиком.
