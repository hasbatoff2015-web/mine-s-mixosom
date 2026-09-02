# Тестирование

## 2026-09-02 PR #31 post-server integration

Automated focused gate:

```text
npx vitest run tests/player-skins.test.ts tests/player-skin-assets.test.mjs tests/player-visual-animation.test.ts tests/third-person-camera.test.ts tests/player-main-integration.test.ts tests/remote-player-view.test.ts tests/classic-combat-integration.test.ts
```

Итог: **7 files / 41 tests passed**. Расширенный player + overlay + server/network gate: **28 files / 236 tests passed**. Отдельно: `test:sim` **42/42**, `test:server` **73/73**, `typecheck`, `typecheck:sim`, `typecheck:client`, `typecheck:server`, `check:boundaries`, `smoke:sim`, `smoke:server` — PASS.

`player-skins` проверяет 64×64 validation, Classic/Slim dimensions, body/head, independent left/right/base/outer UV, nearest/no-mipmap texture, cache/ref-count, live appearance swap/dispose и feet/height bounds. `player-skin-assets` читает реальные IHDR всех 45 supplied PNG + QA skin. `player-visual-animation` покрывает head/body yaw, opposite gait, sneak, attack/eat/block/bow overlays. `third-person-camera` покрывает F5 order/active edge, 4-block distance, swept-corner wall/slab clipping, non-solid empty source и smooth restore. `player-main-integration` guards authoritative Online no-local-world-tick, player-eye targeting, render-path breaking overlay and lifecycle-neutral perspective switching. `remote-player-view` verifies bounded interpolation feeding canonical `PlayerVisual`, default appearance, animation/invisibility/light path, no placeholder box and no fabricated held item.

DEV URL: `/?qaPlayer=1`. Проверены Classic и Slim supplied skins, outer on/off (`draw 13 → 8` with held sword), first-person arm, sprint/mining/bow and all remaining pose states, head sliders, front/back/first and shared sword/pickaxe/block/bow/food visuals. Cache после смены skin остаётся `1 texture / 2 refs`; geometry stabilizes at 14 per variant, 28 after both variants. `/?qaBreaking=1` на том же merged build визуально прошёл cube stage `0/9 → 4/9` и special-block samples.

Full comparable `npm run test -- --maxWorkers=2`: integration **115/119 files, 1238/1253 tests**, exact clean `origin/main` `57724f6` baseline **109/114 files, 1214/1231 tests**. Integration failures are the same baseline classes: stale `GeneratedItemGeometry.ts` source fingerprint, `minecraft-reference-extractor` parse failure, CPU-heavy worldgen/fire/minecart timeouts and one Vitest worker RPC timeout. The clean worktree additionally lacked ignored `assets/minecraft` inputs, so two authored-asset tests failed only there. All 22 net additional tests pass; no player/remote/overlay/server regression class was added. `npm run check` therefore stops at the known full-suite failures, while standalone build/size/archive pass at **3.75 MiB / 277 files**.

Manual/device follow-up: actual gameplay F5 near full blocks/slabs/stairs/fences, crosshair target before/after camera pull-in, front-mode W semantics, cave near-plane comfort, landscape mobile GPU cost, and two-client remote `PlayerVisual`. Standalone harness proves model/pose resources, pure tests prove collision math; neither simulates real pointer lock/device thermals.

## 2026-09-02 PR #28 block breaking overlay integration

Reports: `reports/2026-08-31_block-breaking-overlay.md` and `reports/2026-09-02_pr28-block-breaking-overlay-integration.md`. Integrated baseline `origin/main`=`a305dc5`. Branch `cursor/block-breaking-overlay-3f86`.

Targeted: `tests/block-breaking-overlay.test.ts`, `tests/breaking-overlay-textures.test.mjs`, retained mining/block-geometry/selection/Game/use/GameplayKernel packs, online simulation/network block updates, and server Anarchy gameplay.

Contracts: stage mapping (`<=0`/`>=1` hidden, `0.01→0` … `0.9→9`), texture path `gui/destroy/destroy_stage_N`, UV 0..1 per face, shape keys for cube/slab/stairs/fence/door, target change resets visual stage, vanished block hides, same stage reuses material/map/geometry, no chunk dirty/remesh, world coordinates at x=15/16, dispose.

DEV harness: `/?qaBreaking=1` (cube/slab/stairs/fence/door, keys `0–9`, `[` `]`, `C` auto-cycle). Production builds do not import the harness.

Online authority contract: overlay only reads local progress; client completion sends a request and does not write the block. Server `advanceMining` / `breakBlock` remains authority; authoritative block packets update clients. No second mining timer or online world tick was added.

Final test/build/full-suite results are recorded in the 2026-09-02 integration report. Manual desktop/mobile/two-client checklist remains an owner acceptance gate. HUD mining bar is intentionally still present.

## 2026-09-01 inactive Anarchy client world sync

Report: `reports/2026-09-01_inactive-client-world-sync.md`.

`tests/inactive-client-world-sync.test.ts`: remesh policy PLAYING (inventory overlay) vs PAUSED/BACKGROUND vs MENU; `applyNetworkBlockChanges` while paused; batch last-write; parsed `block_batch` without resume replay; x=15/16; fluid state; deferred lighting queue; kernel still off online.

Retain `gameplay-modal`, `network-block-state-respawn`, online session/respawn, `anarchy-server` / `anarchy-gameplay`.

## 2026-09-01 Phase 7 tooling split

Report: `reports/2026-09-01_shared-tooling-split.md`.

Layer commands (do not replace `npm run check`):

```bash
npm run typecheck:sim      # tsconfig.sim.json — no DOM, no Three
npm run typecheck:client    # tsconfig.client.json
npm run typecheck:server    # tsconfig.server.json
npm run check:boundaries    # static import scan
npm run smoke:sim           # Node import of shared sim; fails if `three` loads
npm run smoke:server        # Anarchy start/tick/mutate/persist, no renderer
npm run test:sim            # kernel, interaction, geometry, RNG, snapshot, lighting adapter, tooling
npm run test:server          # tests/server + fs-world-store
npx tsc --noEmit            # umbrella (still meaningful)
npm run build               # tsc --noEmit && vite build
npm run dev                 # Vite client
npm run dev:server           # Node Anarchy
```

Vitest default environment is still **Node**. Shared tests must not need jsdom. Client visual tests (`entity-initial-lighting`, `mob-hurt-flash`, …) import Three and register `tests/setupClientEntityHost.ts` so `new MobManager(new THREE.Scene(), …)` still wraps `ThreeEntityHost`. Server tests stay Node.

`npm run check` now also runs `check:boundaries` before the existing test/build/size/archive chain.

## 2026-08-30 initial entity lighting (online join)

Report: `reports/2026-08-30_entity-initial-lighting.md`.

`tests/entity-initial-lighting.test.ts`: join-time mob dark until chunk light + `interpolateVisuals` (no hurt); dynamic spawn already lit; hurt is not the initializer; day vs night compose; `entity_snapshot` restore path; dropped-item visual sync; two-mob isolation; minecart interpolate without `update()`; skeleton snapshot restore. Retain `mob-hurt-flash`, `entity-lighting`.

## 2026-08-30 Phase 6 RNG + lighting adapters

Report: `reports/2026-08-30_shared-rng-lighting-adapters.md`.

Targeted: `tests/random-source.test.ts` (seed determinism, drop counts, scatter envelope, explosion injected RNG) and `tests/lighting-adapter.test.ts` (`WORLD_LIGHT_BUDGET_MS === 2`, immediate vs deferred, `processDeferredLighting` no-op on server worlds). Retain lighting-jobs / lighting-height-256 / lighting-scheduler, combat, explosion, gameplay-kernel, anarchy-gameplay, use-interaction, entity-host.

## 2026-08-29 Phase 2 shared interaction

Report: `reports/2026-08-29_shared-interaction.md`.

Targeted: `tests/use-interaction.test.ts` (intent order, `placeFromHit`, online `interact`-only) plus retained `placement-support` (still `Game.useTargetOrItem`), `glowstone-lantern-chain`, `gameplay-kernel`, `tests/server/anarchy-gameplay.test.ts` / `anarchy-server.test.ts`, bucket + network block-state/input packs.

## 2026-08-29 Anarchy server QA fixes

Report: `reports/2026-08-29_local-server-qa-fixes.md`.

Targeted: `tests/authoritative-motion.test.ts`, `tests/remote-player-view.test.ts`, `tests/server/anarchy-server.test.ts` (plus retained `tests/anarchy-world.test.ts`). Covers stale snapshots, no local hard-teleport, camera look isolation, remote delay lerp, input seq, break/place accept/reject, two-client broadcast, persist, reconnect.

## 2026-08-29 local authoritative Anarchy server

Report: `reports/2026-08-29_local-authoritative-server.md`. Docs: `docs/LOCAL_SERVER.md`.

Targeted: `tests/server/anarchy-server.test.ts` (start/load/join/spawn/two clients/movement/break/place/reach reject/persist/plugins/API surface/singleplayer isolation) plus retained `tests/anarchy-world.test.ts` (IndexedDB identity still valid for the legacy helper / SP list filter).

## 2026-08-29 lateral skylight / lighting consistency

Report and full 25-step manual checklist: `reports/2026-08-29_lighting-quality-lateral-sky.md`.

Current branch integrates height256 main `25fb847`. New height256 targeted run: **274/274 in 18 files**, `--maxWorkers=1`, before the final teardown regression. It includes the 14 suites below plus lighting-height-256, world-height-256, schematic-import and anarchy-world. Current save schema1/high-Y and all four Game creation/load paths are covered. Detailed full-check/build/WebGL follow-up results are in the report's **Height-256 integration** section. Use transient DEV fixtures or fresh-origin throwaway worlds for QA; no save downgrade is involved.

