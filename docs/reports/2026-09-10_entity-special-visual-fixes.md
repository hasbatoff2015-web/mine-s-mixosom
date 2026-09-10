# Entity and special visual fixes — 2026-09-10

## Goal

Исправить визуальные регрессии torch/redstone torch/lantern/rails, восстановить читаемые chicken legs и skeleton bow pose, направлять skeleton arrow damage в реально пересечённого игрока и отделить third-person grip/bow aim от first-person transforms. Не менять scope, fixed 20 TPS, save/protocol schema, canonical collision/placement или first-person pose.

## Result

Все заявленные code paths исправлены на ветке `codex/entity-special-visual-fixes`. Special blocks проходят production-renderer browser matrix; chicken и skeleton проверены через canonical `ThreeEntityHost`; third-person предметы и bow pitch проверены в `PlayerVisual`; exact projectile target закреплён unit и двух-player server integration tests. Четыре запланированных implementation commits созданы после явного подтверждения пользователя; документация фиксируется отдельным follow-up commit.

## Git

- Repository: `hasbatoff2015-web/mine-s-mixosom`
- Branch: `codex/entity-special-visual-fixes`
- Base SHA: `e4d43ff3cb1461053a44da1a7b23325832acc0ce`
- Remote branch: `origin/codex/entity-special-visual-fixes`.
- Final implementation SHA: `5f86c29c6ab9abb4478de0eb8802da05f5c861d2`.
- Main merge/rebase: не выполнялись.
- Implementation commits:
  1. `7fc9db7 fix: repair torch lantern and rail rendering`
  2. `2805e4b fix: restore chicken and skeleton presentation`
  3. `43ddd98 fix: route skeleton arrows to actual player hits`
  4. `5f86c29 fix: align third person held item and bow poses`
- Documentation is intentionally a separate commit after the implementation SHA; the PR/head SHA is reported in the task handoff because a commit cannot contain its own hash.

## Root causes

1. Torch cuboid передавал один вертикальный texture strip всем шести faces, поэтому top/bottom растягивались и выглядели как боковины.
2. Lantern был слишком грубой комбинацией boxes с неполным соответствием authored UV regions; hanging/standing silhouette плохо читался.
3. Rail renderer переиспользовал ступенчатые `railLocalBoxes`, предназначенные для selection/collision. Ascending rails выглядели ступенью, curves использовали straight tile/yaw вместо отдельной corner texture.
4. Фактический chicken PNG — physical `128×64`, logical `64×32`; большая часть ожидаемого legacy `[26,0]` cross island прозрачна. Alpha test скрывал ноги, а широкая подстановка непрозрачного участка визуально создавала лишние полосы.
5. Skeleton model не владел bow item visual и использовал симметричную melee-like arm pose.
6. Skeleton projectile tick проверял только один player focus, после чего сервер повторно выбирал ближайшего survival player к impact position. Это теряло identity фактически пересечённого AABB.
7. Third-person held model использовал неподходящий общий transform, а bow elevation имел инвертированный знак `π/2 - viewPitch`; sneak parent мог визуально добавлять pitch второй раз.

## Implemented

### Torch, redstone torch, lantern

- `TORCH_SIDE_UV`, `TORCH_TOP_UV`, `TORCH_BOTTOM_UV` описаны отдельно в atlas-tile space.
- `ChunkMesher.addCuboid` получил opt-in per-face UV policy; ordinary cuboids не изменены.
- Один `torchLocalMatrix` по-прежнему обслуживает floor и четыре wall facing, поэтому selection/light/gameplay не раздвоены.
- Lantern world/held geometry использует читаемые body, cap, hanger и hanging-chain parts с authored atlas rectangles.
- Light emission, placement, support and persistence paths не менялись.

### Rails

- Добавлена render-only abstraction `railRenderQuads(shape)`; `railLocalBoxes` остался только simulation/selection contract.
- Все десять `RailShape` дают ровно одну thin double-sided surface с epsilon `1/16`.
- `ascending_north/south/east/west` имеют настоящие разные Y endpoints.
- `north_east/north_west/south_east/south_west` используют `block/rail_corner` и нужные UV flips.
- `ChunkMesher` и special held model используют один render contract.
- `railPath.railAt` разрешает shape из текущих соседей, поэтому break/rebuild соседнего участка не оставляет stale default direction.

### Chicken and skeleton

- Chicken definition содержит ровно `rightLeg` и `leftLeg`, отдельные pivots, mirror на левой ноге, grounded Y и gait signs `[1,-1]`.
- `TexturedCuboid` / `LegacyModel` поддерживают opt-in `faceUvRects` и `physicalSize`. Только chicken legs remap непрозрачные authored foot/shin pixels; другие mob rigs сохраняют прежний layout.
- `ThreeEntityHost.createMob('skeleton')` создаёт ровно один bow через shared `ItemVisualFactory`, крепит его к right-arm hand anchor и повторно использует весь lifetime visual.
- Skeleton attack pose различает bow arm и draw arm; anchor компенсирует arm-X для читаемого вертикального bow.

