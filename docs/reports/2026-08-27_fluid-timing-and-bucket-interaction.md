# Goal

Исправить WHEN fluid updates допускаются и HOW empty bucket находит/забирает source. Предыдущую local flow-cost routing/item-burning реализацию сохранить. Никаких commit/push.

Implementation и автоматические проверки завершены. Полный Definition of Done **не закрыт**: browser gameplay QA заблокирована URL security policy; full suite остаётся baseline-red.

# Current local baseline

- Branch: `feat/playable-voxel-alpha`.
- `HEAD = origin/main = 8935772e6edd8137a19755a8a7759d197bce4c28`.
- Рабочий baseline — **dirty local worktree**, не файлы из GitHub.
- До follow-up modified: `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/TESTING.md`, `scripts/benchmark-fluids.ts`, `src/entities/DroppedItemManager.ts`, `src/world/fluids.ts`, `tests/fluids.test.ts`.
- До follow-up untracked: предыдущий report `2026-08-27_fluid-routing-and-item-lava-fix.md`, `tests/dropped-item-environment.test.ts`, `tests/fluid-routing.test.ts`.
- Прочитаны AGENTS, current PROJECT_STATE, свежий report, git status/branch/log/diff. Посторонних изменений не обнаружено; файл `e --short HEAD` отсутствует.
- Предыдущий report: local baseline 529/563 passed, 34 failures (CPU timeouts, fingerprint, streaming). Более ранний clean HEAD имел 30/551 failures. Этот follow-up не начинался с clean tree и не восстанавливал origin-файлы.

# Previous Codex fluid work preserved

Не менялись `computeFluidUpdate`, bounded reverse-distance field, nearest/equal/turning path routing, down-first, decay, falling-column support handling или fluid surfaces. Не менялись DroppedItemManager и его пять environment tests. Предыдущие 12 новых routing/item tests сохранены.

Benchmark script и предыдущий report оставлены без изменений этим follow-up. В cumulative Git diff они присутствуют как предыдущая работа, не как новые изменения.

# Java 1.9 timing reference

Contract из задачи: fixed 20 TPS, Water 5 ticks = 0.25 s, overworld Lava 30 ticks = 1.5 s на новый causal step. Это material deadline, не снижение общего throughput. Соседние независимые fronts могут обновляться в одном tick. CPU budget может только задержать due work, никогда не выполнить новое раньше срока.

Fluid budgets сохранены: 48 updates/tick, 1.5 ms slice, queue cap 2048; world job/light budgets 4/2 ms. Minecraft здесь reference, не импорт его кода.

# BEFORE propagation timings

Сначала добавлен failing `tests/fluid-timing.test.ts`, затем запущен на неизменённом production baseline. Fixture: один загруженный Stone-коридор с Air channel, источник на tick 0. First arrival читается из `world.tickNumber`, не FPS/wall clock. Только clock CPU-budget заморожен, чтобы OS/GC jitter не искажал exact scheduling assertions; `world.tick()` остаётся настоящим fixed tick.

| Fluid | x=1 | x=2 | x=3 | x=4 |
| --- | ---: | ---: | ---: | ---: |
| Water BEFORE | 1 | 1 | 6 | 6 |
| Lava BEFORE | 1 | 1 | 31 | — |

Оба новых теста красные до fix. Две последовательные клетки могли появиться за один tick.

# Root cause

1. `applyBlockBatch` ставил center + шесть соседей на `+1`, включая Air.
2. `takeDueFluids` извлекал эти Air coordinates вместе с source. Source превращал Air в жидкость, затем уже извлечённое задание для бывшего Air сразу продолжало propagation в том же tick.
3. Propagation notifications тоже ставили задания для не-жидких клеток; получался повторяющийся двухклеточный cascade.
4. После writes delay вычислялся по origin. Если Lava уже стала Air/Stone, `fluidTickDelay` выбирал Water=5.
5. Generic edits и generated activation могли уменьшить pending Lava deadline до `+1`.

# Scheduling paths audited

