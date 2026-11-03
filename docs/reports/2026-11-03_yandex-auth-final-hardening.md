# Закрытие Yandex RESUME и корреляция LINK

Дата: 2026-11-03

## Goal

Закрыть подтверждённые дыры: welcome без подтверждённого consume, старый отпечаток 0009, общий лимит за reverse proxy, поздний ответ LINK, очистка чужого deployment и лишний слот на полном сервере.

## Result

Код и поведенческие тесты закрывают эти случаи. Живой PostgreSQL в этой среде не запускался. DEV и production не обновлялись.

## Implemented

- RESUME публикует игрока только после `consumeReservedProof === true` и пока попытка держит join lease. `false` снимает только свою бронь и не шлёт welcome. Исключение SQL бронь не снимает и welcome не шлёт.
- Старый SHA-256 текста проверяется после HMAC. Новые строки пишутся каноническим отпечатком. Миграции `0009` и `0010` не редактировались. `0011` не нужна.
- Loopback не становится общим peer-лимитом. `X-Forwarded-For` читается только от `FC_TRUSTED_PROXIES`. Лимит субъекта — проверенный `uniqueID`. Отпечаток доказательства ограничен отдельно.
- `auth_link.requestId` и `auth_result.requestId` связывают один запрос. Идентификатор не даёт прав.
- Очистка фильтрует `deployment_id`, `server_mode`, `world_id` и не удаляет строки моложе максимального окна 3600+600 секунд плюс час.
- Уже подключённый UUID не занимает второй слот. Офлайн-игрок на полном сервере не входит. Два разных входа не делят последний слот.

## Changed files

`WorldInstance.ts`, `AnarchyServer.ts`, `yandexProofReceipts.ts`, `yandexVerifier.ts`, `authRateLimit.ts`, `config.ts`, `protocol.ts`, `Game.ts`, `yandexLinkCorrelation.ts`, тесты и документы этого отчёта.

## Architecture decisions

Потребление доказательства стоит между подготовкой и публикацией. Если consume уже зафиксирован, а publish не удался, доказательство остаётся потраченным и ключ не выдаётся. Следующий вход требует новую подпись. Ровно одну доставку welcome между PostgreSQL и браузером этот процесс не обещает.

Неизвестный исход consume не вызывает `DELETE` брони: повтор того же доказательства упирается в существующую строку.

За Nginx без `FC_TRUSTED_PROXIES` общий лимит 40/5 мин на `127.0.0.1` не применяется. Остаются лимит сокета, лимит процесса и лимит после проверки подписи. Пример для локального Nginx, без правки живых конфигов: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` и `FC_TRUSTED_PROXIES=127.0.0.1`, только если игровой порт снаружи закрыт и peer действительно Nginx.

## Tests

Поведенческие WebSocket-тесты: consume true, false, throw, повтор после неизвестного исхода, гость при недоступной базе, гонка двух RESUME с чатом `race-ok`, полный сервер, legacy hash, requestId.

`npm run test:server`: 1195 passed, 67 skipped, 1 failed. Падение — `setView into new columns stays cheap` под общей нагрузкой: max 94.77 мс при бюджете 80, средние 50.85 и 56.65 мс при бюджете 50. Отдельно на этой ветке тест прошёл. На `origin/main` `7956ab6a` отдельно средние были 52.09, 55.22 и 51.18 мс и бюджет 50 не выполнен. Код чанков не менялся.

PostgreSQL integration: NOT RUN. Нет `psql`, Docker и `FC_TEST_DATABASE_URL`.

## Visual QA

Интерфейс кнопок не менялся. Новый ручной проход не делался.

## Performance

На игровой tick новые SQL не добавляются. LINK/RESUME делают проверку, lookup или bind, одну бронь и один consume. Очистка остаётся таймером раз в 10 минут, пакет 500, вне tick. Карты лимитера ограничены 1024 ключами.

## Known issues

Живая база и черновик Яндекса не проверялись. Если consume зафиксирован, а сокет уже не владеет lease, доказательство потрачено без welcome.

## Deferred

Реферальные награды, новый провайдер, Redis, отдельный auth-сервер.

## Next work

На DEV включить флаг, секрет и PostgreSQL отдельно. Прогнать интеграционный тест на базе, в имени которой нет `prod`.

```
FC_TEST_DATABASE_URL=postgres://USER:PASS@127.0.0.1:5432/fc_yandex_test npx vitest run tests/server/provider-identity-links.integration.test.ts
```

Тест создаёт и удаляет только свои schema. Production URL не использовать.

## Git

Ветка `cursor/yandex-auth-player-linking-db49`, draft PR #143. `main` не менялся. Деплоя нет.
