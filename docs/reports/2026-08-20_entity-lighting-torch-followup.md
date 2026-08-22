# Goal

Follow-up after lighting/torch/selection: по скриншотам исправить три оставшиеся проблемы без PointLight и без второй lighting pipeline:

1. wall torch визуально не крепится к боковой грани и выглядит тоньше outline;
2. мобы днём слишком тёмные, в пещере освещение ложится странно / частично;
3. в отверстиях/пещерах блоки обрываются в неестественно чёрные грани.

# Result

Wall torch стал cuboid stick с UV crop opaque региона `torch.png`: основание на стене, пламя наружу/вверх, размер совпадает с outline. Мобы и world entities берут тот же `composeWorldLight`, что и terrain, из трёх voxel samples. Cube faces усредняют 4 light samples на вершину.

`npm run check` green: 21 files / 123 tests.

# Implemented

- Torch geometry: cuboid `0.22 × 0.88` вместо crossed 16×16 planes. UV `[14/32, 0, 18/32, 20/32]` — только непрозрачные 4×20 px. Wall origin на supporting face + inset, half-width offset после tilt, `TORCH_WALL_TILT = -0.40`. Floor torch без наклона, base на полу. Outline использует тот же `torchLocalMatrix`.
- Entity lighting: `createEntityMaterial` (`MeshBasicMaterial` + wrap ≥ 0.76 × `uEntityLight`). `sampleEntityLight` усредняет feet/torso/head. `bindEntityLightReceiver` копирует RGB с root перед draw, материалы остаются shared. Подключено к mobs, drops, arrows, falling blocks, primed TNT.
- `MobManager.getApproximateLight` читает `combinedLight` вместо surface-height heuristic.
- Cube meshing: `smoothFaceCornerLight` — 4-tap average на вершину. Sky curve `sky^0.82`. Bottom face shade `0.58` вместо `0.5`. Unlit cave без global ambient floor.

# Changed files

- `src/rendering/specialBlockGeometry.ts`
- `src/rendering/ChunkMesher.ts`
- `src/rendering/worldLighting.ts`
- `src/rendering/ItemVisualFactory.ts`
- `src/rendering/ArrowVisualFactory.ts`
- `src/world/LightEngine.ts`
- `src/entities/voxelVisuals.ts`
- `src/entities/MobManager.ts`
- `src/entities/DroppedItemManager.ts`
- `src/entities/FallingBlockManager.ts`
- `src/combat/PlayerArrowManager.ts`
- `src/redstone/RedstoneSystem.ts`
- `tests/lighting-torch-selection.test.ts`
- `tests/entity-lighting.test.ts` — NEW
- `tests/entities.test.ts`, `tests/item-rendering.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/TESTING.md`
- `docs/reports/2026-08-20_entity-lighting-torch-followup.md` — this file

# Architecture decisions

- Не PointLight и не второй lightmap. Scalar sky/block 0–15 остаётся каноном; цвет только в compose.
- Entity materials — тот же Basic+shader подход, что у chunks: Lambert N·L снова занулял бы стороны модели.
- Shared materials + `onBeforeRender` uniform, не clone-per-mob.
- Smooth lighting только на cube terrain faces (4 lookups / vertex). Specials остаются одним sample.
- First-person viewmodel не семплирует world light: нет `entityLight` на root → identity.

# Tests

- Wall torch: four facings, base distance to wall < `0.75 * TORCH_WIDTH`, floor upright, cuboid bounds, outline matches size.
- Entity: daylight luminance > 0.7, unlit cave < 0.2, torch warm R>B, multi-sample between feet and head.
- Terrain: previous torch-bottom / dark-cave / vegetation tests; hole walls stay lit.

Полный suite: **123/123**.

# Visual QA

Headless Chrome не строит first-person cave/torch/mob screenshot без ручного UI. Сцены A–D нужно пройти локально.

Автоматически: torch endpoints vs wall, cuboid AABB, compose math, entity samples, hole-wall sky > 0.4.

# Performance

- Нет PointLight, нет per-pixel lighting, нет shadow map в игре.
- Entity light: 3 integer lookups × число мобов на 20 TPS; neighbor fallback только если cell unlit.
- Smooth lighting: +3 extra chunk-array reads на cube vertex во время budgeted mesh rebuild, не каждый кадр.
- Shared entity materials, без clone.

# Known limitations

- Outline — oriented box, не pixel-perfect torch mesh edges.
- Voxel raycast по-прежнему клетка, не тонкий cuboid.
- Wrap-shade — один world-space vector, не vanilla AO.
- Lava и torch делят один тёплый block-light tint.
- Ceiling torch по-прежнему запрещён.

# Deferred

- Exact vanilla torch cuboid pixels / rotation origin.
- Full Minecraft smooth lighting + AO.
- Mesh-accurate targeting.

# Next recommended work

Локально пройти Creative: 4 wall torch, daylight sheep/cow/chicken, cave skeleton у факела, смотреть вниз в яму. Затем P0 save/Yandex.

# Git

Ветка: `cursor/lighting-torch-selection-fix-935a`
