# Дуэли: крупный отсчёт и залп

Дата: 2026-10-06.

Позже, 2026-10-07: размер отсчёта стал 2.8, постматчевый кулдаун убран, меню обновляется после перехода в `idle`. См. `docs/reports/2026-10-07_duels-rematch-menu.md`.

## Goal

Сделать цифры отсчёта крупнее и пиксельным шрифтом, не перехватывая ПКМ. В момент начала боя показать залп частиц без ракеты. Убрать двойное владение жизненным циклом и закрыть дыры урона и лута.

## Result

Отсчёт остаётся 5000 мс и третями `3` → `2` → `1` → `БОЙ!`. Запись `duel-countdown` идёт шрифтом `display`, стилем `normal`, размером 3.2, без фона, billboard, `interactive: false`. `HOLOGRAM_SIZE_MAX` равен 3.2. Размер по умолчанию остаётся 1. Сохранённые голограммы не переписываются.

Переход в `fighting` один раз шлёт `duel_effect` / `fight_start_burst`. Точка — середина арены голограммы плюс 0.75 по Y. Участники получают всегда. Остальные — если ближе 48 блоков. Клиент вызывает `FireworkVisuals.spawnBurst` со `velocityScale` 0.5 и `lifeScale` 0.75. Сущности ракеты, спрайта и следа нет.

Тик, `playerDamage`, `itemPickup` и выход игрока остаются на `WorldInstance`. Плагин владеет командами и `enable` / `disable`. Выключение отменяет активный отсчёт или бой и запрещает новый матч текстом «Дуэли временно недоступны.»

## Implemented

- `DUEL_COUNTDOWN_HOLOGRAM_SIZE = 3.2`. `WorldInstance.setDuelCountdownHologram` ставит `font: 'display'`, `style: 'normal'`, `interactive: false`.
- `HologramRecord` / `NetworkHologram` несут `interactive`. Нет поля или не `false` — интерактивно. `pickHologramRayHit` пропускает `interactive === false`. Редактор поле не принимает.
- `FireworkVisuals.spawnBurst(x, y, z, options?)`. По умолчанию `velocityScale` 1 и `lifeScale` 1. Обычный `sync` со `state: 'burst'` вызывает тот же метод. Формулы: скорость `(2.6 + (i % 4) * 0.18) * velocityScale`, жизнь `(1.1 + (i % 3) * 0.13) * lifeScale`. 88 частиц, те же цвета.
- `DuelService.enterFighting` вызывает `emitFightStartBurst` один раз. `duelStartBurstPosition` = `duelHologramPosition` + `DUEL_START_BURST_Y_OFFSET` 0.75.
- `disable()` делает `shutdown()` и ставит `enabled = false`. Меню получает `duelAvailable`.
- `shouldCancelPlayerDamage` принимает `cause`. В бою без атакующего отменяются только `melee`, `arrow`, `projectile`. В `loot` отменяется любой входящий урон победителю и его собственная атака. `suppressesIncomingDamage` закрывает огонь/окружение и взрыв.
- `committed` удаляется после перехода в `idle`. Просроченные `rejectUntil` и `cooldownUntil` чистятся. `shutdown` чистит приглашения и кулдауны, статистику и арену не трогает.

## Changed files

- `shared/duels.ts`, `shared/hologramStyle.ts`, `shared/protocol.ts`
- `server/services/duels.ts`, `server/services/holograms.ts`, `server/builtin-plugins/duels.ts`
- `server/WorldInstance.ts`, `server/gameplay.ts`
- `src/core/Game.ts`, `src/gameplay/hologramHit.ts`, `src/rendering/FireworkVisuals.ts`
- `src/survival/SurvivalSystem.ts`, `src/ui/gameMenuGui.ts`
- `tests/server/duels-service.test.ts`, `tests/server/duels-world.test.ts`
- `tests/hologram-hit.test.ts`, `tests/hologram-style.test.ts`, `tests/hologram-transient.test.ts`
- `tests/firework-burst-colors.test.ts`, `tests/duel-effect-protocol.test.ts`, `tests/game-menu-gui.test.ts`
- `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`

## Architecture decisions

- Максимум размера голограммы общий, а не исключение по имени `duel-countdown`.
- `interactive` не выведен в редактор. Это серверное свойство записи.
- Залп не создаёт `FireworkEntity` и не проходит `FireworkManager`.
- Радиус зрителей совпадает с `DUEL_HOLOGRAM_RANGE`.
- Низкоуровневые хуки остаются на `WorldInstance`, потому что урон, подбор и тик не должны зависеть от порядка плагинов. Плагин только включает и выключает сервис.
- Падение в бою не считается вмешательством моба. Отменяются только боевые причины без игрока-атакующего.

## Tests

- `npx vitest run tests/server/duels-service.test.ts tests/hologram-hit.test.ts tests/hologram-style.test.ts tests/hologram-transient.test.ts tests/firework-burst-colors.test.ts tests/duel-effect-protocol.test.ts tests/game-menu-gui.test.ts` — 46 passed.
- `npx vitest run tests/server/duels-world.test.ts` — 11 passed.
- `npm run typecheck:client` — PASS.
- `npm run typecheck:server` — PASS.
- `npm run check:boundaries` — PASS.
- `npm run build` — PASS.
- `git diff --check` — PASS.
- `npx vitest run` — 3152 passed, 22 failed, 1 skipped, 338 files. The 22 failures are the same names previously recorded on `origin/main` `c621d804a51004ecb53f214e8843b0022303dd27`, except `tests/server` auto-mine which passed in this run: arrow panel UVs, classic combat presentation (2), fence jump, production MP3 count (2), remote breaking overlays (13), pet hit registration (2), bow draw FIFO. No duel, hologram, firework, or protocol test failed. This is local Vitest, not GitHub CI. `git fetch` could not resolve `github.com` in this environment, so `origin/main` was not re-checked live.

## Visual QA

Два клиента и зритель в браузере этим проходом не запускались. Чеклист для DEV остаётся ручным.

## Performance

Один залп — 88 частиц в уже существующем `Points` / `PointsMaterial` и буфере на 512. Новый render loop, материал и сущность не добавлялись. Текст голограммы по-прежнему меняется только при смене глифа.

## Known issues

- `public/ui/menu/icon_duels.png` нет в репозитории.
- Постоянный hologram с именем `duel-countdown` не запрещён.
- `/tpahere` снаружи по-прежнему может привести постороннего на арену.
- Живой двухклиентный QA не сделан.

## Deferred

- Очередь арен, ставки, вторая арена.
- Визуальная проверка шрифта и плотности залпа на DEV.

## Next work

Владелец кладёт иконку, ставит точки арены в claim с PvP и проходит чеклист двух клиентов.

## Git

Ветка `cursor/duels-plugin-arena-1v1-6694`. Draft PR **#122**. Не смержено.
