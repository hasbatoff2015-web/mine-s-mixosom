# Roadmap

## 2026-08-29: full Anarchy server gameplay

- [x] One integration pass: listed Anarchy systems request → server validate → mutate → sync. Reuse existing managers in `ServerGameplay`.
- [x] Online client skips local simulation; snapshots + inventory/health/effects/time/block_batch.
- [x] Shared inventory actions; melee PvP; death drops; potions/effects; TNT; fluids on server World.tick.
- [x] Persist entities/inventory; explicit `npm run server:import` only (no auto IndexedDB, no `.schem`).
- [x] Targeted tests 22/22 (`anarchy-server` + `anarchy-gameplay`). Docs + draft PR. **No main merge.**
- [ ] Owner two-client localhost QA before any main merge.
- [ ] Explicit IndexedDB → `npm run server:import` of the accepted spawn map (not in git).
- [ ] Later: VPS deploy, accounts, anti-cheat beyond look/reach/mining checks.

## 2026-08-29: Anarchy server QA fixes (no new features)

- [x] Diagnose missing accepted spawn (IndexedDB vs procedural server world); do not fake `.schem` import.
- [x] Fix local rubber-banding: server-authoritative 20 TPS + smooth client chase, stale snapshot drop, client-side look.
- [x] Fix break/place: look-sync raycast, `block_result`, reach slack, broadcast + persist.
- [x] Regression tests for motion, break/place, two-client, reconnect, persist.
- [ ] Owner localhost QA (one client / two clients / restart / no-server toast) before any main merge.
- [ ] Explicit IndexedDB → server dump import of the accepted spawn map (owner export, then `npm run server:import`).

## 2026-08-29: local authoritative Anarchy server (foundation)

- [x] Architecture audit of actual `origin/main`; no Colyseus remnants; IndexedDB Anarchy was client-authoritative.
- [x] Separate Node server process, localhost WebSocket, configurable host/port, graceful shutdown.
- [x] Server-side Anarchy world lifecycle + filesystem persist; no silent `.schem` import.
- [x] Client connect from **Анархия PvP**; unavailable server → toast, stay in menu.
- [x] Authoritative join/spawn, input movement, two-client visibility, break/place, chat, command registry, PluginManager.
- [x] Singleplayer path kept; online vs SP ownership split documented.
- [x] Targeted server tests 14/14; tsc/build/size PASS. Full suite baseline failures unchanged (authored assets ENOENT, minecart timeouts).
- [ ] User localhost QA (two browsers, persistence, chat) before any main merge.
- [ ] Explicit IndexedDB → server dump import of the accepted spawn map (not in git).
- [ ] Later: VPS deploy; accounts. Gameplay systems from the foundation pass are on the server in the full-gameplay branch.

## 2026-08-29: lateral skylight / lighting quality

- [x] Vertical baseline + bounded resumable lateral frontier, 14-step falloff, typed ring and deadline/hard work caps; 2 ms PLAYING budget and render distances retained.
- [x] All eight mesh lighting dependencies; skip-blocked/near-unlock scheduling preserved.
- [x] Regional sky removal/recompute, six-face external block-light import, same-bounds restart, coalesced final versions and reader refresh.
- [x] Canonical cube/special exposed-cell sampling with separate modest AO; no ambient/gamma increase.
- [x] Gameplay lighting deferred, including furnace/getters; direct sun remains distinct from lateral light.
- [x] 228-test targeted pass, extended before/after CPU benchmark and existing DEV scene/browser checks.
- [x] Integrate main `25fb847` at height256: occupancy/implicit sky, paged snapshots, bitset queue flags, import restart and all four deferred Game paths. Same Draft PR #13, no merge to main.
- [x] Height256 high-roof/hole/emitter/border/import/save regressions, 274-test targeted pass, 22-case CPU256 benchmark and radius2/4/6 memory audit. Historical96 data retained separately.
- [ ] Native-device checklist and GPU soak: Creative flight/breaking, F8 borders and real mobile input.
- [ ] Resolve pre-existing full-suite CRLF/extractor/CPU-RPC failures separately. No main merge is part of this task.

## 2026-08-28: world height 256 + Anarchy spawn import

