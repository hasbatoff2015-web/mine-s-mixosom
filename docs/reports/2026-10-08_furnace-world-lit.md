# World-space горение печи

База: `cursor/furnace-crafting-drops-ed70` @ `f24f3ed`. Не закоммичено и не запушено.

## Что было

`furnace_sync` уходит только игрокам с открытым GUI и несёт слоты вместе с таймерами. `tickFurnaces` после смены `burnTime` вызывал только серверный `syncFurnaceEmission`. Клиент без GUI не получал lit-бит, поэтому `ChunkMesher` оставлял `furnace_front`.

## Data flow

`tickFurnaces` / слом горящей печи / `restoreSnapshot`  
→ `VoxelWorld.syncFurnaceBurnBit` (тот же `syncFurnaceEmission`, если блок всё ещё печь)  
→ `onFurnaceLitChanged`  
→ `WorldInstance.flushFurnaceLit` → `furnace_lit` всем подключённым  
→ `Game` `applyFurnaceLit` пишет прокси `burnTime` 1 или 0, без тика  
→ `isFurnaceBurning` → `ChunkMesher.cubeFaceTextureKey` → `furnace_front_on` / `furnace_front` и свет.

Вход: `AnarchyServer` кладёт `networkFurnaceLit()` в `welcome.furnacesLit`, `startOnlineAnarchy` восстанавливает его через `furnaceRecordsFromLit`.

Загрузка столбца: `chunk_data.furnacesLit` заменяет lit-бит этого чанка. Пустой набор гасит старый `burnTime`.

`furnace_sync` остаётся GUI. Если он сам пересёк ноль, клиент тоже вызывает `syncFurnaceBurnBit`, чтобы таймер интерфейса не оставлял меш без света. Слоты в world-space пакет не входят.

## Проверено

- `tsc` (root, sim, client, server), import boundaries.
- `tests/furnace-lit-network.test.ts` 7/7: idle→burning→idle, late join mesh, reload while burning, reload after stop, stale replace, два клиента без GUI, late joiner `chunk_data`, слом горящей печи.
- `furnace-orientation-lit` 5/5, `furnace-crafting-drops` 16/16, `furnace-sync` 3/3, `lighting-seams` 56, `world-events` 33, `world-state` 3.

Браузер с двумя клиентами не запускался.
