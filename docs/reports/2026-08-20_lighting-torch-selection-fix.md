# Goal

Исправить три связанные визуальные проблемы playable alpha без новых renderer/lighting engine и без PointLight на факел:

1. pitch-black нижние грани блоков в пещерах даже рядом с факелом;
2. слабый/холодный свет факела и перевёрнутая ориентация wall torch;
3. selection outline как полный `1×1×1` cube на special geometry.

# Result

Root cause нижней грани — **двойное освещение**: mesher уже писал light в vertex color, затем `MeshLambertMaterial` умножал Lambert `N·L` по геометрической нормали `(0,-1,0)` и занулял face. Wall torch наклонял пламя **в** стену из-за знака tilt. Outline всегда был EdgesGeometry куба.

Сейчас terrain lighting считается в shader из раздельных sky/block attributes, torch visually теплее и ярче при том же flood radius 14, wall torch крепится основанием, selection берёт oriented boxes из той же special geometry.

`npm run check` green: 20 files / 117 tests, Vite 72 modules, 0.92 MiB / 165 files.

# Implemented

- Chunk materials переведены на `MeshBasicMaterial` + `onBeforeCompile` (`createWorldChunkMaterial`). Scene hemisphere/directional sun больше не освещают voxel terrain; они остаются для мобов/предметов.
- Mesher пишет `skyLight`, `blockLight`, `faceShade`, `emissionLight` и biome tint. Shader: `max(skyTerm * daylight, torchWarm * block, emission) * shade`.
- Torch contribution `(1.0, 0.68, 0.28) * 1.35` — теплее и ярче; sky/daylight нейтральные. Flood emission факела по-прежнему 14.
- `uDaylight` обновляется каждый RAF из существующего `daylightFactor` — ночной sky гасится без remesh, block light нет.
- Wall torch tilt `-0.38`: основание к стене, пламя наружу и вверх для north/south/east/west. Floor torch без изменений. Ceiling по-прежнему запрещён.
- `selectionBoxesForBlock` / `createSelectionGeometry` расширяют существующий `WorldRenderer.selection`. Voxel raycast не менялся.

# Changed files

- `src/rendering/worldLighting.ts` — NEW
- `src/rendering/specialBlockGeometry.ts` — NEW
- `src/rendering/ChunkMesher.ts`
- `src/rendering/WorldRenderer.ts`
- `src/core/Game.ts`
- `src/dev/VegetationQaHarness.ts`
- `vite.config.ts` — exclude nested `mine123/` from vitest
- `tests/lighting-torch-selection.test.ts` — NEW
- `tests/vegetation-lighting.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/TESTING.md`
- `docs/reports/2026-08-20_lighting-torch-selection-fix.md` — this file

# Architecture decisions

- Не RGB lightmap и не PointLight. Scalar `blockLight` 0–15 остаётся каноническим; цвет применяется только при compose в shader.
- Не MeshLambert с «подкрученным ambient»: это маскировало бы N·L, а не убирало его.
- Selection — oriented AABBs по уже существующим размерам special meshes, не второй triangle picker и не per-frame geometry alloc (cache by shape key).
- Shared `torchLocalMatrix` используется и mesher, и outline, чтобы ориентация не разъехалась.

# Tests

`tests/lighting-torch-selection.test.ts` (9): torch flood, lit bottoms, dark cave floor, warm vs sky tint, 4 wall facings + floor, selection boxes, shape keys, WorldRenderer outline.

Vegetation tests обновлены: vertex `color` теперь tint, итоговый свет через `composeWorldLight`.

Полный suite: **117/117**.

# Visual QA

Headless Chrome в этой среде есть, но нет сценария, который сам строит закрытую комнату, ставит wall torch и делает screenshot от первого лица без ручного UI. In-game сцены A–D нужно пройти на localhost.

Автоматически проверено: lighting math, bottom-face vertex light с факелом, тёмный unlit cave, endpoints wall torch, bounding box outline тоньше cube.

# Performance

- Нет PointLight, нет extra draw calls на факел.
- Те же 5 world materials / chunk meshes; плюс 4 float attributes на vertex (дешёвые).
- Selection geometry кэшируется; не пересоздаётся каждый frame и не dirty-ит chunks.
- Explosion/meshing budgets не трогались.

# Known limitations

- Face shade bottoms всё ещё `0.5` (Minecraft-like); это затемнение, не pitch-black.
- Нет colored lights кроме warm compose для всего block light (lava тоже чуть теплее).
- Outline — oriented boxes, не точные crossed-plane edges факела.
- Voxel raycast по-прежнему целится в клетку, не в тонкий mesh.
- Ceiling torch не добавлялся.

# Deferred

- Per-vertex AO.
- Exact vanilla torch model cuboids.
- Mesh-accurate targeting.

# Next recommended work

Пройти Creative сцены A–D локально (комната без/с факелом, 4 wall torch, outline). Затем P0 save/Yandex, не новый lighting engine.

# Git

Ветка: `cursor/lighting-torch-selection-fix-935a`  
Commit/push **не делались** по явной просьбе пользователя.