- [x] `WORLD_HEIGHT=256` (`Y 0..255`); generated surface still capped at 84; ores/bedrock/caves unscaled.
- [x] occupancyTop sky/emitter/fluid/mesh scans; light budget stays 2 ms.
- [x] Sponge `.schem` importer + Diamond Block fallback with replacement report.
- [x] Jungle log/wood → Oak Log (not planks); cocoa/jungle pods → Air; other unsupported stay Diamond.
- [x] Anarchy spawn extra `Y -= 28` after auto-fit; cocoa → Air; jungle → oak log.
- [x] Anarchy = persistent canonical IndexedDB world; **no runtime schematic import**; `importVersion` does not rebuild.
- [ ] Native QA: Anarchy opens without `.schem`, spawn/edits persist, no reimport.

## 2026-08-28: glowstone / lantern / chain

- [x] Glowstone cube light 15; lantern 3D model light 15; torch stays 14. Existing LightEngine, streaming budget and fluid lighting untouched.
- [x] Lantern standing/hanging via canonical raycast + `attachment` state; hanging attaches to chain or a sturdy ceiling.
- [x] Vertical chain with thin selection/collision; hanging columns use ceiling attachment so they are not self-supporting.
- [x] Custom recipes: Torch+Gold → Glowstone; Torch+Iron Ingot → Lantern; shaped iron/stick grid → 16 Chain.
- [x] Creative, RU names, 3D special_model icons/held items, drops, save/load.
- [ ] Native-browser visual QA of lantern hanging from chain, glowstone cave lighting, chunk-border seams and first-person scale.

## 2026-08-28: core sample-based SFX

- [x] Extend canonical `AudioManager` to cached AudioBuffer samples; keep pause/mute/masterVolume and Yandex lifecycle.
- [x] Data-driven sound events + block `soundGroup` (no per-BlockId files, no Game.ts sound switch).
- [x] ~26 short original MP3; mining cadence, footsteps, explosion dedupe, bow/arrow/combat/pickup/food/door/chest/click.
- [x] Local Minecraft 1.8 extractor (`npm run audio:extract-reference`); originals not committed.
- [x] Headless Chromium session: 26/26 SFX decoded, real dirt/sand footsteps with pitch variation, catalog `play()` path, pause until PLAYING (`/?audioDebug=1`).
- [x] Interactive Chromium: `block.break.dirt` / `block.step.dirt`, pause/resume AudioContext, overlay `files ok` / `events ok`.
- [x] Player footsteps local (`positional: false`); catalog `block.step.*` remains positional; world SFX stay 3D.
- [ ] Native-device speaker listen of TNT/creeper, bow/arrow, combat, door/chest (Cloud VM has no audible output).

## 2026-08-28: creeper / fence / plants / tooltip / RU polish

- [x] Creeper generic death animation; primed fuse cancelled on player kill; self-explosion path unchanged.
- [x] Fence 1.5 collision broadphase so a jump cannot pass through; visual height stays 1; slabs/stairs unchanged.
- [x] Vegetation included in existing support integrity (no PlantSystem, no world scan).
- [x] Golden Apple absorption replenishes to 4 and never stacks; Creative HUD shows yellow hearts.
- [x] Custom Minecraft-like item tooltip; native item `title` removed.
- [x] Explicit Russian display names for all obtainable items/blocks; Recipe Book Russian search.
- [ ] Native-browser visual QA of creeper death, fence jump, plant break, Golden Apple HUD, tooltips and Russian catalog names on a real GPU session.

## 2026-08-28: gameplay / UI / entity polish

- [x] Frontier vertical melee apex ~½ previous height; horizontal 1.8 impulse untouched.
- [x] Sprint persists after hit while W+sprint stay held; release latch removed.
- [x] Cached 3D isometric block icons in Creative/Inventory; generated items stay sprites.
- [x] Inventory close × outside the panel on the right; responsive gutter + 44px hit target.
- [x] Arrows pass through vegetation/fire; selection targeting unchanged; player+skeleton share collision raycast.
- [x] Chicken legs visible (pack UV `[29,0]`); other mob rigs unchanged.
- [x] Stair inner/outer occupancy corrected for all 4 facings × left/right; mesh/collision/selection agree.
- [x] Player-fired resting arrow pickup; full inventory keeps the entity; skeleton arrows not pickable.
- [x] Golden Apple yellow absorption hearts to the right of red hearts; effect expiry clears leftover HP.
- [ ] Native-browser visual QA of catalog 3D icons, close-button layout, chicken walk, stair corners, arrow pickup and golden apple HUD on a real GPU session.

## 2026-08-27: interaction / support / mouse / mob polish

