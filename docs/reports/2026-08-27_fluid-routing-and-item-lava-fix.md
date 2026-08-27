# Goal

Минимально исправить две ошибки текущей alpha: excessive Water/Lava fan-out на сложном рельефе и неуничтожаемые dropped items в Lava/Fire. Сохранить существующие fluid levels, queue/budget, batching, lighting, streaming, rendering, save compatibility и весь unrelated gameplay.

# Current baseline SHA

- branch: `feat/playable-voxel-alpha`
- clean local `HEAD`: `8935772e6edd8137a19755a8a7759d197bce4c28`
- fetched `origin/main`: `8935772e6edd8137a19755a8a7759d197bce4c28`
- short form: `8935772`
- случайный untracked `e --short HEAD` был отдельно исследован: 4900 bytes чистого `git log`, project references отсутствовали; удалён только этот файл точечным `Remove-Item -LiteralPath` до baseline validation.

# Problem

`preferredHorizontalDirs()` отвечал на вопрос «существует ли drop в этом прямом направлении?». Если короткий и длинный drops существовали одновременно, fluid создавал оба initial branches. Повороты не находились. На каждой последующей террасе новые branches снова падали и снова разветвлялись, поэтому footprint рос каскадом. Дополнительно уже заполненная falling-cell снизу заставляла `tryEnter()` вернуть false, после чего mid-air cell ошибочно переходила к horizontal spread.

`DroppedItemManager` обрабатывал Water и Lava одной generic-liquid buoyancy веткой и не имел environmental health/damage. Проверка жидкости была одной center-cell sample, поэтому частичный AABB contact тоже не был надёжен.

# Java 1.9 reference

