# Интеграция измерения «Ад»

## Goal

Закрыть дыры уже собранного Ада: измерение у взрывов и спавна мобов, базы кланов, портал в одиночной игре, перенос волка и кота. Не переписывать работающий Ад и не трогать обычный мир.

## Result

События взрыва и спавна несут измерение своего мира. База клана ставится в обоих измерениях и телепортирует туда же. Одиночный портал переключает локальный мир тем же трёхсекундным отсчётом. Волк и кот следуют за владельцем в обе стороны.

## Implemented

- `ExplosionEvent` и `MobSpawnEvent` получили `dimension`. Его пишет `ServerGameplay`, привязанный к одному миру. Приват и `loadRegularClaimVolumes` Ада фильтруют `worldId:nether`.
- `ClanBase.dimension` необязателен. Нет поля и обычный `worldId` — обычный мир. Установка разрешена в Аду. Телепорт передаёт измерение в `enterDimension`. Точка на алмазе сохраняется, если под ногами твёрдый блок и это не лава и не огонь. Иначе ищется безопасная точка в радиусе 10.
- Одиночная игра паркует неактивный `VoxelWorld` и его мобов, дроп, вагонетки, редстоун и падающие блоки. Портал и кнопка «Телепорт на спавн» в паузе используют общий `stepPortalChannel`. Смерть в Аду оставляет дроп в Аду и возвращает на обычный спавн. Снимок хранит карман в `nether`, версия схемы остаётся 1.
- Переносятся только `wolf` и `cat`. Косметические `pet_bee` и `pet_creeper` снимаются со старого менеджера и создаются рядом с владельцем.

## Changed files

- `server/events.ts`, `server/gameplay.ts`, `server/builtin-plugins/claims.ts`, `server/WorldInstance.ts`, `server/services/clan.ts`
- `src/world/dimension.ts`, `src/world/netherPortal.ts`, `src/core/Game.ts`, `src/ui/GameUI.ts`
- `src/save/types.ts`, `src/save/snapshot.ts`
- `src/entities/MobManager.ts`, `DroppedItemManager.ts`, `FallingBlockManager.ts`, `MinecartManager.ts`, `FireworkManager.ts`
- `src/farming/FarmingSystem.ts`, `src/redstone/RedstoneSystem.ts`, `src/combat/PlayerArrowManager.ts`
- Тесты: `tests/nether-dimension.test.ts`, `tests/world-snapshot.test.ts`, `tests/server/clan-base.test.ts`, `tests/server/nether-integration.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

Измерение события берётся у мира, который создал событие, а не у ближайшего игрока. Одиночный переход не заводит второй детектор портала: отсчёт общий, а привязка менеджеров к новому `VoxelWorld` локальна для `Game`.

## Tests

- `tsc --noEmit`, `tsc -p tsconfig.client.json`, `tsc -p tsconfig.server.json` — без ошибок.
- `npm run build` — клиент собран, `dist/assets/index-DH3eevIT.js` около 1.88 МБ.
- `tests/server` и `tests/fs-world-store.test.ts`: 1284 прошло, 81 пропущено. Повторный прогон чистый. Первый параллельный прогон один раз не уложился в лимит `tick-load-flight` (110 мс при пороге 80 мс) и после отдельного прогона прошёл.
- `tests/nether-dimension.test.ts`, `tests/world-snapshot.test.ts`, `tests/server/nether-integration.test.ts`, `tests/server/clan-base.test.ts`, `tests/worldgen-v3.test.ts` проходят.
- Клиентские падения, которые уже были до этой доводки, не ослаблялись. Разбор — в ответе задачи.

## Known issues

Одиночный Ад не тикает, пока игрок в обычном мире: цветы дозревают при возвращении, по настенным часам. Косметические питомцы не пишутся в сохранение мира ни в одном измерении. Обратный портал из Ада по-прежнему не строится автоматически: возврат — кнопка спавна.

## Deferred

Энд, новые виды питомцев, отдельные права клана на измерение.

## Next work

Ручная проверка двух клиентов по инструкции в ответе задачи.

## Git

Продолжение `cursor/nether-dimension-e754` от `5e4df4fa`. На GitHub не отправлялось.