The next targeted/full-check counts are **historical height96** results, preserved for comparison, not the final height256 acceptance numbers.

Height256 follow-up after the last code edit:50/50 in5 files; full check962 passed/24 failed/986, one failed suite and two RPC errors versus fresh main880 passed/36 failed. A new observed dismount default timeout remains6.64 s vs5 s; explicit30 s diagnostic passes6 sunlight/dismount cases but does not make default check green. Build/size/archive PASS:3.60 MiB/221 files. WebGL all7 fixtures at1280x720/844x390 plus real Creative/Anarchy new-save-load smoke; native pointer lock/manual gameplay acceptance remains open.

Targeted run: **228/228, 14 files**, `--maxWorkers=1`, unchanged timeout/assertion thresholds. Files: lighting-seams/jobs/scheduler/physics-interaction/torch-selection, entity-lighting, vegetation-lighting, glowstone-lantern-chain, furnace-orientation-lit, streaming-scheduler, fluid-streaming, dirty-queue, block-break-batch and interaction-support-polish. Final focused checks: **74/74**, including the 56th lighting-seams regression for an opaque cold furnace at a relight boundary. A separate 5/5 sunlight integration diagnostic used an explicit 30 s timeout; see the report, not a default-suite green claim.

New coverage: lateral room/cave gradients, roof hole closure/same-bounds restart, canopy filters, all-six-face external emission, torch/glowstone/lantern removal, sliced furnace on/off/break, >8192 emitters, frozen-clock caps, per-world ownership, unchanged-region no-remesh, eight-neighbor readiness/build order, real cube/special vertex attributes, uniform-only daylight and direct-sun semantics. Old vertical-only neighbor-zero expectations were replaced; fixtures include diagonals and clear dirty state only after all initial lighting settles.

CPU benchmark: `npm run benchmark:lighting`; `.local/lighting-benchmark-256-after.json` contains 3 trials per scenario plus radius2/4/6 memory accounting. Includes highYRoom, highYEmitter and a multi-batch importedStructureLighting. `--case=initial81StreamingSlices` repeats one case into a separate file without overwriting the full sweep. For identical before/after comparison, create a detached `.local/lighting-baseline` worktree at `25fb847` and run `npm run benchmark:lighting -- --baseline`; remove the clean worktree before full Vitest discovery. Archived `benchmarks/*lighting256-*.json` is current; `*lighting-before/after.json` remains historical96. Mesh acknowledgements are not GPU draws or mesh-build timings. `npm run benchmark:streaming` remains the canonical streaming sweep.

DEV browser fixtures reuse `VegetationQaHarness` and `WorldRenderer`: `/?qaLighting=room`, `closed`, `hole`, `cave`, `forest`, `sources`, `high` (floor192/roof200). Wall / roof hole / light source / day-night controls invoke actual world paths; F7 uses existing SKY/BLOCK/FINAL. Fixture worlds are transient and do not touch IndexedDB saves. Screenshots/pixel checks are distinct from long native-GPU and real-mobile acceptance.

Full `npm run check` is **not green** on this Windows checkout: final run 919 passed / 20 failed / 939 tests, one failed suite and two RPC errors. Unlike older reports below, the current baseline failure is not a missing authored asset pack: CRLF source fingerprint, reference-audio extractor syntax, CPU timing/RPC failures were observed before edits. An intermittent entity-separation failure passes on rerun but is not proven baseline. Full-run results, new failures and their resolution are recorded in the report; unrelated tests were not rewritten to hide them. Separate build/size/archive checks pass: 3.59 MiB / 219 files.

## 2026-08-28 Anarchy persistent canonical world

Актуальный отчёт: `reports/2026-08-28_anarchy-canonical-persistent.md`. Ветка `cursor/spawn-map-import-256-height`.

Contracts: production Anarchy restores IndexedDB without `.schem`; stale `importVersion` does not rebuild; canonical spawn is `serverWorld.spawn`; modifications survive restart; missing schematic does not block; singleplayer list still hides Anarchy. DEV `importAnarchySpawn` remains for offline baking.

## 2026-08-28 Anarchy cocoa → air

Актуальный отчёт: `reports/2026-08-28_anarchy-cocoa-to-air.md`. Ветка `cursor/spawn-map-import-256-height`.

Contracts: `minecraft:cocoa` (и legacy pod/beans ids) → Air, не Diamond и не Oak Log; jungle_log → Oak Log; unknown → Diamond; `importVersion` 3.

`npx tsc --noEmit`: PASS. Full vitest: **918 passed / 2 failed / 920** (pre-existing authored-asset ENOENT). Production **3.61 MiB / 221 files**.

## 2026-08-28 Anarchy jungle→oak log and Y-28

Актуальный отчёт: `reports/2026-08-28_anarchy-jungle-oak-y-shift.md`. Ветка `cursor/spawn-map-import-256-height`.

Targeted: `tests/schematic-import.test.ts`, `tests/anarchy-world.test.ts`.

Contracts: jungle_log/jungle_wood → Oak Log (not Diamond, not planks); unknown → Diamond; Anarchy `yShift === -28`; X/Z = 0; bounds 0..255; `importVersion` 1 is stale, 2 imports once; save/load keeps shifted structure and oak logs.

`npx tsc --noEmit`: PASS. Full vitest: **917 passed / 2 failed / 919**. The two failures are the pre-existing `authored-item-assets.test.mjs` ENOENT on missing `assets/`. Vite build / size / archive: PASS, **3.61 MiB / 221 files**.

## 2026-08-28 world height 256 + Anarchy spawn import

Актуальный отчёт: `reports/2026-08-28_spawn-map-import-256-height.md`. Baseline `origin/main`=`6e27b93`.

Targeted: `tests/world-height-256.test.ts`, `tests/schematic-import.test.ts`, `tests/anarchy-world.test.ts`, plus retained worldgen/lighting/menu.

Contracts: `WORLD_HEIGHT=256`, Y=0/255 valid, Y=-1/256 invalid, save/load at Y=255, high-Y light/fluid/raycast, schematic palette mapping, unsupported→Diamond, import-once Anarchy, singleplayer list filter.

`npx tsc --noEmit`: PASS. Full vitest: **913 passed / 2 failed / 915**. The two failures are the pre-existing `authored-item-assets.test.mjs` ENOENT on missing `assets/` (Cloud has no Faithful tree). Vite build / size / archive: PASS, **3.61 MiB / 221 files**.

## 2026-08-28 glowstone / lantern / chain

Актуальный отчёт: `reports/2026-08-28_glowstone-lantern-chain.md`. Baseline `origin/main`=`73a78f4`.

Targeted: `tests/glowstone-lantern-chain.test.ts` (22) + `tests/glowstone-pack-textures.test.mjs` (2) plus retained `block-registry`, `crafting`, `block-selection-raycast`, `placement-support`, `creeper-fence-plants-tooltip-ru`, `special-preview-contract`, `lighting-torch-selection`, `interaction-support-polish`.

Light contracts: Glowstone = 15, Lantern = 15, Torch = 14. Placement covers standing/hanging lantern, chain-under-chain, lantern-under-chain, support cascade, thin selection, save/load, chunk border x=15/16. Icons: Faithful 32px glowstone; lantern/chain GUI sprites; held atlas UVs.

`npm run typecheck`: PASS. Full vitest: **898 passed / 2 failed / 900**. The two failures are the pre-existing `authored-item-assets.test.mjs` ENOENT on missing `assets/minecraft/textures`. Vite build / size / archive: PASS, **3.59 MiB / 219 files**.

## 2026-08-28 core sample SFX

Актуальный отчёт: `reports/2026-08-28_core-audio-sfx-pass.md`. Catalog: `AUDIO_ASSETS.md`.

Targeted: `tests/audio-sfx.test.ts` (20), `tests/minecraft-reference-extractor.test.mjs` (6), plus retained `classic-combat-integration`, `placement-support`, `block-registry`.

Full `npm test -- --maxWorkers=2`: **874 passed / 2 failed / 876**. The two failures are the pre-existing `authored-item-assets.test.mjs` ENOENT on missing `assets/minecraft/textures/items/bucket_empty.png` (unrelated source-pack fixture). Previous audio-pass baseline was 872/2/874 with the same two failures.

`npm run typecheck`, `npm run build`, `npm run check:size`, `npm run check:archive`: PASS. Production **3.53 MiB / 214 files** (26 new short MP3).

Unit coverage (no speakers): catalog resolution, block sound groups, variant/pitch/volume, distance skip, mining cadence, footsteps, explosion dedupe, potion vs food, missing sample does not throw, pause/mute/volume, `debugSnapshot` recent plays. Extractor copies fake 1.8 index objects to friendly `.ogg` names without storing hashes in the repo.

DEV browser overlay: `/?audioDebug=1`. Headless Chromium after local-footstep fix: walk overlay `block.step.dirt dirt_2.mp3 p0.98 v0.16` (**no `3d`**); `block.break.dirt` still ends with `3d`. Production MP3 pack is 26× mono. Speaker listen of TNT/bow/combat/UI remains a local-device gate.

## 2026-08-28 creeper / fence / plants / tooltip / RU polish

Актуальный отчёт: `reports/2026-08-28_creeper-fence-plants-tooltip-ru-polish.md`. Baseline `origin/main`=`9dc3300`.

Targeted file: `tests/creeper-fence-plants-tooltip-ru.test.ts` (24/24) plus retained `entities`, `player-physics`, `interaction-support-polish`, `gameplay-ui-entity-polish`, `heart-hud`, `container-ui`, `content-pass`, `block-registry`, `chat-commands`.

