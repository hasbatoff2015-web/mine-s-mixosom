# Peaceful-арена и клон карты

## Goal

Два независимых каталога из построенной карты PROD Anarchy для Survival и Peaceful, PvP на Peaceful только внутри арены, без взрывов на Survival и Peaceful. PROD Anarchy и текущий DEV Anarchy не менять.

## Result

Игровые правила и офлайн-скрипт клонирования сделаны и покрыты тестами. Согласованный backup PROD и запуск трёх DEV-процессов не выполнены: в этой среде нет SSH-ключа, секрета хоста и self-hosted worker. Публичный статус PROD Anarchy при проверке был `ready: true`. Файлы PROD и DEV не редактировались.

## Implemented

- `cellAllowsExplicitPvp` и проверка обеих позиций в `ServerGameplay.cancelDisallowedPlayerStrike`, в том числе для урона питомца с `attackerPlayerId`.
- Запрет поджига TNT, фитиля крипера и детонации вагонетки, когда `explosionsAllowed` ложен. Уже зажжённый TNT возвращается в клетку, если она свободна.
- `scripts/clone-world-snapshot.mjs` копирует весь мир и картовые plugin-data. Имя привата не решает, что это арена: нужен явный `flags.pvp === true`. Обе копии устанавливаются вместе и откатываются вместе. Живая структура PROD по-прежнему не прочитана.

## Not done

- `fc-backup` на PROD не запускался, PROD не останавливался.
- Каталоги DEV Survival и DEV Peaceful на VPS не создавались.
- Три DEV-процесса не поднимались.

## Tests

`tests/server/server-modes.test.ts`, `tests/server/claims.test.ts`, `tests/server/clone-world-snapshot.test.ts`.