### Skeleton projectile routing

- `MobPlayerFocus` теперь несёт stable `id` наряду с position/eye/alive/targetable.
- `skeletonArrowMuzzle(position, yaw)` — чистая deterministic simulation-space функция без Three.js/DOM authority.
- `nearestMobProjectilePlayerHit` выполняет swept segment против canonical `PLAYER_WIDTH × PLAYER_HEIGHT` AABB всех living/targetable foci и выбирает минимальную distance.
- Projectile tick сравнивает player distance с voxel block raycast; block выигрывает tie, projectile удаляется на первом player hit.
- `MobPlayerDamageEvent` всегда содержит exact `targetPlayerId`.
- `ServerGameplay` делает lookup только по этому id и заново проверяет Survival/alive; прежний nearest fallback удалён.
- Singleplayer legacy context получает стабильный `LOCAL_PLAYER_FOCUS_ID = 'local-player'`.

### Third-person held items and bow arms

- Независимые third-person profiles: sword, tool, bow, generic, block.
- `PlayerVisual` применяет соответствующий raised/gripped transform только к third-person hand child.
- `FIRST_PERSON_SPRITE_POSE` и first-person render profiles не менялись.
- Bow aim теперь `π/2 + viewPitch - bodyPitch`; положительный pitch поднимает руки, отрицательный опускает, sneak parent учитывается один раз.

### QA harnesses

- `?qaSpecial=rails&row=flat|slope` строит все десять shapes через настоящий `VoxelWorld → WorldRenderer → ChunkMesher`.
- `?qaSpecial=lights` строит floor + N/S/E/W wall matrix для обычного и redstone torch, standing/hanging lantern.
- `MobQaHarness` использует canonical `ThreeEntityHost.syncMob`, поэтому screenshot skeleton действительно включает production bow attachment/pose.

## Asset/source audit

| Runtime asset | Source / decision |
|---|---|
| `public/textures/block/torch.png` | Existing authored 32×32 torch sheet; explicit side/top/bottom regions, no generated replacement. |
| `public/textures/block/redstone_torch.png` | Existing authored 32×32 sheet; same face policy and attachment transforms as torch. |
| `public/textures/block/lantern.png` | Existing Faithful 1.16.5 32×96 strip; geometry samples the first authored 32×32 frame. Cuboid proportions/UV intent cross-checked against vanilla standing and hanging lantern model JSON. |
| `public/textures/block/rail.png` | Replaced old runtime file with repository-authored Faithful `assets/minecraft/textures/blocks/rail_normal.png` (32×32). |
| `public/textures/block/rail_corner.png` | New runtime copy of repository-authored `rail_normal_turned.png` (32×32); no procedural curve approximation. |
| `public/textures/entity/chicken.png` | Existing authored 128×64 physical sheet (`64×32` logical); actual opaque pixels measured in tests before choosing UV overrides. |
| skeleton bow | Existing `item/bow` generated-item path through `ItemVisualFactory`; no duplicate texture/material/model system. |

Reference model proportions were cross-checked against public vanilla model JSON for standing lantern, hanging lantern and curved rail. No branded asset or source code was copied into the project; the runtime textures come from the repository's existing authored pack tree.

## Changed files

### Rendering/assets

- `public/textures/block/rail.png`
- `public/textures/block/rail_corner.png`
- `src/blocks/registry.ts`
- `src/blocks/types.ts`
- `src/rendering/specialBlockGeometry.ts`
- `src/rendering/ChunkMesher.ts`
- `src/rendering/ItemVisualFactory.ts`
- `src/rendering/TexturedCuboid.ts`
- `src/entities/railPath.ts`
- `scripts/import-assets.mjs`

### Mob/player/gameplay

- `src/entities/EntityHost.ts`
- `src/entities/LegacyModel.ts`
- `src/entities/mobModels.ts`
- `src/entities/ThreeEntityHost.ts`
- `src/entities/MobManager.ts`
- `server/gameplay.ts`
- `src/items/itemRenderProfiles.ts`
- `src/rendering/player/PlayerVisual.ts`
- `src/rendering/player/PlayerVisualAnimator.ts`

### QA/tests/docs