- [x] Shared button/lever geometry + redstone geometry-state publication; real DDA all mount/state matrix.
- [x] Local bounded support-loss, exactly-once drops/redstone/light cleanup; real explosion integration.
- [x] Separate fluid-displaceable semantics; flowing water wash + unchanged routing/timing/bucket regression.
- [x] Player/skeleton embedded arrows resume existing physics when support disappears/changes shape.
- [x] Raw lock fallback + dev diagnostics + conservative mouse sanitation; AI-facing/gait separated from recoil.
- [x] 20-tick vertical reference audit, flat step=false; no undocumented Y adaptation or horizontal retuning.
- [x] Partial browser QA through explicit opt-in test-world UI: controls, support, water, five player arrows, normal/sprint mob recoil.
- [ ] Problem-PC native mouse/lock diagnostics, ordinary fast movement, Escape/inventory/chat lifecycle acceptance.
- [ ] Remaining real-input combat matrix (crit, wall, W-tap, sword block), skeleton arrow browser QA and GPU/mobile soak; component tests are not these acceptance results.
- [ ] User gameplay review before any commit/push. See `reports/2026-08-27_interaction-support-mouse-mob-polish.md` for measured results/limitations.

## 2026-08-27: classic combat и оставшаяся приёмка

- [x] No-cooldown melee; exact 1.8 damage totals; shared hurt resistance; falling+sprint crit; fixed armor.
- [x] Canonical base/extra KB, melee travel drag, attacker slowdown; sprint now persists while input remains (2026-08-28 polish). Unit/component flat/wall trajectory validation.
- [x] Transient sword blocking, 20% movement, cached first-person pose; input edges не теряются между fixed ticks; legacy save compatibility.
- [ ] Полная browser classic combat acceptance: spam click/W-tap/crit/armor/block pose, GPU/FPS и mobile input. Browser доступ восстановлен для partial polish QA; native lock всё ещё не получен автоматизированным сеансом.
- [ ] Отдельно расследовать baseline CRLF fingerprint и scheduler/CPU timeout failures полного suite; этот pass не меняет пороги/ожидания unrelated tests.

- [x] Authored bucket/potion/minecart pipeline, overwrite stale placeholders и защита от fallback.
- [x] Тонкий arrow shaft + tip + tail-only fins, shared +Z player/skeleton visual.
- [x] Placement-anchor отдельно от full sturdy attachment face; запрет опоры на torch/thin blocks.
- [x] Shield **полностью удалён** из runtime/render/combat/registry; legacy saves очищаются точечно.
- [ ] Полная browser acceptance A–F: inventory, held items, stuck arrows с разных углов, torch matrix, отсутствие shield. Partial polish QA не закрывает всю старую matrix.
- [x] Support-loss для Torch/RedstoneTorch/Button/Lever/Ladder/Wire/Plates/Rail при разрушении опоры реализован в polish pass.
- [x] Запрошенный после cleanup classic 1.8 melee pass реализован; remaining QA и отличия перечислены в `MINECRAFT_1_8_COMBAT_REFERENCE.md` и свежем report. Multiplayer/netcode parity не заявляется.

Roadmap начинается от фактической playable alpha `0.1.0`. Приоритеты означают:

- **P0** — необходимо для надёжной публичной alpha и отправки в Яндекс Игры;
- **P1** — качество и глубина первой крупной alpha после стабилизации;
- **P2** — расширение продукта после подтверждённого P0/P1 foundation.

Feature creep не должен блокировать P0. Всё, что прямо исключено из текущего scope, не считается «почти готовым» из-за наличия текстуры или enum entry.

## P0 — release blockers и стабилизация

### P0.1 Воспроизводимая поставка

