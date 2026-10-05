# Дуэли 1v1

Дата: 2026-10-05.

## Goal

Добавить сервер-авторитетные дуэли 1v1: плитка меню, приглашения, одна арена, отсчёт, изоляция боя, лут, статистика. Мегакоины за дуэль не меняются.

## Result

Клиент шлёт только `menu_action`. Сервер решает, можно ли вызвать, принять, нанести урон, подобрать лут и записать победу. Активный матч на диск не пишется. Статистика и две точки спавна переживают рестарт.

Файл `public/ui/menu/icon_duels.png` в дереве отсутствует. Плитка ссылается на этот путь. ASSET MISSING / NOT VISUALLY VERIFIED.

## Implemented

- `shared/duels.ts`: радиус 20, TTL 30 с, отказ 10 с, кулдаун после матча 3 с, бой 5 минут, лут 15 с, отсчёт 5 с. Глиф отсчёта — равные трети.
- `server/services/duels.ts`: фазы `idle`, `countdown`, `fighting`, `loot`, `timeout_cleanup`. Один исходящий вызов. Несколько входящих. `matchId` коммитит статистику один раз.
- `server/builtin-plugins/duels.ts`: `/duel`, `/duel setspawn 1|2`, `/duel info`. Право `duels.admin`, `server.admin` или оператор.
- Меню: девять плиток, три ряда `.mc-menu-grid-row-3-full`. `MC_MENU_WIDTH` 248. Высота корня 238. `menuLogicalHeight('duels')` 292.
- Уведомления: категория `duels`. Открытие экрана снимает бейдж и не удаляет вызов.
- Смерть использует `ServerGameplay.dropAllPlayerResources`. Обычная смерть вне дуэли идёт тем же helper и не дропает второй раз.
- Ручной `drop_selected` / `drop_cursor` во время отсчёта и боя отклоняется до изменения инвентаря.
- Телепорт: `TeleportService` и `RtpSessionManager` спрашивают `externalTeleportError`. Обход только `reason: 'duel'` и `hardRelocatePlayer({ bypass: 'duel' })`.
- Голограмма `duel-countdown` живёт в transient-карте `HologramNetwork`. `persist()` её не пишет.
- Economy пропускает `recordPvpKill` и `rewardPlayerKill`, пока `shouldSuppressNormalPvpSettlement` истинен для пары в фазе `fighting`.

## Changed files

- `shared/duels.ts`, `shared/gameMenu.ts`, `shared/notifications.ts`, `shared/protocol.ts`
- `server/services/duels.ts`, `server/services/holograms.ts`, `server/services/teleport.ts`, `server/services/rtp.ts`
- `server/services/gameMenu.ts`, `server/services/gameMenuActions.ts`, `server/services/notifications.ts`, `server/services/permissions.ts`
- `server/builtin-plugins/duels.ts`, `server/builtin-plugins/index.ts`, `server/builtin-plugins/context.ts`, `server/builtin-plugins/economy.ts`
- `server/WorldInstance.ts`, `server/gameplay.ts`
- `src/ui/gameMenuGui.ts`, `src/ui/containerTheme.ts`, `src/ui/GameUI.ts`, `src/style.css`
- `tests/server/duels-service.test.ts`, `tests/server/duels-world.test.ts`, `tests/hologram-transient.test.ts`
- `tests/game-menu-gui.test.ts`, `tests/server/game-menu.test.ts`, `tests/server/menu-notifications-auction-history.test.ts`
- `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`

## Architecture decisions

- Одна арена. Очереди нет. Вызов можно послать, пока арена занята. Принять можно только на свободной настроенной арене.
- Дистанция считает сервер: `dx² + dy² + dz² <= 20²`.
- Отсчёт 5 с от `startedAt`. Бой начинается в `startedAt + 5000`. Дедлайн — ещё 300000 мс. Текст голограммы меняется только при смене глифа.
- Дисконнект в `fighting` — поражение. Дисконнект в `countdown` и остановка плагина в `countdown`/`fighting` — отмена без статистики и без дропа. Оба возвращаются в сохранённую позу до persistence.
- Таймаут: оба `losses + 1`, побед нет, дроп нельзя подобрать, сущности удаляются через 15 с.
- Лут отслеживается только по id сущностей, которые вернул общий death-drop helper.
- Победитель в фазе `loot` заперт для внешнего телепорта. Проигравший уже на спавне и в lifecycle не входит; его держит 3-секундный кулдаун.
- Claim PvP не обходится. Пара проходит обычный combat path.
- Публичный Plugin API не получил методы инвентаря. `DuelRuntime` только у builtin context.

## Tests

- `npx vitest run tests/server/duels-service.test.ts tests/server/duels-world.test.ts tests/hologram-transient.test.ts tests/game-menu-gui.test.ts tests/server/game-menu.test.ts tests/server/menu-notifications-auction-history.test.ts` — PASS, 63 tests (service 14, world 9, hologram transient 1, menu GUI 11, server menu 11, notifications 17).
- `npm run typecheck:client` — PASS.
- `npm run typecheck:server` — PASS.
- `npm run check:boundaries` — PASS.
- `npm run build` — PASS.
- `git diff --check` — PASS.
- `npx vitest run` — 3141 passed, 23 failed, 1 skipped, 337 files. The same 23 failures reproduce on `origin/main` `c621d804a51004ecb53f214e8843b0022303dd27` in this environment: arrow panel UVs, classic combat presentation, fence jump, production MP3 count, remote breaking overlays, AutoMine delete, pet hit registration, bow draw FIFO.

## Visual QA

Браузерный проход не делался. Два клиента, живая голограмма и HUD баланса не проверялись. Иконка `icon_duels.png` отсутствует.

`menuUiScale` для 1920×1080, 1366×768 и 844×390 покрыт `tests/game-menu-gui.test.ts`.

## Performance

Отсчёт и дедлайны — абсолютные метки. Повтор таймера 100 мс плюс world tick. Голограмма не рассылается, пока текст тот же. Новый combat engine не добавлялся.

## Known issues

- `public/ui/menu/icon_duels.png` нет в репозитории.
- Постоянный hologram с именем `duel-countdown` не запрещён. Transient и persistent с одним именем могут отрисоваться вместе.
- `/tpahere` снаружи проверяет только того, кто перемещается. Участник дуэли не телепортируется, но посторонний может прийти на арену, если команда двигает его.
- Ручной дроп закрыт для `drop_selected` и `drop_cursor`. Другие пути выброса, если они появятся, этим gate не покрыты.

## Deferred

- Очередь арен.
- Ставки и награды Мегакоинами.
- Вторая арена и bounds/forcefield.
- Живой двухклиентный QA.

## Next work

Владелец кладёт `public/ui/menu/icon_duels.png` и ставит две точки `/duel setspawn` внутри claim с разрешённым PvP.

## Git

Ветка `cursor/duels-plugin-arena-1v1-6694` от `origin/main` `c621d804a51004ecb53f214e8843b0022303dd27`. Реализация — `cf07c0af59de3928ea51585aea45e7eea94540eb`. Draft PR https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/122. Не смержено.