- [`BlockDynamicLiquid.java` (Minecraft 1.9 MCP)](https://github.com/CircuitLord/Minecraft-1.9-MCP/blob/master/temp/src/minecraft/net/minecraft/block/BlockDynamicLiquid.java): downward flow проверяется раньше horizontal; overworld Water decay = 1, Lava decay = 2; slope search рекурсивно умеет поворачивать, исключает immediate reverse, использует bounded distance 4/2; optimal directions очищаются при меньшей стоимости и сохраняют ties.
- [`EntityItem.java` (Minecraft 1.9 MCP)](https://github.com/CircuitLord/Minecraft-1.9-MCP/blob/master/temp/src/minecraft/net/minecraft/entity/item/EntityItem.java): item size `0.25×0.25`, health starts at 5, health/age/pickup delay serialize; Lava gives an upward kick, а отдельной modern Water buoyancy ветки у `EntityItem` нет.
- [`Entity.java` (Minecraft 1.9 MCP)](https://github.com/CircuitLord/Minecraft-1.9-MCP/blob/master/temp/src/minecraft/net/minecraft/entity/Entity.java): Lava overlap damages by 4 and fire collision damages by 1 through the common entity damage path.
- [Minecraft Wiki: Fluid](https://minecraft.wiki/w/Fluid): human-readable confirmation of slower overworld Lava, downward-first spread and horizontal flow distances.

Internal Frontier levels остаются behavior-equivalent, без бессмысленной замены на vanilla metadata: source 8; Water `7..1`; overworld Lava `6,4,2`.

# Reproduction

Добавлен deterministic fixture на flat supported plane:

- WEST drop cost 0, EAST cost 2, N/S blocked: baseline пишет WEST + EAST, expected только WEST;
- turning-only drop за WEST → WEST → NORTH и более дорогой straight EAST: baseline выбирает EAST, потому что WEST ray не умеет повернуть;
- terraced Water/Lava hill: baseline initial branches = 3, затем cascading falls и повторный range reset.

Red tests до реализации:

```text
tests/fluid-routing.test.ts: 2 failed / 5
different cost: received WEST+EAST, expected WEST
turning path: received EAST, expected WEST
```

# Root cause

Root cause подтверждён тестом и hill instrumentation:

1. boolean `pathHasDrop()` не сравнивал стоимости;
2. поиск шёл только по straight ray;
3. все directions с любым drop получали flow;
4. `tryEnter()` смешивал «downward route открыт» и «нужна новая write», поэтому уже заполненная falling column могла fan-out'иться в воздухе.

Queue cap и lighting не были причиной fan-out: BEFORE hill достигал cap только как следствие огромного branching footprint.

# Previous algorithm

Для каждой из четырёх initial directions `pathHasDrop()` делал до 4 straight samples для Water / 2 для Lava и возвращал boolean. `preferredHorizontalDirs()` собирал все `true`, независимо от расстояния. Если ни один straight ray не находил drop, использовались все четыре стороны.

# New flow-cost algorithm

Canonical `src/world/fluids.ts` расширен, parallel system не создавался.

- Один bounded reverse-distance field строится для текущей cell, а не четыре независимых world BFS.
- Локальная область — Manhattan diamond радиуса `initial cell + 4` для Water / `+2` для Lava.
- Reusable fixed `Int8Array` / `Uint8Array`; `Map<string, Node>`, `THREE.Vector3` и per-node allocations отсутствуют.
- Solid, other source и unloaded chunk непроходимы; текущая source-cell закрыта, поэтому immediate return невозможен.
- Поле находит turning paths.
- Initial directions выбираются только с global minimum cost; equal-minimum mask сохраняет все ties.
- Если drop в depth отсутствует, остаётся обычный four-way horizontal spread.

Queue constants не изменялись: cap 2048, max 48 updates/tick, `FLUID_JOB_BUDGET_MS = 1.5`.

# Falling-flow semantics

`hasDownDrop()` теперь отдельно фиксирует, что downward route открыт. Даже если cell снизу уже имеет равный falling level и новая write не нужна, current update завершается без horizontal umbrella. Когда falling column достигает support, horizontal range снова начинается с source-strength falling semantics. Global distance/volume cap не добавлен.

# Water behavior

- flat: `8 source → 7 → 6 → 5 → 4 → 3 → 2 → 1 → Air`;
- tick delay 5;
- slope search radius 4 after initial cell;
- equal-minimum split разрешён;
- terraced flow проходит дальше 7 blocks от original source за счёт legitimate lower landing ranges;
- source removal drains orphan flow; queue idles and late writes = 0;
- infinite-source regeneration не добавлялась.

# Lava behavior

- flat overworld: `8 source → 6 → 4 → 2 → Air`;
- tick delay 30;
- slope search radius 2 after initial cell;
- down-first, lower landing reset и no global cap совпадают с Water principle;
- source/flowing mixing остаётся Obsidian/Cobblestone;
- Lava emission/lighting paths не менялись.

# Dropped-item fire/lava behavior

- `DroppedItemEntity.environmentHealth` starts at 5;
- small feet-anchored `0.28×0.28` AABB переиспользует `aabbFromBody()` + `aabbOverlapsBlockType()`;
- Lava damage = 4 per fixed 20-TPS contact tick: typical submerged item dies on second tick;
- Fire damage = 1 per contact tick: item dies on fifth tick;
- removal uses existing manager path with reason `burned`, removes map entry and visual before merge/pickup;
- Water damage = 0;
- modern generic Water buoyancy branch removed; no water currents were added;
- Lava keeps a deterministic upward kick approximating 1.9 `EntityItem` without random lateral jitter;
- `environmentHealth?` is optional in serialized entries; old saves default safely to 5, no save schema bump.

# Files changed

- `src/world/fluids.ts`
- `src/entities/DroppedItemManager.ts`
- `tests/fluids.test.ts`
- `tests/fluid-routing.test.ts`
- `tests/dropped-item-environment.test.ts`
- `scripts/benchmark-fluids.ts`
- `docs/PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`
- this report

No changes to World, LightEngine, ChunkMesher, fluidSurface, TerrainGenerator, Game/UI, combat, minecart/TNT, inventory, save schema version, assets or render distance.

# Tests

Baseline before code changes:

```text
npm run check
TypeScript PASS
Vitest 551 total: 30 failures (existing fingerprint/streaming/timeouts)
check stopped before build
npm run build separately PASS: 123 modules
```

After:

```text
npm run typecheck                                      PASS
targeted fluid/item matrix                             21/21 PASS
npm test full                                          529/563 PASS, 34 baseline-class failures
npm run build                                          PASS, 123 modules
npm run check:size                                     PASS, 3.44 MiB / 187
npm run check:archive                                  PASS, 3.44 MiB / 187
```

The full parallel suite remains noisy: CPU-heavy worldgen/mob/minecart/lighting tests exceed their 5 s/30 s limits; `GeneratedItemGeometry` fingerprint and radius-6 `<8 s` assertions already failed on clean baseline. New tests all pass. Isolated existing fluid suite keeps 20 semantic/lighting tests passing and the same three known `14.816 s > 8 s` streaming assertions failing. Unrelated baseline tests were not edited.

# Hill benchmark BEFORE / AFTER

Synthetic deterministic terraces; no random worldgen and no arbitrary fluid-volume assertion.

| Metric | Water BEFORE | Water AFTER | Lava BEFORE | Lava AFTER |
| --- | ---: | ---: | ---: | ---: |
| Initial branches | 3 | 1 | 3 | 1 |
| Total fluid cells | 3828 | 134 | 5690 | 42 |
| Falling cells | 2751 | 12 | 4363 | 12 |
| Landing footprint Y=29 | 535 | 4 | 459 | 3 |
| Landing footprint Y=25 | 448 | 5 | 654 | 3 |
| Base footprint Y=21 | 162 | 113 | 687 | 25 |
| Queue peak | 2048 | 188 | 2048 | 84 |
| Writes | 9910 | 269 | 14717 | 82 |
| Settle tick | not settled by 500 | 96 | not settled by 900 | 303 |
| Late writes (200 ticks) | 4085 | 0 | 4400 | 0 |
| Final queue | 2048 | 0 | 2032 | 0 |
| Max Manhattan from source | 31 | 28 | 36 | 20 |

AFTER benchmark also counts exactly 3 supported falling landing columns for each fixture. The first BEFORE instrumentation named this metric incorrectly (`landingCells=0`, because supported falling cells retain `fluidFalling`); comparable per-level footprints above come from the preserved BEFORE `cellsPerY` output. This measurement bug was corrected in the benchmark, not hidden.

# Fluid performance

Final `npm run benchmark:fluids`:

```text
flat Water computeFluidUpdate: avg 0.12481 ms, p95 0.14807, max batch avg 0.18184
flat Lava computeFluidUpdate:  avg 0.05464 ms, p95 0.06791, max batch avg 0.08000
Water flat queue peak 181, settle 41, late writes 0
Lava flat queue peak 80, settle 62, late writes 0
```

The older straight-ray Water flood run was faster in wall-clock (`29.566 ms / 200 ticks` vs final `64.659 ms`) because it sampled fewer cells, but the bounded cost field remains sub-millisecond per update and the existing 1.5 ms queue slice still limits work instead of raising the budget. Hill workload drops by orders of magnitude because non-minimal branches disappear. Mesh smoke remains bounded (`dry 16.161 ms / 512 faces`, fluid `25.986 ms / 704 faces`).

# Lighting regression check

- No LightEngine/World lighting code or budget changed.
- Water/Lava level-only skip-relight, local-sky, queue dedupe, equilibrium, distant pause and mixing tests pass.
- `WORLD_LIGHT_BUDGET_MS = 2`.
- `npm run benchmark:lighting`: 9×9 sliced total 1474.711 ms, max slice 3.652 ms; torch crosses chunk (`14→13`), torch/furnace sky recomputes remain 0.
- Existing 5 s lava-emitter test timeout remains baseline-class; semantic hill runs settle with `lateWrites=0`.

# Streaming regression check

- Canonical `npm run benchmark:streaming` retains budgets `WORLD_JOB_BUDGET_MS=4`, light=2.
- Instant-light fairness paths: walk/fly/reverse/zigzag player miss 0 ms, fair wanted→visible p95 ≤ 200 ms.
- Radius-6 sliced-light remains an existing baseline problem (`maxNearWantedMissingMs` 22.233 s in this run).
- Fluid benchmark water/lava/both has wanted p95 `4.517–5.167 s`, max `5.233 s`, and the same existing `17.783 s` near-missing proxy seen before this pass. Routing did not introduce a new streaming failure and did not mask the old one.

# Browser QA

The local Vite page responds HTTP 200 at `http://localhost:4173/`. Automated in-app Browser QA could not run: the installed Browser plugin failed twice during connection with `Trusted RPC dependency must resolve within a configured trusted code path` for its own `browser-service.mjs`. The plugin was reset once and failed identically. No project/browser workaround, external automation or code change was made.

Therefore visual WATER/LAVA hill, source removal, multi-item Lava/Water and Creative streaming interactions remain a manual gate. Automated geometry, semantic, hill and streaming simulations are complete, but browser DoD is explicitly not claimed as passed.

# Known limitations

- Full Vitest suite has pre-existing timing/fingerprint/streaming failures and is not green on clean `8935772`.
- Radius-6 sliced-light streaming violates its documented `<8 s` assertion independently of fluid routing.
- Browser plugin trust-path failure blocks automated real-render QA in this environment.
- Lava item kick is deterministic and omits vanilla random lateral jitter.
- Item environmental damage persists health, but temporary sub-tick contact accumulator is intentionally not serialized.

# Deferred

- Java water source regeneration/infinite-water rules.
- Water current/push simulation for item entities.
- Existing lighting/streaming starvation threshold work.
- Browser manual QA once the Browser plugin connection works.
- Any unrelated flaky timeout/fingerprint fixes.

# Git

- Started from fetched `origin/main = 8935772` with clean working tree.
- No reset, stash, rebase, checkout-over-files, `git clean`, force push or unrelated deletion.
- No commit and no push: user did not request them for this pass.
- Worktree contains only the implementation/tests/benchmark/docs listed above.