- [ ] На чистом clone выполнить `npm ci`, `npm run assets:import`, `npm run check` и `npm run check:archive`.
- [x] Локальный pipeline после lighting/physics/interaction polish: asset import `162/162`, typecheck, 95 tests, production build, size и archive green.
- [x] Локальный pipeline после TNT explosion batching: typecheck, 108 tests, production build 70 modules, 0.92 MiB / 165 files.
- [x] Локальный pipeline после lighting/torch/selection fix: typecheck, 117 tests, production build 72 modules, 0.92 MiB / 165 files.
- [x] Локальный pipeline после entity lighting / wall-torch followup: typecheck, 123 tests, production build.
- [x] Локальный pipeline после Minecraft generated-items Phase 1: typecheck, 129 tests, production build 72 modules, 0.92 MiB / 165 files.
- [x] Локальный pipeline после vanilla FP transform audit: typecheck, 143 tests / 22 files, production build 74 modules, 0.93 MiB / 165 files.
- [x] Локальный pipeline после F2 1.21.8 held-item screenshot audit: typecheck, 150 tests / 22 files, production build 75 modules, 0.94 MiB / 165 files.
- [x] Локальный pipeline после shared held-item pose QA candidates: typecheck, 152 tests / 22 files, production build 75 modules, 0.94 MiB / 165 files.
- [x] Локальный pipeline после live held-item pose QA panel: typecheck, 156 tests / 22 files, production build 75 modules, 0.94 MiB / 165 files.
- [x] Локальный pipeline после special-item door/ladder/lever pass: typecheck, 165 tests / 23 files, production build 75 modules, 0.94 MiB / 165 files.
- [x] Локальный pipeline после stairs/slabs/special-icons pass: typecheck, 189 tests / 24 files, production build 78 modules, 0.96 MiB / 165 files.
- [x] Локальный pipeline после ladder/icon-fit/creative-scroll pass: typecheck, 206 tests / 26 files, production build 80 modules, 0.96 MiB / 165 files.
- [x] Локальный pipeline после special-icon preview lighting: typecheck, 208 tests / 26 files, production build 81 modules, 0.96 MiB / 165 files.
- [x] Локальный pipeline после inventory close pointer lock: typecheck, 211 tests / 27 files, production build 82 modules, 0.96 MiB / 165 files.
- [x] Локальный pipeline после pause resume pointer lock: typecheck, 214 tests / 27 files, production build 82 modules, 0.96 MiB / 165 files.
- [x] Локальный pipeline после pointer-lock Esc fallback: typecheck, 219 tests / 27 files, production build 82 modules, 0.97 MiB / 165 files.
- [x] Локальный pipeline после container UI / chest model / Recipe Book / Creative flight / sim-while-GUI-open: typecheck, 257 tests / 31 files, production build 90 modules, 1.00 MiB / 166 files.
- [x] Локальный pipeline после container visual/functional QA (Creative tabs, chest lid/facing, furnace lit/light, transactional Recipe Book, stable slot DOM): typecheck, 275 tests / 33 files, production build 90 modules, 1.01 MiB / 167 files.
- [x] Локальный pipeline после recipe-book layout / hover overlay / chest lid interior / furnace GUI front / Creative inventory polish: typecheck, 276 tests / 33 files, production build 90 modules, 1.01 MiB / 167 files.
- [x] Локальный pipeline после performance/world-loading/mob-smoothing pass: typecheck, 301 tests / 40 files, production build 95 modules, 1.03 MiB / 167 files.
- [x] Локальный pipeline после lighting performance / chunk seams pass: typecheck, 311 tests / 41 files, production build 96 modules, 1.04 MiB / 167 files.
- [x] Локальный pipeline после DEV chunk streaming inspector (diagnostic only, no scheduler change): typecheck, 323 tests / 42 files, production build 99 modules, 1.06 MiB / 167 files.
- [x] Локальный pipeline после chunk mesh starvation / obsolete pending cleanup: typecheck, 337 tests / 43 files, production build 100 modules, 1.07 MiB / 167 files.
- [x] Локальный pipeline после player-visible streaming latency metrics (inspector only, no scheduler change): typecheck, 349 tests / 43 files, production build 100 modules, 1.08 MiB / 167 files.
- [x] Локальный pipeline после lighting halo / flood-head scheduler fix: typecheck, 368 tests / 44 files, production build 100 modules, 1.08 MiB / 167 files.
- [x] Локальный pipeline после worldgen mountains / deeper bedrock / connected caves / vegetation density: typecheck, 382 tests / 45 files, production build 100 modules, 1.08 MiB / 167 files.
- [x] Локальный pipeline после fluids / lava lakes / new items pass: typecheck, 398 tests / 47 files, production build 102 modules, 1.11 MiB / 180 files.
- [x] Локальный pipeline после fluid surface + streaming regression fix: typecheck, 424 tests / 49 files, production build 103 modules, 1.11 MiB / 180 files.
- [x] Локальный pipeline после fire arrow / fire visual / item icons: typecheck, 429 tests / 50 files, production build 106 modules, 1.12 MiB / 180 files.
- [x] Локальный pipeline после fire-contact / sunlight / 3D minecart pass: typecheck, 453 tests / 51 files, production build 109 modules, 1.13 MiB / 180 files.
- [x] Локальный pipeline после minecart floor / derail / Shift dismount / TNT ignition + primed texture: typecheck, 464 tests / 51 files, production build 109 modules, 1.13 MiB / 180 files.
- [x] Локальный pipeline после shape-aware block targeting / minecart LMB break: typecheck, 485 tests / 52 files, production build 111 modules, 1.14 MiB / 180 files.
- [x] Локальный pipeline после chat commands / minecart drop polish: typecheck, 495 tests / 53 files, production build 116 modules, 1.15 MiB / 180 files.
- [x] Локальный pipeline после fire overlay / cave lava ponds / bedrock cap / hurt feedback / ore ×2: typecheck, 506 tests / 55 files, production build 117 modules, 1.15 MiB / 180 files.
- [x] Локальный pipeline после frozen-lava / lighting-flicker / Diamond /3 / Fire damage / mob hurt flash: typecheck, 517 tests / 56 files, production build 117 modules, 1.15 MiB / 180 files.
- [x] Локальный pipeline после enclosed cave lava / Fire-Lava armor rollback / hostile spawn rebalance: typecheck, 529 tests / 57 files, production build 117 modules, 1.16 MiB / 180 files.
- [x] Локальный pipeline после potion invis arm / effect HUD / swirl particles: typecheck, 535 tests / 58 files, production build 119 modules, 1.16 MiB / 180 files.
- [x] Локальный pipeline после armor HUD / canonical armor points: typecheck, 542 tests / 59 files, production build 120 modules, 1.16 MiB / 183 files.
- [x] Локальный pipeline после hearts HUD scale / per-entity mob hurt flash: typecheck, 548 tests / 60 files, production build 122 modules, 1.17 MiB / 186 files.
- [x] Локальный pipeline после merge Codex main-menu UI + Cursor PR #6: typecheck, 551 tests / 61 files, production build 123 modules, 3.44 MiB / 187 files.
- [ ] Зафиксировать фактические версии Node/npm для CI и README.
- [ ] Добавить CI с typecheck, tests, production build, archive/path/size checks.
- [ ] Сформировать ZIP, где `index.html` находится в корне, и проверить его распаковкой.
- [ ] Установить внутренний warning budget ниже официального лимита 100 MiB; текущая цель проекта — оставаться значительно ниже 20 MiB uncompressed.