- `src/dev/SpecialBlockQaHarness.ts`
- `src/dev/MobQaHarness.ts`
- `src/main.ts`
- `tests/entity-special-block-rendering.test.ts`
- `tests/skeleton-presentation.test.ts`
- `tests/mob-projectile-routing.test.ts`
- `tests/visual-models.test.ts`
- `tests/player-visual-animation.test.ts`
- `tests/server/anarchy-gameplay.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/MOB_MODEL_REFERENCE.md`
- `docs/reports/2026-09-10_entity-special-visual-fixes.md`

## Tests

### Green

- `npm run typecheck`
- `npm run typecheck:sim`
- `npm run typecheck:client`
- `npm run typecheck:server`
- `npm run check:boundaries`
- `npm run smoke:sim`
- `npm run smoke:server`
- Focused Vitest command over new regressions plus classic combat/gameplay/server integration: **8 files, 116/116 tests**.
- `npm run build`
- `npm run check:size`: **4.15 MiB, 354 files**.
- `npm run check:archive`: **4.15 MiB, 354 files**, below the 100 MB platform limit.
- Sequential retry of the 12 files that failed under full-suite parallel load: **89/92 tests**; block batching, fluid streaming, fs persistence, hostile spawn, lava/ore, lighting scheduler, server import, tick latency and TNT-minecart became green.

### Full-suite limitations

- `tests/fire-contact-sunlight-minecart.test.ts` reproducibly hangs before executing tests and was excluded from the measurable full run.
- Full run excluding that file: **2014/2029 tests passed**. Most failures disappeared when rerun sequentially with one worker, demonstrating resource-contention/time-budget sensitivity.
- Remaining sequential failures outside this task's changed logic:
  - two existing `worldgen-terrain.test.ts` cases time out;
  - `server/tick-load-flight.test.ts`: 117.26 ms against 80 ms threshold;
  - `minecraft-reference-extractor.test.mjs`: Vitest parser reports `Invalid or unexpected token` at its import block; neither test nor imported extractor changed in this branch.

## Visual QA

Performed in a real Chromium session against the Vite dev server:

- Torch and redstone torch: floor + north/south/east/west wall variants are upright/tilted away from support, top pixels are not stretched, all ten emit visible light.
- Lantern: standing and hanging body/cap/hanger silhouettes are readable; held item also readable.
- Rails: six flat/curve shapes and four true slopes are visible from overview; curve texture is distinct; rail held in first-person is visible and bounded.
- Chicken: front and three-quarter walk views show exactly two separate yellow grounded legs with opposite gait.
- Skeleton: three-quarter attack view shows one bow at the hand and distinct bow/draw arm pose.
- Player third person: sword idle, pickaxe walk, block sneak, apple eat and bow all remain raised/gripped/bounded. Bow at `viewPitch=-60°` points down and `+60°` points up; sneak remains monotonic. First-person bow pose remained unchanged.
- One browser log entry (`CHICKEN_LEG_FACE_UVS is not defined`) was produced during an intermediate hot-module reload before declaration order settled. A new final QA tab loaded with **0 warning/error log entries**; the issue was not reproduced by typecheck/build/tests.

The exact two-client skeleton-arrow routing, rail break/rebuild/persistence and minecart continuity were validated by deterministic integration/unit tests rather than a free-play two-browser session. They remain the main owner-side manual acceptance items.

## Performance

- No new per-frame geometry/model allocation: skeleton bow is created once per visual lifetime; third-person transforms mutate the existing child.
- Rail quads allocate only during chunk/held geometry construction, not each render frame.
- Projectile target scan is linear in the already bounded connected-player focus list and runs at fixed 20 TPS.
- Existing budgeted meshing, lighting, column cache, atlas gutters/mips, HUD/F3 throttling and caps were not changed.
- Production artifact remains 4.15 MiB.

## Known issues

- Full-suite timing remains sensitive to parallel worker load; see Tests.
- The hanging lantern chain/cap and skeleton bow arm angles are deliberate alpha approximations, not a complete vanilla animation/model port.
- Chicken per-face UV reuse is specific to the repository's authored sheet; replacing that sheet requires rerunning the opaque-pixel regression test.
- Native two-browser free-play acceptance for exact skeleton targeting was not completed in this session; server integration covers exact ID, invisible/Creative filtering and wall-vs-player ordering.

## Deferred

- Owner-side free-play: two simultaneous Anarchy clients with skeletons, reconnect/death transitions, and visible health attribution.
- Owner-side continuous minecart ride across rebuilt/high/curved rails after save/load.
- Existing unrelated worldgen/tick-load performance and Vitest `.mjs` parser failures.
- No soul lantern, powered/detector/activator rails, new projectile protocol, accounts, matchmaking or other scope expansion.

## Next work

1. Run the two remaining owner-side manual multiplayer/minecart scenarios.
2. Address the pre-existing hanging test and performance/parser failures as separate tasks, without mixing them into these visual/gameplay fixes.
