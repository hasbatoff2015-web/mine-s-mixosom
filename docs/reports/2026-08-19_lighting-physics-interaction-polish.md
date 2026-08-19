# Lighting, physics and interaction polish

Date: 2026-08-19  
Project: Frontier Cubes `0.1.0`

## Goal

Один цельный polish pass поверх текущей playable alpha: объёмное солнце и локальный block light, 1-block mob step-up, Shift/C controls, 1.9 mining times, falling-block entities, gravity primed TNT, non-cube torch/button/door и исправление регрессии zombie.

## Result

Все десять пунктов подключены к существующим системам (`ChunkMesher`, `VoxelWorld`, `RedstoneSystem`, `moveVoxelBody`, block registry). Vitest: 95/95. Production check выполняется в том же проходе.

## Lighting design

Не делался полный vanilla light engine и не использовался fullscreen tint.

- Vertex colors mesher читают sky/block light соседней ячейки face.
- Формула: `max(0.16 + sky×0.72, 0.18 + block×0.95, emission)` × face shade.
- Three.js hemisphere + directional sun усилены для дневного объёма и не уводят ночь в чёрный кадр (`ambient ≈ 0.14+0.32×daylight`, `sun ≈ 0.18+1.55×daylight`).
- Солнце следует за sun mesh.

## Block light / sunlight approach

- Per-chunk `Uint8Array` skyLight и blockLight, тот же layout что blocks (`16×80×16`).
- Sky: column fill сверху + до 6 горизонтальных проходов.
- Block: BFS от emissive (torch 14, redstone torch 7, lava 15), cap 8192 узлов.
- `relightAround` ограничен радиусом источника. Смена emission не пересчитывает sky; смена occlusion пересчитывает sky только у загруженных чанков в радиусе.
- Sampling света не вызывает `getChunk` ensure-path, чтобы не зациклить sky compute.

## Mob step-up fix

`moveVoxelBody` получил `stepHeight`. Мобы вызывают его с `1.05`. Если горизонтальный ход упирается в 1-block стену, тело поднимается, проходит вперёд и садится на ступень. Wander не разворачивается, если шаг удался. Pathfinder не добавлялся.

## Control remap

Desktop: sprint = `ShiftLeft/ShiftRight`, sneak = `KeyC`. Touch buttons без изменений. Controls UI и README обновлены.

## Mining speed rebalance

`src/blocks/mining.ts` считает Java 1.9 формулу. `canHarvest` больше не требует preferred tool: `/100` только у `drop.requiresCorrectTool` (камень, руды, furnace). Примеры: log рукой 3 s, log wooden axe 1.5 s, stone рукой 7.5 s, wooden/stone/iron pick по stone 1.15 / 0.6 / 0.4 s.

## Falling blocks

Sand/gravel при потере опоры удаляются из сетки и становятся `FallingBlockManager` entity с block mesh, gravity `-32` и voxel collision. При земле блок возвращается в world. Save schema 1 опционально хранит `fallingBlocks`.

## Primed TNT gravity

`PrimedTnt` — feet-anchored entity с fuse, gravity и `moveVoxelBody`. Visual на `y+0.49` интерполируется. Начальный импульс `vy=4`, если velocity не задан. Fuse и explosion pipeline прежние.

## Torch/button geometry and placement

- Torch: crossed planes, floor или wall (потолок запрещён), wall tilt.
- Button: малый cuboid, floor/wall/ceiling как Java 1.8/1.9 stone button.
- Held torch/button/door идут в `generated` item category, не cube.
- Redstone press/pulse не ломался.

## Door implementation

Oak door: `renderShape: 'door'`, панель `3/16`, два блока upper/lower, facing от yaw игрока, use открывает/закрывает обе половины, collision следует occupied face. Hinge advanced pairing не делался: default left hinge.

## Zombie fix

Причина: left arm/leg брали пустые 64×64 player UV `[32,48]`/`[16,48]`; attack/idle брали Minecraft `-1.2` напрямую в Three.js (рука назад). Исправление: mirrored classic UV `[40,16]`/`[0,16]` и Three pose `+1.2` / `+1.55`. Остальные мобы не трогались.

## Tests

- `tests/mining.test.ts`
- `tests/lighting-physics-interaction.test.ts`
- zombie UV assertion в `tests/visual-models.test.ts`
- 95 tests / 17 files green

## Visual QA

Headless Chrome `127.0.0.1:4173` после `virtual-time-budget`:

- `?qaMob=zombie&view=front|side|three-quarter`: обе ноги на месте, обе руки впереди, headwear цел.
- `?qaItem=torch`: thin torch, не cube; held/generated silhouette отдельно от стоящей модели.
- `?qaItem=oak_door`: item QA всё ещё показывает block-style preview куба (held category `generated`); world door — thin mesher geometry, подтверждена unit test’ом cutout faces/collision.
- `?qaItem=stone_button`: non-cube item preview.

In-game lighting/step-up/door placement/TNT fall закрыты кодом + unit tests; полный click-through survival session в этом проходе ограничен отсутствием IDE browser MCP. Dev server: `npm run dev` → `http://localhost:4173`.

## Performance impact

- +2 `Uint8Array` на chunk (компактно).
- Torch place не делает full-chunk sky rebuild.
- Occlusion change всё ещё пересчитывает sky загруженных чанков в радиусе 8–15; это bounded, не full-world.
- Meshing по-прежнему budgeted dirty rebuild.

## Known limitations

- Sky light в vertex colors не пересобирается каждый dusk; ночной контраст факела на открытом воздухе слабее, чем в пещере.
- Горизонтальный sky spread — 6 проходов, не vanilla flood.
- Door hinge/double-door pairing упрощены.
- Falling sand не ломает non-replaceable blocks вроде torch при посадке.
- Нет colored lights, lightmaps, greedy meshing lights или worker lighting.

## Next recommended work

1. Dedicated sky/block vertex channels + uniform daylight, чтобы ночные факелы на поверхности были ярче без remesh.
2. Column-local sky dirty instead of whole-chunk sky recompute on occlusion.
3. Ladder climbing, slab/stair meshes, double-door hinge.
4. Bounded voxel pathfinding после подтверждения 1-block step-up в длинных сессиях.
5. Falling-block drops when landing on a non-replaceable block.
