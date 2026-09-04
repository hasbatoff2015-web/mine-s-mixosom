# Состояние проекта

## Последний проход: Anarchy spawn schematic → filesystem

- Ветка `cursor/anarchy-spawn-schem-import-3ff8` от `origin/main` `165f563` (Farming V1 + Networking V2).
- Canonical spawn source: owner `frontier_spawn2.schem` (Sponge). Не в git. Не IndexedDB dump. Не procedural world.
- `npm run server:import` принимает `.schem` / `--schem` и печёт через существующие `parseSchematic` + `importAnarchySpawn` (`ANARCHY_SPAWN_Y_SHIFT = -28`) в `FsWorldStore` (`WORLD_PATH` / `server/data/worlds/anarchy`). JSON dump сохранён.
- Существующий мир не перезаписывается молча: нужен `--force`, перед записью копия `anarchy.backup-<timestamp>`, roster `players` сохраняется. Farming IDs 150–157 и Networking V2 не менялись.
- Production startup по-прежнему `FsWorldStore.load("anarchy")` → restore. `WorldInstance.initialize` **не** читает `.schem`.
- Cloud VM не видит `C:\Users\миша\Desktop\GAMES\mine123\spawn_map\frontier_spawn2.schem`. Импорт реального файла — локальная команда владельца с тем же CLI.
- Report: `docs/reports/2026-09-04_anarchy-spawn-schem-import.md`.

## Последний проход: Farming V1 + Networking V2 union