| Path | BEFORE reason/material/delay; acceleration risk | AFTER |
| --- | --- | --- |
| `World.setBlock → applyBlockBatch` | place/break/edit, center +6 включая Air, +1; **yes** | only actual receiver Water/Lava, +5/+30 |
| `scheduleFluidAround` | generic notification, caller delay defaults1, no material filter; **yes** | delegates each receiver to canonical material-aware scheduler |
| `scheduleFluid` dedupe | earlier request overwrote due, Air allowed; **yes** | delay clamped to receiver rate, O(1) ticket Map; repeated edits neither accelerate nor postpone normal pending deadline |
| generated boundary / neighbor chunk activation | exposed generated sources, +1; **yes** | actual receiver rate, enclosed ponds still idle |
| `processFluidQueue → produced writes + origin neighbors` | mutated origin determines delay, nonfluids also queued; **yes** | each surviving/new fluid gets its own material rate; no Air fallback |
| CPU budget overflow | due work rescheduled+1, shared new-work API; unsafe ambiguity | separate `retryDueFluid`, requires a live already-due ticket |
| `takeDueFluids` | extract48, forget identity; Air could become fluid in snapshot | retain identity until consume, invalidated jobs skipped; cap/distant pause retained |
| `Game` filled placement | generic mutation+explicit scheduleAround1; **yes** | helper uses canonical batch/deferred light; +5/+30, source promotion restarts own deadline |
| `Game` empty pickup | generic target+Air mutation+scheduleAround1; **yes** | bucket DDA→canonical source→batch; real neighbors use their own rate |
| `Game.tryIgniteAt` | Fire placement then redundant scheduleAround1; **yes** | redundant notification removed; setBlock path handles actual fluids |
| fixed loop | Game fixed step→World.tick→processFluidQueue once | unchanged; no render/mesh/placement direct execution |
| tests/benchmark explicit delay1/2 callers | raw delays could bypass material rate | calls remain valid but cannot shorten material minimum |

`ScheduledFluidTick.block` captures material before writes. Raw block replacement cancels the old coordinate ticket, including an already extracted one. Same-material bucket flow→source also invalidates the old lifetime explicitly. `consumeDueFluid` checks identity, material and due time. No new propagation uses the retry API.

# Timing fix

Production changes limited to scheduling/interaction; no new fluid solver. New cells are scheduled only after creation and cannot enter the currently extracted due snapshot. Neighbor notifications read only actual fluid receivers, so removing Lava cannot manufacture Water-speed follow-up jobs.

Exact tests cover Water/Lava arrivals, both materials' independent parallel fronts, repeated generic edits, legacy +1 callers, Air enqueue rejection, Water→Lava replacement, removed/recreated same-material source, stale extracted tickets, already-due budget retry and delayed Lava drain.

# Bucket raycast root cause

`session.target` uses the ordinary shape-aware raycast, intentionally ignoring liquids (`blockSelectionBoxes` returns no liquid boxes). Old `useEmptyBucket(hit)` required that same target to be Water/Lava, making the normal pickup path unreachable. It also replaced an entire stack of empty buckets with one filled bucket.

# Bucket-specific raycast

Added optional `World.raycast(..., { stopOnLiquids: true })` to the existing DDA. In this mode the first liquid voxel supplies an interaction AABB. Solid/special blocks retain existing selection boxes. Default raycast remains unchanged; there is no global liquid outline/mining target and no second traversal engine.

Empty bucket uses player eye/view and the existing PLAYER_REACH before ordinary block/cart dispatch can consume a target behind the liquid. A first flowing/falling hit stops traversal and then fails pickup; no skipping through to a source. Ordinary solid wall and reach limits still block collection.

# Source semantics

- Pickup calls canonical `isFluidSource`; Game no longer duplicates level/falling rules.
- Source→Air goes through `applyBlockBatch` with deferred lighting: block state cleanup, save delta, dirty mesh/corner neighbors and real fluid neighbor notifications remain canonical.
- Filled placement uses the ordinary block target/face offset and replaceability rule; source state uses `FLUID_SOURCE_LEVEL` and no falling flag.
- Pouring onto existing same-fluid flow promotes it to source and starts a fresh material deadline; an existing source is a no-op and does not consume the bucket.
- Lava pickup uses the existing budgeted removal-light job; no synchronous region flush was added.

# Inventory semantics

- Registry: empty max16, Water/Lava bucket max1.
- Survival count1: selected slot becomes filled. Count>1: subtract exactly one empty, insert filled using Inventory.add; remainder uses Game's existing drop callback.
- Creative pickup: filled bucket appears in active slot; remaining empty buckets are preserved in inventory/drop fallback. Creative filled placement keeps the selected filled bucket. Survival placement returns one empty bucket.
- Because pre-change player saves could contain filled stacks up to64, `restoreBucketInventory` normalizes only legacy bucket stacks before existing validation. Other inventory items/slots are preserved; excess is inserted or returned for ordinary drops after session startup. Input save object is not mutated. This avoids the existing whole-inventory-empty fallback for those old stacks. No general inventory/save-system rewrite.