Definition of done: чистая машина воспроизводит тот же green build без ручных правок.

### P0.2 Права на runtime assets

- [ ] Получить от владельца исходного texture pack письменные license/credits/provenance сведения.
- [ ] Зафиксировать manifest реально импортируемых файлов и их происхождение.
- [ ] Повторно проверить production bundle: logos, panorama, paintings, Mojang patterns и сторонние product namespaces не должны попасть в `dist/`.
- [ ] Если права на среднерисковые textures не подтверждаются, заменить их собственными оригинальными assets.

Definition of done: для каждого production asset есть разрешение или собственный безопасный replacement.

### P0.3 Save integrity

- [ ] Добавить automated round-trip test полного `SerializedWorldState`: blocks, player, containers, drops и mobs.
- [ ] Ввести явный migration dispatcher для `schemaVersion`, даже если пока есть только version 1.
- [ ] Валидировать и восстанавливать повреждённые chest/furnace/mob records так же безопасно, как inventory.
- [ ] Расширить corrupt-record fixtures на redstone sources и primed TNT; invalid redstone state уже безопасно сбрасывается целиком.
- [ ] Сериализовать недостающий survival/combat state либо явно сбрасывать его и сообщать правило пользователю.
- [ ] Добавить recovery path: backup предыдущего save или экспорт/импорт JSON.
- [ ] Проверить pagehide/background save на Chrome, Safari/iOS и Android WebView-подобном окружении.

Definition of done: принудительный reload/закрытие вкладки не теряет подтверждённый progress, corrupted record не ломает список миров.

### P0.4 Runtime correctness

