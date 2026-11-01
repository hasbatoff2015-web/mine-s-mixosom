# Stage A — постоянный гостевой playerId

## Goal

Один и тот же гость на том же сайте, режиме и сохранённом мире должен возвращаться в исходный серверный UUID. Неизвестный ключ не должен молча создавать другого персонажа.

## Result

Ключ хранится в `localStorage` слотом `развёртывание|режим|мир`. Сервер ищет его в `players.json`. Если ключа нет в этом мире, ответ `unknown_guest`, новая запись не создаётся. Первая запись нового гостя пишется до приветствия. Офлайн-команда `scripts/recover-guest.mjs` меняет только ключ выбранного UUID.

Конкретная пара UUID XASAN из DEV-логов здесь не воспроизводилась. Код подтверждает, что старый `sessionStorage` и неизвестный токен могли дать новый UUID. Живые файлы VPS не смотрелись.

## Implemented

- `src/net/guestIdentityStorage.ts` — формат, слот, миграция старого `sessionStorage`, отказ при нескольких разных старых ключах.
- `AnarchyClient` не отправляет сохранённый ключ на сокет из `?anarchyUrl=` / `?anarchyHost=` / `?anarchyPort=`, если адрес не совпадает с обычным.
- `WorldInstance.join` с `durableFresh` пишет игрока до публикации. Неизвестный токен — ошибка.
- `scripts/recover-guest.mjs` — осмотр и `--apply` только при отсутствии `.instance.lock`.

## Changed files

- `src/net/guestIdentityStorage.ts`, `src/net/AnarchyClient.ts`, `src/core/Game.ts`
- `server/WorldInstance.ts`, `server/AnarchyServer.ts`, `shared/protocol.ts`
- `scripts/recover-guest.mjs`
- `tests/guest-identity-storage.test.ts`, `tests/server/guest-identity-persistence.test.ts`
- `docs/PLAYER_IDENTITY.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`

## Architecture decisions

Внутренний id остаётся серверным UUID. Ник не является ключом. DEV и PROD различаются адресом страницы, не адресом сокета. Смена `WORLD` — другой слот. `dev-switch` в репозитории нет; выкладка `WORLD` не переписывает.

## Tests

| Команда | Результат |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run typecheck:client` | PASS |
| `npm run typecheck:server` | PASS |
| `npm run typecheck:sim` | FAIL, прежние DOM и virtual-модуль |
| `npm run check:boundaries` | PASS |
| `npm run build` | PASS |
| `npm run build:admin` | PASS |
| `npm run build:server` | PASS |
| `npm run smoke:server:prod` | PASS |
| `git diff --check` | PASS |
| Гостевые тесты | PASS, 15 |
| `npx vitest run` | 24 failed, 3672 passed, 1 skipped, 412 files |

24 падения — прежний набор без `auto-mine`: стрелы, два classic combat, забор, два MP3, 13 overlay, одна строка UI, God Sword, два теста питомца, лук. В прошлом полном прогоне `auto-mine` падал; в этом прогоне его среди FAIL нет. Новых имён нет. GitHub CI не запускался: NOT RUN.

Проверено на данных, не на имени ключа: тот же UUID после рестарта, алмазы, слот, OP, дом, друг; неизвестный токен не пишет `players.json`; сбой `savePlayers` не публикует нового игрока; второй ник XASAN не получает OP и дом первого; два входа одним токеном — один id, старый `connectionId` живое соединение не снимает; welcome уже видит запись на диске; `rotate --apply` сохраняет UUID и инвентарь и гасит старый ключ.

## Visual QA

NOT TESTED. Чеклист для владельца на DEV — в отчёте агента. PROD не трогался.

## Performance

На тике новых записей личности нет. Запись диска — при первом гостевом входе и при обычных сохранениях, которые уже были. PostgreSQL на движение не добавлен.

## Known issues

Потеря ключа в браузере сама персонажа не находит. Другое устройство без Яндекса ключ не видит. Смена каталога мира — другой персонаж. Два UUID с одним ником не сливаются.

## Deferred

Привязка Яндекса, общий реестр аккаунтов, перенос между мирами.

## Next work

Stage B может привязать проверенный внешний аккаунт к уже существующему `playerId`. Этот id при привязке не переписывать.

## Git

До задачи tip был `2894aa1`. Ветка `cursor/admin-antidupe-postgres-foundation-26a8`. `origin/main` `78eb6f3`. PR #129 остаётся draft.