Full `npm test -- --maxWorkers=2`: **848 passed / 2 failed / 850**. The two failures are the pre-existing `authored-item-assets.test.mjs` ENOENT on missing `assets/minecraft/textures/items/bucket_empty.png` in this environment (unrelated source-pack fixture). Previous main polish baseline was 824/2/826 with the same two failures. Unrelated timeout thresholds were not changed.

`npm run typecheck`, `npm run build`, `npm run check:size`, `npm run check:archive`: PASS. Production **3.46 MiB / 188 files**.

- Creeper player-kill death pose (`rotation.z > 0` at half duration), primed-fuse cancel, self-explosion still removes immediately without drops.
- Fence 1.5 collision during walk/jump/elevated feet; connected/corner; slab/stairs step-up; mob broadphase; visual height remains 1.
- TallGrass/Fern/Flower/DeadBush support-loss via existing queue; cobweb/fire excluded; water replaceable plants drop nothing.
- Golden Apple absorption 0→4, 1→4, 4→4; duration refresh 300→2400; Creative HUD no longer zeros absorption; expiry and save/restore.
- Item slot HTML has no native item `title`; tooltip clamp; dynamic hover metadata patch.
- Exhaustive Russian mapping for `obtainableItems()` and every `BLOCKS` key; Recipe Book search `меч` / `алмаз` / `доски`.

Unrelated timeout thresholds were not changed.

## 2026-08-28 gameplay / UI / entity polish

Актуальный отчёт: `reports/2026-08-28_gameplay-ui-entity-polish.md`. Baseline HEAD=`67afc97`.

Targeted polish files: `combat`, `classic-combat-integration`, `mob-polish`, `shield-removal`, `stairs-slabs-icons`, `special-preview-contract`, `container-ui`, `heart-hud`, `visual-models`, `gameplay-ui-entity-polish`, `embedded-arrow-support`, `content-pass`. All green.

Full `npm test -- --maxWorkers=2`: **824 passed / 2 failed / 826**. The two failures are `authored-item-assets.test.mjs` ENOENT on missing `assets/minecraft/textures/items/bucket_empty.png` in this environment (unrelated source-pack fixture, not this diff). Historical main baseline was 771/796 with more timeout failures. Unrelated thresholds were not loosened.

`npm run typecheck`, `npm run build`, `npm run check:size`, `npm run check:archive`: PASS. Production **3.46 MiB / 188 files** (two new 9×9 absorption heart PNGs).

- Vertical apex ~0.576 / ~0.841; initial XZ 8/18 unchanged; 20-tick open travel 1.80024 / 4.44323 (earlier landing).
- Sprint remains true on the next tick with held W+sprint after a successful extra hit.
- Block items use `special_preview`; apple/sword/bow/torch stay `texture`.
- 16 stair occupancy fixtures (4 facings × inner/outer × left/right); mesh/collision share boxes.
- Collision-mode raycast skips TallGrass/flowers/fire and still hits stone/stairs.
- Player arrow pickup, full-inventory leave-in-world, creative consume-without-grant, skeleton non-pickup.
- Absorption HUD icons 4→2 full yellow; damage 3 then 2; effect expiry zeros HP; serialize round-trip.
- Close control is a stage sibling; `MC_CLOSE_HIT_MIN_PX=44`; landscape sizes keep the button in-viewport.

## 2026-08-27 interaction / support / mouse / mob polish

Актуальный отчёт: `reports/2026-08-27_interaction-support-mouse-mob-polish.md`. Baseline HEAD=origin/main=`3b9e68e`: typecheck PASS, targeted207/207, full692/714 (22 failures +1RPC). Final targeted **330/330,21files,26.04s**. Full **771/796,25failures +2RPC,242.24s**: те же5 числовых ошибок и6 failing files, но fire-contact timeouts17 вместо14. Три дополнительных случая отдельно PASS на baseline и current с почти одинаковым временем; strict full-suite no-worse condition всё ещё не объявлен выполненным. Scheduler thresholds/CRLF fingerprint не ослаблены. Production результаты — в отчёте.

- `interaction-support-polish.test.ts` (54): actual DDA center/edge/oblique/miss для Button/Lever floor/ceiling/4walls и powered states; real redstone orientation/pulse/restore; support matrix и exactly-once Game→DroppedItemManager, slab-face changes, unloaded support/queue overflow; real ExplosionQueue→support/light/power/arrow; all6 fluid-displaceable blocks при normal5-tick water arrival, light removal, non-displaceable barriers.
- `embedded-arrow-support.test.ts` (10): player/skeleton impact record, unchanged pose, Air/Water release, changed door shape, unrelated edits, same visual/geometry identity.
- `pointer-motion-polish.test.ts` (13): ordinary exact deltas, invalid values, isolated spike, sustained high-DPI exact sum, fresh-session reset, bounded history, raw/plain Promise+event fallback, legacy void/TypeError, denied request/cancellation, honest unknown unlock.
- `mob-polish.test.ts` (5): zombie facing/gait across recoil and AI resume, intentional passive flee, retreating skeleton look, two independent20-tick reference trajectories including hitY/stepped.
- Existing arrow visual test mock now supplies the complete actual VoxelHit/world support contract; geometry expectations unchanged. Existing Escape classification fixture supplies observed Escape evidence; no weakening of combat/fluids/placement assertions.

Reproducible browser fixture: DEV URL `/?inputDebug=1&polishQa=1`, create a **new** Creative world, seed exactly `interaction-support-polish`. `Build QA platform` explicitly replaces only the test arena (x4..12,z4..14,y71..77); do not use the seed/fixture on a valued save. Buttons invoke real Game targeting/use/break and real World/managers, not injected state. After Build: aim/use controls; remove supports; water→both torches; five arrows→remove log; normal/sprint hit. Browser QA actually inspected these scenarios, but does not substitute for hardware input.

Problem-PC checklist: use DEV `?inputDebug=1` without the fixture, play several minutes. At a failure capture locked, changes/errors, reason, focus/visibility, last/largest dxdy, invalid/spike counts and raw/plain status. Stable lock + spike increment indicates sanitation; lock transition is a separate lifecycle event. Check normal fast turns, Escape pause, inventory/chat close, focus loss/reacquire; no automatic retry. Browser automation here produced pointerlockerror, locked=false and no movement events, so it cannot establish problem-PC root cause or acceptance. If Escape keydown is hidden by the browser, unlock is intentionally classified unknown, not guessed Escape.

Remaining browser matrix: native right-click/edge/oblique control use; all decoration mounts/RedstoneTorch/Ladder support; skeleton arrows; crit/wall/W-tap/armor/block; mobile and10–15min GPU soak. Partial browser results and component PASS must stay distinct.

## 2026-08-27 classic combat

Текущая спецификация: `MINECRAFT_1_8_COMBAT_REFERENCE.md`; полный baseline/post-change результат: `reports/2026-08-27_classic-1-8-combat-pass.md`. Combat tests выполняются на реальных системах с deterministic collision field, без worldgen/GPU. Browser acceptance pending, не выдавать CPU geometry/pose checks за screenshots.

Финальный targeted набор: **194/194, 14 files**, 22.91s (`--maxWorkers=2`). Full suite:690/713 с23 failures/1RPCerror; canonical `npm run check`:675/713 с38 failures/2RPCerrors при default concurrency, остановился на tests. После этого отдельно build/typecheck/size/archive PASS:127modules,3.45MiB/186files. Full runs были до добавления последнего CPU soak test (теперь total714); soak включён в final194. Unrelated tests/thresholds не изменялись.

- `combat.test.ts` (47): total damage, мгновенные full attempts, crit+sprint/запреты, 20-tick hurt boundary/differences, block-before-armor/absorption, canonical base/extra KB, attacker slowdown, save migration, bow curve и survival smoke.
- `classic-combat-integration.test.ts` (17): Game click queue → real MobManager/Inventory/Survival; no sweep; accepted-only wear/exhaustion; sprint latch; reach3/wall; held-use movement mapping; shared player/mob trajectory; skeleton arrow impulse; cached first-person object stability; CPU soak24mobs/300ticks/7200attempts без роста object/geometry/material identities.
- `mob-hurt-flash.test.ts`: rejected hit не обновляет flash; новый full hit на half-window boundary обновляет. Материалы/геометрия/cleanup остаются прежними.
- `shield-removal.test.ts`: legacy migration сохранена; held sword без active Combat blocking не даёт защиты. Отдельный classic тест проверяет active sword use.

Manual browser matrix (в разрешённом сеансе, новый тестовый мир, `?perf=1`; не изменять пользовательский save):

1. Diamond sword → zombie, 10–20 CPS: swings продолжаются, каждый attempt damage8; target не принимает equal hits чаще 10 ticks. Проверить fist/wood/stone/iron/diamond и переключение без cooldown.
2. Ровная каменная площадка и высокая стенка: стоячий hit, sprint hit, падение и отрицательная/положительная target Y velocity. Не должно быть повторного base KB на ignored/differential hit или прохода сквозь стену.
3. Sprint→accepted hit→удерживать W+sprint: sprint не перезапускается автоматически. Отпустить W или sprint, снова нажать: extra hit доступен. Ordinary hit не тормозит attacker.
4. Прыжок/falling hit ×1.5, в том числе sprinting; rising/ground/water/ladder/riding — без crit.
5. Incoming melee без armor / iron / diamond: fixed reduction; sword held-use `(raw+1)/2` до armor; источник fall/drown/starve/suffocate не блокируется.
6. Sword hold-use: видимая block pose, движение 20%, sprint off. Release/switch/сломанный меч/death/pause/inventory снимают block. Быстрые attack↔block переходы без зависания pose; shield/indicator отсутствуют.
7. Bow короткий/полный draw, Survival ammo/Creative, fire arrows, stuck arrows с разных углов. Старый shield save без потери других stacks; обычный save/reload.
8. 10–15 min combat soak и mobile landscape attack/use: object/GPU resources/FPS/tick p95 до/после. Автотесты не доказывают эти browser показатели.