- Ветка `cursor/farming-networking-v2-3ff8` от `origin/main` `aa0ee07403874fc72e483f53c2b1db176d33b649` (Farming V1 / PR #43). Donor Networking V2 = PR #42 `e5c77f334fa46b726372fb7d7d27283f213ea184`. Не blind `-X theirs`.
- Сохранены Farming IDs 150–157, `FarmingSystem`, kernel `world → farming → falling → players`, `hydrated`/`age` в protocol, SP/server hosts, assets, tests.
- Движение: FIFO `PlayerCommandQueue`, `ackCommandSeq`, prediction/reconciliation, serverTick remote interpolation, `PROTOCOL_VERSION = 3`. Старый latest-input + `stepTowardTarget` chase **не** production.
- Online-клиент по-прежнему не тикает farming. Сервер тикает `FarmingSystem` в том же 20 TPS kernel, затем FIFO players.
- Расследование регрессии: `docs/reports/2026-09-04_mp-smoothness-regression.md`. Integration: `docs/reports/2026-09-04_farming-networking-v2-union.md`.

## Farming V1 — 2026-09-04

- Feature branch: `codex/farming-core`, based on `origin/main` `4d803e5de22e551e3f71941c0abb03c91e78cf4c`. Existing block IDs are unchanged; Farming uses appended IDs 150–157.
- Shared Node-safe `FarmingSystem` runs after `VoxelWorld.tick` in the 20 TPS `GameplayKernel`. Hydration checks every 100 ticks; growth every 1200 ticks. Sparse per-chunk farming positions are tracked from committed block changes and restored chunk modifications; there are no per-crop timers, wall-clock catch-up, or full-world scan. An empty server active-center list pauses all farming until a player reconnects.
- Binary hydration uses existing Water occupancy at farmland Y/Y+1 and Chebyshev radius 4. Dry farmland remains farmland and preserves crop age; only growth pauses. Crops/stems use canonical `blockStates` (`hydrated`, `age`) for IndexedDB, filesystem snapshots, reconnect, and normal block update/batch networking.
- Wheat/Carrot/Potato/Melon/Pumpkin, five hoes, Bone/Bone Meal, foods, harvest tables, recipes, rare Survival bootstrap drops, vegetation batching, 15/16 farmland geometry, and deterministic attached stems are implemented through existing registries/managers.
- Anarchy stays server-authoritative for tilling, consumption/durability, growth RNG, Bone Meal, fruit, harvest, drops, crafting, furnace, and food. Online clients only request and render canonical state.
- Automated gates: directed farming/regression 267/267, core Farming 35/35, `test:sim` 42/42, `test:server` 78/78, all typechecks, import boundaries, Node/server smokes, build/size/archive PASS. Exact-main full-suite comparison added 36 passing tests and no failure class. Benchmarks: 1024 positions 6.066 ms; 4096 positions 13.908 ms on this machine. DEV WebGL `?qaFarming=1` visually checked dry/wet plots, all stages, stems/fruits, hoes, Bone Meal, and farming items.
- Detailed handoff: `docs/reports/2026-09-04_farming-core.md`.

Срез: **2026-09-04**. Версия: `0.1.0`, playable alpha.

## Последний проход: Online networking v2 integration

- Ветка `cursor/online-networking-v2-integrated-3ff8` от BASE `cursor/online-networking-v2-3ff8` (`1f5aafe`). Donor `codex/online-command-pipeline-v2` (`aa2ae9e`) — не mechanical merge. **Не merge main.** Существующие #37/#38/#39/#40 не rewrite.
- Контракт: CLIENT OWNS INTENT / SERVER OWNS RESULT. `LIVE = checkpoint[ackCommandSeq] + truly pending`. `PROTOCOL_VERSION = 3`.
- Movement: BASE FIFO + `ackCommandSeq`. Accepted ACK не мутирует live pose. Overflow compact только continuous-state; `queueCompacted` на протоколе.
- Block: BASE explicit intent + donor `targetBlockId` / hit-in-voxel / exact face / LOS+face. Eye из `actionPoseHistory[commandSeq]` или REJECT. Never silent B.
- Bow: BASE `localAim.ts`. Draw не сбрасывается stale FIFO `use:false`. Captured-aim Online spread=0. Reconnect zeros `bowUseTicks`.
- Remote: один `RemoteInterpolationBuffer`. serverTick clock, 12 samples, delay 100 ms пока нет underflow, затем clamp(100+jitterP95, 80..180). Recovery ≤100 ms. Teleport/respawn snap. Flying сохранён.
- Report: `docs/reports/2026-09-04_online-networking-v2-integration.md`. Final audit: `docs/reports/2026-09-04_final-online-and-gameplay-integration.md`.
- Integrated onto Farming `main` (`aa0ee07`) as union: FIFO/`ackCommandSeq` + Farming kernel `tickFarming` + block IDs 150–157. Protocol 3 keeps `hydrated`/`age`.

## Предыдущий проход: Online networking v2 (BASE PR #40)

- Ветка `cursor/online-networking-v2-3ff8`, от HEAD PR #39 (`c5fba74`). **Не merge в main.** Не rewrite #37/#38/#39.
- Контракт: CLIENT OWNS INTENT / SERVER OWNS RESULT. `PROTOCOL_VERSION = 3`.
- Movement: FIFO `PlayerCommandQueue`, one command per 20 TPS tick, sticky last if empty. ACK = `serverTick` + `ackCommandSeq` + bounded `appliedSteps[]`.
- Reconciliation: compare `history[ackCommandSeq]`. Accepted ACK must not mutate live pose (`diffMotionFull === []`). Real mismatch → restore + replay. Equiv 1e-4, not 0.03 pose slop.
- Block: sequenced `action` / targeted `interact` with target/face/hit. Validate A or reject. Never substitute neighbor B from delayed server ray. Mining locked to `break_start` target.
- Bow: `bow_release` with captured yaw/pitch. Use falling edge does not spawn arrows. Later look cannot change a released projectile.
- Remote: PR #38 serverTick buffer kept; telemetry expanded (jitter p50/p95, late/s, maxVisualStep).
- Local aim: PR #39 live look kept for capture; physics stays 20 TPS.
- DEV `predNo*` remains diagnostic only.
- Report: `docs/reports/2026-09-04_online-networking-v2.md`. Baseline: `docs/reports/2026-09-04_online-networking-v2-baseline.md`.
- Owner: two-client live QA still required (draft PR until confirmed).

## Последний проход: Local interaction aim (live look)

- Ветка `cursor/local-aim-desync-86e1`, от PR #38. **Не merge в main.** Remote interpolation / local prediction physics / server authority **не трогали**.
- Bug: first-person camera uses `InputManager` yaw/pitch every RAF; block pick / outline / bow used `PlayerController.viewDirection()` only on the 20 TPS tick → crosshair and selection could disagree (e.g. between two logs).
- Fix: one Node-safe `localInteractionAim` (canonical eye + live look). `refreshLocalCrosshair` on render for the outline; break/place/bow reuse the same aim. Physics still copies look inside `PlayerController.tick` / `tickOnline`. Third-person targeting stays eye+facing, not the presentation camera.
- DEV F3 `Aim cam/ply/look tgt n face`. `?aimDiag=1` documented; HUD is on in DEV F3.
- Tests: `tests/local-aim.test.ts`. Typecheck client/server/sim PASS.
- Report: `docs/reports/2026-09-04_local-aim-desync.md`.

## Последний проход: Remote player interpolation v1

- Ветка `cursor/remote-player-interpolation-86e1`, от HEAD PR #37 (`fd02b67`). **Не merge в main.** Local prediction / PlayerController / server TPS **не трогали**.
- Remote samples keyed by `player_state.tick`, not `performance.now()`. Arrival time is telemetry + elapsed term of the latest sample only.
- Clock: `clockTick = latestServerTick + (now - latestReceivedAt) / 50ms`; `renderTick = max(prev, clockTick - 2)`. Delay **100 ms** (2 ticks). Buffer max 8.
- Lerp xyz/pitch/velocity; shortest-path yaw; midpoint booleans. One snapshot → hold. Underflow → velocity coast ≤ 100 ms, then hold the **capped** pose (no snap back, no infinite coast).
- Rejoin `player_joined` resets the timeline. `player_left` disposes. Animator uses interpolated xz speed + vy/onGround/sprint/sneak. Actions still false/0 (next PR).
- DEV: F3 nearest-remote HUD; `?remoteDiag=1` logs one timeline/s.
- Tests: `tests/remote-player-interpolation.test.ts` A–K + jitter/yaw/reset/telemetry; view + diagnostics; entity tests uncoupled from remotes.
- Report: `docs/reports/2026-09-03_remote-player-interpolation.md`.
- Owner: two-client QA still required (A moves, B observes).

## Последний проход: Online Creative Flight permission (PR #37)

- Ветка `cursor/online-prediction-remesh-86e1`. **Не merge в main.**
- Live dump: server hover `y=71.666 vy=0 fly=true`, idle input every tick. Client checkpoint/history `fly=false` + gravity (`vy≈-1.57` then `-3.10`) → repeated Y correction / vertical jitter.
- Root cause: **не timeline.** `PlayerController.tick()` clears `isFlying` when `creativeFlightAllowed` is false. Singleplayer sets the flag every tick from `summary.mode`. Online `tickOnline` never did. Welcome set `summary.mode=creative` but left the new controller at default `false`. `player_state` only wrote the flag when gamemode **changed**, so it stayed false forever. Scratch `predictedStateFromCheckpoint` copies movement state only — permission is outside `PlayerMovementState`.
- Fix: sync `creativeFlightAllowed` from gamemode on startSession / tickOnline / sendOnlineIdle / snapshot **before** reconcile / inventory / respawn / setGameMode (same as SP). Scratch always receives that permission. `[corrDiag]` `FLIGHT:` prints local/scratch allowed vs checkpoint/predicted/snapshot flying.
- Не трогали physics constants, Y tolerance, smoothing, applied-input timeline.
- Tests: `tests/online-creative-flight-prediction.test.ts` — unsynced live falls vs server hover; scratch without permission drops fly; SP vs Online hover 200 ticks `corr=0`; flight forward / SHIFT / reconnect / alt-tab; survival walk/jump.
- Report: `docs/reports/2026-09-03_online-creative-flight-permission.md`.

## Последний проход: extra=3 vs tickGap=1 (PR #37)

- Ветка `cursor/online-prediction-remesh-86e1`. **Не merge в main.**
- Owner: `extra=seqGap` при `tickGap=1 physicsTicks=1`. **Не seqGap heuristic.** `extraTicks = simTicks = serverTick - lastAckedServerTick`. Comparable = lastAcked + **N ticks of latest input**.
- `tickGap` считается от last **received** `player_state` (`lastStateTick` на ingest). `lastAckedServerTick` только на reconcile commit. Latest-only pending slot теряет промежуточные snapshot'ы → simTicks=3, tickGap=1. seqGap совпадает случайно (клиент тоже натикал ~3 seq).
- Старый dump врал: `extra=max(0, physicsTicks-seqGap)` печатался рядом с значением simTicks.
- Stationary flight y-jitter **не** leftover `vy` от extra>1: live applied-input timeline показал server hover `vy=0 fly=true` while client prediction had `fly=false` + gravity. See Creative Flight permission pass.
- DEV: snapshot `appliedTicks` (последние 8 server physics ticks), `[corrDiag]` APPLIED INPUT TIMELINE + `extraAssignSite` + `pendingSlotOverwrites` + checkpoint y/vy.
- Report: `docs/reports/2026-09-03_checkpoint-extra-source.md`.

## Последний проход: prediction checkpoint (PR #37)

- Ветка `cursor/online-prediction-remesh-86e1`. **Не merge в main.**
- Owner dump: `seq=545 lastAck=543 gap=2 physicsTicks=1 firstDiff=x reject=xz`. Клиент предсказал seq 544 и 545; сервер сделал **один** physics tick latest-input 545. `history[545]` ≈ на один walk step впереди.
- **`inputSeq` не checkpoint.** Snapshot: `serverTick` / `tickNumber`, `physicsTicks=N`, `inputSeq` = latest movement **state**. Client history keyed by `clientPredTick`. Compare = last accepted pose + `simTicks` of that latest input. Не FIFO. Не seqGap heuristic / lerp / tolerance.
- Model B: клиент предсказывает каждый локальный 20 TPS tick; snapshot несёт authoritative tick. Model A отклонён (клиент не знает server slot). Model C (FIFO) запрещён.
- Timeline harness (`src/net/predictionTimeline.ts`): owner gap=2 воспроизводится; history would correct, checkpoint dist=0. То же для phase batches и fly+SHIFT 2-vs-1. Stationary flight checkpoint dist=0 (тот же timeline, не отдельный physics bug).
- Game: welcome/resync seed checkpoint; `reconcilePredictedPlayer(..., { physicsTicks, serverTick: message.tick })`.
- Tests: timeline + prediction + lockstep coalesce now **accept**; pipeline 10 Hz coalesce **corr=0**.
- Report: `docs/reports/2026-09-03_prediction-checkpoint.md`.

## Последний проход: one-correction diagnostic (PR #37)

- Ветка `cursor/online-prediction-remesh-86e1`. **Не merge в main.**
- Owner: 20/20 localhost, `sess socks=1`, всё ещё `corr/s` 5–11, `netPos/s`=`corr/s`, soft/snap/dup=0. Это **реальные positional corrections**, не TPS и не duplicate socket.
- **Диагностика, не фикс.** `[corrDiag:first]` полный dump (SEQ/TIMING/PHYSICS/INPUT/POSE/DIFF/STATE/WORLD). `physicsTicks=1` → compare `history[N]`; `=2` → `history[N]` + extra того же latest input. `lastInputSeq` ≠ physics tick.
- PlayerController lockstep 1…20 identical (walk/strafe/jump/idle/flight hover/fly+SHIFT). WorldInstance 1:1 vs `predictLocalMove` на Anarchy **совпадает** (тот же мир и frozen copy). Category C на этом harness снята.
- Coalesce-пример: seqGap=2 physicsTicks=1 → `firstDiff=z` distance≈0.208≈walkStep. Это B, не 20/20 1:1.
- Live 20/20 причина **ещё не доказана**. Нужен owner paste `[corrDiag:first]` с `?corrDiag=1`.
- Tests: correction-diag **10/10**; lockstep **6/6**; prediction **29/29**; typecheck PASS.
- Report: `docs/reports/2026-09-03_one-correction-diag.md`.

## Последний проход: hidden-tab Page Visibility (PR #37)

- Ветка `cursor/online-prediction-remesh-86e1`. **Не merge в main.**
- Owner: одна вкладка игры, переключение на ChatGPT на 1–2 с → jitter сильно хуже / иногда снова гладко. Не duplicate sessionToken.
- **Пока вкладка BACKGROUND:** `tickOnline` не бежит (pred=0, send=0). Сервер продолжает `lastInput` на 20 TPS. `player_state` приходит, но latest-slot + `duplicate-seq` ignore. Локальная поза заморожена, сервер уходит на ~`WALK_SPEED×hiddenSeconds`. Resume: RAF freeze → до 4 catch-up ticks со stale pose → correction storm. Сервер **не** копит FIFO команд — sticky lastInput.
- **Политика:** hide → один idle (сервер останавливается); show → `previousTime`/`accumulator` reset, force resync к последнему snapshot, history сброшена, look сохранён. Не меняли physics / tolerance / interpolation / TPS.
- DEV: F3 `visibility/focus/hiddenDurationMs/resumeTicks/resumeSnapshots`, `inGap/inBurst`; логи `[vis]`, `[vis-resume]`, `[vis-resync]`.
- Tests: hidden-tab **9/9**; prediction **29/29**; tick-clock **6/6**; typecheck client/server/sim PASS.
- Report: `docs/reports/2026-09-03_hidden-tab-visibility.md`.

## Последний проход: session isolation + event-loop / reconnect load (PR #37)

- Ветка `cursor/online-prediction-remesh-86e1`. **Не merge в main.**
- Owner: вторая вкладка с тем же sessionToken; после reconnect frame spike ~1697 ms; через минуту corr/s=0 но jitter; flight: snapSent~15, corr/s~11, catchUp/s=4, dropped=8.
- **Session:** `join()` заменял `sink`, но старый WebSocket оставался в `sockets` и мог звать `applyInput`. Close старого сокета делал `disconnect` живого игрока. Теперь: новый `connectionId` на resume, старый сокет `session_taken` + close, input только с live connectionId, close stale не дисконнектит. F3 `sess socks/src/snap/resume/fp` (fingerprint, не token). QA: **ровно одна вкладка**.
- **Load:** `syncChunksFor` больше не вызывает `serializeModifications()` на весь мир на каждый новый chunk. Бюджет 2 новых generate/sync, drain каждый outer loop. Welcome encode timed. Client: `[reconnectLoad]`, `[frameSpike]`, `[longtask]`, `?quietWorld=1`.
- tickClock: lateness/callback/ELD p95/p99/max, tickWall, entities, chunkSend/gen.
- Tests: tick-clock **6/6**; prediction **29/29**; isolation flags **8/8**; `test:sim` **42/42**; `test:server` **94/94**; typecheck/build PASS.

## Последний проход: 20 TPS server clock + catch-up comparable snapshots (PR #37)

- Ветка `cursor/online-prediction-remesh-86e1`. **Не merge в main.**
- Owner F3: pred/s=20, state/s=17, corr/s=3, netPos/s=3, soft=0. Остаток — **реальные xz/y corrections**, не speed/flying.
- Root cause: `setTimeout(tickMs - work)` копит Node slack → outer loop ~17 Hz. Catch-up крутит 20 physics ticks, но **один** snapshot после 2 ticks с `inputSeq=N`. Клиент сравнивал `history[N]` (1 tick) с позой на 2 ticks → rewind ~walk step, corr/s≈3.
- Fix: абсолютный 20 Hz слот (`scheduleNextTickSlot`); snapshot несёт `physicsTicks`; reconcile сравнивает `history[N]` плюс `max(0, physicsTicks - seqGap)` extra ticks того же latest input. Не lerp, не больше tolerance.
- DEV: F3 `srv phys/s snapGen/s snapSent/s`; `[corrDiag]` на каждую коррекцию (`firstDiff`, `physicsTicks`).
- Tests: tick-clock + prediction + move-sim + isolation **69/69**; `test:sim` **42/42**; `test:server` **89/89**; typecheck/build PASS.
- Report: `docs/reports/2026-09-03_server-tick-clock-corrections.md`.

## Последний проход: incoming local `player_state` side effects (PR #37)

- Ветка `cursor/online-prediction-remesh-86e1`. **Не merge в main.**
- Owner QA: Normal Online jitter; `?predNoState=1` полностью гладкий (`send=on state=OFF`). Значит, prediction / PlayerController / fixed-step render / outbound input OK. Баг — **приём local `player_state`**.
- Root cause: `ackRejectReason` rewind'ил на `speed` / `onGround` / `flying` даже при совпавшем xz/y. Fly+SHIFT `vy ≈ 7.5` vs `PREDICTION_ACCEPT_SPEED = 0.2` → каждый snapshot `restoreAuthoritativePlayer` писал `velocity.y` + replay без `LocalPlayerRenderState.pushAfterTick`. `predNoState` этот путь пропускает.
- Fix (минимальный): pose-only accept (`xz`/`y`); speed/onGround/flying = `softReject` (лог, без restore). Snapshot queue до начала `tickOnline`. Survival `restore` только если health/hunger/dead изменились.
- DEV: `?predStateObserve=1`; category skips; per-field mutation log; `[firstBadEvent]` + `soft=`. `predNoState` сохранён.
- Tests: flags **8/8**, matrix **8/8**, prediction **28/28**, player-main **4/4**, pipeline **8/8**, render-state **8/8**, remesh **4/4**; `test:sim` **42/42**; `test:server` **83/83**; typecheck/build PASS. Full vitest **1346 passed / 8 failed** (pre-existing authored ENOENT + minecart 5s timeouts).

## Последний проход: network-path isolation (PR #37)

- Ветка `cursor/online-prediction-remesh-86e1`. **Не merge в main.**
- Ручной A/B: Normal Online jitter; `?predNoNet=1` идеально гладкий. Значит, остаток в **online network path**, не в PlayerController и не в generic render interpolation.
- DEV isolation: `?predNoState=1` (send+predict, skip local `player_state`), `?predNoSend=1` (no movement send, still receive/apply), `predNoNet` = оба. F3: `online/normal|noState|noSend|noNet`.
- Accepted/ignored local snapshot больше не пишет look/riding/gamemode unless the value changed; reconcile accept is a full-field no-op.
- DEV trace: every local-player network mutation (source/old/new), send/recv rates, collision-volume block/chunk events, first visible render jump dump, optional `clientSentAt` → snapshot `netTiming`.
- Physics constants / render lerp / correction tolerance / urgent remesh не менялись.
- Tests: flags **6/6**, matrix **6/6**, prediction **24/24**, pipeline **8/8**, render-state **8/8**, remesh **4/4**; `test:sim` **42/42**; `test:server` **83/83**; build PASS.

## Последний проход: LocalPlayerRenderState (PR #37)

- Ветка `cursor/online-prediction-remesh-86e1`. **Не merge в main.**
- Restore `previousPosition` на pose до всего кадра **не** помог QA (~155 FPS, `corr/s≈0`) и математически тянет камеру назад к `S1` (`lerp(S1,S3,leftover/dt)`).
- Render больше не читает `PlayerController.previousPosition`. `LocalPlayerRenderState` хранит завершённые sim-pose и интерполирует **соседнюю** пару `S_{n-1}→S_n` при `alpha = leftover/dt`. Physics previousPosition только для fall distance.
- DEV: F3 `rΔ min/max/neg/s/big/s` + camera; `?predNoNet=1` (predict без send/snapshot). Синтетика 60/120/144/165 FPS без WebSocket.
- Tests: render-state **8/8**, pipeline **8/8**, prediction **24/24**; `test:sim` **42/42**; `test:server` **83/83**; build PASS.
- Report: `docs/reports/2026-09-03_local-player-render-state.md`.

## Последний проход: fixed-step interpolation window (PR #37)

- Ветка `cursor/online-prediction-remesh-86e1`. **Не merge в main.**
- Ручной QA: jitter на walk/sprint/jump/strafe/flight/fly+SHIFT при `corr/s=0`. Stationary чистый. Это не rubber-band и не FIFO.
- Root cause: `PlayerController.tick` копирует `previousPosition` на **каждый** inner tick. `render = lerp(prev, pos, leftover/dt)` после 2 ticks в одном кадре показывает начало последнего tick ≈ целый physics step относительно прошлого кадра (alpha был ~1). Online чаще даёт 2-tick кадры (remesh/WS hitch); выражение то же, что в SP.
- Fix: в `Game.frame` после цикла ticks вернуть `previousPosition` на pose **до** первого tick кадра. Один tick — no-op. Physics constants / networking / urgent remesh / smoothing не трогали.
- Tests: fixed-step **6/6**, pipeline **7/7**, prediction **24/24**, remesh **4/4**; `typecheck*` PASS; `test:sim` **42/42**; `test:server` **83/83**; build PASS.
- Report: `docs/reports/2026-09-02_fixed-step-interpolation.md`.

## Последний проход: диагностика correction 0.3–0.6 и 20 TPS catch-up (PR #37)

- Ветка `cursor/online-prediction-remesh-86e1`. **Не merge в main.**
- F3: `prd/s=20` `state/s=18` `corr/s=1` avg 0.34 max 0.64. Lockstep PlayerController **не** расходится (1…20 ticks). Это не H.
- Причина: `setInterval(50)` ≈ 18 Hz без catch-up; клиент предсказывает 20 шагов, сервер один latest-input tick → rewind на 1–3 walk step. `tickCatchUp` симулирует owed ticks и шлёт **один** snapshot. FIFO не возвращали.
- DEV: `?corrDiag=1`, F3 snap recv/drop/gap, `FC_DEBUG_SNAP=1`, `/predsim`.
- Report: `docs/reports/2026-09-02_online-correction-diagnosis.md`.

## Последний проход: убрать FIFO movement queue (PR #37)

- Ветка `cursor/online-prediction-remesh-86e1`. **Не merge в main.**
- FIFO `inputQueue` (1 пакет / tick, cap 64) давал 300–400 ms stale WASD и bow release 3.2 s (64×50 ms). Старые `use:false` в очереди сбрасывали charge → стрела иногда не вылетала.
- Movement снова **latest state**: `lastInput` / `lastInputSeq`, один `PlayerController.tick` за 20 TPS, `snapshot.inputSeq = lastInputSeq`. Jump pulse и bow/food release latch. Attack/break/place по-прежнему отдельные immediate messages.
- Prediction: сравнивать `history[N]` с latest seq; не replay'ить пропущенные movement seq. Urgent remesh / GRAVITY / 20 TPS не трогали.
- Report: `docs/reports/2026-09-02_online-input-queue-revert.md`.

## Последний проход: Online local-motion pipeline (SP vs Online)

- Ветка `cursor/online-prediction-remesh-86e1` (PR **#37**). **Не merge в main.**
- Accept-path PR #37 был прав: matching ack **не** пишет pose. Ручной QA без улучшения — потому что localhost `lastInput` coalescing давал **correction каждый снимок**, а не accept.
- Root cause визуального 20 Hz: сервер симулировал только последний пакет за tick; `history[N]` = два клиентских шага, snapshot = один. Restore на предыдущий tick совпадает с `previousPosition` → `lerp` вырождается. Камера уже была `interpolated-local` (те же строки, что SP).
- Попытка FIFO `inputQueue` (один seq / tick) дала 300–400 ms stale WASD и bow delay 3.2 s — **откатили**. Актуальная семантика: latest-input, см. проход выше. Small correction по-прежнему не копирует `previousPosition = position`. GRAVITY/JUMP/WALK/SPRINT/FIXED_DT/offline physics/urgent remesh не трогали.
- DEV F3 `Motion …` + `?motionDiag=1` (2 s trace). Pipeline: SP и queued online mean render step ~0.070; coalesce 10 Hz = 20 corrections / 2 s.
- Report: `docs/reports/2026-09-02_online-local-motion-pipeline.md`.

## Последний проход: Online Anarchy prediction-history jitter fix

- Ветка `cursor/online-prediction-remesh-86e1` (PR **#37**). **Не merge в main.**
- Root cause jitter: каждый `player_state` делал restore+replay, даже когда prediction уже совпадала. Сравнивался live pose с результатом replay, а не snapshot seq N с predicted state **после** seq N. `previousPosition`/`position` дёргались на 20 Hz. Server `inputSeq` = lastInput этого tick (пропущенные seq не симулируются).
- Исправление: history 64 `{seq, input, stateAfter}`. Ack сравнивает snapshot с predicted state at N. В пределах допуска — **не трогать** position/velocity/previousPosition и не replay. Иначе rewind к N и replay только seq > N. Duplicate `inputSeq === lastAckedSeq` игнорируется (server reused lastInput).
- Urgent remesh из того же PR сохранён. GRAVITY/JUMP/WALK/SPRINT, 20 TPS, offline physics не менялись.
- Report: `docs/reports/2026-09-02_online-prediction-jitter.md`.

## Последний проход: Online Anarchy prediction + urgent remesh

- Ветка `cursor/online-prediction-remesh-86e1` от актуального `origin/main` `4d803e5`. **Не merge в main.**
- Root cause движения: клиент **не** крутил `PlayerController` online. `player_state` становился XYZ-target, `stepTowardTarget` (`LOCAL_APPROACH_PER_SECOND = 18`) экспоненциально догонял **включая Y**. Серверная jump arc визуально превращалась в chase stale target → floaty / levitation / краткий «залип» в воздухе. GRAVITY/JUMP_VELOCITY не менялись. Offline physics не трогали.
- Исправление: тот же `PlayerController` на клиенте предсказывает каждый 20 TPS input; buffer unacked seq; snapshot несёт `inputSeq`; rewind + replay. Нет per-frame XYZ chase. Snap только при коррекции ≥ 6 блоков. Server остаётся gameplay authority (health/world/combat).
- Root cause блоков: `applyNetworkBlockChanges` сразу пишет VoxelWorld (collision), а `WorldRenderer.rebuildDirty` ждал `!hasPendingLighting`. Видимая геометрия отставала на кадр+. Urgent remesh: `preferKeys` + `allowPendingLighting`, budget 2 ms / 3 chunks. `WORLD_JOB_BUDGET_MS` / `WORLD_LIGHT_BUDGET_MS` не поднимались. Remesh не в WebSocket handler.
- Server tick hitch: DEV `FC_DEBUG_TICK_MS=1`. Измерение 40 walk/sprint/jump ticks: mean gameplay ~0.32 ms, max wall ~4.1 ms, **нет spike > 50 ms**. Обычный air hitch — клиентский chase, не server tick. Performance guess-fix не делали.
- Report: `docs/reports/2026-09-02_online-prediction-remesh.md`.

## Последний проход: интеграция UI PR #22 с server + breaking + player main

- Существующая ветка Draft PR **#22** `codex/ui-visual-system-pass` объединена обычным `git merge --no-ff` с точным `origin/main` `020d9d38d58f2d23231683a6aca736acf813bcb7`. Сохранены server-authoritative Online Anarchy, GameplayKernel, lifecycle/save contracts, PR #28 breaking overlay и PR #31 PlayerVisual/F5.
- `GameUI` остаётся единым DOM owner: live server status, authoritative cursor/craft slots, inventory action submission, online containers, death/respawn и chat focus-race fix из main сохранены вместе с Press Start 2P/Inter, UI tokens, responsive HUD, authored hunger icons, loading hierarchy, compact Creative и World Select redesign.
- Delete-dialog теперь имеет `aria-describedby`, explicit two-button Tab/Shift+Tab focus loop, Escape/Cancel/backdrop close и возврат фокуса на исходный Delete. Storage по-прежнему меняется только через существующий `WorldListActions.delete` callback.
- DEV router сохраняет все независимые fixtures: `?qaUi=...`, `?qaBreaking=1`, `?qaPlayer=1`; UI fixture не создаёт WebGL world и не пишет saves.
- UI gate **50/50**, объединённый UI/player/overlay/server/network gate **241/241**, shared sim **42/42**, server **73/73**. Все typechecks, boundaries, Node smokes, build, size и archive проходят.
- Full comparable run: feature **118/122 files, 1251/1267 tests**, exact main **114/119 files, 1236/1253 tests**. Нового failure class нет; остаются baseline CPU timeouts, stale geometry fingerprint, reference-extractor parse и worker RPC. Exact-main worktree дополнительно не имел ignored authored source-pack.
- Actual browser: responsive matrix **28/28** на 1920×1080, 1366×768, 1280×720, 932×430, 896×414, 844×390, 740×360; font/HUD/Creative/World Select/online offline-state/focus loop и доступность `qaPlayer`/`qaBreaking` проверены без console diagnostics. Build: **3.88 MiB / 284 files**.
- Handoff: `docs/reports/2026-09-02_pr22-ui-server-player-integration.md`; исходный UI report дополнен секцией `POST-SERVER + PLAYER INTEGRATION`.

## Исходный UI visual system / HUD / loading / Creative / World Select — 2026-08-30

- Ветка поставки: `codex/ui-visual-system-pass`, baseline `origin/main` = `a056e6f5d4b7f2e206b697f0a774ece921cbbefa`. Задача UI-only: gameplay, fixed 20 TPS, world simulation, input/pointer-lock ownership и save schema не менялись.
- Production typography теперь self-hosted: Press Start 2P для display/game identity, Inter для интерфейсного текста, системный monospace только для debug. Локальные Cyrillic/Latin WOFF2 и OFL-записи описаны в `docs/FONT_ASSETS.md`; CDN/runtime network dependency нет.
- Loading имеет отдельные brand/phase/progress/detail уровни, determinate `role=progressbar`, `aria-valuenow` и видимый процент. `updateWorldLoading` продолжает патчить существующие DOM-узлы без полного remount.
- HUD получил общую responsive width model для status bars и 9-slot hotbar: desktop 50 px slots (60 px на wide desktop), low-height landscape 35 px. Hearts, absorption и armor сохранены. Hunger больше не использует OS glyph: десять authored full/half/empty SVG drumsticks строятся pure helper'ом.
- Creative расширяет существующий `GameUI`/`.mc-stage`: catalog остаётся scroll host, `onClose` остаётся canonical callback. `MC_CREATIVE_HEIGHT=166`; catalog ограничен шестью logical rows, hotbar больше не прижимается через `margin-top:auto`. Close — отдельный beveled stage sibling, фактический hit target 44–56 px; scale учитывает panel + gap + close.
- World Select сохраняет single click selection, double click load и существующие callbacks. Добавлены mode badge, дата/время/seed hierarchy, явный selected marker, primary Play и danger Delete. Native `window.confirm` заменён локальным accessible dialog с фокусом, Cancel/Escape/backdrop и тем же `actions.delete`.
- DEV-only `?qaUi=loading|hud-full|hud-low|hud-absorption|creative|world-list` монтирует только `GameUI`, не создаёт WebGL world и не читает/пишет IndexedDB saves. Production import tree-shaken через `import.meta.env.DEV`.
- Validation: typecheck PASS; UI targeted **46/46**; build/size/archive PASS, **3.73 MiB / 228 files**. Actual in-app Chromium responsive matrix Loading/HUD/Creative/World Select: **28/28** at 1920×1080, 1366×768, 1280×720, 932×430, 896×414, 844×390, 740×360; no clipping, overlap, document overflow, loading-card scrollbar or console diagnostics. Creative scroll/tabs/close and World Select selection/double-click/dialog Cancel/Escape/delete passed.
- Full `npm test -- --maxWorkers=2`: **982 passed / 14 failed / 996**, plus one Vitest worker RPC error. All new/retained UI suites pass. Failures are outside this diff: 12 default 5 s CPU timeouts (worldgen/sunlight/minecart), existing GeneratedItemGeometry source fingerprint mismatch, intermittent mob separation, and reference-extractor parse failure; thresholds and unrelated code were not changed.
- Full details and handoff: `docs/reports/2026-08-30_ui-visual-system-hud-menu-polish.md`.

## Последний проход: post-server integration PR #31 player skins / character / third-person

- Существующая ветка Draft PR **#31** `cursor/player-skins-third-person` объединена обычным merge с server-authoritative `origin/main` `57724f6`; PR #28 breaking overlay и весь GameplayKernel/server/shared/tooling stack сохранены.
- `Game.tickOnline` не запускает client world simulation. Perspective и `PlayerVisual` остаются presentation-only; gameplay targeting/reach по-прежнему строятся из `PlayerController.eyePosition()` / `viewDirection()`.
- `RemotePlayerView` больше не создаёт временный `BoxGeometry`: bounded snapshot interpolation управляет feet/yaw/pitch/velocity/state, а canonical `PlayerVisual` отвечает за rig, render-frame locomotion, invisibility и shared entity lighting.
- Protocol не расширялся: remote использует `DEFAULT_PLAYER_APPEARANCE`, empty-hand neutral fallback и не получает PNG/base64/texture payload. `selectedSlot` без authoritative item id не используется для угадывания held item.
- F5 сохраняет `first → back → front → first`, обрабатывается только edge-triggered в active gameplay и не очищает WASD/input sequence или network session. Camera collision читает canonical `world/blockGeometry`/collision boxes.
- `BlockBreakingOverlay` остаётся render-path consumer того же authoritative eye/look target во всех perspectives; mapping/cache/no-remesh contract не менялся.
- Focused player gate **41/41**, expanded player/server/network/overlay gate **236/236**, shared sim **42/42**, server **73/73**; all typechecks, boundaries, Node smokes, build, size and archive pass. Full comparable run has no new failure class versus exact main; details below.
- Подробности исходной реализации: `docs/reports/2026-08-31_player-skins-third-person.md`; post-server results добавлены в его секцию `POST-SERVER INTEGRATION`. Отдельный integration handoff: `docs/reports/2026-09-02_pr31-player-visual-server-integration.md`.

## Minecraft-compatible player skins и third-person camera

- В production подключены **45 уникальных пользовательских 64×64 RGBA skins** из переданного `skins.zip` (один byte-identical duplicate отброшен): 20 Classic и 25 Slim по каноническим прозрачным arm-зонам. Default — `frontier_explorer` (Classic). Дополнительно есть authored DEV `player_uv_test` с разными цветами граней. Старый `entity/steve.png` не используется новым player pipeline.
- Канонический контракт — `PlayerAppearance { skinId, model, layers }`. `MinecraftSkinRegistry` держит одну nearest/no-mipmap texture на `skinId`, ref-count освобождает старую texture; `PlayerSkinGeometryCache` делит immutable geometry между экземплярами.
- `PlayerVisual` — артикулированная модель высотой 1.8 блока: раздельные head/body/arms/legs, правильные modern 64×64 left/right UV, Classic 4 px arms, Slim 3 px arms и пониженный Slim shoulder pivot, отдельные hat/jacket/sleeves/pants overlays. Feet origin совпадает с `PlayerController.position`.
- First-person empty arm использует тот же appearance/texture и right-arm UV, включая right sleeve toggle. Runtime `Game.setPlayerAppearance()` меняет world + viewmodel без reload мира.
- F5 в активном gameplay циклически переключает `firstPerson → thirdPersonBack → thirdPersonFront → firstPerson`; вне gameplay browser F5 не перехватывается. Default third-person distance — 4 блока. Восемь corner probes проверяют swept camera volume через `blockCollisionBoxes`; препятствие втягивает камеру сразу, освобождение восстанавливает distance плавно. Gameplay raycast/targeting остаётся от authoritative player eye/view.
- World player visual обновляется на render frame из interpolated feet и live input look, но physics/combat/mining остаются fixed 20 TPS. Есть walk/sprint/sneak/jump/fall/swing/mining/bow/sword-block/food poses, independent head/body yaw, cached third-person held item, voxel entity lighting, hurt tint и invisibility (skin скрыт, held item остаётся).
- DEV `?qaPlayer=1`: 46 skin entries (45 supplied + UV QA), Classic/Slim, layers, poses, sword/pickaxe/block/bow/food, head yaw/pitch, hurt/invisibility и first/back/front. Browser QA подтвердил front/back UV, Slim shoulder, first-person arm, layer draw-count `13 → 7`, held pickaxe/bow; console warnings/errors отсутствуют.
- Права на 45 пользовательских skins не выводятся из технической интеграции: перед публикацией владелец проекта должен подтвердить происхождение/лицензии, особенно для узнаваемых персонажей. Generated ImageGen concept сохранён только в ignored `.local/` и не ship/commit.
- Подробности и validation: `docs/reports/2026-08-31_player-skins-third-person.md`.

## Последний проход: интеграция PR #28 block breaking overlay

- Ветка существующего Draft PR **#28** `cursor/block-breaking-overlay-3f86` объединена обычным merge с `origin/main` `a305dc5`; серверная архитектура Online Anarchy из main сохранена.
- `BlockBreakingOverlay` остаётся presentation-only consumer существующего `session.miningProgress`. Singleplayer mining simulation не менялась; Online client только показывает local visual feedback и отправляет input/request, а фактическое разрушение выполняет server `ServerGameplay` и подтверждает authoritative `block_update` / `block_batch`.
- Canonical renderer path: `miningProgress → WorldRenderer.setBreakingProgress(...) → BlockBreakingOverlay`. Mapping: `progress <= 0` и `progress >= 1` скрыты; промежуточный stage = `min(9, floor(progress * 10))`.
- Геометрия использует canonical simulation contract `src/world/blockGeometry.ts` и rendering wrapper `selectionBoxesForBlock`: cube, slab, stairs, fence connections, door и остальные selection shapes. Stage меняет cached texture/material/geometry; chunk dirty/remesh не вызывается.
- Production textures: original Frontier 32×32 masks at `public/textures/gui/destroy/destroy_stage_0.png` … `_9.png`. Local Mojang `assets/minecraft/textures/blocks/destroy_stage_*.png` were documented in the asset audit but are **not** in this workspace and were **not** committed.
- DEV harness: `/?qaBreaking=1`. Исходный визуальный отчёт: `docs/reports/2026-08-31_block-breaking-overlay.md`; integration report: `docs/reports/2026-09-02_pr28-block-breaking-overlay-integration.md`.

## Последний проход: Phase 8 plugin platform

- Ветка `cursor/plugin-platform-37a2` от PR **#34** HEAD `81211b1` (`cursor/inactive-client-world-sync-37a2`). **Не merge в main.** Не сворачивать Anarchy stack в main. Не начинать homes/tpa/economy.
- PluginManager был foundation (API + EventBus + `enableAll`), без discovery, без scoped cleanup, без kernel-adjacent semantic events. Phase 8 делает server-only platform: lifecycle, `PLUGIN_API_VERSION`, scoped ServerAPI, EventBus isolation, pre/post events, command unregister, disk discovery.
- Live discovery: `server/plugins/` (`FC_PLUGIN_DIR`). Stock dir is empty — `/hello` is not a built-in. Canonical example: `server/plugin-examples/hello.ts` (copy into `server/plugins/` or `FC_EXAMPLE_PLUGIN=1`). Test fixtures stay under `tests/server/fixtures/plugins/` (includes broken/invalid — do not point `FC_PLUGIN_DIR` there for ordinary QA).
- Shared `simulationEvents.ts` + server `pluginEventAdapter`. Shared core не импортирует PluginManager. Singleplayer / client bundle без plugin runtime.
- Не трогать PR **#22** / **#28** / **#31**. Не закрывать **#30** / **#32** / **#33** / **#34**.
- Report: `docs/reports/2026-09-01_plugin-platform.md`. Targeted **216/216**. Full vitest **1211/7** (authored ENOENT + minecart 5s + RPC). Production **3.65 MiB / 221 files**. Draft PR **#35**. Owner local QA. **Не merge.**

## Последний проход: inactive Anarchy client world sync

- Ветка `cursor/inactive-client-world-sync-37a2` от Phase 7 HEAD `a995ded` (PR **#33**). **Не merge в main.** Не Phase 8.
- Root cause: `block_update` / `block_batch` сразу пишут VoxelWorld, но `processWorldJobs` (light + remesh) шёл только в `PLAYING`. Entity interpolation в `render()` поэтому жил, а блоки ждали Continue / refocus.
- Fix: online `shouldProcessOnlineWorldVisuals` для PLAYING / PAUSED / BACKGROUND. Kernel / tickOnline по-прежнему только PLAYING. Нет очереди пакетов, нет второго fluid/LightEngine.
- Targeted: `inactive-client-world-sync` 12 + session/Anarchy/fluid packs. Full vitest **1194/7** (authored ENOENT + minecart 5s + RPC). Production **3.65 MiB / 221 files**.
- Report: `docs/reports/2026-09-01_inactive-client-world-sync.md`. Owner local QA (inventory / pause / tab / fluid / two clients). **Не merge.**

## Последний проход: Phase 7 tooling split

- Ветка `cursor/shared-tooling-split-37a2` от architecture HEAD `15cc8d7` (`cursor/entity-initial-light-finalize-37a2`, PR **#32**). **Не merge в main.** Не Phase 8. PR **#30** / **#32** не закрывать. Не трогать PR **#22** / **#28** / **#31**.
- Compile boundaries: `tsconfig.sim.json` (no DOM, no Three), `tsconfig.client.json`, `tsconfig.server.json`. Umbrella `tsconfig.json` + `npm run typecheck` remain.
- Shared sim: `Vec3` instead of `THREE.Vector3`; `MoveInput` instead of DOM `InputManager`; `LifecycleState` in `lifecycleTypes.ts`. `src/entities/index.ts` no longer exports `ThreeEntityHost`. Server does not import `three` / rendering.
- Guards: `npm run check:boundaries`, `npm run smoke:sim` (Node loader throws on `three`), `npm run smoke:server`. `npm run check` includes boundaries.
- GameplayKernel order, useInteraction, blockGeometry, EntityHost, persistence, RNG, lighting budget **2**, chest sync, death visual clock, plugins-unwired — unchanged.
- Targeted: `test:sim` 38/38; server/entity/death pack 81/81. Full vitest: same baseline class as #32 (authored ENOENT + minecart 5s timeouts + RPC). Production **3.65 MiB / 221 files**.
- Report: `docs/reports/2026-09-01_shared-tooling-split.md`. Draft PR **#33** stacked on **#32**. Owner local QA (SP + Anarchy + two clients, **no gameplay change**). **Не merge. Не начинать Phase 8.**

## Последний проход: Online Anarchy initial entity lighting (finalize)

- Ветка `cursor/entity-initial-light-finalize-37a2` от PR **#30** HEAD `068b7df`. **Не merge в main.** Не Phase 7. PR **#30** не закрывать.
- Review #30: mob `syncVisual` / drops / falling / arrows `applyRenderPose` / primed TNT interpolate already re-sample light every client visual refresh. Hurt is not required.
- Remaining same-class gap: `MinecartManager.interpolateVisuals` only moved the mesh. Online skips `update()`, so join-time carts stayed at the unlit spawn sample. Now interpolate applies `EntityHost.applyLight` at the displayed pose (headless no-op).
- Tests: isolation of two join-time mobs (hurt A does not change B), minecart interpolate without a sim tick, skeleton `entity_snapshot` restore. LightEngine / budget **2** unchanged. Targeted **48/48** (10 initial-lighting). `tsc` + production build PASS.
- Report: `docs/reports/2026-08-30_entity-initial-lighting.md`. Owner local QA (A11). **Не merge. Не начинать Phase 7.**

## Последний проход: Online Anarchy initial entity lighting

- Ветка `cursor/entity-initial-light-fix-bbb1` от Phase 6 HEAD `2e21bf3` (`cursor/shared-rng-lighting-adapters-bbb1`, PR **#29**). **Не merge в main.** Не Phase 7.
- Root cause: online client не вызывает `MobManager.update()` (нет второй симуляции). `spawn()` семплирует `entityLight` один раз, часто до `chunk_data` / deferred `processLighting`. `syncVisual` / `tickRemoteVisuals` обновляли свет **только при hurt flash**. Hit → `applyAuthoritativeHurt` → повторный sample уже по lit chunk. Dynamic spawn после streaming попадал в готовый свет.
- Fix: visual sync всегда вызывает `applyMobLight` (pose coords). Тот же contract для drops / falling / arrows / primed TNT interpolate. Headless server без Three. LightEngine / budget **2** / daylight formula не трогали.
- Targeted: `entity-initial-lighting` 7 + hurt-flash, entity-lighting, entity-host, death-animation, lighting-adapter. `tsc` clean.
- Report: `docs/reports/2026-08-30_entity-initial-lighting.md`. Draft PR stacked on **#29**. Owner local QA (A11). **Не merge.** Phase 7 tooling split — отдельная ветка после этого фикса.

## Последний проход: Phase 6 RNG + lighting adapters

- Ветка `cursor/shared-rng-lighting-adapters-bbb1` от chest-sync HEAD `a8c9579` (`cursor/chest-online-sync-fix-bbb1`, PR **#27**). **Не merge в main.** `origin/main` (`a056e6f`) без Anarchy. **Не начинать Phase 7.**
- Simulation RNG больше не вызывает `Math.random` напрямую. `RandomSource` / `systemRandomFn` / `seededRandomFn` в `src/gameplay/random.ts`. Live SP `Game` и Anarchy `ServerGameplay` инжектят `SYSTEM_RANDOM` (тот же `Math.random` под адаптером), чтобы spawn/loot sequences не сдвинулись. Тесты могут подставить seeded source.
- Visual RNG остаётся client-only `Math.random`: potion particles, audio pitch/variant. Save world id / default seed — identity, не tick simulation. Terrain по-прежнему `mulberry32` / `hashCoords` в `Generator` (не смешивать с tick RNG).
- Lighting: `LightingAdapter` классифицирует `deferred` (client) vs `immediate` (server). `processDeferredLighting` no-op на immediate world, чтобы сервер не гонял client scheduler. Flood остаётся в `LightEngine`. `WORLD_LIGHT_BUDGET_MS = 2` не поднимали. Lateral sky radius 14 не трогали.
- Simulation light queries (`combinedLight`, `getDirectSkyLight`, `sampleVoxelLightLevels`) реэкспорт из `world/lightingState.ts`. Shader compose остаётся в `rendering/worldLighting.ts`.
- Не тронуты: GameplayKernel order, useInteraction, blockGeometry, EntityHost, persistence, protocol, chest GUI sync (#27), death visual clock, fluids, combat numbers, worldgen algorithms, spawn, Anarchy id/path.
- Targeted: 12 files **167/167** (`random-source` 6, `lighting-adapter` 4, lighting-jobs/height-256/scheduler, kernel, combat, explosion, hostile-spawn, anarchy-gameplay, use, entity-host). `tsc` clean. Production **3.65 MiB / 221 files**.
- Full `npm run check`: **1169 passed / 8 failed** (2 authored ENOENT `bucket_empty.png` + 6 minecart 5s timeouts) + 1 vitest RPC `onTaskUpdate`. Same class as PR **#27** (1160/7); +10 new tests, one extra minecart flake under full-suite load. Not hidden.
- Report: `docs/reports/2026-08-30_shared-rng-lighting-adapters.md`. Draft PR **#29** stacked on **#27**. Owner local QA. **Не merge. Не начинать Phase 7.**

## Последний проход: Online Anarchy chest GUI sync

- Ветка `cursor/chest-online-sync-fix-bbb1` от Phase 5 HEAD `cc74c11` (`cursor/shared-persistence-port-bbb1`, PR **#26**). **Не merge в main.** Не Phase 6. Persistence / GameplayKernel / protocol types не менялись.
- Root cause: server already sent `inventory.window.slots` after each click, but the client applied those slots only when opening the GUI (`!isInventoryOpen()`). An already-open chest kept the stale `getChest().slots` array; player inventory/cursor did refresh. Close→reopen looked correct.
- Fix: `applyAuthoritativeContainerSlots` always; `shouldOpenOnlineContainer` only for the first open. Server `flushSharedContainerViewers` sends the same `inventory` packet to other players with that chest/furnace open.
- Targeted: `online-container-sync` 5, `anarchy-chest-sync` 8, container-ui, inventory, anarchy-server, kernel, use. `tsc` clean. Production **3.65 MiB / 221 files**.
- Full `npm run check`: **1160 passed / 7 failed** (2 authored ENOENT `bucket_empty.png` + 5 minecart 5s timeouts) + 1 vitest RPC. Same baseline as PR #26. Not hidden.
- Report: `docs/reports/2026-08-30_chest-online-sync.md`. Draft PR **#27** stacked on **#26**. Owner local QA. **Не merge. Не начинать Phase 6.**

## Последний проход: Phase 5 persistence port

- Ветка `cursor/shared-persistence-port-bbb1` от death-animation HEAD `7ae826b` (`cursor/entity-death-animation-smoothness-bbb1`, PR **#25**). **Не merge в main.** `origin/main` (`a056e6f`) без Anarchy. **Не начинать Phase 6 (RNG/lighting adapters).**
- Canonical gameplay record: `WorldSnapshot` (`SerializedWorldState`, `WORLD_SCHEMA_VERSION = 1`). `WorldStore`: load/save/exists (+ delete/list). SP `IdbWorldStore` (тот же IndexedDB `frontier-cubes-saves` / `worlds`). Server `FsWorldStore` → `server/data/worlds/<id>/{meta,world,players}.json`.
- Mapper `snapshotToFsRecords` / `fsRecordsToSnapshot`. Import: dump → `parseWorldSnapshot` → `FsWorldStore`. Corrupt existing FS throws `PersistenceError` (no silent procedural reset). Concurrent FS saves queued. Snapshot только на save/export.
- Не тронуты: GameplayKernel, useInteraction, blockGeometry, EntityHost, protocol, spawn, Anarchy world id/directory, IDB names, visual clocks.
- Targeted: `world-snapshot` 5, `idb-world-store` 3, `fs-world-store` 6, lighting Game save-path 24/24, anarchy persist/restart 48/48, kernel/use/geometry/entity-host/death green. `tsc` clean. Production **3.65 MiB / 221 files**.
- Full `npm run check`: **1147 passed / 7 failed** (2 authored ENOENT `bucket_empty.png` + 5 minecart 5s timeouts) + 1 vitest RPC `onTaskUpdate`. Lighting Game stubs are green. Same baseline class as PR #24/#25. Not hidden.
- Report: `docs/reports/2026-08-30_shared-persistence-port.md`. Draft PR **#26** stacked on **#25**. Owner local QA (SP save/load + Anarchy restart). **Не merge.**

## Последний проход: entity death animation smoothness

- Ветка `cursor/entity-death-animation-smoothness-bbb1` от Phase 4 HEAD `fee6604` (`cursor/shared-entity-host-bbb1`, PR **#24**). **Не merge в main.** `origin/main` (`a056e6f`) без Anarchy. **Не начинать Phase 5+.**
- Root cause после EntityHost: death pose (`rotation.z` / scale) брала `mob.deathSeconds`, который тикает только на **20 TPS**. Online `applyInterpolatedEntityVisuals(..., interpolateVisuals(1))` не сглаживает этот clock (в отличие от chicken `visualAge`). Получалось ~14 поз за 0.7 s.
- Fix: client-only `deathVisualElapsed` / `deathVisualActive` на `MobEntity`. `Game.frame` вызывает `advanceDeathVisuals(rawElapsed)` в том же loop, что fire animation. `syncMob` получает `mobDeathVisualSeconds(...)`. Формула позы **не** менялась: 0.7 s, `π/2`, scale `1 - progress * 0.25`.
- Server по-прежнему authoritative для died / `deathSeconds` lifetime / removal. Snapshots не шлют animation frames. `applyAuthoritativeDeath` стартует clock один раз. Interpolator задаёт base x/y/z/yaw; death z-rotation/scale поверх.
- Не тронуты: GameplayKernel, useInteraction, blockGeometry, EntityHost interface, hurt-flash sharing, server 20 TPS, protocol, interpolation buffer (кроме использования как base pose).
- Targeted: `entity-death-animation` **11/11**. Also entity-host, interpolation, visual-events, hurt-flash, creeper death, kernel, arrows, anarchy-gameplay packs green. `tsc` clean. Production build/size/archive PASS **3.64 MiB / 221 files**.
- Full `npm run check`: **1133 passed / 7 failed** (authored ENOENT `bucket_empty.png` + minecart 5s timeouts, same pre-existing class as PR #24) + 1 vitest RPC timeout. Not hidden; not from this pass.
- Report: `docs/reports/2026-08-30_entity-death-animation-smoothness.md`. Draft PR **#25** stacked on **#24**. Owner local QA **принят.** Phase 5 persistence — этот проход.

## Последний проход: Phase 4 EntityHost

- Ветка `cursor/shared-entity-host-bbb1` от PR #23 HEAD `ff5bef0` (`cursor/shared-block-geometry-bbb1`). **Не merge в main.** `origin/main` (`a056e6f`) без Anarchy.
- `EntityHost` — rendering seam. Simulation managers spawn/tick/serialize без `new Mesh` / Geometry / Material. `HeadlessEntityHost` на Anarchy server. Client: один `ThreeEntityHost` на `Game.scene` (shared `ItemVisualFactory` / `ArrowVisualFactory`).
- `DroppedItemManager` / `FallingBlockManager` / `MinecartManager` / `MobManager` / `PlayerArrowManager` принимают `Object3D | EntityHost`. Tests wrapping `THREE.Scene` остаются через `resolveEntityHost`.
- `ServerGameplay` больше не создаёт `THREE.Group` entity scene и не конструирует `ItemVisualFactory`. `RedstoneSystem` на сервере без `root` (primed TNT без mesh).
- Не тронуты: GameplayKernel order, Phase 2 useInteraction, Phase 3 blockGeometry, interpolation, fluids, respawn/session WASD (#19/#20), protocol, persistence/RNG/plugins, renderer folder moves.
- Targeted: `entity-host` 5/5 + entity/anarchy/kernel/use/geometry/interpolation/respawn pack greens. `tsc` clean. Production build/size/archive PASS **3.64 MiB / 221 files**.
- Report: `docs/reports/2026-08-30_shared-entity-host.md`. Draft PR **#24** stacked on #23. **Не merge.** Owner local QA. **Не начинать Phase 5+.**

## Последний проход: Phase 3 shared block geometry

- Ветка `cursor/shared-block-geometry-bbb1` от PR #21 HEAD `7e67419` (`cursor/shared-interaction-bbb1`). **Не merge в main.** `origin/main` (`a056e6f`) без Anarchy.
- Simulation geometry: `src/world/blockGeometry.ts` (AABB, neighbor stair/rail/fence, attachment normals, selection/collision boxes). **Без** Three.js / meshes / textures.
- Rendering `src/rendering/specialBlockGeometry.ts` — UV, torch matrices, outline, lantern/chain mesh. Re-export тех же sim-функций; второй таблицы AABB нет.
- Collision / selection / placement / `useInteraction` / ladder / rails / `Game` / `ServerGameplay` больше не импортируют `specialBlockGeometry`. Server collision/placement считает формы без rendering.
- Не тронуты: GameplayKernel, Phase 2 useInteraction, interpolation, fluids, respawn/session WASD (#19/#20), protocol. EntityHost — Phase 4 (этот проход).
- Targeted: `block-geometry` 5 + placement/glowstone/selection/polish/ladder/stairs/use/kernel/anarchy pack **308/308**. `tsc` clean. Production build/size/archive PASS **3.64 MiB / 221 files**.
- Report: `docs/reports/2026-08-30_shared-block-geometry.md`. Draft PR **#23** stacked on #21. **Не merge.** Owner local QA **принят.** Phase 4 EntityHost — этот проход.

## Последний проход: Phase 2 shared interaction

- Ветка `cursor/shared-interaction-bbb1` от PR #20 HEAD `05e77a8` (`cursor/online-session-transition-input-fix-bbb1`). **Не merge в main.** `origin/main` (`a056e6f`) без Anarchy.
- Одна simulation-level use/placement: `src/gameplay/useInteraction.ts` (`performUseHeld` / `placeFromHit` / `placeBlockAt`). Hosts: SP `Game.useTargetOrItem`, server `ServerGameplay.useHeld` + `placeBlock`.
- UI/audio/toasts/swing/save — SP effects. Plugin events / `player.window` / `inventoryDirty` — server effects. Online client по-прежнему только `interact`; local use не симулируется.
- Канонический порядок и placement rules — бывший SP path (anchors, lantern/chain support, slab merge, rail-only minecart, cartCloser перед block-use). Серверный `placeAt`/`applyPlacementState` не дублирует правила.
- Не тронуты: GameplayKernel, interpolation, fluids/block-state protocol, respawn/session input (#19/#20), Phase 4+ (EntityHost, persistence, RNG, plugins architecture).
- Targeted: `use-interaction` 10 + placement/glowstone/kernel/anarchy/network/bucket pack **115 + 120** focused greens. `tsc` clean. Production build/size/archive PASS **3.64 MiB / 221 files**.
- Report: `docs/reports/2026-08-29_shared-interaction.md`. Implementation `3622e20`. Draft PR **#21** stacked on #20. **Не merge.** Owner local QA (SP place/use + Anarchy interact same rules) **принят.** Phase 3 geometry — этот проход.

## Последний проход: online session transition WASD

- Ветка `cursor/online-session-transition-input-fix-bbb1` от PR #19 HEAD `0723c6e`. **Не merge в main.**
- Owner QA PR #19: death→respawn WASD ок. Regression: Anarchy → Singleplayer → Anarchy — WASD мёртв **с входа**, look и chat живы. Не после смерти.
- Root cause: `sessionStorage` token resume'ит того же server player с `lastInputSeq` от прошлого сокета. Новый `AnarchyClient` всегда шлёт `inputSeq` с 0. `applyInput` отбрасывает seq < last как stale. Look/chat не используют seq. `tickOnline` при этом шёл.
- Fix: disconnect и resume join сбрасывают `lastInputSeq` / lastInput. Сообщения только от текущего client (generation + identity). enterPlaying всегда PLAYING. PR #19 death path не тронут.
- Report: `docs/reports/2026-08-29_online-session-transition-input.md`. HEAD `e38af85`. Draft PR **#20** stacked on #19. **Не merge.** Owner local QA.

## Последний проход: online respawn WASD (stabilization)

- Ветка `cursor/online-respawn-input-fix-bbb1` от Phase 1 HEAD `c75497b` (`cursor/shared-game-core-kernel-bbb1`). **Не merge в main.** `origin/main` (`a056e6f`) без Anarchy.
- Owner QA после Phase 1: SP ок, Anarchy коннектится, WASD до смерти ок, после death→respawn WASD иногда мёртв (mouse look и chat живы). `/kill` не workaround.
- Root cause: (1) mob/TNT/PvP звали `respawnIfDead` без `health` dead→alive, клиент мог не сделать restore; (2) restore делал `canvas.focus` + pointer-lock request → `window.blur` при `hasFocus()===false` → **BACKGROUND** → `tickOnline` не шлёт input. Look рендерится каждый кадр, chat — DOM.
- Fix: один canonical `respawnIfDead` с flush dead/alive; blur не ставит BACKGROUND при pointer lock / pending lock / respawn guard; acquire сначала resume PLAYING; не фокусить canvas если уже locked; keys clear только если chat/inventory владели клавиатурой.
- Не тронуты: GameplayKernel, interpolation, fluids, block states, rendering, bow/arrow, SP tick.
- Report: `docs/reports/2026-08-29_online-respawn-input-fix.md`. HEAD `c97565d`. Draft PR **#19** stacked on Phase 1 / #18. **Не merge.** Owner local QA, затем остановиться.

## Последний проход: GameplayKernel (Phase 1 shared sim order)

- Ветка `cursor/shared-game-core-kernel-bbb1` от PR #17 HEAD `bdab232`. **Не merge в main.** `origin/main` (`a056e6f`) без Anarchy.
- Один sequencer `src/gameplay/GameplayKernel.ts`: world → falling → players → playerActions → projectiles → vehicles → mobs → mobEvents → preDropSupport → drops → redstone → explosions.
- Hosts: SP `Game.tick` (online still `tickOnline` only); server `WorldInstance` → `ServerGameplay.tick` → kernel. Механики не переписаны.
- Server player physics теперь внутри kernel **после** `world.tick`/falling (как SP). Mining/use hold остаются в `tickConnectedPlayers`.
- `daylightFactor` один (`src/gameplay/daylight.ts`) для sky, mobs, sunlight. DEV `?debugTick=1` / `FC_DEBUG_TICK=1`.
- Targeted: `gameplay-kernel` 6/6; anarchy-gameplay 19/19; physics/combat/fluids/worldgen pack 122/122. `tsc` clean. Full check **1063 passed / 7 failed** (authored ENOENT + minecart 5s timeouts, same pre-existing class as PR #17) + 1 vitest RPC.
- Report: `docs/reports/2026-08-29_shared-game-core-kernel.md`. Draft PR **#18**. **Не merge.** Owner local QA (behavior should match PR #17).

## Последний проход: online blockstates / live fluids / respawn input

- Ветка `cursor/online-blockstates-fluid-render-respawn-bbb1` от PR #16 HEAD `76b8f87` (`cursor/entity-interpolation-input-visual-sync-bbb1`). **Не merge в main.** `origin/main` (`a056e6f`) по-прежнему без Anarchy gameplay.
- Local QA после PR #16: WASD пропадал после death/respawn; directional blocks всегда в default facing; button/door не нажимались визуально; live Water/Lava — квадраты, а загруженные из chunk state жидкости с наклоном.
- Respawn: online пропускал SP death UI; `health` после instant respawn мог не отличаться от pre-death 20 HP. Сервер шлёт dead→alive; клиент `restoreOnlinePlayingFromRespawn` возвращает PLAYING, focus, pointer lock, закрывает chat/inventory.
- Block state: live `block_update`/`block_batch` несут optional `state`. `onCommittedBlockState` включает fluid level / door / button. Клиент `applyNetworkBlockChanges` — id затем state; `writeBlockRaw` больше не оставляет жидкости без level.
- Interact: RMB online только `interact`; server `useHeld` + raycast/look. Placement orientation уже был в `applyPlacementState`.
- Fluids: не новый renderer. Live updates теперь с `fluidLevel`/`fluidFalling`; neighbor `neighborFluidMeshOffsets` dirty; batch затем один remesh. Client online не тикает fluids.
- Targeted: `network-block-state-respawn` + `network-input-recovery` + `anarchy-gameplay` **35/35**. `tsc` clean. Production build/size PASS 3.63 MiB / 221 files. Full `npm run check` **1056 passed / 7 failed** (authored ENOENT `bucket_empty.png` + minecart 5s timeouts, same pre-existing class as PR #16) + 1 vitest RPC timeout.
- Report: `docs/reports/2026-08-29_online-blockstates-fluid-render-respawn.md`. Draft PR **#17**. **Не merge.** Owner local QA.

## Последний проход: entity interpolation / input recovery / visual sync

- Ветка `cursor/entity-interpolation-input-visual-sync-bbb1` от gameplay `fe1509f` (`cursor/full-anarchy-server-gameplay-bbb1`). **Не merge в main.** Не работать поверх чужого `main`.
- Two-client QA PR #15: authority ок, но remote mobs/entities дёргались, WASD мог «умереть» после chat/tab, hurt/death/bow/arrow visuals не доезжали.
- Root cause jitter: `applyEntitySnapshots` писал `previousPosition = position` + `position = snapshot` в момент пакета; `interpolateVisuals(alpha)` использовал **client tick alpha**, не время между server ticks. Remote players уже были на delayed history (`RemotePlayerView` ~80 ms).
- Fix: `EntityInterpolationBuffer` — tick-ordered snapshot history, render sample at `now - 80ms`, shortest-yaw, teleport snap (`ENTITY_SNAP_DISTANCE`), spawn immediate, remove drops history. Local player chase / remote players / other entities остаются тремя режимами.
- Input: `window.blur` больше не ставит BACKGROUND, если `document.hasFocus()` (pointer-lock/chat spurious blur). Tab hide (`visibilitychange`) по-прежнему BACKGROUND. Chat close / canvas click / pointer lock / focus вызывают `resumePlayingIfVisible` + `clearHeldKeys` + canvas focus. Stale chat INPUT больше не глотает WASD.
- Visual events: server `entity_event` (`hurt` / `death` / `projectile_spawn` / `projectile_hit`) + snapshot state. Per-entity hurt flash и death pose; client не emit'ит loot. Bow draw — visual-only `bowUseTicks` из hold RMB. Arrows packed first in interest snapshots (cap 96) + interpolator.
- Targeted: interpolation 10, input 9, visual events 7; focused pack with Anarchy/hurt-flash 84/84. `tsc` clean. Build/size PASS 3.63 MiB / 221 files. Full suite 1039 passed / 8 failed (authored ENOENT + minecart timeouts, pre-existing class) + vitest RPC.
- Report: `docs/reports/2026-08-29_entity-interpolation-input-visual-sync.md`. Draft PR #16. **Не merge.** Owner two-client QA.

## Последний проход: full Anarchy server gameplay

- Ветка `cursor/full-anarchy-server-gameplay-bbb1` от foundation `15ca54f` / `origin/main` `a056e6f`. **Не merge в main.** Отдельный draft PR (не #14).
- Один integration pass: listed Anarchy gameplay на server authority. Не новые фичи, не второй game loop. `ServerGameplay` (`server/gameplay.ts`) крутит существующие World / MobManager / CombatSystem / SurvivalSystem / RedstoneSystem / ExplosionQueue / DroppedItemManager / MinecartManager / PlayerArrowManager / recipes.
- SERVER owns: world/blocks/chunks, entities, player pose/health/inventory/equipment, drops, crafting, melee PvP + mobs, fluids (existing queue + `block_batch`), fire/TNT, minecarts, potions/effects, gamemode, commands, filesystem persist.
- CLIENT online: input/requests, render, UI, interpolation. `tickOnline` не тикает world/mobs/fluids/combat/drops. Inventory clicks/`attack`/`interact`/`break_block`/`place_block` — запросы. Singleplayer IndexedDB + local `tick()` без изменений.
- Spawn: accepted IndexedDB карта **не** импортируется на старте. Сервер — `server/data/worlds/anarchy/` (procedural + `estimateWorldSpawn` если пусто). Явный шаг: `npm run server:import -- dump.json`. Нет runtime `.schem`.
- Targeted: `anarchy-server.test.ts` 12/12, `anarchy-gameplay.test.ts` 10/10. `tsc --noEmit` clean. Full suite 1014 passed / 7 failed (authored ENOENT + minecart timeouts, pre-existing) + 1 vitest RPC. Build/size PASS 3.62 MiB / 221 files.
- Report: `docs/reports/2026-08-29_full-anarchy-server-gameplay.md`. **Не merge.** Owner two-client QA.

## Последний проход: Anarchy server QA fixes (movement / break / place)

- Ветка та же: `cursor/local-authoritative-server-bbb1`. **Не merge в main.** Draft PR #14.
- Local QA foundation **не принят**: rubber-banding, break не работал, spawn карты IndexedDB на сервере нет.
- Spawn: сервер **не** подхватывает браузерный IndexedDB и **не** импортирует `.schem`. Текущий server world — filesystem `server/data/worlds/anarchy/` (первый старт = procedural + `estimateWorldSpawn`). Accepted spawn живёт только в IndexedDB пользователя. Перенос — отдельный explicit `npm run server:import`, не в этом pass.
- Movement: убран hard overwrite локального transform каждым snapshot. Server 20 TPS authority; client — input + smooth chase + ignore stale `player_state.tick`. Камера не берёт yaw/pitch с сервера. Remote interpolation с delay, не на local id.
- Break/place: raycast смотрит тем же look, что камера; `block_result` с причиной; reach slack `PLAYER_NET_REACH`; persist по-прежнему только server.
- Targeted tests **26/26**. Full suite 1004 passed / 7 failed (authored ENOENT + minecart timeouts, pre-existing) + 1 vitest RPC. Build/size PASS 3.61 MiB / 221 files.

## Последний проход: local authoritative Anarchy server (foundation)

- Base: актуального `origin/main` `a056e6f` (lighting PR #13). Ветка `cursor/local-authoritative-server-bbb1`. **Не merge в main** до ручного QA.
- Отдельный Node process: `npm run dev:server` (`ws://127.0.0.1:2567`, Vite остаётся на 4173). Транспорт native WebSocket/`ws`, не Colyseus (в репозитории его не было).
- Online `Анархия PvP` → localhost server. Нет silent IndexedDB fallback. Singleplayer без сервера. `Выживание PvP` mock.
- Server owns Anarchy world/chunks/players/tick/spawn/filesystem persist (`server/data/worlds/anarchy/`). Client: input, render, interpolation.
- Foundation sync: join/spawn, two clients, movement, break/place, chat, `/gamemode` registry, PluginManager/events.
- **Accepted IndexedDB spawn map не в git.** Первый server world — procedural + `estimateWorldSpawn`. Явный import: `npm run server:import`. Нет runtime `.schem`.
- Fluids/mobs/combat/TNT/minecarts/full inventory **портированы на server** в pass `cursor/full-anarchy-server-gameplay-bbb1` (не в этом foundation commit).
- Targeted tests 14/14; lighting/world height 30/30. Full suite 992 passed / 7 failed (authored ENOENT + minecart timeouts, pre-existing) + 1 vitest RPC. Build/size PASS 3.61 MiB / 221 files.
- Docs: `docs/LOCAL_SERVER.md`. Report: `docs/reports/2026-08-29_local-authoritative-server.md`. Draft PR #14. **Не merge.**

## Последний проход: lateral sky / lighting quality

- Integrated `origin/main`: `25fb847fc3762b99f8b10b6a6f24f0b2d234c998`; same feature branch `codex/lighting-quality-lateral-sky`, same Draft PR #13. WORLD_HEIGHT=256 is canonical. Historical height96 results remain in the report, not current acceptance numbers.
- Height256: conservative occupancy/scanMaxY, implicit sky via per-column materialized extents, high-Y block-light spill bounds, 4 KiB changed-page snapshots and 8 KiB queued bitsets. Completed jobs release references; session teardown releases the legacy last-world diagnostics reference.
- Canonical LightEngine: vertical sky + resumable lateral frontier, radius 14, typed ring queue, deadline and hard work caps. No return to full-chunk six-pass sky; PLAYING budget remains 2 ms.
- All eight mesh lighting neighbors must be ready. Regional block relight imports all six AABB faces. Cube/special vertices share exposed-cell sampling; opaque zeros do not darken intensity averages, AO is separate (0.8..1).
- Gameplay mutations/getters/furnace use sliced lighting; same-bounds edits restart the region; final touched chunks and border readers get coalesced version updates. Day/night stays uniform-only. Direct-sun burning does not mistake lateral level 14 for open sky.
- Height256 validation: 274/274 in 18 files before the final teardown regression, then50/50 focused. Full check962 passed/24 failed, two RPC errors; fresh main baseline880/36. One additional dismount timeout is explicitly unresolved. Build/size/archive PASS:3.60 MiB/221 files. Four actual Game paths, schema1 Y255 deltas, importer and canonical Anarchy are covered; details in report.
- CPU256 initial81 median475.68 ms versus main980.59; highYRoom259.37 versus462.26. Common edit worst slices <=3.65 ms; isolated initial81 spike19.45 ms did not repeat (3.59/2.17/2.29). Measured snapshot peaks36-48 KiB at radii2/4/6, not whole-volume duplicates. CPU timings are not GPU FPS.
- DEV routes: `?qaLighting=room|closed|hole|cave|forest|sources|high`, existing F7 SKY/BLOCK/FINAL. High fixture floor192/roof200. Native input/device/GPU soak remains pending; use throwaway gameplay saves.
- WebGL256: all7 fixtures at1280x720/844x390, screenshot pixels and no console errors; Creative and Anarchy new/save/load smoke passed on separate4174 origin. Pointer lock/chat submission unavailable in automation, so manual gameplay building/flight/source/time acceptance is not claimed complete.
- Algorithm, measurements, validation caveats and manual checklist: `docs/reports/2026-08-29_lighting-quality-lateral-sky.md`.

## Последний проход: world height 256 + Anarchy spawn import

- Git baseline: `6e27b93` (`origin/main`), ветка `cursor/spawn-map-import-256-height`.
- `WORLD_HEIGHT = 256` (`Y 0..255`). `Y=255` валиден, `Y=256` и `Y<0` — нет. Процедурный terrain **не** масштабируется: `MAX_GENERATED_SURFACE = 84`, sea `63`, ores/bedrock/caves без vertical scaling.
- Chunk `16×256×16`; `occupancyTop` ограничивает sky/emitter/fluid/mesh scan пустого неба. `WORLD_LIGHT_BUDGET_MS = 2` не поднимали.
- Importer: `src/world/import/` остаётся DEV/offline tool (NBT + Sponge `.schem`). **Production Anarchy не импортирует `.schem`.** `Играть онлайн → Анархия PvP` всегда грузит persistent IndexedDB world `anarchy` (chunks, spawn, metadata). `importVersion` / `spawnImported` больше не вызывают rebuild. Если мира ещё нет — обычный procedural create, не schematic. Singleplayer не затронут. `Выживание PvP` — заглушка.
- `frontier_spawn2.schem` не удалять: backup/source asset. Runtime от него не зависит.
- Report: `docs/reports/2026-08-28_spawn-map-import-256-height.md`. Canonical persistent Anarchy (no runtime schematic): `docs/reports/2026-08-28_anarchy-canonical-persistent.md`.

## Последний проход: glowstone / lantern / chain

- Git baseline: `73a78f4` (`origin/main`), ветка `cursor/glowstone-lantern-chain`.
- Glowstone — solid cube, **emission 15**. Lantern — 3D cutout model, **emission 15**. Torch remains **14**. Existing LightEngine / streaming / fluid lighting path unchanged.
- Lantern standing (`attachment: floor`) or hanging (`ceiling`); hanging attaches to a sturdy down-face or a Chain. Chain is vertical only and stores the same attachment so a hanging column is not self-supporting.
- Selection/collision use thin AABBs (not a full 1×1×1 voxel). Canonical `World.raycast` DDA unchanged.
- Custom recipes: shapeless Torch+Gold Ingot → Glowstone; shapeless Torch+Iron Ingot → Lantern; shaped `ISI/ISI/ISI` → **16** Chain.
- Runtime textures: Faithful 32x `block/glowstone.png` (byte-family match with `stone.png`), Faithful lantern/chain block sheets, and authored `item/lantern.png` / `item/chain.png` for inventory/hotbar. Held lantern/chain keep `special_model` with world atlas UVs.
- Report: `docs/reports/2026-08-28_glowstone-lantern-chain.md`.

## Последний проход: core sample-based SFX

- Git baseline: `3c9cf45` (`origin/main`), ветка `cursor/core-audio-sfx-0b75`.
- `AudioManager` plays cached `AudioBuffer` samples from `public/audio/sfx/` (~26 short mono MP3). `playTone` is DEV fallback only.
- Data-driven `SoundEventId` + `BlockDefinition.soundGroup`. Mining hits every 4 ticks; break/place/step reuse the same material family. Footsteps follow grounded travel; sprint is a shorter stride.
- World SFX are positional with max-distance skip. Player footsteps are local (`positional: false`); catalog `block.step.*` stays positional for future mobs. Explosion/TNT/creeper share one event with per-tick/nearby dedupe. Pickup/eat/drink/door/chest/click/ignite/splash replace the old beeps.
- Minecraft Java 1.8 oggs are local reference only via `npm run audio:extract-reference` → `.local/minecraft-reference-audio/` (gitignored, never shipped).
- DEV `/?audioDebug=1` overlay + F3 SFX line. Headless Chromium: 26/26 decoded, real dirt→sand footsteps. Interactive Chromium: dirt break + step events, pause/resume context.
- Report: `docs/reports/2026-08-28_core-audio-sfx-pass.md`. Catalog: `docs/AUDIO_ASSETS.md`.

## Сохранённый проход: creeper / fence / plants / tooltip / RU localization

- Git baseline: `9dc3300` (`origin/main`), ветка `cursor/mob-collision-tooltip-ru-polish-b257`.
- Creeper death uses the generic corpse pose: `state === 'die'` has priority over fuse pulse. `beginDeath` zeros `fuseSeconds`. Self-explosion still removes immediately without a corpse or gunpowder drop.
- Fence collision stays visual 1 / collision 1.5. Player and mob broadphase use `collisionCandidateCellRange` with `MAX_BLOCK_COLLISION_Y_OVERHANG = 0.5` so an airborne AABB still sees the fence cell below. Jump velocity and step height are unchanged; slabs/stairs still step up.
- Vegetation (TallGrass, Fern, Dandelion, Poppy, OxeyeDaisy, DeadBush) joins the existing support-integrity queue. Grass/fern/flowers need GrassBlock or Dirt; DeadBush needs Sand. Unsupported plants become Air without new inventory items. Cobweb/Fire are not plants. Water can still replace plants.
- Golden Apple Absorption I remains 4 HP / 2400 ticks and does not stack past 4; re-eating replenishes to 4 and refreshes duration. HUD reads `session.survival.absorption` in Survival **and** Creative.
- Item hover uses one shared `.mc-item-tooltip` (delegated pointer events). Native `title` is removed from item slots. Internal IDs stay English; `src/i18n/ru.ts` supplies explicit Russian display names for all registry items/blocks. Recipe Book search matches Russian names.
- Report: `docs/reports/2026-08-28_creeper-fence-plants-tooltip-ru-polish.md`.

## Сохранённый проход: gameplay / UI / entity polish

- Git baseline: `67afc97` (`origin/main`), ветка `cursor/gameplay-ui-entity-polish-935a`.
- Vertical melee KB is a documented Frontier adaptation: `FRONTIER_MELEE_VERTICAL_SCALE = 0.67` applies **only to Y**. Flat apex ≈ 0.576 / 0.841 (normal/sprint), half of the previous 1.153 / 1.709. Horizontal impulse stays 8 / 18 b/s. 20-tick open XZ is slightly shorter only because the mob lands earlier into grounded drag.
- Sprint persists after a successful sprint-hit while W+sprint remain held. `sprintNeedsRelease` / `resetSprintAfterHit` removed. Attacker XZ ×0.6 slowdown remains.
- Creative/inventory block cards bake cached isometric 3D previews (`ItemIconRenderer` + `ItemVisualFactory`). Generated items (apple, sword, bow, torch, door, plants) stay 2D sprites.
- Inventory close `×` is a stage sibling to the right of the panel, not over the «Инвентарь» tab. Touch target ≥ 44px; scale accounts for `MC_CLOSE_GUTTER`.
- Projectile raycast uses `World.raycast(..., { geometry: 'collision' })`. Tall grass / flowers / fern / dead bush / fire no longer stop player or skeleton arrows. Player targeting still uses selection geometry.
- Chicken legs sample pack UV `[29,0]` (vanilla `[26,0]` is transparent on this sheet). Box/pivots unchanged.
- Stair `resolveStairShape` maps a perpendicular neighbor on the high/`facing` side to **outer** occupancy (3/4 inner vs 1/4 outer were inverted). Mesh, collision and selection share the same shape.
- Player-fired resting/embedded arrows are pickable (`Inventory.addItem`). Full inventory leaves the entity. Creative consumes the world arrow without inflating stacks. Skeleton arrows follow Java 1.8 `canBePickedUp=0`. Ground lifetime 60s; flying timeout stays 8s.
- Golden Apple Absorption I + Regeneration II. HUD shows yellow hearts to the **right** of the 10 red hearts in Survival and Creative. Ordinary apples set absorption to 4 HP (not stacked). Effect expiry zeros remaining absorption HP. Save stores `absorption` + `absorptionTicks`.
- Report: `docs/reports/2026-08-28_gameplay-ui-entity-polish.md`.

## Сохранённый interaction / support / input / mob polish

- Git baseline at that pass: `3b9e68e`. Button/Lever используют общие oriented cuboids для mesh, outline и AABB raycast. Redstone публикует attachment/facing/powered в world state: actual DDA и проверка опор видят то же состояние, что renderer.
- Локальная deferred support integrity для Torch/RedstoneTorch/Button/Lever/Ladder/Wire/обеих Plates/Rail **и vegetation** (tall grass/fern/flowers/dead bush) **и Lantern/Chain**: changed cell + 6 соседей, dedupe, бюджет256 проверок за проход. Потеря sturdy face → Air, очистка state/light/redstone, ровно один environmental world drop через Game/DroppedItemManager. Plants with `drop:false` vanish without an item. Lantern/Chain хранят `attachment` floor/ceiling; hanging column не самоподдерживается снизу. Работает и после explosion/batch; неизвестная unloaded опора не считается Air.
- `fluidDisplaceable` отделён от placement `replaceable`: вода смывает Torch/RedstoneTorch/Button/Lever/Wire/Rail. Ladder/door/chest/fence/slab/stair/plates не смываются. Fluid routing, delays и buckets не перенастраивались.
- Обе системы стрел сохраняют impact block/point/velocity, проверяют поддержку embedded arrow на fixed tick и возвращают её в существующую flight physics при потере блока/формы. Visual geometry/caps не менялись; player-fired resting arrows теперь pickable (см. текущий polish).
- Desktop: raw Pointer Lock request с одноразовым plain fallback только при unsupported options; `?inputDebug=1` в DEV различает lock events и delta spikes. Нет обычного smoothing/clamp; изолированный экстремальный sample проверяется по tiny history. **Проблемный ПК ещё требует проверки**, автоматизированный браузер не получает native lock.
- Mob yaw и walking берутся из AI locomotion intent, не recoil velocity. Vertical melee height is now the Frontier 0.67 adapter (see current polish); horizontal impulse 8/18 unchanged.
- Browser QA выполнен частично через opt-in DEV panel в отдельном мире: button/lever outline+use, support drops, Water в обеих Torch cells, пять освобождённых player arrows, normal/sprint zombie recoil. Это не native mouse/W-tap/GPU-soak acceptance. Результаты тестов и оставшаяся matrix: `reports/2026-08-27_interaction-support-mouse-mob-polish.md`.

## Сохранённый classic 1.8 combat

- Baseline реализации: чистая `feat/playable-voxel-alpha`, HEAD = origin/main = `5820d7d` после `git fetch origin`. После локальной проверки пользователь отдельно разрешил commit/push classic combat; SHA поставки определяется по Git history, baseline SHA не является текущей версией combat pass.
- Melee использует Java 1.8.9 reference: полный урон на каждый click attempt, без cooldown/attackSpeed/индикатора; fist 1, swords 5/6/7/8, axes 4/5/6/7, pickaxes 3/4/5/6, shovels 2/3/4/5. Это total damage, без повторного +1.
- Общий `HurtResistance` игрока/мобов: окно 20 ticks, в первой половине equal/weaker hit отвергается, stronger наносит разницу без второго full hurt/base KB. Falling crit ×1.5 совместим со sprint.
- Canonical melee KB: половина текущей velocity + base 8 b/s horizontal; vertical uses `FRONTIER_MELEE_VERTICAL_SCALE=0.67` (apex ~½ Java 1.8). Extra sprint +10 horizontal / +1.34 vertical. Target travel сохраняет импульс и применяет drag; successful extra hit замедляет attacker XZ ×0.6 и **не** сбрасывает sprint, если input всё ещё требует бег.
- Sword hold-use: transient blocking, `(raw + 1)/2` до fixed armor reduction, движение ×0.2 без sprint, cached first-person pose. Shield не возвращён. Прочность меча/инструмента −1 за accepted hit по явному требованию задания (Java tool wear −2); exhaustion +0.3.
- Arrow flight/geometry, fluids, placement, assets, world/chunk save format и ordinary movement не перенастраивались. Боевой transient state не сохраняется.
- Unit/integration validation выполнена; полный suite имеет baseline failures. Во время classic pass browser access был заблокирован; текущий polish выполнил частичный browser QA, но полная native-input/combat acceptance ещё pending. История: `reports/2026-08-27_classic-1-8-combat-pass.md`; спецификация: `MINECRAFT_1_8_COMBAT_REFERENCE.md`.

## Сохранённые item / arrow / placement fixes

- Fluid routing/timing, bucket pickup и item-lava fixes входят в baseline5820d7d и сохранены без изменений.
- Bucket/WaterBucket/LavaBucket/Minecart/GlassBottle используют найденные authored PNG. Зелья — build-time композиция authored drinkable bottle + tinted overlay, 32×32. Importer перезаписывает старые заглушки, preflight обязателен, fallback даже с `--force` эти assets больше не рисует. `npm run assets:import -- --items-cleanup` обновляет только восемь целевых PNG и удаляет obsolete runtime shield PNG.
- `ArrowVisualFactory`: 18 triangles, shaft 0.028 толщиной, малый pyramid tip, feathers только у хвоста, правильный crop 64×64 entity sheet и общий +Z axis player/skeleton. Projectile physics/damage не менялись. Вагонетка использует authored 128×64 entity sheet с panel UV и shared geometry cache.
- `world/placement.ts`: placement anchor и full sturdy support face — разные predicates. Torch/RedstoneTorch и прочие thin/non-solid blocks не являются anchors/supports. Torch floor/wall разрешены на пригодной опоре, ceiling запрещён. Ladder/button/lever/rail/plate/wire/door используют placement support check; slab/stair full boundary определяется collision rectangles. Support-loss decorations теперь реализован в том же модуле и canonical world mutation path (см. последний проход).
- **Shield удалён полностью**, не скрыт: registry/type/profile/pose/blocking/slowdown/durability/axe-disable/runtime icon отсутствуют. Generic offhand storage сохранён; legacy stack migration для player/armor/offhand/chest/furnace/drops не сбрасывает другие предметы. Старое combat state игнорируется.
- Classic melee теперь реализован поверх этих fixes; Bow/Arrow physics и geometry не перенастраивались. Финальный targeted набор194/194; typecheck/build/size/archive PASS (3.45MiB/186files). Full-suite failures и browser ограничения — в свежем combat report.

История предыдущего cleanup: `docs/reports/2026-08-27_item-arrow-placement-shield-cleanup.md` (не источник текущих combat contracts).

Этот документ описывает фактическое состояние кода, а не желаемый feature list. Обозначения:

- **Готово** — путь от UI до runtime подключён и подходит для alpha;
- **Alpha approximation** — работает, но сознательно проще reference или имеет заметные ограничения;
- **Не реализовано** — в коде нет законченного пользовательского сценария.

## Сводка

| Область | Статус | Фактический результат |
| --- | --- | --- |
| Boot/menu/world list | Готово | Стилизованное главное меню с оригинальным voxel-фоном; отдельные экраны одиночной игры, online (Anarchy = localhost authoritative server with full gameplay kernel, Survival PvP mock), настроек и read-only управления; создание/выбор/загрузка/удаление одиночных миров сохранены; вход в мир идёт через `LOADING_WORLD` с реальным progress |
| Main loop | Готово | Fixed `20 TPS` (`advanceFixedStep`, `MAX_CATCH_UP_TICKS = 4`), RAF render, player/mob/drop/arrow interpolation, adaptive world-job budget |
| Procedural world | Готово | Seeded chunks `16×16×256` (`Y 0..255`), plains/forest/desert, periodic mountains (+10…+20) with generated surface still `≤84`, deeper underground (~+15 to bedrock), connected caves, sea, five ores, thinned trees/cactus и biome-specific cross-plants; generate/light/mesh разделены и бюджетируются; empty sky above occupancy is not full-column work |
| Rendering | Готово для alpha | Three.js, render-rate camera look, mip-safe padded runtime atlas, independent world passes including vegetation FrontSide cutout, budgeted chunk meshing, special/cross geometry, shape-aware selection outlines, **staged block-breaking crack overlay**, shared item/arrow visuals и отдельный first-person pass |
| Player physics | Готово для alpha | Voxel AABB, walk/sprint/sneak/jump, Creative double-Space flight, step `0.6`, collision including fence 1.5 Y-overhang broadphase, fall damage, water/lava |
| Mining/building | Готово для alpha | Shape-aware block raycast (AABB selection, not full-cell occupancy), 1.9 harvest formula, hardness/tool/tier, durability, Survival drops (Creative без collectible drops), dirty-mesh dedupe, deferred lighting flush |
| Inventory/crafting | Готово для alpha | 36 slots, 9-slot hotbar, armor (UI без off-hand), cursor clicks, 2×2/3×3 recipes, pixel container GUI, 3D cached block icons, custom item tooltip, Russian display names, Recipe Book on crafting/Survival 2×2 (not furnace), Creative Catalog/Inventory tabs, close × outside panel |
| Chest/furnace/bed | Готово для alpha (bed проще) | Entity chest model + lid-up animation + 27-slot GUI, furnace facing + lit front + torch-equivalent light, input/fuel/output GUI, spawn point and simple night skip |
| Basic redstone/TNT | Готово для alpha | Power `0–15`, dust attenuation, torch/lever/button/plate, gravity-driven primed TNT with TNT texture + fuse tint pulse, budgeted batched explosions, save/restore |
| Survival | Готово для alpha | Health, hunger, saturation, exhaustion, food, armor, air, lava/fire/cactus/starvation, death/respawn |
| Combat | Реализовано; browser acceptance pending | Classic 1.8 click-driven melee, shared hurt resistance, fixed armor, sprint persistence after hit, sword blocking, Frontier vertical KB height; staged bow draw/shared arrows сохранены, shield отсутствует |
| Entities | Готово для alpha | 8 legacy articulated rigs, 1-block mob step-up, falling-block entities, zombie limb/pose fix, simple AI, voxel lighting; **render interpolation** (pos/yaw/walkPhase) при simulation `20 TPS` |
| Day/night | Alpha approximation | 24,000-tick clock; terrain and world entities compose the same sky/block sample (`sky * daylight` vs warm torch block light) without Lambert N·L |
| Saves | Готово для alpha | IndexedDB schema 1 для **singleplayer**; online Anarchy persist — filesystem `server/data/worlds/anarchy/` |
| Desktop input | Готово | Pointer lock, WASD, Shift sprint / fly descend, Ctrl fly sprint, double Space Creative flight, C sneak, mouse, F3 debug, **T chat** / **`/` command**, E inventory, DEV F8 chunk grid / F7 light view / F9 freeze streaming inspect; `?worldgenDebug=1` пишет surfaceY/mountain/hills/cave/cap/block на chunk HUD |
| Touch/mobile | Alpha approximation | Joystick, look zone, action buttons, safe-area CSS and portrait rotate overlay |
| Responsive browser QA | Готово для заданной matrix | Все desktop/mobile viewport sizes прошли visibility/count checks; representative visual QA выполнен на `667×375` и portrait |
| Audio | Готово для alpha | Cached sample SFX (`AudioManager.play` / `playAt` / `playBlock`), ~26 short MP3, material sound groups, restrained mining/footsteps, positional world events; pause/mute/volume; no music |
| Yandex SDK | Alpha integration | `/sdk.js`, init fallback, LoadingAPI ready, GameplayAPI start/stop and pause/resume events |
| Automated QA | Частично готово | unit/component tests (см. `docs/TESTING.md`), CPU job + lighting + streaming-scheduler + worldgen benchmarks и DEV `?perf=1` overlay (F8 colored chunk states, F7 light debug, F9 freeze front chunk, streaming inspector + mesh fairness HUD); no automated WebGL/IndexedDB/full browser E2E suite |
| Public release | Не готово | Нужны provenance approval, реальные device tests, Yandex draft audit and final moderation pass |

## Мир и блоки

### Готово

- Чанк хранит `16 × 256 × 16` numeric block IDs в `Uint16Array`. Индекс `y × 256 + z × 16 + x` не содержит `WORLD_HEIGHT`, поэтому старые modification deltas остаются валидными. `occupancyTop` — conservative highest non-air Y для scan пустого неба.
- Горизонтальные координаты процедурно не ограничены; вокруг игрока загружается настраиваемый радиус, дальние chunks удаляются из runtime cache.
- Генерация детерминирована строковым seed.
- Реализованы три биома: `plains`, `forest`, `desert`.
- Высота поверхности типично `63–84` (sea level `63`); periodic mountain mask даёт широкие возвышенности примерно `+10…+20` над local baseline. `MAX_GENERATED_SURFACE = 84` закреплён отдельно от `WORLD_HEIGHT`, чтобы горы не уезжали к Y=244.
- Есть bedrock floor (`Y 0–2`) plus a world-wide **Stone cap at Y=3** (`STONE_CAP_TOP_Y`) that caves, lava ponds and ores cannot remove, ridged 3D-noise cave networks (ветвления и chambers, carve только `y ≥ 4` и `≤ localMin(surface) - 4`), небольшие irregular cave **lava ponds** (footprint ~3–12, depth 1–3, **closed Stone basin**: shrink/reject open waterline and cave-edge drops using generator-space `terrainSolid`, not missing-chunk-as-wall; after generate ordinary ponds stay idle, queue 0; **only actually exposed** cells enter `scheduleFluid` as a safety net) и veins для coal, iron, gold, redstone (**vein attempts ×2**) и diamond (**attempts ≈ current/3**: 1 vein + 1/3 extra chance, `size` прежний).
- Forest oak density ≈ 40% прежней, desert cactus ≈ 25–30% прежней; biome-specific cross-plants без изменения самих моделей.
- Terrain decor включает oak trees, cactus и детерминированные растения: tall grass/flowers в plains, tall grass/fern/flowers в forest, dead bush в desert.
- Реестр содержит stable-ID definitions для шести replaceable `cross`-растений поверх прежних air/liquids, terrain, древесины, руд, utility/building blocks, wool, redstone, slabs/stairs, **oak/birch/spruce fences**, **rail**, **cobweb**, **fire** (без item, `renderShape: fire`), **glowstone** (cube, light 15), **lantern** (cutout 3D, light 15, standing/hanging), **chain** (вертикальная thin geometry) и **diamond block** (fallback для schematic import). Tall grass/fern несут `lightingMode: vegetation` и `biomeTint: grass`; flowers/dead bush — тот же lighting mode без grass tint. Fire — отдельный cutout layer: 4 крайние плоскости + 2 диагонали крестом, анимированный vertical strip (`block/fire.png`), не cube и не plant-cross.
- Изменения мира записываются как chunk deltas, поэтому исходные procedural chunks не сохраняются целиком. Старые saves загружаются без crash; **неизменённый** terrain при reload перегенерируется новым worldgen (возможен seam на границе уже изменённого и нового chunk). Для visual QA гор/пещер нужен новый мир.
- Chunk дополнительно хранит компактные `Uint8Array` skyLight/blockLight (`0–15`) того же размера, что и blocks.
- Sand и gravel при потере опоры удаляются из сетки и становятся falling-block entity с gravity/mesh, затем возвращаются в world.
- Дверь — тонкая 2-block cuboid geometry (`3/16`) с open/close, collision по occupied face, joint upper/lower state и UV half/hinge как у vanilla `door_*_left/right`.
- Лестница — тонкая cutout-плоскость на боковой опоре (`NORTH/SOUTH/EAST/WEST`). Climbing: контакт с thin climb volume (не целая cell), intent = movement INTO support (`dot(wishXZ, towardSupport)`), скорость `LADDER_CLIMB_SPEED = 4.0`, без input — `LADDER_MAX_DESCENT_SPEED = 3.0`, sneak (C) удерживает. Stairs не являются ladder. `CombatSystem.onLadder` читает тот же `player.onLadder`.
- Stairs — геометрические две (или больше для corner) AABB, не full cube: facing N/S/E/W, `stairHalf` bottom/top, neighbor-derived `straight/inner_*/outer_*` без сохранения shape. Collision и selection совпадают с boxes. Игрок поднимается generic step-up `0.6`, без ladder/climb mode.
- Slabs — `slabType` bottom/top/double. Single = высота 0.5; double = полный блок. Одинаковые slab merge, разные материалы нет. Raycast проходит пустую половину.
- Targeting: `World.raycast` DDA входит в voxel, затем тестирует `selectionLocalBoxes` / `blockSelectionBoxes`. Если луч проходит через пустую часть occupied cell (rail, plate, ladder, torch, lantern, chain, …), hit не засчитывается и DDA идёт дальше. Outline, LMB и RMB делят один VoxelHit. Mining progress рисуется отдельным crack overlay на selection-shape, без remesh. Default для ordinary cubes — full block. Collision и selection разделены (rail не solid, но выбирается).
- `stone_stairs` остаётся legacy ID (`hiddenFromGameplay`), не крафтится и не показывается в Creative. Получаемые stairs: oak/birch/spruce planks, cobblestone, brick, stone brick. Slab counterparts те же плюс `stone_slab`.
- `stone_pressure_plate` делит `pressure_plate` render/redstone path с oak plate. Wooden trigger = all entities/items; stone = living (player/mobs). Placement только на верхнюю опору.

### Alpha approximation

- Нет greedy meshing: каждый видимый face становится отдельным quad. Dirty chunks перестраиваются с ограничением количества за tick и adaptive ms budget; один chunk в `pendingMesh` пока ждёт rebuild.
- Нет worker generation/meshing, LOD, occlusion system и полноценного frustum-aware scheduler. Pipeline на кадре: generate (unlit, radius = renderDistance+1) → incremental light → mesh visible radius. Visible chunk не мешится без neighbor light context. PLAYING: generation больше не вытесняет mesh навсегда — nearby/urgent ready mesh получает bounded slot даже на generation-кадре (`streamingScheduler.ts`). Halo pending mesh не конкурирует с wanted visible set. **lit→meshStart в несколько секунд из-за skip-all-mesh-on-gen снят**. Lighting flood mutex больше не останавливает очередь на blocked head; distant in-progress flood может быть preempted ради near unlock (`docs/reports/2026-08-23_lighting-halo-scheduler-starvation.md`). DEV inspector разделяет **prefetch lifetime** (`lit→meshStart`) и **player-visible latency** (`WANTED→VISIBLE`, `READY-WANTED WAIT`). `WORLD_LIGHT_BUDGET_MS = 2` сохранён; дальние края radius 6 всё ещё streaming, но очередь не зависает на 20–160 s из-за blocked head.
- Sky/block light remain an alpha approximation, not vanilla 1:1. Sky: vertical baseline (opaque blocks; water/leaves attenuate by 1) + bounded lateral frontier (14 indirect steps, each costs 1 plus material attenuation). No full-chunk multi-pass relaxation. Sources: torch/furnace 14, glowstone/lantern/lava 15. Jobs are resumable; PLAYING budget 2 ms, loading 8 ms. The 1-chunk halo and all eight mesh sampling neighbors must be stable. Daylight is shader-uniform-only. Completed jobs publish coalesced `lightVersion` / `meshedLightVersion` updates; unchanged reset/refill does not remesh.
- Пещеры и помещения получают боковой sky через проёмы с конечным градиентом; закрытая комната остаётся sky=0. Cubes and special geometry share a bilinear exposed-cell vertex sampler, exclude opaque samples from intensity and cap AO separately at 20%. Existing ambient and face-shade constants are unchanged; torch tint remains warm without PointLight.
- Render classification независима от face occlusion/light semantics: opaque, alpha-tested cutout, vegetation cutout, fire cutout, glass translucent и water translucent имеют отдельные geometry/material paths. Leaves используют `alphaTest=0.42`, `transparent=false`, `depthWrite=true`, `DoubleSide` и сохраняют biome RGB tint. Cross-plants (`lightingMode: vegetation`) пишутся отдельным batched mesh с `FrontSide` и lighting normals `(0,1,0)`. Fire использует glow cutout с UV-анимацией кадра (без remesh).
- Water и glass разделены по opacity/render order, однако отдельные translucent faces внутри pass всё ещё не сортируются по глубине.
- Lever, torch/redstone torch, wire, button, pressure plate, oak door, ladder, stairs, slabs и chest больше не рисуются full cubes. Torch ставится на пол и стену; button — на пол, стену и потолок; ladder — только на боковую сторону solid support; pressure plate — только на верхнюю грань solid support. Chest — отдельная entity-модель (body/lid/latch) с Faithful `entity/chest/normal` texture. Placement facing = opposite of look (latch/front к игроку), отдельно от door look-facing. Крышка открывается назад-вверх вокруг заднего hinge (`chestLidAngle` > 0); lid/body разделены `CHEST_LID_SEAM = 1/64`, latch-south omitted, **lid underside (`down`) присутствует** чтобы внутренняя сторона крышки не была прозрачной. Furnace — cube с `blockStates.facing` (тоже opposite-of-look) и lit front `furnace_front_on` при `burnTime > 0`; emission = `torchBlockEmission()`. Bed всё ещё не имеет specialized mesh.
- Bed — один блок с установкой spawn point и простым пропуском ночи.
- Basic redstone намеренно ограничен шестисоседней передачей сигнала и не моделирует directional connection shapes, quasi-connectivity или advanced components.
- Fluid simulation: source + flowing (`fluidLevel` 8 / 1–7, `fluidFalling`), strict down-first then sideways, water ~7 cells / 5 ticks, lava ~3 cells / 30 ticks, budgeted queue (48 updates, 1.5 ms, cap 2048). Horizontal routing uses a bounded Java-1.9-style minimum flow-cost field (water radius 4, lava 2): paths may turn, only equal-minimum initial directions split, unloaded chunks are barriers. Filled falling columns remain downward-only until support, then a new horizontal range starts; there is no global source-distance/volume cap. Water + lava source → obsidian; water + flowing lava → cobblestone. Render uses world-space **corner heights** and same-fluid face culling (not per-cell cuboids). Level-only changes remesh without relight. Distant fluids (chebyshev > min(meshRadius, 2)) pause in-queue. Worldgen lava — небольшие **enclosed** basin ponds (не scatter и не giant Y=12 sheets). `activateGeneratedFluidBoundaries` ставит в очередь только клетки с Air/replaceable/другой жидкостью рядом или снизу, включая x=15/16 когда соседний chunk появляется. Ordinary enclosed pond остаётся idle (queue 0).

## Предметы, добыча и создание

### Готово

- Data-first item registry связывает block items, resources, foods, tools, weapons, четыре комплекта armor, **flint and steel**, **golden apple**, **glass bottle**, **invisibility/regeneration potions**, **buckets**, **fire arrow** и **minecart**.
- Bucket follow-up: empty stack max 16, filled max 1. Пустое ведро использует тот же DDA с `stopOnLiquids`: первый liquid останавливает луч, source проверяется через `isFluidSource`; нельзя забирать через стену или flowing/falling cell. Обычный targeting по-прежнему игнорирует fluids. Survival сохраняет остаток пустого стака и добавляет filled bucket (при полном inventory — canonical drop); Creative pickup кладёт filled в active slot, placement его сохраняет. Source placement/pickup используют deferred lighting; Lava emission удаляется через существующий budgeted lighting path.
- Fluid timing follow-up: все новые задания, включая generic block edits и generated boundaries, получают material-aware delay, Air не ставится в очередь. Water first arrivals = ticks **5/10/15/20**, Lava = **30/60/90**. Старые `delay=1` calls не обходят rate; `+1` остаётся только для already-due budget retry. Material/lifetime смена инвалидирует старый ticket. Hill footprint предыдущего routing pass сохранён: **134 / 42** cells, late writes 0.
- В progression есть wood/stone/iron/diamond pickaxe, axe, shovel и sword; hoe и gold tools намеренно исключены.
- Gold armor присутствует, как и leather/iron/diamond armor.
- Stack validation, merge/split, left/right click semantics, durability, equipment constraints, atomic consume и serialization покрыты unit tests.
- Mining использует Java 1.9 формулу `(S/H)/30` при harvest и `/100` иначе. Preferred tool ускоряет добычу; `requiresCorrectTool` нужен только камню, рудам и furnace.
- 2×2 и 3×3 matcher поддерживает shaped, mirrored и shapeless recipes, tags, детерминированный consumption plan и **remainders** (lava bucket → empty bucket).
- Есть core recipes для planks, sticks, crafting table, chest, furnace, torch, ladder, white bed, door, bow/arrows, tools, swords, armor, slabs/stairs (включая birch/spruce/brick/stone brick; без hidden `stone_stairs`) и basic redstone/TNT/`stone_pressure_plate`. **Minecart** — shaped 5× Iron Ingot U (`I I` / `III`), в Recipe Book через `CRAFTING_RECIPES`. **Glowstone** shapeless Torch+Gold Ingot; **Lantern** shapeless Torch+Iron Ingot; **Chain** shaped `ISI`×3 → 16. Shield полностью удалён из registry/recipes/render/combat; legacy stacks очищаются при загрузке.
- Runtime furnace читает единые `SMELTING_RECIPES`/`FUEL_BURN_TICKS`: доступны iron/gold, sand→glass, logs→charcoal и raw foods без второй hardcoded table. Lit visual/light выводятся из `FurnaceState.burnTime > 0`, не из отдельного `lit` flag. LightEngine читает `world.blockEmissionAt`.
- Dropped items имеют physics, merge radius, pickup delay, pickup, cap, despawn и save/restore. Environment health = 5: shape-aware item AABB получает 4 damage/tick в Lava и 1 damage/tick в Fire, removal идёт через manager path с reason `burned`; Water не наносит environmental damage. Optional serialized health сохраняет повреждение, старые entries без поля безопасно получают 5. Modern generic water buoyancy удалена; Lava сохраняет небольшой 1.9-style upward kick. Обычные cube block items рисуются atlas-cube. Sprite items (включая held torch и arrow) используют общую `GeneratedItemGeometry`: один front/back quad на весь sprite, толщина `1/16`, side spans только по opaque→transparent (`alpha == 0`) с merge соседних рёбер. Side faces — outer shell (winding совпадает с outward normal). Collapsed side UV берёт центр opaque texel, не границу с transparent neighbor. 32×32 pack не меняет model size, но диагонали дают больше 1-texel spans (у `iron_pickaxe.png` 104 merged spans). Generated item material без mob wrap-shade (voxel light для drops сохраняется). Stack size даёт до четырёх детерминированно смещённых визуальных копий без создания новых ресурсов на кадр.
- First-person предметы классифицируются как `block`, `generated`, `handheld`, `bow`. Held mesh отдельно: `block_cube` / `generated` / `special_model`. `generated`, `handheld` и bow делят один first-person sprite pose: position `[0.67, -0.29, -0.70]`, rotation `[1, -90, 34]°`, `scale: 0.60` (**final** Three.js uniform, не множитель на vanilla `0.68`). Значения выбраны вручную через live QA calibrator; yaw −90° — намеренный visual result, не порт vanilla matrix и не candidate 8/18/32°. Канонический idle right-hand adapter (`heldItemVanillaTransform.ts`) остаётся diagnostic-only. Dev `?qaItem=` по умолчанию — isolated inspect (`qaView=front|back|left|right`), `qaView=held` возвращает first-person с live panel; RESET TO PRODUCTION возвращает эти числа. `qaSideDebug=1` красит UP/DOWN/LEFT/RIGHT. `held*` / `qaPose` override только idle held transform. Textured Steve arm видна только при пустом main hand; equip, walk/idle bob, swing/mining, еда, bow texture stages `0 / 0.65 / 0.9` накладываются поверх base. Held torch/lever/ladder — generated sprite по vanilla 1.21.8 item JSON (`layer0` = block texture); oak_door — generated из runtime-композиции `oak_door_upper`+`oak_door` (в pack нет `item/oak_door.png`). Button/pressure plate/stairs/slabs/chest/fence/rail/lantern/chain — `special_model`. **Любой** `special_model` идёт в `special_preview` (unknown shape → `generic` pose): auto-fit, sRGB, preview-only unlit clone, entity textures preloaded before `bake()`. Нет per-item brightness/scale. Chest icon использует тот же pipeline + `entity/chest/normal`. Ordinary cubes остаются 2D atlas tile; cube с `textures.front` (furnace, crafting table) использует front, не side. Creative E — отдельный `.mc-stage` с вкладками Каталог / Инвентарь (localization), catalog width 195 logical. Catalog: прокручиваемая сетка + gutter чтобы scrollbar не перекрывал 9-й столбец + только 9 hotbar slots; Inventory tab: armor слева сверху с силуэтами, без offhand, 3×9 на полную ширину + hotbar, без каталога. Catalog DOM/scroll сохраняется при переключении вкладок. Live `refreshOpenInventory()` патчит slot/recipe contents in-place (`data-sig`), hover — `::after` white overlay. Recipe Book только у crafting table и Survival 2×2 (кнопка в craft row, icon tabs); Furnace GUI без книги. Placement рецепта транзакционный: вернуть grid → затем real или ghost.

### Alpha approximation

- UI реализует cursor clicks, shift-transfer chest↔inventory, furnace routing и Recipe Book на crafting/Survival 2×2 (отдельная левая панель, кнопка книги в craft row, icon categories, search / All-Craftable, transactional real vs ghost). Полноценный pointer-drag distribution остаётся в data layer.
- Chest одиночный и содержит 27 slots; double chest и lock/name semantics отсутствуют. Lid `openProgress` — runtime-only. Lid underside — `down` face с `CHEST_LID_SEAM`.
- Печь тикает в общем world tick независимо от открытого GUI. Flame/arrow патчатся live. Recipe Book в печи сознательно отсутствует. GUI icon печи — `block/furnace_front`, не side.
- Recipe Book читает `CRAFTING_RECIPES`. `SMELTING_RECIPES` остаются источником furnace simulation, не UI-книги. Все crafting registry recipes считаются known/unlocked. Нет vanilla advancement unlocks.
- First-person generated/handheld/bow pose записан из manual visual QA: `[0.67, -0.29, -0.70]`, `[1, -90, 34]°`, scale `0.60`. Это **не** vanilla idle matrix и не pixel-perfect F2. Live panel и `qaPose` candidates остаются QA-only. Generic offhand storage сохранён; offhand renderer и shield entity отсутствуют. Leather overlay вне текущего pass. Слот второй руки в container GUI скрыт.

## Игрок и survival

### Готово

- Feet-anchored AABB `0.6 × 1.8`, sneak height `1.5`, step height `0.6`.
- Скорости walk/sprint/sneak, jump velocity и основные формулы ориентированы на reference; точные отличия перечислены в `MINECRAFT_1_9_REFERENCE.md`.
- Creative flight: только `gameMode === creative`, double Space в окне 7 ticks (edge keydown), `CREATIVE_FLY_SPEED = 10.9` / sprint `21.6` / vertical `7.5`. Shift descend, Ctrl fly-sprint, hover без gravity, landing (`landed`) выключает полёт, collision остаётся, flying перекрывает ladder. `isFlying` не пишется в save.
- Collision resolver двигает по осям, поддерживает wall sliding, step-up, ladder climb/descent и защиту от схода с края в sneak. Solid collision — массив boxes на клетку (`blockCollisionBoxes`): stairs/slabs/cactus/door/chest используют фактическую форму. Ladder collision для ходьбы нет (non-solid); climb volume отдельно в `ladderMotion.ts`.
- Render camera получает текущие yaw/pitch непосредственно из input каждый animation frame; физика и gameplay остаются на fixed `20 TPS`, поэтому mouse-look не квантуется simulation ticks. Hurt camera roll — только `camera.rotation.z` (render offset); yaw/pitch и aim не меняются.
- Визуальные transforms мобов, drops, player arrows и primed TNT/falling blocks интерполируются на render frame (`alpha = accumulator / FIXED_DT`). AI, hitbox, damage и collision читают только simulation pose. Teleport/spawn/коррекции ≥ 6 блоков делают snap.
- Есть water/lava state, плавучесть/drag, утопление, lava/fire/cactus damage и fall damage после трёх блоков. Fire contact — AABB overlap с `BlockId.Fire` (`PlayerController.inFire` / `aabbOverlapsBlockType`), **1 HP / 20 ticks** while intersecting Fire; damage идёт через canonical armor mitigation (`fire`/`lava` **не** bypass). Выход из Fire сразу гасит `contactFire` (нет afterburn от ordinary Fire). Lava: 4 HP / 10 ticks + linger `ignite(300)`, тоже через armor. `FIRE_ARROW` (≈100 ticks) — отдельный таймер. Вода гасит arrow/lava/sunlight, не ordinary-fire contact (его и так нет вне клетки). First-person burning overlay — два нижних flame quad (shared fire strip, opacity 0.76), не 6-plane block перед камерой. Успешный health damage (`SurvivalSystem.onDamage`, `dealt > 0`) даёт короткий red flash и bounded hurt kick. Cobweb сильно замедляет игрока/мобов (`movementMultiplier` 0.15) и стрелы. Fence collision height 1.5.
- Survival считает health/hunger/saturation/exhaustion, regeneration/starvation и hurt resistance. Status effects: absorption, regeneration (heal-over-time), invisibility (hostile `playerTargetable` false; first-person empty-hand arm hidden while the effect is active, held item can remain). Drinkable potions: invisibility **3 min** (`3600` ticks), regeneration **1 min** (`1200` ticks). Active invis/regen show a small bottom-right HUD chip (potion icon, Russian name, `M:SS` countdown) and a soft lower-screen swirl particle overlay from `textures/particle/particles.png`. Absorption HP is saved with optional remaining ticks; other effects are not serialized. HUD показывает yellow absorption hearts справа от red hearts. Effect expiry zeros leftover absorption.
- Health HUD: 10 pixel-art hearts (`gui/heart_{empty,half,full}.png`), same `--hud-status-icon-size` / gap as the 10 armor icons so the rows match in width. Full = 2 HP, half = 1 HP, still 20 HP max. Hunger remains emoji pips.
- Sprint в Survival доступен только при hunger выше `6`; удержание jump начисляет jump exhaustion только в tick фактического отрыва от земли.
- Armor использует classic fixed reduction `(25-clamp(points,0,20))/25`, без damage-dependent curve/toughness. Piece values сохранены (leather 7 / gold 11 / iron 15 / diamond 20). Canonical `getArmorPoints()` питает и mitigation, и HUD. Bar из 10 pixel-art chestplate icons над hearts (full=2, half=1), скрыт при 0.
- Food use требует удержания, consumable проверяет hunger cap.
- Death выбрасывает survival inventory/equipment, показывает экран смерти и возвращает игрока в spawn point. Death messages идут в локальный чат (`deathMessage(source)`).
- Локальный чат (без сети): T открывает поле, `/` открывает с префиксом `/`, Enter отправляет, Esc закрывает, Up/Down — история. Команды через `src/chat` registry: `/help`, `/gamemode`, `/time`, `/give`, `/tp`, `/seed`, `/clear`, `/kill`.
- Creative не расходует blocks/arrows/durability и не получает survival/environment/mob/explosion damage.

### Alpha approximation

- Movement использует экспоненциальный response/friction, а не bit-exact vanilla physics.
- Sneak height/eye, terminal velocity и единый block reach намеренно отличаются от Java 1.9 reference.
- Suffocation и void перечислены как damage sources, но отдельный стабильный runtime detector для них не завершён.
- Armor durability и многие secondary effects не воспроизводятся полноценно.
- Difficulty не выбирается в UI; runtime использует `normal`.

## Бой и сущности

### Готово

- CombatSystem считает full-damage attacks без cooldown. Registry — единственная таблица damage. Target-owned `HurtResistance` отделяет accepted differential hit от full hurt; armor fixed `(25-A)/25`, toughness не участвует.
- Melee target выбирается raycast по mob AABB и не проходит сквозь voxels; entity reach ограничен тремя блоками в runtime.
- Shield полностью удалён. Hold-use меча включает classic sword blocking/pose и movement ×0.2, без shield cone/wind-up/axe-disable. Legacy shield stacks становятся null, остальные предметы сохраняются.
- Bow использует 20-tick charge curve, три pulling textures, плавный FOV zoom и movement slowdown, расходует arrows в Survival, повреждает bow и создаёт projectile с gravity/block/mob collision.
- MobManager подключён к main tick и save/restore.
- Passive: cow, pig, chicken, sheep. Hostile: zombie, skeleton, creeper, spider.
- AI имеет idle/wander/chase/attack/hurt/die states, caps, distance spawning/despawn, line of sight и voxel collision. Hostile **surface night** spawn ≈ ×0.5 (`SURFACE_NIGHT_HOSTILE_SPAWN_FACTOR`). Dark cave hostiles spawn separately (low sky, solid floor, no lava/water), max **1 new cave hostile per chunk per spawn event**, local radius-12 density guard; not a permanent 1-mob-per-chunk lock. Passive spawn path unchanged.
- Hostile melee использует реальную 3D-дистанцию между eye positions и voxel line of sight, поэтому не бьёт игрока на другом этаже или через стену.
- Creative player остаётся центром spawning/despawn, но не передаётся hostile AI как target.
- Player и skeleton используют общий arrow visual/physics basis: blocks-per-tick velocity, continuous segment collision, air drag `0.99`, water drag `0.6`, gravity `0.05 block/tick²`, speed-based damage и in-ground state. **Fire arrow** — shapeless `arrow + lava_bucket` (остаётся empty bucket), projectile с оранжевым tint. Попадание: обычный урон стрелы + `igniteTicks` 100 (5 с) по живой цели; TNT block праймится; TNT minecart детонирует сразу; обычные блоки **не** поджигаются. Горение: `FIRE_CONTACT` / `FIRE_ARROW` / `SUNLIGHT` / lava — раздельные причины, общий overlay. **Все hostile** (`isHostileMob`) горят под прямым дневным солнцем (`daylight ≥ 0.82` и skylight ≥ 14), не vanilla undead whitelist. Player и passive не горят от солнца. Creeper имеет fuse/radial explosion, hostile hits передаются напрямую в armor/SurvivalSystem, смерть моба создаёт loot drops.
- `MinecartManager`: 3D open-top entity (`minecartGeometry.ts`, texture `entity/minecart`), не item billboard. Opaque full-width inner floor (`MINECART_FLOOR_TOP = 0.16` above the 2/16 rail strip). **ON_RAIL** (`cart.rail`) uses rail-constrained W/S; end of a loaded track converts `alongSpeed × tangent` to world velocity and enters **OFF_RAIL** (gravity, voxel collision, ground friction `0.78`/tick, no W/A/S/D). Crossing a real rail cell re-snaps after a 4-tick grace. Ride Use; **Shift** (sprint edge) dismounts to a clear neighbor, on- or off-rail. LMB (attack edge) breaks a cart that is nearer than the block hit; Survival drops Minecart via `DroppedItemManager` (unprimed TNT cart also drops TNT); Creative removes without a world drop (`dropsForBrokenMinecart`); ridden and primed TNT carts are ignored. Player AABB push проектируется на tangent. TNT Use → variant `tnt` (не rideable); Flint entity-first prime, fuse 80 ticks, no Fire block; Fire Arrow — immediate explode (cart AABB taller than the rim so the cargo is hittable). Save `minecarts?` (position/velocity/variant/fuse/`onRail`). Isolated rail follows player look axis; EW visual yaw `π/2`. Practical, не vanilla bit-exact.
- Base player/mob melee knockback и full hurt flash запускаются только для `fullHurt`, в том числе при полном поглощении absorption. Rejected и differential hit не повторяют base KB/flash. Accepted extra sprint KB обрабатывается отдельно.
- Все восемь видов используют articulated pivot rigs и собственные local legacy entity sheets. У sheep исправлена длина base legs при сохранённом коротком wool overlay; skeleton torso двусторонний только для читаемости рёбер; zombie left limbs берут mirrored classic `64×32` UV (`[40,16]`/`[0,16]`), а forward-arms pose задаётся положительным Three.js Euler (`+1.2` / `+1.55`), не Minecraft-значением `-1.2`. Spider сохраняет emissive-style `spider_eyes` overlay; gameplay hitboxes независимы от visuals.
- `LegacyModel` отделяет `rotationPoint` от локального `addBox origin`, переводит Y-down model-space в Three.js и хранит неизменяемую base pose. Константы и уровни точности перечислены в `MOB_MODEL_REFERENCE.md`.
- World entities (mobs, drops, arrows, falling blocks, primed TNT) берут яркость и тёплый torch tint из тех же `skyLight`/`blockLight`, что и terrain: три sample (feet/torso/head), `createEntityMaterial` без Lambert N·L, мягкий wrap-shade не ниже `0.76`. Успешный mob damage (не fire DOT) ставит per-entity `hurtFlashSeconds` (~220 ms) и multiply-tint в `userData.entityLight`. Geometry и textures остаются shared; each living mob renderer clones entity materials once at spawn (`cloneOwnedEntityMaterial`) so `uEntityLight` cannot leak across the same species. Clones dispose on despawn.
- Generic `TexturedCuboidGeometry` строит шесть независимых UV faces из logical texture offset/size; 2× sheets нормализуются так же, как 1×. Entity sheets используют sRGB/nearest; block atlas использует mipmaps, четырёхпиксельную extrusion-зону и ограниченную anisotropy.

### Alpha approximation

- AI использует direct steering плюс 1-block step-up, а не pathfinding/navigation mesh: сложный terrain всё ещё может застревать.
- Spawn rules, light checks, despawn, sunlight burning (all hostiles, not vanilla undead-only), loot chance и damage — gameplay approximation, а не полная таблица Java 1.9.
- Нет breeding, taming, shearing, animal drops по burning state, skeleton equipment, spider climbing и сложных special cases.
- Projectile/explosion physics не моделируют точный swept volume/exposure/raycast sampling vanilla.
- Classic melee реализован, но это не multiplayer/netcode parity. Input re-entry sprint latch и tool wear −1 — явные продуктовые адаптации. Browser feel/pose acceptance ещё требуется.
- Нет enchantments, experience и advanced combat feedback. Potion items (invisibility / regeneration) и golden apple effects есть; brewing stand нет.

## Basic redstone и TNT

### Готово

- `RedstoneSystem` подключён к main fixed tick и получает notifications после placement/break/explosion changes.
- Dust переносит мощность `15 → 0` по шести соседям с затуханием на единицу за wire cell.
- Redstone torch является постоянным source; lever переключается use action; stone button даёт timed pulse; oak pressure plate реагирует на игрока, мобов и dropped items.
- Powered TNT превращается в отдельную visual primed entity с gravity/voxel collision, исчезает как block и взрывается после `4 s`.
- TNT explosion использует общий radial pipeline, но apply идёт batch: один lighting pass на slice, chain TNT без повторного `setBlock`. Mass TNT стоит в `ExplosionQueue` с time/job/voxel budget.
- Active sources, остаток button pulse и primed TNT с оставшимся fuse сохраняются/восстанавливаются. Redstone state v2 также хранит lever attachment/facing; v1 получает fallback `floor/north`. Derived wire power не хранится и пересчитывается после restore.
- Lever состоит из stone base и отдельной handle с pivot/rotation; placement поддерживает floor/wall/ceiling и четыре wall facings. Powered change инвалидирует chunk mesh.
- Torch/redstone torch — cuboid `0.22×0.88` с UV crop opaque региона torch.png; wall torch основанием касается стены, пламя наружу/вверх. Dust — ground quad с power tint, button — малый выступ на любой стороне, pressure plate — тонкую горизонтальную plate.
- Propagation bounded: queue и число шагов за update ограничены; отдельный test проверяет budget.

### Alpha approximation

- Это компактная шестисоседняя сеть, а не полная redstone topology Java 1.9.
- Нет repeater, comparator, piston, observer, dispenser/dropper, hopper, torch burnout и block-specific powered behavior за пределами TNT.
- Dust connection shape/power пока не получает отдельную визуализацию на block mesh.

## UI, input и lifecycle

### Готово

- DOM/CSS screens: loading, стилизованное main menu, selectable world list, create world, online server mock, settings, read-only controls, pause, death. Меню использует `public/ui/frontier-menu-background.png`; online entries и таблица фактических клавиш вынесены в `menuModel.ts`.
- HUD: crosshair, hotbar, selected item, health (10 pixel hearts aligned with armor), hunger, **armor bar** (над hearts, hidden at 0), mining progress bar (kept alongside the new world crack overlay), active potion effect chips (bottom-right), toasts и F3 debug. Attack meter удалён.
- Рука и выбранный предмет рендерятся геометрией в отдельной first-person Three.js scene после мира; прежние DOM image overlays удалены. Shield отсутствует, блок мечом использует pose существующего предмета.
- Settings: volume, mouse sensitivity, render distance `2–6`, FOV `60–100`; отсюда открывается отдельная read-only справка по управлению. Значения sliders показываются live.
- Desktop pointer lock: inventory/chest close = programmatic relock; наблюдённый Esc из PLAYING открывает pause через `pointerlockchange` без второго `exitPointerLock`; Continue делает один `tryRequestPointerLock()`. Unknown/focus-lost unlock и отказ запроса используют click fallback без auto-retry. Если браузер не доставляет Escape keydown, причина честно unknown, не доказанный Esc. Подробности raw fallback/diagnostics — в свежем polish report.
- Touch joystick/look/buttons и landscape layout with safe-area insets.
- Lifecycle states: `LOADING`, `MENU`, `PLAYING`, `PAUSED`, `AD`, `BACKGROUND`, `DEAD`.
- Только `PLAYING` продвигает fixed simulation; остальные states останавливают audio и GameplayAPI marker.
- Container/modal ≠ simulation pause: inventory, Creative catalog, chest, furnace, crafting table и Recipe Book остаются в `PLAYING`. Мир, печи и сущности тикают; WASD / look / attack / use / flight блокируются. `Esc` → Pause menu — единственный обычный gameplay путь в `PAUSED`.

### Alpha approximation

- Attack meter удалён; расширенный classic combat browser smoke всё ещё нужен.
- Настройки не сохраняются между sessions; rebind управления не реализован, controls screen намеренно read-only.
- Все заданные desktop/mobile размеры прошли browser visibility/count checks; на `667×375` визуально проверены inventory, pause и settings, отдельно проверен portrait overlay.
- Во время QA найдено и исправлено перекрытие menus/modals touch controls: `controls-suppressed` скрывает look zone, joystick и action buttons вне gameplay.
- Rotation state-preservation и multi-touch поведение всё ещё нужно проверить на реальных устройствах.
- Тексты интерфейса на русском; Yandex language helper пока не подключён к localization table.
- Fullscreen button, rebindable controls и accessibility mode не реализованы.

## Сохранения и платформа

### Готово

- IndexedDB database `frontier-cubes-saves`, object store `worlds`, save schema `1`.
- World summary хранит id, name, seed, mode, timestamps и play time.
- Сохраняются player position/velocity/view, health/hunger/saturation, selected slot, spawn point, inventory/equipment, time, block modifications, optional blockStates, chest/furnace state, dropped items, falling blocks, mobs, redstone sources, primed TNT и optional minecarts.
- Autosave interval — 30 seconds игрового времени; дополнительные saves выполняются при pause, background, pagehide, закрытии container и выходе в меню.
- Повреждённый inventory не блокирует загрузку всего мира: используется empty inventory fallback.
- Старые player/offhand bucket stacks до прежнего max 64 разбиваются по новым лимитам перед inventory validation; излишек возвращается через обычные drops после старта session. Это узкая совместимость bucket limits, не общая миграция save schema.
- Yandex adapter безопасно работает без SDK локально, вызывает `LoadingAPI.ready()` после interactive menu и маркирует gameplay start/stop.

### Alpha approximation / не реализовано

- Нет save migrations, backup slots, integrity checksum, export/import и recovery UI.
- Полное survival state не сериализуется целиком: exhaustion, air/fire timers восстанавливаются не полностью. Absorption HP и remaining absorption ticks сохраняются. Hurt resistance, sword blocking и sprint flags намеренно transient; combat cooldown больше не существует.
- Memory fallback не переживает reload.
- Нет Yandex player authorization, cloud data, leaderboards, ads, payments и achievements.
- Pause reasons представлены простым state machine; перед релизом нужно проверить конкуренцию user pause, tab hidden и platform pause/resume.
- Yandex archive/debug-panel/moderation validation не является завершённой только потому, что SDK adapter существует.

## Автоматическая проверка

Срез проверки fluid timing/bucket follow-up от **2026-08-27**:

```text
TypeScript: tsc --noEmit — PASS
Targeted:   7 files, 77 fluid/bucket/item/inventory/crafting tests — PASS
Vitest full: 570/598 passed, 28 failures; canonical check: 573/601, 28 failures + 2 worker RPC timeouts
Vite build: 124 modules — PASS
Size/archive: 3.44 MiB / 187 files — PASS
Main JS: ~962 kB / ~269 kB gzip; CSS: 38.93 kB / 9.04 kB gzip
```

Baseline этого follow-up — предыдущий **dirty local routing/item patch**, не GitHub: 529/563 passed, 34 baseline-class failures. Ещё раньше clean `8935772` имел 30/551 failures: CRLF-sensitive source fingerprint, radius-6 streaming thresholds и CPU-heavy timeouts. Сейчас добавлено 40 timing/bucket tests (всего 603); все 40 проходят в final targeted run. Два legacy-bucket compatibility tests добавлены после canonical check. Unrelated assertions/timeouts не ослаблялись. Browser подключается, но локальная страница заблокирована URL security policy; реальный gameplay QA остаётся открытым gate. Подробности: `docs/reports/2026-08-27_fluid-timing-and-bucket-interaction.md`.

Codex UI (menu family, online mock, read-only controls) and Cursor PR #6 (fluids, HUD, combat, chat) coexist in the same `GameUI` / `Game` paths.

Покрыты registries, excluded item scope, stack/inventory operations, item render routing/generated geometry (including `iron_pickaxe.png` span counts, outer-shell winding, inspect QA params and closed-baseline source/topology fingerprints), shared first-person sprite pose, `held*` / `qaPose` QA overrides, live pose calibrator helpers, `qaPoseCompare` parse, vanilla idle first-person matrix adapter (not production-wired), crafting/smelting data и runtime furnace flow, combat formulas, bow helpers и отсутствие shield, survival basics, player physics, generation/state, dropped items, mob manager и basic redstone/TNT. Пробелы и ручная матрица перечислены в `TESTING.md`.

## За пределами текущей alpha

Не реализованы accounts/cloud worlds, public VPS deploy, Survival PvP matchmaking, weather, advanced farming/breeding, enchantments, brewing stand, Nether/End, villagers/trading, experience progression, advanced redstone, pistons/hoppers, bosses и моддинг API. **Local Anarchy** (`npm run dev:server`) уже есть: server-authoritative world on one PC. Drinkable potions, rails, minecart и Farming V1 в этой alpha есть как practical approximation, без brewing/powered rails/Farming V2. Это осознанно не подменяется заглушками в P0.
