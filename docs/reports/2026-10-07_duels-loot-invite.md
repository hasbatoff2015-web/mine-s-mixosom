# Дуэли: вызов во время окна лута

Дата: 2026-10-07.

## Goal

Убрать асимметрию меню после смерти в дуэли. Победитель и проигравший должны видеть друг друга и иметь возможность отправить вызов, пока идёт 15-секундный сбор лута. Новый бой при этом не начинается, пока арена занята.

## Result

Результат матча по-прежнему фиксируется в момент смерти. Арена остаётся занятой на `DUEL_LOOT_WINDOW_MS`. Приглашение можно создать в эту фазу. `accept()` отвечает `Арена занята.` и не удаляет `requestId`, не ставит кулдаун отказа и никого не телепортирует. После очистки тот же вызов принимается, если не истёк TTL 30 с и игроки всё ещё подходят под обычные правила.

## Implemented

- `blocksInvitation` закрывает только countdown, fighting и timeout cleanup. Победитель и проигравший в `loot` приглашение отправляют и получают.
- Список рядом больше не пропускает игрока из-за фазы лута. `canChallenge` не зависит от занятости арены.
- `accept()` проверяет занятость арены до готовности игроков и до любой мутации вызова.
- Кнопка «Принять» в меню не гасится только из-за «Арена занята». Сервер остаётся владельцем результата. Кнопка «Вызвать» берётся из `canChallenge`.

## Changed files

- `server/services/duels.ts`, `src/ui/gameMenuGui.ts`
- `tests/server/duels-service.test.ts`, `tests/server/duels-world.test.ts`, `tests/game-menu-gui.test.ts`
- `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`

## Architecture decisions

- Занятость арены и право послать вызов — разные проверки.
- Окно лута не стало кулдауном и не сократилось.
- Дистанция 20 блоков, отказ 10 с, один исходящий вызов и запрет встречного автопринятия не менялись.

## Tests

- `tests/server/duels-service.test.ts` — 22 passed.
- `tests/server/duels-world.test.ts` — 13 passed, including both menus during loot and the same `requestId` after cleanup.
- `tests/game-menu-gui.test.ts` — 11 passed.
- `tests/server/game-menu.test.ts` — 11 passed.
- Hologram, firework, and protocol tests — 18 passed.
- `npm run typecheck:client`, `npm run typecheck:server`, `npm run check:boundaries`, `npm run build`, `git diff --check` — PASS.
- `npx vitest run` — 3158 passed, 23 failed, 1 skipped, 338 files. Twenty-two failures match the previously recorded pre-existing set: arrow panel UVs, classic combat presentation (2), fence jump, production MP3 count (2), remote breaking overlays (13), pet hit registration (2), bow draw FIFO. `tests/server/anarchy-gameplay.test.ts` skeleton-arrow case failed in that parallel run and passed when rerun alone. No duel test failed. Local Vitest, not GitHub CI.

## Visual QA

Браузер и два клиента не запускались.

## Performance

Новых таймеров нет.

## Known issues

- `public/ui/menu/icon_duels.png` нет в репозитории.
- Живой двухклиентный QA не сделан.

## Deferred

- TNT и `/kill` в этот проход не входили.

## Next work

Проверка на DEV: после смерти оба видят соперника, вызов уходит при занятой арене, принятие до конца лута не стартует бой, после 15 с то же приглашение стартует.

## Git

Ветка `cursor/duels-plugin-arena-1v1-6694`. Draft PR **#122**. Не смержено.