# AFTER Water timings

| Target | First arrival tick | Simulated seconds |
| --- | ---: | ---: |
| x=1 | 5 | 0.25 |
| x=2 | 10 | 0.50 |
| x=3 | 15 | 0.75 |
| x=4 | 20 | 1.00 |

No first target at ticks1–4; no second at ticks6–9. Two independent Water sources follow the same cadence simultaneously.

# AFTER Lava timings

| Target | First arrival tick | Simulated seconds |
| --- | ---: | ---: |
| x=1 | 30 | 1.50 |
| x=2 | 60 | 3.00 |
| x=3 | 90 | 4.50 |

No first target at ticks1–29; no second at ticks31–59. Two independent Lava sources run in parallel; repeated Stone edits do not accelerate or starve pending source work. These are simulation measurements, not a claim of completed visual QA.

# Routing regression

Canonical hill benchmark, before this follow-up → after:

| Metric | Water BEFORE | Water AFTER | Lava BEFORE | Lava AFTER |
| --- | ---: | ---: | ---: | ---: |
| Cells | 134 | 134 | 42 | 42 |
| Initial branches | 1 | 1 | 1 | 1 |
| Falling cells | 12 | 12 | 12 | 12 |
| Supported landing columns | 3 | 3 | 3 | 3 |
| Landing footprint Y21/Y25/Y29/Y33 | 113/5/4/3 | 113/5/4/3 | 25/3/3/2 | 25/3/3/2 |
| Max Manhattan distance | 28 | 28 | 20 | 20 |
| Queue peak | 185 | 68 | 87 | 23 |
| Updates | 756 | 256 | 249 | 75 |
| Writes | 266 | 266 | 82 | 82 |
| Settle tick | 88 | 152 | 302 | 631 |
| Late writes (200 ticks) | 0 | 0 | 0 | 0 |
| Final queue | 0 | 0 | 0 | 0 |

Slower settling is intended material cadence; geometry/range/turning/ties remain identical. Lower queue/update counts come from no Air jobs, not a speed throttle. Flat Water queue177→67, Lava80→23; flat late writes remain0. Measured fluid tick max2.173/1.575ms (budget1.5ms is checked between jobs, one job may overshoot). Compute solver was not changed; wall-clock samples under concurrent full-suite load are noisy (Water average0.14873ms, Lava0.06792ms), not exact tick timing inputs.

# Lighting regression

- Bucket integration proves Lava emission15→0, neighboring block light→0 after existing `processLighting(2, ...)` slices, source state removal and no call to synchronous flush.
- Existing water/lava level-only skip-relight, mixing, coalescing and drain assertions pass. Fluid surfaces7/7 and block-selection22/22 pass.
- Canonical lighting benchmark BEFORE/isolated AFTER: 9×9 sliced total1332.727→1348.022ms, max slice3.420→3.397ms; same41472 columns/24511 nodes. Cross-chunk torch14→13, torch/furnace sky recomputes0.
- First AFTER benchmark overlapped full tests and was slower (2036.096ms, max4.224ms); isolated repeat above removes that contention. No lighting budgets or architecture changed.
- Existing lava-emitter soak still exceeds its unchanged5s test timeout (isolated5.677s); this also existed before the follow-up. Other5 lighting-jobs tests pass. A flaky near-flood-owner assertion from the first full run passes isolated.

# Streaming regression

Canonical streaming benchmark run; no scheduler code/budgets modified.

- Instant-light walk/fly/reverse/zigzag: player missing0ms, wanted→visible p95≤200ms, same baseline fairness.
- Radius6 sliced-light nearMissing remains22.233s for flight, same baseline proxy failure. Reverse12.317→12.950s and zigzag6.300→6.667s vary with real CPU slicing; no claim that this old problem is fixed.
- Fluid benchmark Water/Lava/both nearMissing proxy17.783s before and after. AFTER wanted p95≈5.18–5.20s. Existing isolated three assertions still fail at exactly14.8167s vs<8s.
- Equilibrium, distant pause/resume, generated-boundary activation and loaded/unloaded borders pass. Existing routing tests/assertions/waits were not weakened.

# Browser QA