- [x] Runtime furnace переведён на `SMELTING_RECIPES` и `FUEL_BURN_TICKS`; glass и charcoal входят в общий path.
- [x] Последний visual QA pointer-lock overlay / icons / Creative scroll / ladder закрыт в PR #2 (`76ce4a1`). Container UI / Recipe Book / Creative flight — отдельный pass на `cursor/container-ui-recipebook-flight`.
- [ ] Проверить реальный attack meter, bow release, mob hit selection и weapon durability через browser smoke.
- [ ] Пройти end-to-end redstone scenario в browser: source → dust → TNT → visual fuse → explosion/chain → save/reload active fuse.
- [x] Закрыты targeted regressions: takeoff-only jump exhaustion, hunger sprint gate, Creative non-targetability, 3D+voxel-LOS melee и knockback only on dealt damage.
- [ ] Проверить lifecycle disposal при многократном create/load/quit: world meshes, mobs, arrows, drops и event listeners не должны накапливаться.
- [ ] Добавить интеграционные тесты seeded generation, chunk-boundary edits, placement inside player, chest/furnace content drops и respawn.
- [ ] Провести 10–15 minute soak: перемещение через chunks, несколько autosaves, бой, взрывы, смерть, reload.
- [ ] Исправить найденные blocker bugs без расширения feature scope.

Definition of done: основной survival loop воспроизводимо проходит дважды — до reload и после reload.

### P0.5 Yandex lifecycle и moderation QA

- [ ] Разделить причины паузы: user pause, platform pause/ad, document hidden и lost focus не должны взаимно отменять друг друга.
- [ ] Убедиться, что `LoadingAPI.ready()` вызывается один раз после исчезновения blocking loader.
- [ ] Сверить `GameplayAPI.start/stop` с реальным доступом игрока к управлению.
- [ ] Проверить Yandex pause/resume events поверх открытого pause menu и inventory.
- [ ] Проверить подавление browser-native gestures, context menu, scroll и accidental navigation.
- [ ] Пройти Yandex draft/debug panel и актуальный checklist из `YANDEX_REQUIREMENTS.md`.

Definition of done: draft не сообщает lifecycle/ready/path ошибок, а platform resume не запускает поставленную пользователем на паузу игру.

### P0.6 Обязательная browser/device matrix

- [x] Desktop `1920×1080`, `1366×768`, `1280×720`, `1024×768` и малое окно прошли browser visibility/count checks.
- [x] Mobile landscape `932×430`, `844×390`, `800×360`, `768×360`, `740×360`, `720×360`, `667×375` прошли browser visibility/count checks.
- [x] На representative `667×375` визуально проверены inventory, pause и settings; portrait overlay проверен отдельно.
- [x] Исправлено перекрытие menus/modals touch controls.
- [ ] На реальных устройствах проверить portrait → landscape без reload/потери state и multi-touch controls.
- [ ] Пройти функциональные keyboard/mouse и touch scenarios: mining, inventory, crafting, chest, furnace, combat, redstone и save/load.
- [ ] Зафиксировать minimum acceptable FPS/TPS и memory ceiling на слабом целевом устройстве.

Definition of done: нет overlap/cutoff/blocking input defects, simulation держит 20 TPS в установленном render distance.

## P1 — качество большой alpha

### P1.1 Rendering и world performance

- [ ] Перенести chunk generation/meshing в Web Workers с cancellable priority queue, если device profiling после текущего CPU pass подтвердит необходимость.
- [ ] Внедрить greedy meshing или эквивалентное объединение coplanar faces.
- [x] Добавить budgets по jobs/миллисекундам, generation/mesh scheduling и F3 telemetry для chunk rebuild; frustum/distance priority остаётся следующим этапом.
- [x] Adaptive per-frame world-job budget, dirty-mesh Set-dedupe, neighbor remesh только на X/Z boundary, `LOADING_WORLD` until initial radius ready, entity render interpolation at 20 TPS.
- [x] Vertical baseline + bounded lateral sky/block light, resumable jobs, eight-neighbor halo readiness and `lightVersion`/`meshedLightVersion`.
- [x] Lighting flood mutex no longer stops the queue on a blocked head; near unlock neighbors outrank distant halo; obsolete floods are abandoned.
- [x] Разделить opaque/cutout/glass/water passes; leaves переведены на depth-writing alpha test.
- [ ] Улучшить сортировку отдельных translucent water/glass faces.
- [x] Добавить lightweight skylight/block-light contribution в chunk meshing; torch/lava обновляют свет локально, без full-world rebuild.
- [x] Block-break path: skip unchanged filter/emission, coalesce bounded sliced sky/block recompute, no full-chunk six-pass or per-node remesh.
- [x] Убрать Lambert N·L с terrain (pitch-black bottoms), тёплый torch block-light в shader, shape-aware selection outline.
- [x] Wall torch flush to supporting face, thicker cuboid matching outline; entity lighting from voxel sky/block (feet/torso/head); cube-face 4-tap smooth lighting at cave openings.
- [x] Добавить power-of-two atlas, mipmaps, `4 px` padding/extrusion и ограниченную anisotropy для снижения bleeding/shimmer.

