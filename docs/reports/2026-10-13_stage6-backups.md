# Stage 6 — резервные копии VPS

## Goal

Подготовить на VPS один согласованный архив трёх миров и дампа PostgreSQL, оставить три последние копии, описать ручное скачивание на Windows и проверить восстановление во временных каталогах. Игровую архитектуру Stages 1–5 не менять.

## Result

Скрипт `scripts/fc-backup.sh` останавливает только те игровые unit-ы, которые уже запущены, копирует миры и plugin-data, снимает `pg_dump -Fc` и снова запускает те же unit-ы. Архив публикуется после проверки `tar` и SHA-256. Секреты из `/etc/frontier-cubes` в архив не входят. Таймер лежит в репозитории и на VPS не включался.

Изолированное восстановление прошло: миры прочитаны через `WorldPersistence`, дамп залит в другую одноразовую базу, в ней есть миграции `0001`–`0007`, проводка, журнал, идемпотентность и бан.

## Implemented

- Один скрипт: ручной запуск, `list`, `verify`, `stage-download`.
- Остановка через `systemctl stop` (SIGTERM). При срыве остановки архив не создаётся. При срыве `pg_dump` или архива ранее активные unit-ы запускаются снова.
- `flock` не даёт двум копиям идти вместе.
- Каталог `/var/backups/frontier-cubes`, имя `frontier-cubes-YYYY-MM-DD_HHMMSS.tar.gz` и соседний `.sha256`. Права каталога `0750`, файлов `0640`.
- Хранятся три последних успешных архива. Очистка не заходит в каталоги миров и не идёт по symlink.
- `deploy/systemd/frontier-cubes-backup.service` и `.timer`, 04:00 местного времени VPS.
- `docs/BACKUPS.md` и чеклист `docs/QA_MANUAL_STAGE6.md`.

## Changed files

- `scripts/fc-backup.sh`
- `deploy/systemd/frontier-cubes-backup.service`
- `deploy/systemd/frontier-cubes-backup.timer`
- `tests/server/stage6-backup.test.ts`
- `tests/server/stage6-backup-restore.integration.test.ts`
- `docs/BACKUPS.md`, `docs/QA_MANUAL_STAGE6.md`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/POSTGRESQL.md`, `docs/SYSTEMD.md`, `docs/DEPLOYMENT.md`

`scripts/deploy-release.sh` не менялся. Выкладка игры скрипт бэкапа не ставит.

## Architecture decisions

Копия делается вне тика. Согласованность — короткая остановка трёх процессов, а не снимок живых файлов. Если три env смотрят в одну базу, дамп один. Пароль уходит в файл `pgpass` режима `0600`, не в аргументы `pg_dump`. `.instance.lock` в архив не кладётся: это метка процесса, не сохранение мира. Крайний случай разрешения времени в кэше банов Stage 5 не трогался.

## Tests

| Команда | Результат |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run typecheck:client` | PASS |
| `npm run typecheck:server` | PASS |
| `npm run typecheck:sim` | FAIL. `document`, `HTMLCanvasElement`, `virtual:player-skin-content-hashes`. Так же было раньше. |
| `npm run check:boundaries` | PASS |
| `npm run build` | PASS. `dist/assets/index-BfLm0DO-.js` |
| `npm run build:admin` | PASS. `dist/admin/assets/index-Csdw-5jD.js` 15.18 kB |
| `npm run build:server` | PASS |
| `npm run smoke:server:prod` | PASS. Anarchy, Survival, Peaceful, разные `world`, SIGTERM exit 0, lock снят. Временный `WORLD_PATH`. |
| `git diff --check` | PASS |
| `npx vitest run` с одноразовой базой | 25 failed, 3646 passed, 1 skipped, 410 files |

Пропущенный тест: Windows-ветка `server-process-lifecycle` (на Linux она не запускается).

Stage 6 в полном прогоне: 16 unit-тестов и репетиция восстановления — PASS. Репетиция прочитала `players.json` через `WorldPersistence` и после `pg_restore` увидела `schema_migrations` = 7, ledger `ADMIN_SET` / 40, audit `balance`, idempotency `committed`, ban `stage6 ban`. Рабочие пути `/var/lib/frontier-cubes` тест не писал.

`tests/server/auto-mine.test.ts` («restores original blocks on delete») упал в полном прогоне и отдельно прошёл 3/3. В полном прогоне он остаётся failed. Это прежняя нагрузка, не новый дефект копии.

В полном прогоне не упали `anarchy-gameplay` и `tick-load-flight`. Раньше они падали под нагрузкой.

Остальные 24 падения полного прогона — прежний набор: UV стрел, два теста classic combat, прыжок через забор, два теста MP3, 13 тестов breaking overlay, строка UI, удар God Sword по мобу, два теста попадания питомца, удержание лука. Новых имён нет.

## Visual QA

Игровой интерфейс не менялся. Браузерный проход не делался. Ручной чеклист A–T для владельца: `docs/QA_MANUAL_STAGE6.md`, все пункты NOT TESTED, пока их не пройдут на dev-сервере.

## Performance

Новых запросов, обходов игроков и обходов мира на тике нет. Постоянного процесса бэкапа нет: таймер запускает oneshot и тот завершается. Второй запуск упирается в `flock`. Архив — gzip каталогов мира и custom-дамп. Место зависит от размера миров; на диске остаются три пары архив+сумма. Пауза игры равна остановке, копированию и `pg_dump`.

## Known issues

`typecheck:sim` и 24 прежних теста представления/боя/звука по-прежнему красные в полном Vitest. `auto-mine` красный только под нагрузкой полного прогона. Это не блокирует скрипт копии. Для публикации игры они остаются известными дефектами вне Stage 6.

## Deferred

Таймер на VPS не включался. Автоматической доставки на Windows нет. Однокнопочного восстановления нет. Секреты env владелец хранит отдельно.

## Next work

Независимый аудит. Не вливать PR #129, пока его не приняли.

## Git

Ветка `cursor/admin-antidupe-postgres-foundation-26a8`. PR #129 остаётся draft. `origin/main` `78eb6f338349be32d6ecf63ba40f900020b203a2`. До этой задачи tip был `4440e11`.
