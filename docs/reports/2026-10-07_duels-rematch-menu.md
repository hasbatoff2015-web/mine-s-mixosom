# Дуэли: размер отсчёта и реванш без кулдауна

Дата: 2026-10-07.

## Goal

Уменьшить пиксельный отсчёт `3` / `2` / `1` / `БОЙ!` с 3.2 до 2.8 и убрать искусственный постматчевый кулдаун. После окна лута 15 с открытое меню дуэлей должно само перейти в idle, и повторный вызов должен проходить сразу.

## Result

`DUEL_COUNTDOWN_HOLOGRAM_SIZE` равен 2.8. Шрифт остаётся `display` (Press Start 2P), стиль `normal`, фон выключен, billboard включён, `interactive: false`. `HOLOGRAM_SIZE_MAX` остаётся 3.2. Тайминг отсчёта 5000 мс и залп начала боя не менялись.

`DUEL_POST_MATCH_COOLDOWN_MS`, `cooldownUntil`, `armCooldown`, `cooldownRemaining` и поле меню `duelCooldownMs` удалены. Отказ по-прежнему держит 10 с. Окно лута 15 с остаётся частью матча: победитель в нём недоступен для новой дуэли.

`finishCleanup` сначала снимает остатки лута и уводит победителя на спавн, затем ставит `phase = idle`, удаляет committed match id, гасит голограмму и только после этого обновляет меню победителя и проигравшего. Отмена отсчёта и `shutdown` лута или таймаута тоже обновляют меню уже из `idle`.

## Implemented

- Размер отсчёта 2.8 только в константе дуэли.
- Постматчевый кулдаун убран из сервиса, протокола, сборки меню и HTML. Текст «Подождите N сек.» для дуэли больше не рисуется.
- Доступность кнопки вызова зависит от плагина, арены, занятости, жизненного цикла, приглашения, дистанции и готовности цели.
- Пока фаза `loot`, `arenaBusy` истинен и победитель в `isInLifecycle`. После ровно `DUEL_LOOT_WINDOW_MS` и `tick` фаза `idle`, последний автоматический пакет меню имеет `duelArenaBusy: false`, поля кулдауна нет, и при дистанции до 20 блоков `canChallenge` истинен. `challenge()` сразу возвращает `ok: true`.
- То же для forfeit и timeout: после окна очистки 15 с лишнего ожидания нет.

## Changed files

- `shared/duels.ts`, `shared/protocol.ts`
- `server/services/duels.ts`, `server/WorldInstance.ts`
- `src/ui/gameMenuGui.ts`, `src/style.css`
- `tests/server/duels-service.test.ts`, `tests/server/duels-world.test.ts`
- `tests/hologram-transient.test.ts`, `tests/game-menu-gui.test.ts`
- `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`
- `docs/reports/2026-10-05_duels-plugin-arena-1v1.md`, `docs/reports/2026-10-06_duels-countdown-burst.md`

## Architecture decisions

- Окно лута не заменяется кулдауном. Победитель остаётся в матче, пока не собран или не удалён лут.
- Меню читает `DuelService.menu()` в момент `refreshGameMenu`. Поэтому терминальная фаза записывается до отправки пакета.
- Смерть, forfeit и старт timeout по-прежнему обновляют меню уже из `loot` или `timeout_cleanup`, чтобы открытый экран показывал занятую арену.
- Общий потолок размера голограммы не снижался.

## Tests

- `npx vitest run tests/server/duels-service.test.ts tests/game-menu-gui.test.ts tests/hologram-style.test.ts tests/hologram-transient.test.ts tests/hologram-hit.test.ts tests/firework-burst-colors.test.ts tests/duel-effect-protocol.test.ts` — 48 passed.
- `npx vitest run tests/server/duels-world.test.ts` — 12 passed, including the open-menu loot cleanup rematch.
- `npm run typecheck:client` — PASS.
- `npm run typecheck:server` — PASS.
- `npm run check:boundaries` — PASS.
- `npm run build` — PASS.
- `git diff --check` — PASS.
- `npx vitest run` — 3154 passed, 23 failed, 1 skipped, 338 files. The 22 names from the previous duel pass failed again: arrow panel UVs, classic combat presentation (2), fence jump, production MP3 count (2), remote breaking overlays (13), pet hit registration (2), bow draw FIFO. `tests/urgent-block-mesh.test.ts` also failed in that parallel run and passed 4/4 when rerun alone. No duel, hologram, firework, or protocol test failed. This is local Vitest, not GitHub CI.

## Visual QA

Браузер и два клиента этим проходом не запускались. Чеклист DEV остаётся ручным: шрифт Press Start 2P, размер 2.8 против прежних 3.2, ПКМ сквозь текст, залп без изменений, реванш сразу после 15 с при уже открытом меню, без «Обновить».

## Performance

Новых сущностей и таймеров нет. Один лишний пакет меню на игрока в момент cleanup, только если экран дуэлей уже открыт.

## Known issues

- `public/ui/menu/icon_duels.png` нет в репозитории.
- Живой двухклиентный QA не сделан.
- Изоляция TNT и обход `/kill` в этот проход не входили.

## Deferred

- Очередь арен, ставки, вторая арена.
- Ручная проверка размера 2.8 и реванша на DEV.

## Next work

Владелец проходит чеклист визуала и реванша на DEV.

## Git

Ветка `cursor/duels-plugin-arena-1v1-6694`. Draft PR **#122**. Не смержено.