### P1.2 Block states и geometry

- [x] Тонкая 2-block oak door с open/close, collision и UV half/hinge; torch wall/floor; button floor/wall/ceiling; ladder world plane + side placement; stairs/slabs geometry+collision+icons. Bed и chest всё ещё ждут specialized meshes.
- [x] Расширить compact block states: door half/open/hinge/facing, torch attachment, button/lever orientation, ladder facing, slabType, stairHalf; stair corner shape derived; v1→v2 redstone fallback уже реализован.
- [x] Door open/close на use; ladder climbing (into-wall wish, slow descent, sneak hold). Корректный two-block bed и sleeping checks ещё нет.
- [x] Canonical selection shapes + DDA ray-vs-AABB: empty portion of occupied voxels is not a hit (rail/plate/ladder/slab/stairs/fence/torch/…). Outline, LMB and RMB share one VoxelHit. Survival LMB breaks a Minecart into a world drop.
- [x] Локальный чат + command registry (`/help` `/gamemode` `/time` `/give` `/tp` `/seed` `/clear` `/kill`); T и `/` open, death messages in chat.
- [x] Powered TNT ignition, visual 4-second fuse, explosion events и chain priming реализованы для alpha.
- [x] Mass TNT больше не вызывает per-block `relightAround`; `ExplosionQueue` + `applyBlockBatch` держат chain в budgeted ticks.
- [x] Минимальная bounded propagation `0–15` для wire/torch/lever/button/plate/TNT реализована и покрыта unit tests.
- [ ] Добавить корректные redstone connection meshes, orientation/support rules и более точную vertical topology без расширения в advanced components.

### P1.3 World simulation

- [x] Level-based liquids с bounded updates, боковым потоком и water/lava interaction (practical Java-like, не bit-exact; без infinite springs).
- [x] Gravity-driven primed TNT и falling-block entities для sand/gravel; unloaded-chunk queue всё ещё упрощена.
- [x] Более разнообразные terrain features без нарушения seed determinism (mountains + connected caves + density; без новых biomes/structures).
- [x] Spawn finder учитывает новый terrain height и избегает desert/caves/high mountains (покрыто `tests/worldgen-terrain.test.ts`).
- [ ] Сжатие/compaction chunk deltas при долгой игре.

### P1.4 Combat, AI и feedback

- [x] Практичный 1-block mob step-up без отдельного pathfinder; полный voxel-aware search всё ещё P1.
- [ ] Улучшить spawn/despawn/light rules и obstacle recovery; bounded soft separation между мобами уже реализована.
- [x] Подключить базовые first-person arm/item poses для swing/mining, walk, еды, bow charge (shield pose удалён 2026-08-27).
- [x] Убрать 20 TPS quantization из render camera, разделив live input look и fixed simulation state.
- [x] Добавить cached alpha-silhouette depth geometry для generated held/dropped items и три стадии bow texture.
- [x] Phase 1 vanilla-like `item/generated`: один front/back quad, толщина `1/16`, span detection `alpha == 0`, 32×32 в тех же 16×16 model units, общий first-person pose для generated/handheld, held torch sprite, bow pull `0.65/0.9`.
- [x] First-person sprite pose calibration: shared scale/position/roll, pitch/yaw 0, dev `held*` QA overrides.
- [x] Generated-item geometry audit: outer-shell winding, texel-center side UV, inspect/`qaSideDebug` harness, `iron_pickaxe.png` span diagnostics. Topology закрыта как baseline.
- [x] Vanilla idle first-person right-hand matrix reconstruction + held matrix QA overlay. Production pose не переключали: нет доказанного screenshot match projected points.
- [x] F2 Java 1.21.8 2048×1152 silhouette landmark audit: 1.9==1.21.8 idle matrix; «edge-on» = неверная метрика `front·look`; Y-bias vs F2 остаётся. Production не переключали.
- [x] Shared held-item pose: цель сменена с pixel-perfect F2 на visual Minecraft-like; QA candidates subtle/balanced/stronger + `qaPoseCompare`. Production pose не переключали.
- [x] Live held-item pose QA panel: sliders/numeric/copy/reset, item switch без сброса pose. Production pose и geometry не менялись.
- [x] Production shared held-item pose записан из manual visual QA: `[0.67, -0.29, -0.70]`, `[1, -90, 34]°`, scale `0.60`. Yaw −90° не заменять.
- [x] Special block-item pass: lever/ladder/door held generated; ladder world plane + climbing; door cuboid UV; button/plate/stairs/slab special inventory cuboids + auto-fit icons.
- [x] Chest world/item visual: entity atlas, body/lid/latch, held special_model. Double chest всё ещё вне scope.
- [x] Унифицировать player/skeleton arrow physics/visual basis и оставить попавшие в блок стрелы видимыми до timeout.
- [x] Добавить deterministic biome vegetation через chunk-batched crossed quads без отдельных scene objects.
- [x] Добавить damage flash, hit particles, расширенный bow feedback, use-анимации для дополнительных предметов и **core sample SFX** (2026-08-28). Music / ambients / mob voices remain later.
- [ ] Довести off-hand, все item categories и transforms до более точного vanilla parity без потери общего cache pipeline.
- [ ] Выверить projectile sweep и explosion exposure без дорогой полной физики.
- [ ] Расширить поведение существ: spider climbing, passive flee, burning drops, sheep shearing — только после core stability.
- [x] Component combat scenarios: full-damage spam, hurt resistance, crit+sprint, sword blocking, no shield, skeleton projectile, flat/wall KB. Browser/creeper-chain soak остаётся отдельной приёмкой.

