# Урон hostile mobs, fuse крипера в multiplayer, зелёные иконки листвы

Дата: 2026-10-06.

## Goal

Снизить урон и частоту атак hostile mobs, показать уже существующую singleplayer-анимацию крипера в multiplayer и покрасить inventory-иконки листвы и верха дёрна тем же biome tint, что и мир.

## Result

Zombie, skeleton и spider бьют вдвое слабее и в 1.5 раза реже. Creeper, волк и пассивные мобы не изменены. В сети `fuseSeconds` крипера доходит до `ThreeEntityHost.syncMob` через существующее поле `EntitySnapshot.fuse`. Иконки oak/birch/spruce leaves зелёные, верх grass block зелёный, бока и низ дёрна и обычные блоки без этого tint.

## Implemented

- `MOB_DEFINITIONS`: zombie `attackDamage` 1.5 и `attackCooldownSeconds` 1.5; skeleton 2 и 2.4; spider 1 и 1.35. Creeper остаётся `attackDamage` 0 и cooldown 1. Длительность fuse 1.5 с и взрыв не менялись.
- Melee и выстрел скелета по-прежнему читают `definition.attackDamage` / `definition.attackCooldownSeconds`.
- `snapshotsNear` для `kind === 'creeper'` пишет `fuse: mob.fuseSeconds`, в том числе 0. Другие мобы поле не получают.
- `applyEntitySnapshots` для creeper ставит `mob.fuseSeconds` из `snap.fuse`. Отсутствующее или нечисловое значение становится 0, поэтому спад fuse не залипает.
- `creeperFuseVisualScale` — прежняя формула из `syncMob`: `clamp(fuseSeconds / 1.5)`, высота `1 + progress * 0.08`, горизонтальный pulse.
- `vegetationTextureTint` — общая проверка `biomeTint === 'grass'`, `grass_block_top` и `leaves`. `ChunkMesher.tintFor` вызывает её. Инвентарь без биома использует plains, biome 0: `[0.54, 0.9, 0.42]`.
- `ItemVisualFactory.blockGeometry` пишет этот tint в vertex color только если хотя бы одна грань не белая. Бок и низ дёрна остаются `[1, 1, 1]`.
- Material cache: обычные блоки остаются на ключе `renderLayer`. Vegetation cube получает `${renderLayer}:vegetation-tint` и `vertexColors`, без смены `material.color`.
- `prepareSpecialIconPreview` умножает уже записанный vertex color на GUI shade. У блока без color attribute shade по-прежнему серый, как раньше.

## Changed files

- `src/entities/mobDefinitions.ts`
- `src/entities/ThreeEntityHost.ts`
- `src/net/applyEntitySnapshots.ts`
- `server/gameplay.ts`
- `src/rendering/vegetationTint.ts`
- `src/rendering/ChunkMesher.ts`
- `src/rendering/ItemVisualFactory.ts`
- `src/rendering/itemIconPreview.ts`
- `tests/hostile-mob-balance.test.ts`
- `tests/creeper-fuse-network.test.ts`
- `tests/inventory-vegetation-tint.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`

## Architecture decisions

- Новый cooldown не заводился. Skeleton shot interval — тот же `attackCooldownSeconds`.
- Анимация крипера не дублируется на сервере. Сервер передаёт секунды fuse, клиент только копирует их в поле, которое `syncMob` уже читает.
- `EntitySnapshot.fuse` переиспользован. У primed TNT это секунды, у TNT minecart — тики, у крипера — секунды `fuseSeconds`. Протокол не расширялся.
- Tint не кладётся в `material.color`: один material на слой раскрасил бы все блоки слоя. Цвет — per-geometry, material vegetation — отдельная запись cache.
- Иконка не имеет biome column, поэтому берётся plains, тот же default, что `biomeGrassTint` для неизвестного кода биома.

## Tests

- `tests/hostile-mob-balance.test.ts` — числа определений; zombie 1.5 урона и пауза 1.5 с; skeleton два выстрела с паузой 2.4 с; spider 1 урон и пауза 1.35 с.
- `tests/creeper-fuse-network.test.ts` — серверный snapshot `fuse`, клиентский `MobEntity.fuseSeconds`, scale `creeperFuseVisualScale` на 0.75, 1.2 и 0; пропуск поля сбрасывает fuse; zombie fuse не получает.
- `tests/inventory-vegetation-tint.test.ts` — plains tint на листьях и верхе дёрна; бок/низ и stone/dirt без tint; раздельные materials при любом порядке создания; GUI preview умножает tint на shade.

`npx tsc --noEmit` — PASS.

Точечно PASS: `tests/hostile-mob-balance.test.ts`, `tests/creeper-fuse-network.test.ts`, `tests/inventory-vegetation-tint.test.ts`, плюс соседние `entities`, `item-rendering`, `vegetation-lighting`, `icon-scroll-fixes`.

Полный `npm test` — в этом же проходе, результат дописывается после прогона.

## Visual QA

Иконки проверяются по vertex color после `prepareSpecialIconPreview`, то есть по тому буферу, который рисует inventory bake. Отдельный WebGL screenshot хотбара в этом проходе не снимался.

## Performance

Новых систем, мешей и проходов по чанкам нет. На vegetation block item добавляется один color attribute и один дополнительный material на render layer.

## Known issues

Между snapshot'ами клиент не докручивает fuse локально: шкала следует последнему авторитетному значению. Это тот же `syncMob`, без клиентской симуляции.

## Deferred

Плавная интерполяция fuse между пакетами. Отдельные biome tint для иконок леса, пустыни и снега.

## Next work

Нет. Взрыв крипера и длина fuse остаются прежними.

## Git

Ветка `cursor/hostile-balance-fuse-inventory-tint-c2dc`.
