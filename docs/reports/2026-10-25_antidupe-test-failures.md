# Падения God Sword, питомца, лука и скупки

Дата: 2026-10-25. Ветка `cursor/admin-antidupe-postgres-foundation-26a8`. VPS, DEV и PROD не открывались.

## Goal

Разобрать шесть результатов старого прогона и исправить только подтверждённые причины.

## Result

Три расхождения были в коде. Два были в постановке теста относительно уже существующего сжатия очереди команд. Одно было окружением Git. Одно было тем, что тест скупки вызывал `/give` без OP, поэтому продажи не было.

## Implemented

- `ServerGameplay.meleeMob` и одиночный удар в `Game` ставят `lethal` только для `mega_zombie`. Зомби с 20 HP получает обычные 10 и остаётся жив. Меч по-прежнему тратится после принятого попадания. Игрок по-прежнему получает `forceLethal`.
- `resolveSequencedEntityUse` снова отклоняет действие, если `action.selectedSlot` не совпадает со слотом записанной позы команды. Так и было в `3436f27`, пока `dd2ac89` не подменил эту проверку общим `resolveActionSlot`. Общий метод по-прежнему разрешает смену слота на самом новом `commandSeq` для удара и `interact`.
- Ожидание приручения и FIFO лука чередуют `vehicleForward`. Это граница команды, игрок вне вагонетки от неё не едет, а бюджет очереди 4 больше не выбрасывает одинаковые пакеты. Проверки `tameProgress === 0`, `bowUseTicks === 1` и длины очереди сохранены.
- В тесте восстановления скупки Ада становится оператором до `/give`, и тест проверяет, что 16 и 8 алмазов реально лежат в инвентаре. Без OP команда молча не выдаёт предмет, слот продажи пуст, и баланс остаётся стартовыми 100.

## Changed files

- `server/gameplay.ts`
- `src/core/Game.ts`
- `server/WorldInstance.ts`
- `tests/server/pet-hit-registration.test.ts`
- `tests/server/player-actions.test.ts`
- `tests/server/stage3c-buyer-recovery.test.ts`
- `docs/ARCHITECTURE.md`
- `docs/PROJECT_STATE.md`
- этот отчёт

## Architecture decisions

Летальность Меча Бога по игроку не переносилась на всех мобов. У Мега-зомби 1500 HP, и существующий мир-тест ждёт смерть от этого меча, поэтому флаг остаётся только у `mega_zombie`.

Сжатие непрерывных команд не отключалось. Тесты, которым нужна длинная очередь, помечают команды границей, как уже делает `melee-lag-compensation`.

`safe.directory` не добавлялся. Ошибка Git возникает, когда процесс не владеет репозиторием и `SUDO_UID` не указывает на владельца. `sudo` подставляет `SUDO_UID`, поэтому та же команда от root через sudo проходит. Прямой root без `SUDO_UID` получает `dubious ownership`. Это проверка Git, не дефект `gitReleaseId`.

## Tests

Локально, без VPS.

| Команда | Результат |
| --- | --- |
| `npx vitest run` god-sword, pet-hit, player-actions, mega-zombie-world, pets-anarchy, hotbar-selection, release-deploy, tick-load-flight | 8 files, 85 passed |
| `stage3c-buyer-recovery` с локальным PostgreSQL 16 на `127.0.0.1` | 1 passed. До OP: баланс 100, сообщение «Положите предмет в слот продажи.», в `economy_operations` только `INITIAL` |
| `tsc --noEmit`, `tsc -p tsconfig.server.json`, `check:boundaries` | passed |

`tick-load-flight` в этом прогоне уложился в `max < 80` и `mean < 50`. Порог не менялся. Прежние 91–106 мс совпадают с уже описанной нагрузкой хоста на `setView` и генерацию столбцов, не со сканером антидюпа: скан не входит в тик.

`tests/server/release-deploy.test.ts` прошёл от владельца каталога. Отдельная проверка: root с очищенным `SUDO_UID` на чужом репозитории получает `fatal: detected dubious ownership`.

## Known issues

Полный Vitest и PostgreSQL-набор кроме восстановления скупки в этом проходе не запускались. `typecheck:sim` не запускался.

## Deferred

Глобальный `safe.directory` и смена порога `tick-load-flight`.

## Next work

Решение о прогоне остальных PostgreSQL-тестов и о DEV принимается отдельно.

## Git

Ветка `cursor/admin-antidupe-postgres-foundation-26a8`. `main` не менялся. Merge, rebase и force push не делались.