## 2026-08-27 item / arrow / placement / shield cleanup

Targeted suite — 205/205 в 19 файлах; typecheck/build/size/archive PASS. Итог полного suite и baseline failures см. `reports/2026-08-27_item-arrow-placement-shield-cleanup.md`; старые fingerprints/performance thresholds не ослаблялись.

Новые tests:

- `authored-item-assets.test.mjs`: точные bytes source→runtime, deterministic potion tint/alpha/cork, repeated import, forced fallback precedence, missing-required preflight без потери runtime files.
- `arrow-visual-cleanup.test.ts`: finite geometry/UV/normals, tail-only fins, +Z orientation и embedded tip по шести направлениям, stable inGround quaternion, 240 shots → cap48, geometry1/materials2/texture1, removal без children.
- `placement-support.test.ts`: реальные Game.useTargetOrItem calls без DOM constructor — torch anchor rejection, все faces для torch/redstone torch/button/lever/ladder, stone/slab/stair/door/chest/furnace/rail/plate/wire controls, slab merge, replaceable vegetation, bow/food/potion use dispatch. После Phase 2 это тот же `performUseHeld`.
- `use-interaction.test.ts`: чистый `resolveUseIntent` (bucket / lever / door / cartCloser / food / place), `placeFromHit` torch+lantern support, online client шлёт только `interact`.
- `shield-removal.test.ts`: player/offhand/armor/chest/furnace/drop migration, сохранность metadata/durability/bucket overflow, Game damage+armor+normal knockback без active blocking, отсутствие shield-specific runtime. Sword blocking добавлен последующим classic pass; `/give shield` обязан завершаться ошибкой.

Browser QA **не пройден**: браузер ранее отклонил localhost по policy; сейчас browser/user tabs пусты. Обход через другой host/browser/CDP не использовался. PNG inspection и component tests не означают WebGL acceptance.

После восстановления разрешённого сеанса выполнить:

1. Inventory/hotbar: bucket, water_bucket, lava_bucket, minecart, glass_bottle, potion_invisibility, potion_regeneration; silhouettes и прозрачность.
2. `?qaItem=<id>&qaView=held&pose=idle` для каждого; guard items iron_pickaxe/diamond_sword/apple/coal/torch/bow без изменения pose.
3. `?qaArrow=1&arrowScene=inspect&arrowView=front`: кнопки front/back/side/top/angle; normal/fire.
4. `?qaArrow=1&arrowScene=ground` и `arrowScene=wall`: tip inside, shaft outside, нет billboard при смене camera angle; затем реальные player и skeleton shots в игре.
5. `arrowScene=flying` и `arrowScene=stress`: 120 meshes; много раз stress→inspect→stress, normal/fire. HUD geometries/textures должны стабилизироваться; записать renderer.info и FPS. CPU cache test не заменяет GPU leak check.
6. Torch matrix в Creative и Survival: stone-on-torch / torch-on-torch отклонены без расхода; floor+4 walls stone разрешены; ceiling запрещён; ladder/button/lever и full/partial slabs/stairs. После polish удаления опоры ожидается exactly-once environmental drop, а не floating decoration.
7. Empty/sword/axe + hold-use: нет shield/slowdown; bow charge, food/potions, bucket pickup/place работают; legacy save не теряет остальные stacks.

## Цель

Проверки разделены на три уровня:

1. unit/component tests для чистых TypeScript systems;
2. production validation для typecheck, bundle, archive paths и размера;
3. browser/device smoke для WebGL, input, UI, lifecycle и IndexedDB.

Green unit suite не равна готовности к публикации: WebGL, browser storage, touch и Yandex lifecycle требуют отдельной проверки.

## Команды

Установка и запуск:

```bash
npm install
npm run dev
```

Отдельные проверки:

```bash
npm run typecheck
npm test
npm run build
npm run check:size
npm run check:archive
npm run benchmark:performance
npx vite-node scripts/benchmark-perf-pass.ts
npm run benchmark:lighting
npm run benchmark:streaming
npm run benchmark:fluids
```

Полный локальный pipeline:

```bash
npm run check
```

`npm run check` последовательно запускает strict TypeScript check, Vitest, production build и size/path validation. `check:archive` дополнительно отвергает `.ts`, `.map` и `.psd` в production output.

Если локальная исходная папка `assets/` доступна, перед тестированием импорта:

```bash
npm run assets:import
```

Команда должна завершиться отчётом о 161 выбранном runtime asset. В clean clone
без локального source pack этот шаг нужно пропустить: готовый whitelist уже
закоммичен в `public/textures`, а importer завершится до очистки output.

## Main-menu redesign check (2026-08-25)

```text
npm run typecheck                                      PASS
npm test -- --run tests/menu-model.test.ts             PASS (3/3)
npm run build                                          PASS (101 modules)
npm run check:size / npm run check:archive             PASS (3.36 MiB, 168 files)
HTTP / and /ui/frontier-menu-background.png            200 / 200
```

`tests/menu-model.test.ts` фиксирует названия offline server mock, `0 / 300`, фактические Shift/C desktop bindings, чат `T` / команду `/` и форматирование menu values.

Ручной browser checklist для этого pass:

- main: background cover, logo, три primary actions, без scroll на desktop;
- singleplayer: select, double-click/load, create, delete confirmation, back/Esc;
- online: два mock server rows, online count, signal bars, disabled connect, back/Esc;
- settings: четыре существующих sliders, live values, controls, apply/back/Esc;
- controls: read-only sections, scroll, actual key list, no rebinding;
- compact landscape: footer/actions не перекрывают scrollable content.

В текущем Windows runner встроенный browser runtime не стартовал (`apply deny-read ACLs`), поэтому screenshot/console visual smoke отложен. Production HTML/background доступны по HTTP, но это не подменяет ручной browser QA.

Полный `npm run check` на clean baseline `8935772` останавливается в Vitest: 30/551 failures (CRLF-sensitive source fingerprint, radius-6 streaming bounds и CPU-heavy timeout tests). После fluid-routing/item-lava pass полный параллельный run: 34/563 failures тех же baseline-классов; 12 новых tests все green. Build/size/archive запускаются отдельно и green. Не трактовать вариативное число timeout как regression без isolated reproduction.

## Текущее автоматическое покрытие

Срез локального запуска **2026-08-27** (fluid timing + bucket follow-up, поверх local routing patch):

```text
tsc --noEmit: PASS
Targeted:     7 test files, 77 tests, 77 passed
Vitest full:  570/598 passed, 28 failures
npm run check: 573/601 passed, 28 failures + 2 worker RPC timeouts; stops at test stage
Final count:  603 tests; 2 legacy bucket tests added after check, included in targeted 77
production:   124 modules, 3.44 MiB / 187 files
Main JS: ~962 kB / ~269 kB gzip; CSS: 38.93 kB / 9.04 kB gzip
```

