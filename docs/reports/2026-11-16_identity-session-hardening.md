# Личность и сессия — 2026-11-16

## Goal

Существующий UUID не должен меняться при обычном входе, обновлении клиента или сервера, перезапуске процесса и повторном подключении. Поломка хранилища не должна маскироваться новым персонажем.

## Result

Путь Stage A и Stage B сохранён. Сервер по-прежнему один создаёт UUID и `sessionToken`. Клиент хранит ключ и предъявляет его снова. Добавлены проверки, которые раньше пропускали пустой список игроков, пустые права, чужой мир и две одновременные первые регистрации.

## Confirmed root causes

1. `WorldPersistence.loadRecords` при живых `meta.json` и `world.json` считал отсутствующий `players.json` пустым объектом. Следующее сохранение записало бы пустой список и стёрло UUID, инвентари и токены.
2. `parsePlayers` молча выбрасывал строку с плохими координатами. Следующий снимок сохранял уже урезанный состав.
3. `PermissionService.load` на отсутствующем файле брал пустой fallback и сразу делал `persist()`. Для существующего мира это создавало новый `permissions.json` без ручного OP. Не-объект и неизвестная версия тоже переписывались.
4. `join` не получал ожидаемый `worldId`. Между `/status` и сокетом смена мира успевала создать UUID в другом мире; клиент отказывался сохранить ключ уже после записи.
5. `withGuestScopeLock` без `navigator.locks` сразу выполнял тело. Две первые вкладки могли создать два UUID, после чего одна запись `localStorage` оставляла только последний токен.
6. `runYandexResume` превращал ошибку чтения гостевого хранилища в отсутствие ключа и мог открыть связанного персонажа.
7. Неудачная запись после `welcome` не повторялась и не оставляла идемпотентный ключ повтора. Клиент при этом уже был в игре.

Не подтвердилось и не менялось: ротация `sessionToken` на каждом входе, выдача OP по нику, автоматическая активация `unreviewedOps`, зависимость гостевого входа от PostgreSQL. Миграция PermissionState v2 по-прежнему кладёт UUID в `unreviewedOps`: тест и `docs/PERMISSIONS.md` описывают это как намеренную политику, потому что источник права в старом файле не доказан.

## What was hardened

- Первый вход слота пишет `fc.guest.reg.v1/<deployment>/<mode>/<worldId>`. Web Lock сериализует вкладки. Без него IndexedDB-транзакция `fc-guest-reg` или сравнение записи в `localStorage` оставляют один `registrationId`. Сервер по этому id возвращает тот же UUID и тот же токен. Неизвестный токен этим id не заменяется.
- `join.expectedWorldId` не совпал с миром процесса — `world_mismatch` до UUID, токена, `players.json` и привязки Яндекса.
- Существующий мир без `players.json`, с битым JSON или с не-объектом в таблице не стартует и файл не создаёт. Новый мир по-прежнему пишет пустую таблицу вместе с `meta.json` и `world.json`.
- Строка игрока с нечисловыми координатами или испорченным секретом роняет разбор снимка, а не исчезает.
- Существующий мир без читаемого `permissions.json` не стартует и пустой файл не пишет. Версия 3 сохраняет ручной OP. Версия 2 и файл без версии ведут себя как раньше.
- Запись ключа после `welcome` повторяется три раза. Неудача не называется успешным сохранением. `registrationId` остаётся для следующего входа.
- Ошибка чтения хранилища на входе Яндекса останавливает подключение.
- `fc-backup` требует `players.json` и `plugin-data/permissions.json`, пишет `"identity": "full"`. `verify` для `"identity": "map-only"` печатает `verify: identity-incomplete`. Выкладка релиза каталоги миров не трогает.
- Запись JSON по-прежнему через временный файл и `rename`, перед переименованием вызывается `fsync`.

## How a UUID is restored

1. Сервер создаёт UUID и `sessionToken`, пишет строку в `players.json`, затем шлёт `welcome`.
2. Клиент кладёт токен в `fc.guest.v2/...` и снимает регистрационный ключ.
3. Следующий вход отправляет тот же токен. Сервер находит тот же UUID.
4. Если `welcome` дошёл, а токен в браузер не записался, следующий вход шлёт сохранённый `registrationId` и получает тот же UUID.

