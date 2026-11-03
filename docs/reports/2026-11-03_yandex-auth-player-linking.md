# Stage 1: Яндекс ID и привязка персонажа

Дата: 2026-11-03

## Goal

Добровольная серверная привязка подтверждённого Яндекс ID к существующему UUID и восстановление того же персонажа на другом устройстве. Реферальные награды, AFK и меню рефералов не входят.

## Result

**BLOCKED BY VERIFIED PROVIDER IDENTITY.**

SERVER-AUTHENTICATED YANDEX ID НЕ ПОДТВЕРЖДЁН. Вход, привязка и восстановление по Яндексу не включены. Кнопки в меню нет. Гостевой вход не менялся по смыслу. Сделаны только независимые ограничения: клиентский `{ verified: true }` не становится личностью, а два `join` на одном сокете не публикуют двух гостей.

## Implemented

- `verifyYandexPlayerSignature` по-прежнему не возвращает id. Покупка, самодельный JSON и флаг `isAuthorized` личность не создают.
- `loadYandexAuthConfig` остаётся `enabled: false` при выключенном флаге, при пустом секрете и при заданных обоих.
- `issueVerifiedYandexIdentity` ставит метку процесса. `asVerifiedProviderIdentity` отвергает JSON, объект с `verified: true` и spread-копию. Сокет эту функцию не вызывает. Верификатор её не вызывает.
- `AnarchyServer.handleJoin` принимает один незавершённый вход на сокет. Второй пакет игнорируется и в лог не пишет токен. Закрытие сокета до конца входа отключает только `connectionId` этой попытки.

## Changed files

- `server/identity/providerLinks.ts`
- `server/identity/yandexVerifier.ts`
- `server/config.ts`
- `server/AnarchyServer.ts`
- `tests/server/provider-identity-links.test.ts`
- `tests/server/provider-identity-links.integration.test.ts`
- `tests/server/yandex-verifier.test.ts`
- `tests/server/guest-identity-persistence.test.ts`
- `docs/PLAYER_IDENTITY.md`
- `docs/YANDEX_REQUIREMENTS.md`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/POSTGRESQL.md`

## Architecture decisions

LINK и RESUME не добавлены в протокол. Сообщение, которое всегда отвечает отказом, и кнопка, которая всегда сообщает «сервер выключил вход», обещали бы готовую привязку.

Гостевой `sessionToken` не вращается и не удаляется. Привязки, из-за которой старый ключ стал бы лишним, нет. Активное подключение и запись в `players.json` не переписываются ради Яндекса.

Scope остаётся `deployment_id + server_mode + world_id`. Новой таблицы для общего реферального id нет.

Будущий ReferralService, когда проверка появится, сможет читать только проверенную пару внешний id и UUID внутри одного scope. Подпись, секрет, ник и гостевой ключ ему не отдаются. Связь в Anarchy не сливает Survival и не сливает DEV с PROD.

## Yandex verification

Документы:

- https://yandex.com/dev/games/doc/en/sdk/sdk-player
- https://yandex.ru/dev/games/doc/ru/sdk/sdk-player
- https://yandex.com/dev/games/doc/en/sdk/sdk-purchases
- https://yandex.com/dev/games/doc/en/sdk/sdk-events
- https://yandex.com/dev/games/doc/en/requirements/1/2
- полный индекс https://yandex.com/dev/games/doc/en/llms-full.txt
- загрузчик https://sdk.games.s3.yandex.net/sdk.js (это loader, не схема профиля)
- типы `@types/ysdk`: `signature` — строка, полей JSON нет

Подтверждено:

- конверт `<signature>.<profile data>`, обе части base64;
- HMAC-SHA256 покупки считается по декодированным байтам второй части;
- лимит `getPlayer` — 20 раз за 5 минут;
- `openAuthDialog()` только после действия игрока;
- отдельного HTTP API «проверь игрока» в документации нет.

Не подтверждено:

- имена полей внутри профиля;
- какое поле равно `getUniqueID()`;
- подписанный признак авторизованного аккаунта, а не анонимного id;
- `issuedAt`, срок или защита от повторной отправки профиля.

Реального signed profile с DEV нет: нет iframe Яндекс Игр, нет секрета игры и нет тестового аккаунта. Подпись в репозиторий не клалась. Синтетический HMAC на выдуманном JSON в тестах помечен как синтетический и личность не создаёт. Опубликованный вектор покупки `t0p$ecret` — официальный пример покупки, не профиля.

Replay: для профиля не доказан срок жизни. Пока доказательство статическое, защита от повтора не заявляется. Nonce, который не подписывает Яндекс, старую подпись свежей не делает. Этого достаточно, чтобы не включать production-вход.

## Security

Недоверенны: `getUniqueID()`, `isAuthorized()`, ник, `playerId` из пакета, `{ verified: true }`, JSON сокета, `localStorage`. Доверенным был бы только subject после серверной проверки. Такой subject сейчас не создаётся.

`FC_YANDEX_AUTH_SECRET` в клиент, git, `/status` и логи не попадает. Код причины в логе: `disabled`, `missing_secret` или `profile_schema_unverified`.

Повторный `join` не шлёт ошибку клиенту: `AnarchyClient` во время входа любой `error` считает провалом и оборвал бы первый, настоящий вход.

## Tests

- `npm test -- tests/server/yandex-verifier.test.ts tests/server/provider-identity-links.test.ts tests/server/guest-identity-persistence.test.ts tests/guest-identity-connect.test.ts tests/guest-identity-storage.test.ts` — 5 файлов, 113 тестов, все прошли.
- `npm run test:server` — 1179 прошли, 65 пропущены, 1 падение по времени: `setView into new columns stays cheap` показал среднее 51–55 мс при бюджете 50 мс, пока весь набор сервера шёл параллельно. Повтор того же файла отдельно — 3/3 прошли. Код обзора чанков не менялся.
- `npm run typecheck:server`, `npm run typecheck:client`, `npm run check:boundaries`, `npm run build`, `npm run build:server` — прошли. Vite по-прежнему предупреждает про `/sdk.js` и крупный chunk.
- `tests/server/provider-identity-links.integration.test.ts` и остальные PostgreSQL integration-тесты **NOT RUN**: `FC_TEST_DATABASE_URL` не задан. Это не PASS.
- Полный `npm test` целиком отдельно не гонялся: серверный набор и гостевые клиентские тесты покрыты командами выше.
- Ручные сценарии A–J с настоящим Яндексом **NOT RUN**.

## Visual QA

Не делалась. Интерфейс привязки не добавлялся.

## Performance

На тик новых запросов нет. HMAC на движении нет. Опрос SDK не добавлен. Отклонённый повторный `join` не пишет `players.json` и не читает PostgreSQL.

## Known issues

Без схемы профиля постоянную привязку включать нельзя. Гость по-прежнему не переносится на другое устройство сам.

## Deferred

LINK, RESUME, конфликт локального гостя A и персонажа B, смена аккаунта Яндекса, текст меню, реферальная модель поверх scope. Ждут имена полей профиля, признак авторизации и решение по свежести. Секрет остаётся вне git.

## Next work

Владелец на черновике Яндекс Игр снимает структуру полей без значений, проверяет HMAC своим секретом и присылает только имена полей и типы. После этого можно решать, включать ли вход. До этого Stage 2 (AFK и активное время) не должен считать Яндекс ID доказанным.

## Git

Ветка `cursor/yandex-auth-player-linking-db49` от `origin/main` `7956ab6a9044deb0beba71e35a6ff104b0d07ffd`. `main` не менялся. Выкладки на DEV и production нет.