| Test file | Tests | Что проверяется |
| --- | ---: | --- |
| `tests/fluid-timing.test.ts` | 9 | Exact first-arrival ticks, parallel Water/Lava fronts, generic edits/legacy +1 cannot accelerate, Air not queued, material/lifetime replacement, already-due retry, Lava drain cadence |
| `tests/bucket-interaction.test.ts` | 31 | Same-DDA liquid hits vs ordinary targeting, source/flow/falling/occlusion/reach, source removal/save delta/mesh, inventory modes/full fallback, source placement and promotion delay, drain, deferred Lava light removal, legacy player bucket stacks |
| `tests/block-registry.test.ts` | 12 | Registry invariants, independent render layers, special shapes, hidden stone_stairs и replaceable cross-plant definitions |
| `tests/inventory.test.ts` | 7 | Stack insertion/remainder/removal, cursor clicks, equipment, shift move, drag API, serialization, atomic consume, durability break |
| `tests/crafting.test.ts` | 9 | Shapeless/shifted/mirrored recipes, white-bed restriction, consumption plan, core recipe outputs including brick stairs/stone plate, smelting/fuel data |
| `tests/combat.test.ts` | 47 | Classic total damage, shared hurt resistance, crit+sprint, canonical KB, armor, sword blocking, legacy migration, bow/survival |
| `tests/player-physics.test.ts` | 5 | Floor/wall sliding, fall damage, slab collision/step-up, stair generic step-up и takeoff-only jump event |
| `tests/entities.test.ts` | 9 | Dropped-item merge/pickup/cap/restore, all 8 mob models, raycast/damage, creeper, skeleton, Creative non-targetability, vertical melee guard и bounded soft separation |
| `tests/dropped-item-environment.test.ts` | 5 | Java-1.9-style item health, Lava/Fire destruction, partial AABB overlap, Water safety, old-save default and health round-trip |
| `tests/world-generation.test.ts` | 4 | Negative chunk coordinates, seed determinism, five ore vertical bands/rarity и deterministic biome vegetation across real chunks |
| `tests/world-state.test.ts` | 3 | Runtime furnace flow, modified blocks/chests/furnaces restore и placement collision guard |
| `tests/redstone.test.ts` | 8 | Power `0–15`, timed sources/TNT, primed TNT keeps `block/tnt` map through fuse tint, all 24 lever attachment/facing/power geometry combinations, v2 orientation round-trip, v1 fallback и bounded propagation |
| `tests/visual-models.test.ts` | 10 | Atlas layout, descriptors/sheets, logical UVs, model-space conversion, corrected sheep layers, zombie classic biped UVs, targeted skeleton double-side/zombie front-side materials, spider constants and articulated rigs |
| `tests/chunk-mesher.test.ts` | 1 | Generated column cache is reused without per-face noise resampling |
| `tests/performance-stats.test.ts` | 1 | Bounded rolling average/p95/spike telemetry |
| `tests/item-rendering.test.ts` | 27 | Routing generated/handheld/block/bow, shared FP pose, bow 0.65/0.9, one front/back quad, no row-span fronts, depth `1/16`, alpha==0 span merge, 32×32 size, cache reuse, torch/arrow/lever/ladder/door generated held path, held* QA parse/defaults, idle front-facing camera, invisibility hides FP arm |
| `tests/special-block-items.test.ts` | 7 | Lever/ladder/door held ≠ cube, placed lever intact, ladder thin N/S/E/W + selection, door UV/half/hinge/open routing, shield отсутствует в registry/obtainable/render paths |
| `tests/stairs-slabs-icons.test.ts` | 22 | Stair/slab families, hidden stone_stairs, geometry/corners/collision/selection, slab merge/raycast, stone plate, special icon categories, pose lock |
| `tests/ladder-climbing.test.ts` | 13 | Thin ladder contact, N/S/E/W into-wall climb, back+S climb, descent clamp, gravity resume, stairs are not ladders |
| `tests/icon-scroll-fixes.test.ts` | 6 | Icon auto-fit extent, no per-item padding, Creative patch-dynamic keeps scroll/catalog, special-icon preview lighting (bright face shades, entity-light hooks stripped on clone) |
| `tests/pointer-lock.test.ts` | 11 | Unlock reasons (escape/programmatic/focus-lost), Esc pause without duplicate exit, Continue one request, failed request → fallback, no auto-retry |
| `tests/chest-model.test.ts` | 10 | Chest ≠ oak cube, entity texture, no chunk faces, opposite-of-look facing vs doors, lid opens up, lid interior `down` face, coplanar seam, held special_model, 27-slot persist, Creative catalog gate, shift transfer, single open target |
| `tests/container-ui.test.ts` | 21 | Logical 176×166 scale, book button in craft row (no extra closed width), no furnace Recipe Book, furnace slot rules, smelting without GUI, 3×3 consume/return, recipe A→B transaction, abort-on-full, craftable quantities, 2×2 filter, Creative tab slot contract without offhand, slot DOM identity, icon category tabs |
| `tests/creative-flight.test.ts` | 8 | 7-tick edge double-tap, Survival never flies, toggle on/off, hover/ascend/descend/Ctrl sprint, collision/landing/ladder override, mode switch, GUI input block while world ticks |
| `tests/gameplay-modal.test.ts` | 9 | Esc Pause stops sim; inventory/creative/chest/furnace/crafting keep PLAYING; gameplay input blocked; furnace cook/burn while GUI open; Recipe Book does not pause; pointer-lock overlay rules; `LOADING_WORLD` is not simulating |
| `tests/furnace-orientation-lit.test.ts` | 5 | N/S/E/W front, lit/unlit texture, GUI icon uses furnace_front not side, torch emission, LightEngine on/off, save/load burning |
| `tests/special-preview-contract.test.ts` | 4 | Every special_model → special_preview, shared pose/policy, chest entity preload, furnace cube GUI uses front texture |
| `tests/camera-look.test.ts` | 2 | Live input rotation immediately reaches render camera between fixed ticks; fixed simulation remains `20 TPS` |
| `tests/arrow-physics.test.ts` | 2 | Full-charge launch is `3 blocks/tick`; common air drag/gravity constants and update order |
| `tests/mining.test.ts` | 3 | 1.9 harvest vs preferred-tool, hand/axe/pickaxe/shovel break times |
| `tests/lighting-physics-interaction.test.ts` | 8 | Block light, mob step-up, falling sand, primed TNT gravity, torch/button/door placement, door collision/geometry |
| `tests/vegetation-lighting.test.ts` | 8 | Vegetation lighting profile, grass-compatible tint, upward normals, FrontSide cutout, torch block light |
| `tests/explosion-performance.test.ts` | 5 | Batch relight dedupe, redstone notify dedupe, chain TNT once, 32-job budget drain, single TNT in one slice |
| `tests/lighting-torch-selection.test.ts` | 11 | Bottom-face torch lighting, cave darkness floor, warm block-light tint, wall torch attachment/size, shape-aware selection, cave-opening sky interpolation |
| `tests/entity-lighting.test.ts` | 4 | Daylight mob brightness, unlit cave darkness, warm torch tint, feet/torso/head averaging |
| `tests/entity-interpolation.test.ts` | 3 | Render lerp at α=0.5, shortest-yaw wrap, snap on large correction |
| `tests/fixed-step.test.ts` | 3 | ~20 ticks / 60 Hz second, 300 ms stall capped at `MAX_CATCH_UP_TICKS`, leftover accumulator |
| `tests/world-loading.test.ts` | 4 | No gameplay/pointer lock in `LOADING_WORLD`, ready radius, monotonic progress, generate/light/mesh required |
| `tests/dirty-queue.test.ts` | 4 | 20 edits → 1 pending mesh, boundary neighbor only, interior no extra chunks, follow-up after rebuild |
| `tests/lighting-jobs.test.ts` | 6 | Skip lighting on grass→air, torch flood, furnace emission, deferred light dedupe, no full-chunk sky storm, lava emitter light stable after settle without remesh churn |
| `tests/fluids.test.ts` | 11 | Exact Water `8→1` / Lava `8→6→4→2` flat levels, downward-only waterfall, lower-level range reset without global cap, source removal idle/late-write guard, mixing, loaded/unloaded borders, queue/HUD |
| `tests/fluid-routing.test.ts` | 5 | Different/equal minimum flow costs, turning path, no-drop four-way fallback and exclusive direct-down priority |
| `tests/fluid-streaming.test.ts` | 18 | Level-only skip relight, no water region flood, no-op, queue dedupe, remesh coalesce, equilibrium soak, distant pause/resume, generated lava **boundary-only** enqueue, mix, water/lava/both fly streaming, mesh cost |
| `tests/lighting-seams.test.ts` | 10 | Flat chunk-border sky match, cross-chunk torch, cave/roof-hole, torch/furnace skip sky, stale mesh versions, halo ready, light-context activation, resumable slice, `?chunks=1` |
| `tests/block-break-batch.test.ts` | 3 | 30 interior breaks one mesh job, 100 deferred edits one light job, batch sky ≤ 2 chunks |
| `tests/perf-profiler.test.ts` | 4 | `?perf=1` parsing, `chunks=1` overlay flag, spike classification, last-spike timestamp/age, adaptive job budget shrinks when frame is already expensive |
| `tests/chunk-streaming-inspector.test.ts` | 26 | DEV streaming inspector: state→color, blockers, read-only queue rank, obsolete/wanted counts (halo light ≠ obsolete mesh), durations, F9 freeze, slow-chunk threshold, READY MESH STARVATION uses readyWanted not litAt, LAST SPIKE age, ready vs blocked head, front-target selection, player-visible vs prefetch latency, wanted enter/leave/re-enter, rolling stats exclude never-wanted halo |
| `tests/lighting-scheduler.test.ts` | 19 | Lighting flood skip past blocked head; 70 blocked + 1 ready; resume near flood owner; mesh-context DAG (no lighting A↔B cycle); A→B→C leaf lighting; near-unlock priority; distant flood preempt; obsolete unlit skip; orphaned/obsolete flood after prune or leave radius; radius-6 wanted set; 2 ms slice; torch border; flat sky seam; rapid break; CPU fly near-hole bound |
| `tests/fluid-surface.test.ts` | 7 | Corner heights, flat source pool culls internals, flowing slopes, shared edges, fluid-above no top, chunk-border seams, lava geometry, falling column |
| `tests/content-pass.test.ts` | 8 | New items/blocks in creative, fire-arrow leftover bucket, golden apple/potion effects (invis 3 min, regen potion 1 min), cobweb/fence collision, rails+minecart, flint TNT, fire-arrow ignite, clustered lava lakes |
| `tests/potion-effects-hud.test.ts` | 5 | Potion durations, `M:SS` countdown, HUD chip stack/hide, swirl UV row, FP particle overlay bounds/opacity |
| `tests/armor-hud.test.ts` | 7 | Vanilla leather/gold/iron/diamond piece+set totals, mixed equipment, HUD full/half/empty mapping, clamp 0–20, Fire/Lava still mitigated via the same `getArmorPoints` |
| `tests/heart-hud.test.ts` | 3 | 20 HP = 10 hearts, half-heart odd HP, shared armor/heart layout constants |
| `tests/menu-model.test.ts` | 3 | Offline server mock names/`0 / 300`, desktop bindings including chat `T` / `/`, play-time and setting formatters |
| `tests/mob-hurt-flash.test.ts` | 8 | Successful mob damage starts per-entity red tint; miss/zero/fire DOT do not; decay + restart; same-type isolation (geometry/texture shared, material/uniform not); three spiders; zombie+spider; owned-material dispose; fire overlay survives |
| `tests/fire-arrow-and-fire.test.ts` | 5 | Fire arrow only primes TNT / ignites living (no world fire), periodic burn + water extinguish, 6-plane fire mesh, animated fire strip, flint/fire-arrow icons and handheld models |
| `tests/fire-contact-sunlight-minecart.test.ts` | 39 | Fire AABB contact vs leave, Fire vs Lava cadence, armor reduces Fire/Lava (no bypass), independent Fire Arrow timer, hostile daylight burn (all hostiles, shade/water/night/passive/player exempt), rail look-axis + EW visual yaw, 3D cart, W/S cap/coast/reverse, push projection, curve/slope/chunk-border, opaque inner floor, derail/off-rail inertia/gravity/friction/no-steer/recapture, Shift dismount edge + safe position, TNT insert/fuse/explode, Flint entity-first prime (no Fire), Fire Arrow vs ordinary arrow via `PlayerArrowManager`, U-recipe + Recipe Book |
| `tests/hostile-spawn-balance.test.ts` | 8 | Surface night hostiles ≈ ×0.5, passive day rate independent of the night factor, cave hostiles in dark air not lava/water, min distance / floor / headroom, max 1 new cave hostile per chunk/event, density, respawn after death, global cap |
| `tests/block-selection-raycast.test.ts` | 22 | Screenshot rail empty-cell miss → Dirt; direct rail hit; plate/ladder/slab/stairs/fence pass-through; nearest actual AABB; chunk-border; face normal; shared outline/LMB target; minecart break/drop/ridden/TNT/priority/hitbox/pickup; Survival vs Creative loot helper; reach |
| `tests/chat-commands.test.ts` | 9 | Parse say vs command; registry names/aliases; gamemode s/c/0/1; time presets; give known/unknown; tp/seed/clear/kill/help; death messages; fade/history/Up-Down; overlay + typing Esc do not open pause |
| `tests/fire-overlay-hurt.test.ts` | 6 | FP fire overlay: two lower quads, translucent, UV animation without remesh; hurt flash/kick on real damage, time decay, look unchanged, bounded repeats |
| `tests/lava-bedrock-ore-pass.test.ts` | 10 | Stone cap Y=3, 20-seed pond bounds/depth/support/exposed-bedrock=0/enclosed waterline=0, Coal/Iron/Gold/Redstone ×2, Diamond ≈0.33× current, chunk-border determinism + generator-space neighbor walls, boundary-only enqueue + shore-break + cross-chunk 15/16, idle enclosed pond, ore Y/vein size |