Ник, IP и отпечаток браузера идентификаторами не являются. Полная очистка данных браузера без привязки Яндекса неотличима от нового гостя. Это ограничение модели, не дефект восстановления.

## Changed files

- `src/net/guestIdentityStorage.ts`, `src/net/AnarchyClient.ts`, `src/core/Game.ts`
- `shared/protocol.ts`
- `server/persistence.ts`, `server/WorldInstance.ts`, `server/AnarchyServer.ts`
- `server/services/jsonStore.ts`, `server/services/permissions.ts`
- `src/save/snapshot.ts`, `src/save/types.ts`
- `scripts/fc-backup.sh`
- `tests/guest-identity-storage.test.ts`, `tests/guest-identity-connect.test.ts`, `tests/yandex-endpoint.test.ts`
- `tests/server/guest-identity-persistence.test.ts`, `tests/server/permissions.test.ts`
- `tests/server/daily-rewards-plugin.test.ts` — только аннотация типа, чтобы корневой `tsc` собирался
- `tests/server/stage6-backup.test.ts`, `tests/server/stage6-backup-restore.integration.test.ts`
- `tests/fs-world-store.test.ts`, `tests/server/import-schematic.test.ts`, `tests/server/world-events-v3-migration.test.ts`, `tests/server/server-process-lifecycle.test.ts`
- `tests/support/initialPermissions.ts`
- `docs/PLAYER_IDENTITY.md`, `docs/PERMISSIONS.md`, `docs/BACKUPS.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`

## Tests

PostgreSQL production не использовался. `FC_TEST_DATABASE_URL` в этом прогоне пустой, поэтому `tests/server/stage6-backup-restore.integration.test.ts` пропущен своим `skipIf`. Состав архива и отказ `map-only` проверены в `tests/server/stage6-backup.test.ts`.

- `npm run typecheck:client` — успешно.
- `npm run typecheck:server` — успешно.
- `npm run check:boundaries` — успешно.
- `npm run build` — успешно. Корневой `tsc` до правки не собирался: в `tests/server/daily-rewards-plugin.test.ts` вызов `releaseDay?.()` не совпадал с аннотацией `(result) => void`, хотя функция аргумент не принимает. Аннотация приведена к `() => void`. Поведение награды не менялось.
- `npm run build:server` — успешно.
- `git diff --check` — без замечаний.
- Целевые тесты личности, прав, Яндекса, снимка и файлового мира: 105 тестов, 0 падений.
- `npx vitest run tests/server tests/fs-world-store.test.ts tests/guest-identity-storage.test.ts tests/guest-identity-connect.test.ts tests/yandex-endpoint.test.ts tests/yandex-auto-client.test.ts tests/world-snapshot.test.ts`: 150 файлов прошли, 13 пропущены, 1395 тестов прошли, 81 пропущен. Один файл `tick-load-flight.test.ts` трижды упёрся в порог среднего времени 50 мс (50.4–53.8 мс) во время общего прогона. Отдельный запуск того же файла: 3 теста, 0 падений. Это тайминг загрузки чанков, не идентичность.

## Guest-model limits

- Очистка данных браузера уничтожает гостевой ключ. Без Яндекса сервер не узнает человека.
- Другое устройство без привязки Яндекса тот же ключ само не видит.
- `guestDeploymentId()` по-прежнему берётся из hostname: `local`, `dev`, `prod` и прочие сайты не делят слот. Менять это без миграции существующих ключей нельзя.
- DEV, PROD, Anarchy, Survival и Peaceful остаются разными слотами.
- Два персонажа с одним ником не сливаются.

## Manual QA on DEV

Один браузер: войти, запомнить UUID, обновить вкладку, закрыть и открыть снова. Открыть две чистые вкладки одного слота и убедиться, что UUID один. Перезапустить процесс DEV и проверить инвентарь и OP. Не подменять мир и не чистить `players.json`.
