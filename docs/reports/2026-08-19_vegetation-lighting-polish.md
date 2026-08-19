# Vegetation lighting polish

Date: 2026-08-19  
Project: Frontier Cubes `0.1.0`

## Problem

После sunlight/block-light pass земля выглядела светлой и ровной, а tall grass / fern / flowers — тёмными вырезанными силуэтами. Деревья, листья и кактусы оставались читаемыми. Pixel-art atlas и cutout не менялись: ломалось только освещение тонких cross-plane растений относительно grass top.

## Root Cause

Vertex color уже брал sky/block light сверху (`normal (0,1,0)`, shade `1`) и grass tint для tall grass/fern. Затем `MeshLambertMaterial` снова считал `N·L` по **геометрическим** нормалям диагональных плоскостей (`±0.707, 0, ±0.707`).

Cutout material общий с leaves и стоит в `DoubleSide`. Three.js переворачивает нормаль на back faces → `(0,-1,0)` относительно lighting normal, hemisphere берёт тёмный ground color, directional sun даёт ~0. Итог: одна сторона плоскости почти чёрная, вторая тоже темнее grass top. Камера, заходящая на «зад» растения, меняла яркость.

`MeshBasicMaterial`, перекраска PNG и глобальный подъём ambient/sun не использовались.

## Solution

Data-driven `BlockDefinition.lightingMode: 'vegetation'` на шести cross-plants. Tall grass/fern дополнительно `biomeTint: 'grass'`; цветы и dead bush без grass tint.

Mesher:

- отдельный `vegetation` buffer, не вторая реализация mesher;
- две диагональные плоскости × две намотки (FrontSide);
- lighting/sample normal `(0,1,0)` как у grass top;
- sky/block/emission формула та же: `max(0.16 + sky×0.72, 0.18 + block×0.95, emission)`.

WorldRenderer: sibling cutout material с тем же atlas/`alphaTest=0.42`/`depthWrite`, но `side: FrontSide`. Leaves/torch/door остаются на DoubleSide cutout.

## Before / After

| Scene | Before | After |
| --- | --- | --- |
| Plains day | Тёмные силуэты травы на светлом дёрне | Tall grass близка к grass top, цветы ярче и без green tint |
| Forest edge | Fern/трава вырезаны на фоне листьев | Растения освещены как трава; leaves без изменений пути |
| Night + torch | Растения остаются чёрными карточками | Block light поднимает vertex color ближайших plants |
| Orbit camera | Яркость прыгает при развороте на back face | Обе стороны с upward Lambert, без flip |

## Performance

Один дополнительный draw call на chunk, где есть растения (batched mesh, не Object3D на блок). Геометрия растения: 4 quad вместо 2. Atlas, alphaTest и mip gutters без изменений. Scene lights / world gen / combat / controls не трогались.

## Tests

`tests/vegetation-lighting.test.ts`: 8 cases — lighting formula, `blockLightingMode` default, registry profile/tint, upward normals, grass-top color match, untinted flowers, FrontSide vs DoubleSide, torch brighter than far plant. Suite: 18 files / 103 tests.

## Visual QA

Dev: `npm run dev` → port 4173.

Headless Chrome `127.0.0.1:4173` after `virtual-time-budget`:

- `?qaBiome=plains` — grass tops sample about RGB `80,95,56` (L≈89). Tall grass albedo is only ~7% darker than `grass_block_top` (avg 139 vs 149). Remaining dark pixels in the frame are dirt sides / trunks, not Lambert-silhouetted plants. Both plant planes stay equally lit while the camera orbits.
- `?qaBiome=forest` / `desert` — plants under canopy are darker via baked sky; cactus/leaves stay on the previous cutout/opaque paths.
- `?qaBiome=plains&qaTime=night` — harness now occludes a 5×5 stone roof over a torch so sky light drops and block light can raise nearby tall grass / fern / flowers. Open-air night torch is still limited by baked full-day sky in vertex colors (known lighting-pass limitation, not vegetation-specific).

In-game Creative is still the canon for final feel: harness no longer uses Hemisphere 1.5 / Directional 1.9.

## Known Limitations

- Vegetation — отдельный material/draw у chunk с растениями, не shared cutout.
- Sky light в vertex colors по-прежнему не пересобирается каждый dusk; ночной открытый воздух слабее пещеры.
- Нет colored lights / lightmaps.
- QA harness орбитирует камеру; static screenshot зависит от момента кадра.

## Deferred

- Per-vertex AO / hemisphere bake inside vertex color.
- Greedy/worker meshing.
- Отдельный debug lighting overlay для игроков (не делался).

## Next work

Прогнать Creative day/sunset/night глазами на целевом устройстве. Pipeline: typecheck PASS, 103 tests PASS, Vite 68 modules, 0.91 MiB / 165 files.

## Git

Не коммитилось в этом проходе, пока пользователь не попросит.
