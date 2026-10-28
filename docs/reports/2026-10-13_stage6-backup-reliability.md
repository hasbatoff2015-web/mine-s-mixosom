# Stage 6 — готовность и публикация архива

## Goal

Сократить простой игры и закрыть три операционных пропуска: проверять `ready: true`, чистить старые архивы только после успешного подъёма, не считать неполную пару архив/сумма готовой копией.

## Result

Игра запускается сразу после копии миров и `pg_dump`. Gzip и SHA-256 считаются по временной копии. Успех требует `GET /status` с HTTP 200, `ready: true`, своим `mode` и своим `world` на порту из env. Удержание трёх копий выполняется только после этого. Сумма публикуется раньше архива. Таймер остаётся на 04:00 местного времени VPS и больше не догоняет пропущенный запуск.

## Implemented

- Порядок: остановка, копия, дамп, старт и готовность, затем манифест, gzip, пара архив+сумма, затем retention.
- Чистая остановка — только `inactive`. `failed` и пустой ответ копию не продолжают.
- Готовность по умолчанию читает `PORT`, `SERVER_MODE` и `WORLD` из `/etc/frontier-cubes/<mode>.env`. Выключенный до копии режим не стартует и не опрашивается. Ожидание не длиннее 60 секунд.
- Неполная пара не входит в список и не участвует в удалении старых копий.
- `Persistent=false` в `frontier-cubes-backup.timer`.
- Строки `timing:` без паролей и адресов базы.

## Changed files

- `scripts/fc-backup.sh`
- `deploy/systemd/frontier-cubes-backup.timer`
- `tests/server/stage6-backup.test.ts`
- `docs/BACKUPS.md`, `docs/SYSTEMD.md`, `docs/PROJECT_STATE.md`

Игровой код, схема PostgreSQL и `deploy-release.sh` не менялись.

## Architecture decisions

Согласованность по-прежнему даёт остановка процессов на время копии и дампа. Сжатие не держит игроков офлайн, потому что читает уже снятый staging. Второй дамп после старта не делается. `FC_HEALTHCHECK` остаётся только ручным перекрытием; без него скрипт сам ходит на `/status`.

## Tests

| Команда | Результат |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run typecheck:client` | PASS |
| `npm run typecheck:server` | PASS |
| `npm run typecheck:sim` | FAIL. Те же DOM и `virtual:player-skin-content-hashes`. |
| `npm run check:boundaries` | PASS |
| `npm run build` | PASS |
| `npm run build:admin` | PASS |
| `npm run build:server` | PASS |
| `npm run smoke:server:prod` | PASS. Три режима, SIGTERM exit 0. |
| `git diff --check` | PASS |
| Stage 6 unit | PASS, 26 tests |
| Восстановление в одноразовой базе | PASS, 526 ms отдельно и 550 ms в полном прогоне |
| `npx vitest run` | 25 failed, 3656 passed, 1 skipped, 410 files |

Полный прогон держит те же 25 имён, что и предыдущая база 3646/25: стрелы, два classic combat, забор, два MP3, 13 overlay, одна строка UI, God Sword, два теста питомца, лук, и `auto-mine` «restores original blocks». `auto-mine` отдельно прошёл 3/3; в полном прогоне он по-прежнему failed. Новых имён нет. Пропуск — Windows SIGTERM.

Локальные длительности фикстур, не VPS: порядок stop → copy → dump → start → ready → compress занял около 0.3 s; отказ готовности с таймаутом 1 s занял около 1.3 s. На VPS смотреть `timing: downtime_ms` в `journalctl -u frontier-cubes-backup.service`.

## Visual QA

Интерфейс не менялся. Браузер не открывался.

## Performance

На тик ничего не добавлено. Постоянного процесса нет. Простой — остановка, копия, дамп и ожидание `ready`. Сжатие в этот промежуток не входит.

## Known issues

Прежние 24 теста представления, боя и звука и нестабильный `auto-mine` в полном прогоне. `typecheck:sim` прежний.

## Deferred

Таймер на VPS не включался. Доставка архива по-прежнему ручная.

## Next work

Независимый аудит. PR #129 не вливать.

## Git

До правки tip был `1613c28`. Ветка `cursor/admin-antidupe-postgres-foundation-26a8`. `origin/main` `78eb6f3`.
