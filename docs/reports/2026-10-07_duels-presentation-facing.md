# Дуэли: размер залпа, взгляд на противника, пропорции отсчёта

Дата: 2026-10-07.

## Goal

Поправить три визуальные вещи после DEV-проверки. Геймплей дуэли, список вызовов, лут и запрет Creative не менять. Предыдущая жалоба на реванш была Creative-режимом одного тестера.

## Result

Залп старта боя рисуется точками 0.12. Обычный фейерверк остаётся 0.20. При принятии оба игрока смотрят друг на друга и на сервере, и в локальной камере. Следующая команда ввода уже несёт этот взгляд, после чего мышь и касание крутят камеру свободно. Цифры отсчёта и `БОЙ!` сохраняют высоту размера 2.8 и больше не растянуты по ширине.

## Implemented

- `FireworkVisuals` держит два слоя `Points`. Обычный материал 0.20, компактный 0.12. `spawnBurst` выбирает слой по `size`, без ветки `if (duel)`.
- `duelLookToward` считает yaw/pitch от одного спавна к другому. Совпадающие точки оставляют сохранённый взгляд.
- `accept` передаёт этот взгляд в `hardRelocateForDuel`. Серверный контроллер получает его сразу. Каждому участнику уходит один `player_look`.
- Клиент пишет yaw/pitch в `InputManager` и в локального игрока и сбрасывает кэш прицела. Обычная сверка движения взгляд не захватывает.
- Голограмма отсчёта ставит `preserveTextAspect: true`. Рендерер не смотрит на имя `duel-countdown`. Старые голограммы без поля остаются с прежней шириной.

## Changed files

- `shared/duels.ts`, `shared/protocol.ts`, `shared/hologramStyle.ts`
- `server/services/duels.ts`, `server/services/holograms.ts`, `server/WorldInstance.ts`
- `src/rendering/FireworkVisuals.ts`, `src/rendering/HologramRenderer.ts`
- `src/net/duelStartLook.ts`, `src/input/InputManager.ts`, `src/core/Game.ts`, `src/gameplay/hologramHit.ts`
- `tests/firework-burst-colors.test.ts`, `tests/duel-look.test.ts`, `tests/duel-start-look-client.test.ts`, `tests/duel-effect-protocol.test.ts`
- `tests/hologram-style.test.ts`, `tests/hologram-transient.test.ts`, `tests/hologram-hit.test.ts`, `tests/hologram-timer.test.ts`
- `tests/server/duels-world.test.ts`
- `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`

## Architecture decisions

- Размер точки — свойство слоя, которое выбирает вызывающий код. Один `PointsMaterial.size` на все частицы снова смешал бы обычный фейерверк и залп дуэли.
- Взгляд при телепорте — одно событие `player_look`, а не поле каждого `player_state`. Клиент по-прежнему владеет обычным прицелом.
- `preserveTextAspect` серверное и общее. Имя голограммы в рендерере не проверяется. Высота плоскости не менялась: ширина стала `высота * (512/256)`.

## Tests

- `tests/firework-burst-colors.test.ts` — 3 passed. Ordinary layer stays 0.20 and 88 particles. Compact layer is 0.12, velocity 0.5, life 0.75, no sprite.
- `tests/duel-look.test.ts` — 1 passed. Cardinal and vertical directions round-trip through `viewDirectionFromLook`. Identical points keep the fallback.
- `tests/duel-start-look-client.test.ts` — 1 passed. Parsed `player_look` updates input, the local player, sampled aim, and the next predicted command. Mouse delta and a touch swipe still turn away.
- `tests/duel-effect-protocol.test.ts` — 2 passed, including finite `player_look` and rejection of a bad reason or non-finite angles.
- `tests/hologram-style.test.ts` — 10 passed. Missing `preserveTextAspect` stays false. At size 2.8, height stays 2.156 and natural width is 4.312.
- `tests/hologram-transient.test.ts` — 1 passed. Countdown with `preserveTextAspect: true` is absent from persisted records.
- `tests/hologram-hit.test.ts` — 4 passed. Non-interactive countdown still does not capture use.
- `tests/hologram-timer.test.ts` — 10 passed.
- `tests/local-player-prediction.test.ts` — 34 passed.
- `tests/server/duels-service.test.ts` — 22 passed.
- `tests/server/duels-world.test.ts` — 14 passed, including one look packet per participant matching the server controller.
- `npm run typecheck:client`, `npm run typecheck:server`, `npm run check:boundaries`, `npm run build`, `git diff --check` — PASS.
- `npx vitest run` — 3164 passed, 22 failed, 1 skipped, 340 files. The 22 failures match the previously recorded pre-existing set: arrow panel UVs, classic combat presentation (2), fence jump, production MP3 count (2), remote breaking overlays (13), pet hit registration (2), bow draw FIFO. An earlier parallel run also failed `tests/server/auto-mine.test.ts` delete-restore and `tests/server/anarchy-gameplay.test.ts` skeleton-arrow; both passed when rerun alone, and neither failed in the final full run. No duel, firework, hologram, or look test failed. Local Vitest, not GitHub CI.

## Visual QA

Не выполнялась в этом проходе. Чеклист для DEV:

Частицы

1. Начать дуэль.
2. Посмотреть залп старта боя.
3. Те же 88 частиц и та же палитра.
4. Тот же компактный разлёт.
5. Та же укороченная жизнь.
6. Отдельные квадраты явно меньше, чем на текущем DEV.
7. Обычная фейерверочная ракета по-прежнему со старым размером точек.

Взгляд

1. Перед принятием игрок A смотрит на 90° в сторону.
2. Игрок B смотрит в другую сторону.
3. Принять дуэль.
4. После телепорта обе камеры сразу смотрят друг на друга.
5. Старое направление не должно мелькать, если этого можно избежать.
6. Сразу подвигать мышь.
7. Камера крутится свободно и не зафиксирована.
8. Повторить, поменяв местами вызывающего и принимающего.
9. Повторить от третьего лица, если оно доступно, и проверить, что ориентация согласована.

Текст

1. Вертикальный размер отсчёта остаётся 2.8.
2. `3`, `2`, `1` больше не растянуты по горизонтали.
3. Шрифт остаётся Press Start 2P.
4. `БОЙ!` имеет те же пропорции.
5. Billboard стабилен при движении камеры.
6. ПКМ сквозь отсчёт по-прежнему работает.
7. Фонового прямоугольника нет.

## Performance

Два небольших буфера частиц вместо одного. Компактный слой вмещает один залп из 88 точек. Отдельного цикла рендера нет.

## Known issues

`public/ui/menu/icon_duels.png` по-прежнему отсутствует. Ручная проверка двух клиентов в этом проходе не делалась.

## Deferred

Слияние PR #122. Иконка дуэлей. Браузерная проверка чеклиста выше.

## Next work

Ждать DEV-проверку залпа, взгляда и пропорций текста. Не менять правила вызова и Creative.

## Git

Ветка `cursor/duels-plugin-arena-1v1-6694`. Не смержено. Draft PR **#122**.