**BLOCKED, not passed.** Current Browser plugin successfully connected (the previous trust-path problem did not recur). First navigation to `http://localhost:4173/` returned connection refused because no server was running. Started the existing Vite dev server on4173. The documented reload then returned a Browser URL security-policy denial with an explicit no-workaround instruction. No alternate host/browser/CDP/automation bypass was attempted.

No screenshots or real rendered gameplay observations are claimed. The Browser skill kept QA on the supported surface and stopped browser actions at that policy gate.

Remaining manual/authorized-browser matrix:

1. Flat-ground Water bucket: visibly sequential front, about0.25s per step.
2. Flat-ground Lava: about1.5s per step, third horizontal cell around4.5s.
3. Empty bucket collects Water and Lava sources; flowing/falling targets fail, walls/reach/flowing foreground cannot be bypassed.
4. Pickup from an established stream: gradual drain, not instant whole-stream deletion.
5. Lava source pickup: orange light disappears as budgeted lighting completes, no persistent ghost.
6. Survival single/stack/full-inventory and Creative active-slot/placement behavior in real UI.

# Tests

```text
BEFORE timing tests                         0/2 PASS (expected red: 1/1/6/6 and 1/1/31)
Final focused matrix                        77/77 PASS (7 files)
  fluid-timing                              9/9
  bucket-interaction                        31/31
  previous fluid-routing                    5/5
  fluids                                    11/11
  dropped-item-environment                  5/5
  inventory                                 7/7
  crafting                                  9/9
lava-bedrock-ore-pass isolated               10/10 PASS
fluid-streaming isolated                    15/18; same3 baseline streaming failures
selection/surface/lighting-physics          37/37 PASS
lighting-jobs isolated                      5/6; baseline5s soak timeout
near-flood-owner isolated                   PASS
npm test full JSON run                      570/598 PASS,28 failures
npm run check                               573/601 PASS,28 failures,2 worker RPC timeouts
npm run typecheck                           PASS
npm run build                              PASS,124 modules
npm run check:size / check:archive           PASS,3.44MiB/187 files
```

Final suite contains603 tests: two legacy-bucket compatibility tests were added after canonical check and are in final focused31/31. Full run failures remain the documented fingerprint (`e71967bd` vs`be428190`), radius6 assertions and CPU-heavy timeout groups; canonical check's two additional errors are worker `onTaskUpdate` RPC timeouts. Full suite is **not green**, and a passing count does not override those errors. No unrelated expected value or timeout was changed to hide failures.

Build warnings remain the expected external `/sdk.js` script and JS chunk>500kB. Production≈962kB JS/269kB gzip, CSS38.93kB/9.04kB gzip; unpacked size remains below release limits. Ignored diagnostic logs live under `.qa-screens/fluid-followup-*` and are not project deliverables.

# Files changed

New follow-up production edits:

- `src/world/World.ts`: material scheduling/ticket lifetime and one DDA option.
- `src/world/fluids.ts`: scheduling callsites only; solver preserved.
- `src/core/Game.ts`: small bucket dispatch/wrapper and legacy player bucket restore integration; no unrelated gameplay changes.
- `src/items/registry.ts`: three stack limits.
- New `src/items/bucketInteraction.ts`: shared pickup/placement/inventory transaction plus narrow legacy player adapter.
- New `tests/fluid-timing.test.ts` and `tests/bucket-interaction.test.ts`.
- `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, this report.

Previous dirty files are listed separately under Current local baseline. No formatting sweep, alternate raycast, global selectable fluids, new solver, worldgen/render/light rewrite, reset/stash/clean or unrelated file deletion.

# Known limitations

- Browser gate remains; task must not be presented as full DoD complete until real gameplay QA is performed.
- Existing full-suite timeout/fingerprint/streaming failures remain; no unrelated regression-fix scope was added.
- Legacy bucket compatibility is for player inventory/offhand, not a general migration of old chest/furnace/drop saves. Overflow uses the existing bounded drop manager and its normal cap/environment/pickup rules. Abnormally huge legacy overflow can therefore encounter that existing cap; back up old worlds before migrating such saves.
- Fluid queues remain non-serialized and use existing generated-boundary activation on load. Infinite-water rules and other previously deferred fluid features were not added.

# Git

HEAD/origin/main remain`8935772`; branch unchanged. All previous local edits/untracked work retained. No commit, push, pull, reset, stash, restore-over-files, git clean, rebase, config mutation or force operation. Work stays local and intentionally dirty for review. `git diff --check` passes.
