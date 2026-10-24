# Донат-питомцы — 2026-10-22

## Goal

Слить актуальный `origin/main` в `cursor/donation-ranks-fb58` и закрыть `/spawnpet` правами BOSS, TITAN и OP. Во вкладке «Донат» нужна карточка «Питомцы», которая вызывает тот же серверный обработчик.

## Result

`origin/main` `d3491a6` влит обычным merge `23ef2c5`. Пчёлка (`bee` → `pet_bee`) доступна с узла `pet.bee` (BOSS и выше). Мини-крипер (`creeper` → `pet_creeper`) доступен с узла `pet.creeper` (TITAN). OP проходит `PermissionService.has` до чтения донат-узлов. Обычный игрок, VIP и PREMIUM не призывают ни один из двух видов. `/spawnpet off` по-прежнему снимает выбор. Волк и кот этой командой не создаются.

## Implemented

- Узлы `pet.bee` и `pet.creeper` добавлены к BOSS и TITAN. Административные узлы не выдаются.
- `/spawnpet` и алиас `petspawn` имеют право `player`. Проверка вида стоит в `setCosmeticPet`. `ensureCosmeticPet` и `snapCosmeticPet` используют ту же проверку, поэтому прямой вызов и повторный вход не обходят ранг.
- Потеря ранга или OP снимает живую сущность на следующем игровом тике. Сохранённый `cosmeticPet` остаётся и возвращает питомца, когда право снова есть.
- Карточка «Питомцы» открывает `donate-pets`. Кнопка читает живую сущность: «Призвать …» или «Отозвать …». Повторное нажатие вызывает `/spawnpet off` только если этот вид действительно рядом. Экран остаётся открытым.
- Существующий потолок `COSMETIC_PET_WORLD_CAP` (64) сохранён. При отказе спавна из-за него игрок видит «На сервере уже максимум декоративных питомцев.»

## Changed files

- `shared/donationRanks.ts`, `shared/playerText.ts`, `shared/protocol.ts`, `shared/gameMenu.ts`
- `server/WorldInstance.ts`, `server/services/donationRanks.ts`, `server/services/donateMenuView.ts`, `server/services/gameMenu.ts`, `server/services/gameMenuActions.ts`
- `src/ui/donateMenuGui.ts`, `src/ui/GameUI.ts`, `src/entities/cosmeticPets.ts`
- `tests/server/spawnpet-command.test.ts`, `tests/server/donation-ranks.test.ts`, `tests/game-menu-gui.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/TESTING.md`

## Architecture decisions

Визуал, полёт и синхронизация питомцев не переписывались. Право не вынесено в отдельную команду. Меню не спавнит сущность само: оно вызывает существующий `/spawnpet`.

## Tests

`tests/server/spawnpet-command.test.ts` покрывает default, VIP, PREMIUM, BOSS, TITAN, OP без ранга, OP вместе с VIP, истечение, `donate_pet` и неизвестный аргумент. `tests/game-menu-gui.test.ts` проверяет вложенный экран и вызов `donate_pet`.

## Visual QA

В этой среде браузерный проход 3D-питомца не выполнялся. Карточка использует уже существующие `.mc-donate-card` и `.mc-donate-grid`.

## Performance

Проверка права на каждом тике смотрит только подключённых игроков с сохранённым выбором и удаляет сущность, только если право уже пропало.

## Known issues

На чистом `origin/main` `d3491a6` падают те же четыре теста: God Sword тратит меч на мобе, два теста `entity_use` в `pet-hit-registration` (`tameProgress` становится 1), и лук FIFO в `player-actions` (`bowUseTicks` 2 вместо 1). Это не связано с правами питомцев.

## Deferred

Новые виды питомцев, отдельные кулдауны и оплата призыва не добавлялись.

## Next work

Проверить на DEV: BOSS призывает только пчёлку, TITAN и OP — оба вида, карточка «Питомцы» показывает отказ сервера и не закрывается.

## Git

Рабочая ветка `cursor/donation-ranks-fb58`. PR #131 не сливается в `main`. Production не обновляется.