Тесты выполняются в Node и не создают настоящий browser/WebGL context.

Targeted regression pass также подтвердил кодовые fixes:

- `jumped` true только на takeoff, поэтому удержание Space не начисляет exhaustion в каждом airborne tick;
- Survival sprint запрещён при hunger `≤ 6`, Creative не ограничен hunger;
- Creative player не является hostile AI target;
- mob melee использует 3D eye distance и voxel line of sight;
- base knockback игрока применяется только при `DamageResult.fullHurt`, включая absorption-only hit; ignored/differential hit не повторяют его.

## Что пока не покрыто автоматически

- full `Game` boot и lifecycle transitions;
- IndexedDB schema/transaction round trip;
- complete `SaveService`/IndexedDB save/load с player, drops и mobs;
- более широкий deterministic terrain snapshot corpus и chunk-boundary mesh regression;
- WebGL renderer, texture loading и missing-texture detection;
- DOM inventory end-to-end gestures;
- touch pointer capture, orientation change и safe-area devices;
- runtime melee/bow/mob/explosion chain без shield;
- полный `Game`-level redstone path от use/placement до chain explosion и save through `SaveService`;
- autosave при visibility/pagehide;
- Yandex SDK draft/debug-panel behavior;
- memory/performance soak.

Это P0 gaps, а не доказательство неработоспособности уже протестированных data systems.

## Выполненный browser smoke и responsive QA

На локальном dev server уже проверен базовый путь через управляемый Chromium:

- загрузка главного меню без runtime console errors;
- переход в список миров и форму создания;
- создание Survival мира с seed;
- появление terrain, HUD и hotbar;
- открытие/закрытие inventory (мир продолжает tick; WASD/look заблокированы);
- pause через `Esc` (simulation останавливается);
- «Сохранить и выйти»;
- появление мира в списке и повторная загрузка.
- загрузка сохранённого мира и respawn path;
- inventory/pause controls suppression;
- отсутствие console warnings/errors (`[]`) в финальном smoke;
- возврат viewport к исходному размеру после matrix.

Visual parity pass дополнительно использовал три детерминированные WebGL-сцены:

- Forest: пять перекрывающихся крон подтвердили полностью непрозрачные зелёные pixels leaves, сохранённые alpha holes и отдельную translucent water surface;
- Mobs: одновременно проверены cow, pig, chicken, sheep, zombie, skeleton, creeper и spider с локальными sheets, fur/eyes overlays и pivot hierarchy;
- Lever: floor/wall/ceiling pairs подтвердили неподвижную base, противоположные on/off handle angles и non-cube torch/wire/button/plate;
- после этих сцен в browser log не было runtime/WebGL warning/error, кроме служебных debug-сообщений Vite.

First-person/items pass добавил dev-only `?qaItem=` harness и реальный Survival smoke:

- пустая рука, apple, stone block, iron pickaxe, bow визуально проверены (историческая проверка щита больше не применима) как отдельная WebGL geometry, а не DOM-картинка;
- drops-сцена подтвердила textured generated items, atlas-cube block item и bounded stack copies;
- Q-drop в Survival уменьшил hotbar stack и создал тот же textured world visual;
- F3 после world + viewmodel passes показал `180 FPS`, frame `5.56 ms`, fixed `20 TPS`, `112290` triangles и `88` calls; item cache сохранил один generated texture;
- pointer-lock вызвал `WrongDocumentError` только при управляемом automation click в in-app browser; это ограничение среды автоматизации, не воспроизведённый runtime defect игры.

Feel/polish pass повторно проверен во встроенном браузере на локальном dev server:

- в реальном Creative-мире пустой main hand показывает компактную textured Steve arm, а apple/feather/coal/stick/sword скрывают отдельную руку и сохраняют читаемый контур;
- `?qaItem=` подтвердил одинаковую cached generated geometry для held/dropped item, глубину и stack copies; stone остаётся настоящим atlas cube;
- `?qaItem=iron_pickaxe` — isolated inspect (front, центр, без bob/swing, orthographic); overlay печатает spans/UV/depth;
- `?qaItem=iron_pickaxe&qaSideDebug=1` — textured front, dim back, стороны UP red / DOWN green / LEFT blue / RIGHT yellow;
- `?qaItem=iron_pickaxe&qaView=left` / `qaView=right` / `qaView=back` — лёгкий угол и тыл;
- `?qaItem=iron_pickaxe&qaView=held&pose=idle` — first-person; overlay печатает camera FOV/aspect, matrices, axis stages, silhouette landmarks `screen01` и F2 2048×1152 comparison (proposed vanilla не applied; comparison camera фиксирована на F2 16:9 FOV70). Residual idle bob заморожен. `held*` knobs работают только здесь;
- `?qaPose=subtle|balanced|stronger` — QA candidate shared pose (не production). Можно сузить отдельным `held*`;
- `?qaPoseCompare=1&qaView=held&pose=idle&qaPose=balanced` — цикл 1–8 / `[` `]` по pickaxe, sword, coal, arrow, stick, apple, bow, torch без правки query;
- `?qaItem=iron_pickaxe&qaView=held&pose=idle` — live pose panel справа: sliders/numeric для X/Y/Z/Pitch/Yaw/Roll/Scale, RESET production (`0.67, -0.29, -0.70` / `1, -90, 34` / `0.60`) / subtle/balanced/stronger, COPY POSE/QUERY/TS. Смена предмета pose не сбрасывает. Только DEV;
- `?qaItem=iron_pickaxe&qaView=held&pose=idle&heldScale=0.60&heldX=0.67&heldY=-0.29&heldZ=-0.70&heldPitch=1&heldYaw=-90&heldRoll=34` — `held*` knobs работают только при `qaView=held`;
- bow standby/partial/full используют локальные `bow_pulling_0/1/2` textures, vanilla pull thresholds `0.65/0.9`, movement slowdown и плавный FOV zoom. Mesh лука не изгибается.

Minecraft generated-item geometry audit (локальный visual QA всё ещё нужен):

- `diamond_sword`, `iron_pickaxe`, `stick` — handheld sprite, видна FRONT texture, тонкий depth; `iron_pickaxe.png` 32×32 даёт 104 merged side spans (много 1-texel на диагонали — это контур, не баг merge);
- `coal`, `apple`, `arrow` — generated sprite, не voxel cubes и не projectile mesh;
- `torch` — held generated sprite, placed world cuboid без изменений;
- `lever` — held generated sprite from `block/lever.png` (vanilla 1.21.8 item JSON); placed lever base+handle;
- `ladder` — held generated sprite from `block/ladder.png`; placed thin plane on N/S/E/W support;
- `oak_door` — held generated composite of upper+lower block textures; placed 3/16 cuboid with half/hinge UV;
- `bow` — texture stages на том же generated mesh;
- `stone` — atlas cube control.
- `?qaItem=lever&qaView=held`, `?qaItem=ladder&qaView=held`, `?qaItem=oak_door&qaView=held`.
- `?qaArrow=1` показал три real-texture arrow visuals на разных траекториях с общей physics update;
- mob QA спереди/сзади/сбоку подтвердил длинные base sheep legs под коротким wool overlay, readable two-sided skeleton ribs и чистый zombie headwear cutout;
- `?qaTime=night` ставит факел, соседние plants и каменный навес, чтобы был виден block light.
- Mass TNT: F3 строка `boom Q pending/processed vx destroyed · cpu/relight ms sky N`. Одиночный TNT должен закрыться за один tick; 32/64 — очередь дренируется без зависания вкладки. Radius/power/cap не уменьшались.
- F3 в реальном forest-мире: около `178–180 FPS`, frame `5.56 ms`, p95 `5.70 ms`, fixed `20 TPS`, tick примерно `0.94–1.16 ms`, `81/81` chunks, `137358` faces, `125852` triangles, `96` calls и `16` mobs;
- browser automation не смог синтетически отправить pointer-lock movement через доступный locator API. Camera regression поэтому отдельно доказан unit test: изменение input между fixed ticks сразу меняет render camera; физический fast-mouse smoke на целевом устройстве остаётся обязательным.