### P1.5 UX и accessibility

- [x] Главное меню и связанные screens: оригинальный voxel background, крупный Frontier Cubes logo treatment, одиночная игра с выбранным миром, offline online-server mock, settings и read-only controls; mouse/Esc/back navigation без отдельной второй menu system.

- [ ] Settings persistence, fullscreen toggle, remappable controls и touch-layout presets.
- [x] Pixel Minecraft-like container GUI для chest / furnace / crafting table / Survival 2×2 inventory; Recipe Book слева на crafting/Survival (кнопка книги в craft row, icon categories, search, All/Craftable, transactional ghost vs placement); Furnace без Recipe Book; Creative Catalog/Inventory tabs (без offhand, armor silhouettes, catalog scrollbar gutter).
- [x] Chest entity model + opposite-of-look facing + lid-up hinge; furnace facing + lit front + torch-equivalent block light from burn state.
- [x] Creative double-Space flight (7 ticks, collision, landing, Ctrl sprint, Shift descend, ladder override).
- [ ] Полный inventory drag UX, tooltips с характеристиками и vanilla advancement recipe unlocks.
- [ ] Масштаб UI, high-contrast mode, reduced motion и keyboard focus navigation в меню.
- [ ] Русская и английская localization tables с выбором через Yandex environment.
- [ ] Понятные save/error/loading states вместо console-only diagnostics.

### P1.6 Platform features по продуктовой необходимости

- [ ] Guest-safe optional authorization flow.
- [ ] Компактная cloud metadata sync; не пытаться помещать полный voxel save в 200 KB player data.
- [ ] Rewarded/interstitial ads только после корректного lifecycle и без влияния на основной survival loop.
- [ ] Privacy/consent/analytics policy до подключения telemetry.

## P2 — расширения после стабилизации

Возможные направления, не обещанные текущей alpha:

- weather и атмосферные эффекты;
- biome expansion, структуры и более глубокая exploration progression;
- experience, enchantments, brewing stand / full potion crafting;
- farming и animal breeding;
- advanced redstone, pistons, hoppers и automation;
- дополнительные dimensions, bosses и late-game progression;
- cloud world transfer и optional accounts;
- multiplayer/server authority;
- modding/data-pack API.

Каждое направление сначала получает отдельный scope, save migration plan, performance budget, asset provenance и tests. Наличие неиспользуемых textures в `assets/` не является основанием для автоматического включения feature.

## Метрики, которые стоит вести

| Метрика | P0 target | P1 direction |
| --- | ---: | ---: |
| Fixed simulation | без устойчивого падения ниже `20 TPS` | 20 TPS на слабом целевом mobile |
| Initial interactive menu | измерить в Yandex draft | уменьшать p95 |
| New-world time to control | измерить desktop/mobile | progressive generation без длинного freeze |
| Runtime JS errors | `0` в smoke/soak | `0` в release regression |
| Save round-trip loss | `0` для schema 1 fields | migrations + backup |
| Unit/component tests | текущие 83 + P0 browser/storage integration coverage | regression grows with features |
| Production archive | значительно ниже 20 MiB target | budget per asset/system |
| Asset provenance | 100% production manifest | автоматическая проверка manifest |
