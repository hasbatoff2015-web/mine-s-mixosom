# Stage A — жёстче гостевой вход

## Goal

Не создавать нового персонажа, если выбрана другая карточка сервера, хранилище не прочиталось, запись повреждена или у того же режима другой мир.

## Result

`connect` получает выбранный режим. Survival и Peaceful спрашивают свой `/status`. Ключ уходит только на обычный адрес этой карточки. Ошибка хранилища, порча `fc.guest.v1` и другой мир того же режима останавливают вход до сокета. Старая попытка после отмены сокет не открывает. Две вкладки с Web Locks пишут один ключ. Импорт ключа меняет один слот.

## Implemented

- Явный `targetServer` из меню.
- Доверие к сокету: адрес должен совпасть с каноническим адресом карточки, даже без query.
- Состояния плана: существующий ключ, новый гость, хранилище недоступно, порча, чужая версия, другой мир, чужой режим.
- Поколение попытки проверяется после статуса и до `new WebSocket`. `fetch` отменяется.
- Приветствие пишется только если `worldId` совпал с проверенным миром.
- `importGuestCredential` не заменяет весь документ.
- Web Locks на время первой регистрации. Без API эксклюзивности нет.

## Changed files

- `src/net/guestIdentityStorage.ts`, `src/net/AnarchyClient.ts`, `src/core/Game.ts`
- `tests/guest-identity-storage.test.ts`, `tests/guest-identity-connect.test.ts`, `tests/player-nickname.test.ts`
- `docs/PLAYER_IDENTITY.md`, `docs/PROJECT_STATE.md`

Серверный durable-путь `persistCandidate` не снимался.

## Tests

| Команда | Результат |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run typecheck:client` | PASS |
| `npm run typecheck:server` | PASS |
| `npm run typecheck:sim` | FAIL, прежние DOM и virtual-модуль |
| `npm run check:boundaries` | PASS |
| сборки и `smoke:server:prod` | PASS |
| `git diff --check` | PASS |
| Гостевые, URL, сессия, anarchy-server, права, дома, друзья | PASS, 90 в одном прогоне до полного набора |
| `npx vitest run` | 24 failed, 3685 passed, 1 skipped, 413 files |

Пакет Survival/Peaceful смотрит реальный `join` на фальшивом сокете. Смена мира, чужой режим статуса, отмена во время статуса, чужой `worldId` в welcome и чужой сокет без query — тоже на пакете. Рестарт UUID, инвентарь, OP, дом и друг остаются в прежнем серверном тесте на файле мира.

24 падения полного прогона — те же стрелы, бой, забор, MP3, overlay, UI, God Sword, питомцы и лук. Промежуточный прогон дополнительно поймал `player-nickname`: строка `connect` в `Game.ts` сменилась. Ожидание теста обновлено на вызов с `targetServer`, ник по-прежнему второй аргумент. После этого имя из полного списка ушло. Новых имён в финальном прогоне нет. GitHub CI: NOT RUN.

## Performance

Лишний `GET /status` один раз на вход. Запись ключа — на welcome. Замок Web Locks держится только до конца первой регистрации, не на тике. Тик и PostgreSQL на движение не изменились.

## Known issues

Без Web Locks две пустые вкладки могут создать двух гостей. Другое устройство ключ не видит. Очищенный браузер и чужой `WORLD` по-прежнему требуют явного решения. Яндекс не подключён.

## Git

До правки tip был `ee58f84`. Ветка та же. `origin/main` `78eb6f3`. PR #129 draft.