Последний CPU benchmark после vegetation/projectile pass:

```text
generation: avg 15.400 ms, p95 18.375 ms, max 22.401 ms
meshing:    avg 18.222 ms, p95 23.071 ms, max 47.373 ms
scan:       avg 16.728 ms, p95 21.610 ms, max 27.269 ms
geometry:   avg  1.479 ms, p95  2.041 ms, max 19.774 ms
mob tick:   avg  0.896 ms, p95  1.650 ms, max  2.643 ms (24 mobs)
faces:      233331 across the benchmark world
```

Responsive pass дополнительно выполнен на всех заданных размерах:

- desktop: `1920×1080`, `1366×768`, `1280×720`, `1024×768` и малое окно;
- mobile landscape: `932×430`, `844×390`, `800×360`, `768×360`, `740×360`, `720×360`, `667×375`;
- на каждом размере прошли visibility/count checks ключевых UI элементов;
- на representative `667×375` визуально проверены inventory, pause и settings;
- в portrait визуально проверен fullscreen rotate overlay.

Во время responsive QA touch look/joystick/actions оказались поверх menus/modals. Дефект исправлен: `controls-suppressed` скрывает gameplay controls вне активной игры.

Во время smoke был найден и исправлен бесконечный рост генерации на границе chunk meshing: lookup соседнего face больше не создаёт новый chunk. Это хороший regression candidate для будущего integration test.

Browser viewport matrix закрывает layout baseline, но не заменяет реальные Safari/iOS/Android, multi-touch и Yandex draft. После изменений main loop, combat, entities, redstone или rendering страницу нужно полностью reload-ить до следующей оценки.

## Desktop manual matrix

Все обязательные размеры уже прошли visibility/count checks:

- `1920×1080`;
- `1366×768`;
- `1280×720`;
- `1024×768`;
- небольшое свободно изменяемое окно.

Следующие functional scenarios всё ещё нужно полноценно пройти, особенно после финальной сборки:

1. loading → main menu, нет горизонтального/вертикального scroll;
2. create/list/load/delete world;
3. pointer lock acquire/release, blur и `Esc`; закрытие inventory по E/Close и pause «Продолжить» сразу возвращают lock без повторного click по canvas; Esc из gameplay открывает pause с видимым курсором;
4. WASD, jump, Shift sprint (земля) / descend (полёт), Ctrl fly sprint, double Space Creative flight, C sneak, edge protection, step/slab/chest collision;
5. mine/place, 1.9-like break times, thin torch/button/door/ladder, stairs/slabs (half/double, facing, top stairs), запрет placement внутри игрока;
6. hotbar `1–9` и wheel, Q-drop/pickup;
7. inventory left/right click, armor/off-hand, crafting 2×2/3×3;
8. chest model/facing/lid, chest/furnace/crafting GUI (без Creative catalog), Recipe Book, block destruction drops contents;
9. food, fall/water/lava/cactus damage, death, respawn и bed spawn;
10. classic melee/hurt resistance/crit+sprint, sword blocking, отсутствие shield/attack indicator, bow with/without arrow;
11. passive/hostile spawn, skeleton shot, creeper fuse/explosion, loot pickup, mob 1-block step-up, zombie limbs;
12. lever/button/plate → dust levels → primed TNT gravity/fuse/explosion/chain, falling sand entity, torch block light;
13. F3 overlay, viewmodel без shield, settings FOV/sensitivity/render distance/volume;
14. pause/background/resume without hidden simulation;
15. save/quit/reload and world/redstone/block-state/falling-block comparison.

## Stairs / slabs / special icons visual QA

Последний pass перед merge ветки `cursor/minecraft-item-pipeline-rework-935a`. Полный checklist также в `docs/reports/2026-08-22_stairs-slabs-special-icons-pass.md`.

Stairs:

- oak + birch/spruce, cobblestone, bricks, stone bricks;
- facing N/S/E/W, bottom и top half;
- серия вверх и вниз обычным WASD (не climb);
- боковое столкновение, jump, corner join;
- `stone_stairs` нет в Creative/крафте.

Slabs:

- bottom / top / double merge одинакового материала;
- разные материалы не merge;
- стоять на 0.5, проходить под top slab;
- held и icon — half, не full cube.

Pressure plates:

- oak и stone: thin model, placement на верхнюю опору, icon, activation.

Icons:

- Creative / survival inventory / hotbar;
- special 3D icons максимально крупные в slot (auto-fit, не мелкий padding);
- stairs/slabs/button/plates не почти чёрные: oak/birch/brick/stone цвета как у texture/held;
- `stone_button` не stone cube;
- ordinary cubes без regression;
- held generated pose без изменений.

Creative scroll:

- прокрутить каталог вниз, взять/положить/shift-click — scroll не прыгает наверх.

Ladder:

- стена 5–10 блоков, лестницы вверх;
- лицом + W вверх; спиной + S вверх;
- no input — медленно вниз; C sneak — удержание;
- от стены — отцепиться; падение на ladder — clamp;
- верх/низ; N/S/E/W; stairs рядом не дают climb.

## Container UI / Recipe Book / Creative flight

Полный checklist: `docs/reports/2026-08-22_container-ui-recipebook-creative-flight.md`.

Chest: facing N/S/E/W latch/front toward player, entity texture, lid opens up, lid interior visible, no chunk cube under entity, 27 slots, Survival и Creative GUI одинаковы (без Creative catalog), left/right/shift clicks, held/icon через canonical special_preview.

Furnace: input / flame / fuel / arrow / output, **без Recipe Book**, facing N/S/E/W, lit front + torch light while burning, GUI icon = furnace_front, progress live while GUI open, shift-click routing.

Crafting: 3×3 → arrow → result, close возвращает grid, Recipe Book (left panel + craft-row book button + icon tabs), transactional A→B, ghost ≠ stack.

Creative E: вкладки Каталог (catalog + scrollbar gutter + 9 hotbar) / Инвентарь (armor silhouettes, без offhand, 3×9 + hotbar), без giant / overflowing slots.

Flight: только Creative, double Space 7 ticks, Space/Shift высота, Ctrl sprint, landing off, walls/ceiling, ladder не перехватывает, Survival — только прыжок.

Pointer lock: close E / chest / furnace / crafting / Continue / Esc overlay без второго flow.

## Mobile/touch manual matrix

Все landscape targets из platform checklist прошли browser visibility/count checks:

- `932×430`;
- `844×390`;
- `800×360`;
- `768×360`;
- `740×360`;
- `720×360`;
- `667×375`.

На `667×375` inventory/pause/settings уже прошли representative visual QA, portrait overlay также подтверждён. На реальных устройствах всё ещё проверить:

- joystick reaches full movement vector and releases on pointercancel;
- look zone не конфликтует с action buttons;
- mine/use hold и release не «залипают»;
- jump/sprint/sneak toggles понятны и доступны;
- inventory/pause buttons не перекрываются safe-area/notch;
- все 9 hotbar slots видимы и нажимаются;
- health/hunger и critical UI не закрыты controls;
- inventory помещается по высоте `360 px`, нужные sections scrollable;
- multi-touch movement + look + action работает;
- portrait показывает rotate overlay;
- возврат в landscape не пересоздаёт мир, не теряет open-state/save и не запускает background simulation.

Responsive browser layout считается пройденным; реальные Safari/iOS и Android tests остаются обязательными.

## Save/load regression scenario

Создать фиксированный seed, затем:

1. добыть блоки по обе стороны chunk boundary;
2. поставить несколько blocks, chest, furnace и bed;
3. положить уникальные stacks в chest/furnace, экипировать armor; проверить legacy shield migration;
4. выбросить item и оставить его неподобранным;
5. дождаться/создать mobs, нанести одному damage;
6. включить lever/button, запустить TNT и сохранить мир с незавершённым fuse;
7. изменить позицию, view, health/hunger и selected slot;
8. дождаться autosave, затем save-and-quit;
9. reload страницы и загрузить мир;
10. сравнить все перечисленные fields, active sources/remaining fuse и отсутствие duplicated entities/items;
11. повторить после pagehide/background и после forced tab close.

Отдельно повредить один inventory/container/mob record в test fixture: список миров и остальные records должны продолжить загружаться.

## Seeded world checks

Для каждого test seed полезно фиксировать не screenshot всей карты, а небольшую стабильную выборку:

- numeric seed;
- biome/height для известных coordinates;
- hash нескольких chunk block arrays;
- наличие каждой ore только в разрешённом Y range;
- отсутствие out-of-range block IDs;
- одинаковый результат для нового `TerrainGenerator(seed)`;
- корректность floor division около X/Z `-1`, `-16`, `-17`, `0`, `15`, `16`.

Decoration у края chunk нужно проверять отдельно, потому что текущий placer намеренно не строит дерево через соседний chunk.

Worldgen mountains/caves/density (`tests/worldgen-terrain.test.ts`, `npm run benchmark:worldgen`):

- same seed → identical heights/caves/trees/cacti; other seed → different terrain;
- surface in `58–84`, sea `63`, generated peaks capped by `MAX_GENERATED_SURFACE = 84` (independent of `WORLD_HEIGHT = 256`);
- mountain contribution `+10…+20` на части мира, не на каждом chunk;
- neighbor height delta ≤ 4, в том числе на biome borders и chunk borders;
- bedrock `Y 0–2` sealed with Stone cap `Y=3`; caves never carve cap; extra ~15 underground vs old surface~49;
- cave networks cross `x=15|16`; connected-component size/width vs swiss-cheese ratio;
- **no 1×1 / 1–2 surface cave pinholes** on plains/forest/desert/mountains; ordinary caves keep `CAVE_ROOF_DEPTH = 4` under the 3×3 local min surface;
- Forest oak ≈ 35–50% old count; Desert cactus ≈ 20–30% old count;
- ores only inside shifted `ORE_RULES` bands, including new deep stone; Coal/Iron/Gold/Redstone vein **attempts ×2**; Diamond **≈ current/3** (`veins: 1` + `extraVeinChance: 1/3`); vein `size` unchanged;
- small irregular **enclosed** cave lava ponds (depth ≤ 3, bounded footprint, Stone shore above waterline, no open cave-edge escape, generator-space chunk-border validation, ordinary pond queue 0);
- spawn on plains grass above sea, not mountain/cave/desert;
- old modification linear indices still restore after `WORLD_HEIGHT` 80→96→256.

DEV: `?worldgenDebug=1` appends `surfaceY=` / `mtn=` / `hills=` / `cave=` / `cap=` / `blk=` on the chunk HUD. Visual QA только на **новых** мирах: сохранённые deltas не мигрируются, unexplored chunks получают новый generator.

```bash
npm run benchmark:worldgen
```

CPU-only (no GPU FPS). Compare plains/forest/desert chunk ms and 81-chunk batch with the numbers in `docs/reports/2026-08-23_worldgen-mountains-caves-density.md`.

Fluids (`tests/fluids.test.ts`, `tests/fluid-routing.test.ts`, `tests/fluid-timing.test.ts`, `tests/bucket-interaction.test.ts`, `tests/fluid-surface.test.ts`, `tests/fluid-streaming.test.ts`, `npm run benchmark:fluids`):

- exact causal first-arrival ticks: Water5/10/15/20, Lava30/60/90; timing fixture freezes CPU-budget clock only, arrivals are measured by `world.tickNumber`, not FPS;
- real parallel fronts, generic edit notifications and legacy+1 calls cannot shorten material delay; removed/recreated cells cannot inherit extracted tickets;
- empty bucket uses the same DDA with liquid-stop option, rejects flowing/falling foreground, solid occlusion and out-of-reach sources; default targeting still skips fluids;
- source pickup/placement, gradual drain, deferred Lava emission removal, Survival stack/full-inventory fallback and Creative active-slot behavior; max stacks16/1/1; legacy player bucket stacks preserved;
- water falls before spreading and reaches exact flat levels `7..1`, then Air;
- lava falls and reaches exact overworld flat levels `6,4,2`, then Air;
- bounded flow-cost routing can turn, excludes more expensive initial directions and keeps equal-minimum ties;
- a filled falling column remains down-only; landing starts a new range, so total original-source distance may exceed 7/3 without a global cap;
- removing a source dries flowing water, queue reaches 0 and 100 late ticks write 0;
- water + lava source → obsidian; water + flowing lava → cobblestone;
- flow continues across a loaded chunk border;
- queue stays ≤ 2048 and per-tick updates ≤ 48;
- render uses four corner heights, culls same-fluid internals, and keeps chunk-border corners identical;
- settled water/lava extra ticks write 0; distant fluids pause and resume;
- water/lava level-only changes skip relight; water flood does not queue a lighting region;
- deterministic terraced-hill stats record initial branches, cells/Y, footprint, queue peak, writes, settle and late writes for BEFORE/AFTER comparison;
- current clean baseline does **not** satisfy the old `<8 s` radius-6 near-hole assertion: fluid/no-fluid simulations report the same existing lighting-streaming issue (`14.816–22.233 s` depending scenario). `WORLD_LIGHT_BUDGET_MS = 2` remains unchanged; this pass does not hide it by raising budgets.

Follow-up browser gate: current Browser connection works, but navigation/reload of the local game was denied by its URL security policy. No bypass; real cadence/pickup/drain/light gameplay QA is still required. See `docs/reports/2026-08-27_fluid-timing-and-bucket-interaction.md` for the remaining manual matrix and full validation results.

```bash
npm run benchmark:fluids
```

## Combat/entity regression scenarios

- Удар рукой/sword/pickaxe/shovel/axe всегда с полным damage; quick switch не сбрасывает несуществующий cooldown.
- Falling crit ×1.5 совместим со sprint; equal/weaker hits в первой половине hurt window ignored, stronger damage — difference.
- Hold-use sword включает block/pose/movement ×0.2; пустая рука/axe не блокируют; bow draw сохраняет свой slowdown. Shield отсутствует.
- Melee/projectile damage проходит через shared hurt gate и classic armor; base melee KB только fullHurt, extra sprint отдельно. Legacy shield не восстанавливается.
- Bow: слишком короткое удержание не стреляет, Survival требует arrow, Creative не требует.
- Arrow сталкивается с ближайшим mob/block и не проходит сквозь wall.
- Каждый passive loot stack валиден для item registry.
- Skeleton projectile наносит player damage; Creative игнорирует damage.
- Creeper fuse отменяется/продолжается по ожидаемому range, explosion не ломает bedrock/слишком hard blocks.
- Redstone dust показывает `15, 14, …, 0`, timed button гаснет, plate реагирует на player/mob/drop и powered TNT detonates after 80 ticks.
- Save/restore сохраняет source/fuse state, но пересчитывает derived wire power; взрывом primed TNT запускает chain.
- Mob death/remove/dispose не оставляет scene children; repeated world load не увеличивает entity count.

## Performance/soak

DEV overlay: `?perf=1` — FPS, frame/tick p95/p99/max, SIM player/mobs/world/combat/entities/other, job counts, LAST SPIKE with **age**, READY MESH STARVATION > 500 ms (readyWanted wait, not litAt), PLAYER-VISIBLE `WANTED→VISIBLE` / `READY-WANTED→MESH` histograms plus separate PREFETCH HISTORY (`lit→meshStart`). Chunk streaming inspector (PLAYER/FRONT CHUNK, halo, DEPENDENCY CHAIN, GEN/LIGHT/MESH ready vs blocked, LIGHT `skipsBlockedHead` / `criticalBlocked`, `queuedObsolete` = pending outside wanted). Не логирует console каждый кадр. F8 цветная сетка, F7 light view, F9 freeze front chunk (CURRENT STATE vs LAST WANTED PERIOD; CURRENTLY NOT WANTED if outside mesh radius). Prefetch vs player-visible: `docs/reports/2026-08-23_chunk-streaming-inspector.md`. Mesh starvation: `docs/reports/2026-08-23_chunk-streaming-starvation-fix.md`. Lighting halo flood skip: `docs/reports/2026-08-23_lighting-halo-scheduler-starvation.md`. Scripted:

- `?perf=1&perfScenario=CREATIVE_BREAK_STRESS` — 100 canonical `applyBlockBatch` air mutations after world ready;
- `?perf=1&perfScenario=MOB_SMOOTHNESS` — one cow with interpolated visual sample.

CPU streaming scheduler (no GPU):

```bash
npm run benchmark:streaming
```

Минимальный soak — 15 минут активной игры:

- двигаться по прямой достаточно далеко для repeated ensure/prune;
- менять render distance `2 → 6 → 2`;
- добывать/ставить blocks и создавать dirty chunks;
- держать passive/hostile populations близко к caps;
- вызвать несколько explosions и много drops;
- выполнить несколько autosaves и один reload.

Собирать минимум:

- FPS и подтверждение fixed `20 TPS`;
- loaded chunk count и rendered face count из F3;
- dropped item/mob/projectile counts;
- `performance.memory` там, где API доступен;
- long tasks, frame spikes, console errors и unhandled rejections;
- save duration/size.

- Rapid Creative break: держать ломание по площадке; FPS не должен уходить в устойчивые 0–10; F3/`?perf=1` last spike не multi-hundred-ms mesh-per-block.
- Мобы при 60+ Hz: ходьба/поворот без 20 FPS steps (AI decisions остаются дискретными).
- World entry: loading overlay с живым percent до PLAYING; первый gameplay кадр в уже мешнутой зоне, без провала в пустоту.
- Бег вперёд 30–60 с: recurring multi-frame stalls без категории в perf overlay — регресс.

Failure signs: монотонный рост scene children после pruning/load, duplicated pickups, autosave backlog, постоянные multi-frame mesh stalls и значимый drift от 20 TPS.

## Production/archive validation

Финальный production check после feel/polish pass пройден: `63` модуля, `164` файла, `0.90 MiB` uncompressed; main JS `693.81 kB` (`184.82 kB` gzip), CSS `12.90 kB` (`3.82 kB` gzip). Dev-only item/arrow/biome QA harness symbols в `dist` отсутствуют. После каждого следующего `npm run build` повторно проверить:

- `dist/index.html` существует в корне;
- paths relative и работают при размещении не в `/`;
- `/sdk.js` остаётся platform path и local absence не блокирует меню;
- нет `.ts`, `.map`, `.psd`, raw source pack, tests и docs;
- нет имён с пробелами или кириллицей;
- uncompressed total укладывается в project budget и официальный лимит;
- high-risk assets из `ASSET_AUDIT.md` отсутствуют;
- hard reload direct entry не даёт 404;
- Yandex draft debug panel видит ready/gameplay calls в правильные моменты.

## Правило завершения P0 regression

Изменение считается проверенным для release branch, когда:

- typecheck, все tests, build, size и archive checks green;
- основной desktop smoke green;
- browser viewport matrix, representative mobile landscape и portrait overlay green;
- real-device touch/rotation smoke green;
- save/load round trip green;
- нет новых console errors/unhandled rejections;
- известное ограничение либо исправлено, либо честно записано в `PROJECT_STATE.md`/report и не является moderation blocker.
