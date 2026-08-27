# Goal

Перевести существующий Frontier Cubes melee с Java 1.9-style на classic 1.8.9: no cooldown, target hurt resistance, damage/crit/armor/KB, deliberate sprint reset и sword blocking. Не возвращать shield и не менять последние fluid/item/arrow/placement fixes.

# Result / Implemented

Реализация и component regression coverage готовы. Browser pose/feel acceptance **BLOCKED**, не PASS; полного зелёного suite тоже нет из-за описанных ниже baseline/environment failures. Нельзя объявлять весь visual/PvP pass полностью принятым без browser QA. Реализация сначала оставлена локально; затем пользователь отдельно разрешил commit/push.

# Git baseline

- Перед изменениями `git status --short` пуст; ветка `feat/playable-voxel-alpha`, tracking `origin/main`.
- HEAD = origin/main = `5820d7d9b11dbb24a5244f90d102d1c28a076109` (`fix: polish item assets arrows placement and remove shield`).
- `git fetch origin` выполнен с разрешением после sandbox отказа на FETCH_HEAD; последующая read-only проверка refs подтвердила равенство.
- Старые reports с HEAD8935772/dirty — исторические: текущие fluid routing/timing, buckets, item lava, authored items, arrow geometry и placement уже находятся в baseline5820d7d.
- Baseline typecheck/build/size/archive PASS; tests с maxWorkers2: 634/657, 23 failed, 1 worker RPC error, 69 files, 199.66s. Build126 modules, JS958.78kB (gzip268.17), CSS38.93kB (gzip9.04); unpacked3.45MiB/186 files.

# Java 1.8.9 sources

Version-specific source audit и ссылки на EntityPlayer, EntityLivingBase, ItemSword/Tool/Axe/Pickaxe/Spade/ToolMaterial, DamageSource, EntityPlayerSP, ItemBow/EntityArrow, InventoryPlayer находятся в [MINECRAFT_1_8_COMBAT_REFERENCE.md](../MINECRAFT_1_8_COMBAT_REFERENCE.md). Просмотрены реализации, а не только таблицы современной wiki. Это third-party MCP mirror reference, не официальный API. Minecraft code/assets не импортировались.

# Previous 1.9 combat

CombatSystem держал ticksSinceAttack/attackSpeed, quadratic damage factor с +0.5 tick, charge threshold для critical/sprint KB. Game делал один attackPressed boolean на tick, списывал durability после target attempt, UI рисовал attack indicator. Player Survival имел partial hurt gate, MobManager принимал каждый hit без общего gate. Runtime shield уже был удалён предыдущим cleanup.

# Attack cooldown removal

Удалены active attackSpeed/attackStrength/attackCooldownTicks/fullyCharged/FULL_ATTACK_THRESHOLD и charge curve из melee, renderer HUD и item types/registry. InputManager считает click edges, Game выполняет все попытки на fixed tick. Каждый attempt полный, actual damage решает цель. Нет CPS cap, artificial delay, sword-swap reset или sweep. Bow charge остаётся независимой существующей механикой.

# Weapon damage table

| Total HP | Wood | Stone | Iron | Diamond |
| --- | ---: | ---: | ---: | ---: |
| Sword | 5 | 6 | 7 | 8 |
| Axe | 4 | 5 | 6 | 7 |
| Pickaxe | 3 | 4 | 5 | 6 |
| Shovel | 2 | 3 | 4 | 5 |

Fist/other item1. Registry — single source; Combat не добавляет base1 повторно. Gold weapons не добавлялись. Wear: sword/tool −1 по явному §55 задания (в reference tool −2), только accepted hit в Survival. Exhaustion +0.3; rejected/air/Creative — без расходов.

# Hurt resistance

Новый маленький `HurtResistance` заменяет дублирование, а не создаёт вторую боевую систему. Общий player/mob/projectile gate, reset20, half-window10, stronger raw difference. `accepted` отделён от `fullHurt` и HP damage. Equal/weaker immunity hit не меняет health/flash/KB/wear/exhaustion/ignite; stronger hit не перезапускает timer/full flash/base KB. Full absorption не отменяет accepted full hurt.

# Critical hits

Falling ×1.5 без charge и запрета sprint. Проверяются ground/water/ladder/blind/riding/living. Blindness не добавлена как feature; helper поддерживает predicate. Game передаёт текущие fixed player conditions, включая ridingCartId. Fist crit1.5; diamond sword crit12; crit+sprint extra возможны вместе.

# Armor formula

Fixed classic points reduction вместо 1.9 damage-dependent curve. Toughness data сохранена для совместимости, mitigation её не читает. Порядок: raw hurt comparison → block → armor → absorption → HP. Existing armor point/HUD source не менялся. Fire/Lava mitigation сохранена; fall/drown/starve/suffocate/void bypass. Fire DOT/generic сохраняют прежние Frontier armor exceptions, явно отмеченные в reference. Armor wear не переписывалась.

# Knockback root cause

Ошибка была не в одном коэффициенте: Game превращал vector KB в `.length()`, MobManager делал additive horizontal push без canonical halving и с hardcoded Y3.2; одновременно существовал отдельный слабый player-received path. Airborne mob motion не имел reference horizontal drag и мог перезаписываться AI. В PlayerController обычный ground response/braking, наоборот, почти гасил внешний импульс до первого перемещения.

# Old Frontier knockback

Outgoing vector length смешивал Y и XZ: например sprint vector(18 horizontal,2 vertical) становился scalar18.11077; MobManager добавлял scalar к старому XZ и ставил Y не ниже3.2. Player-received melee использовал отдельный XZ3.2/Y1.2. Это две несовместимые схемы.

Во время диагностики после исправления только начального вектора, но до travel drag, flat mob за20 ticks проходил3.21029 normal /7.22315 sprint. Это **intermediate measurement**, не честно выданный за baseline5820d7d browser benchmark.

# Vanilla 1.8 knockback

Reference constants и порядок из EntityLivingBase/EntityPlayer приведены в новом reference: base0.4 blocks/tick →8 blocks/s; extra0.5 →10 XZ, extra0.1 →2Y, одно преобразование единиц. Halving/cap и extra stages нельзя заменять длиной общего вектора или magic multiplier.

# New Frontier knockback

Canonical scalar helpers in-place: `applyKnockback`, `applyExtraKnockback`, `applyMeleeDrag`. Game передаёт attacker position/yaw/extra level, не длину vector. PlayerController.receiveMeleeKnockback вызывает тот же base helper. Recoil использует существующие collision systems; AI не стирает импульс, player steering не заменяет его обычным blend. После посадки/в liquid/ladder/flight возвращается прежний movement path.

Deterministic flat/8-block-high-wall component arena, stationary zombie at(0,1,0), attacker(−1,1,0), sprint facing+X, 20 fixed ticks, daylight0.2:

| Scenario | Initial X/Y b/s | X displacement after20 ticks |
| --- | --- | ---: |
| Normal flat | 8 / 8 | 2.049882994 |
| Sprint flat | 18 / 10 | 5.024349146 |
| Normal wall at X1 | 8 / 8 | 0.69999 |
| Sprint wall at X1 | 18 / 10 | 0.69999 |

Player/mob actual trajectories совпадают в первых9 airborne ticks на flat и wall до tolerance1e−4; first tick moves0.4 X, remaining X velocity4.368. Player/mob different step heights and post-landing AI remain alpha. Нет заявления, что любое ванильное terrain/netcode поведение воспроизводится bit-exact.

# Sprint hit

Extra KB и slowdown выполняются только после accepted target result. На ordinary/rejected hit attacker не тормозит и не теряет sprint. Stronger differential accepted hit может дать extra без второго base KB. Никаких combo multipliers.

# Sprint reset

Successful extra hit ставит sprint=false и transient release latch. Пока W+sprint удерживаются, следующего автоматического sprint bonus нет. Release sprint или forward≤0.05 снимает latch; новый ввод вновь разрешает sprint. Это явное требование пользователя, более строгое, чем vanilla client held-sprint re-entry; не называется bit-exact Java input.

# Attacker slowdown

Только accepted extra stage: velocityXZ×0.6, Y не меняется. Test [5,2,−10]→[3,2,−6]. Обычный full hit/air/ignored не изменяют движение attacker. Игрок сохраняет обычный WASD controller вне recoil.

# Sword blocking

Use-state зависит от selected sword, alive и gameplayAllowed. Fixed tick включает/выключает; lifecycle немедленно сбрасывает при выходе из PLAYING. Game маскирует sprint и forward/strafe×0.2. Formula применяется к raw/difference до armor. No directional cone/wind-up/axe-disable/shield feature. Death/switch/break/release/overlay/pause сбрасывают. Blockability matrix и сохранённые environmental exceptions перечислены в reference/tests.

# First-person blocking

Небольшой sword pose overlay в существующем FirstPersonRenderer; swing duration0.30s. Idle generated/handheld pose, scale, item geometry и материалы не заменены. 100 block/release/swing cycles сохраняют object identities/count и возвращают исходную idle matrix без накопления drift. Это CPU transform validation, **не visual pose acceptance**.

# Bow regression

20-tick draw curve/threshold/ammo/FOV/pulling textures не переведены в melee charge. ArrowPhysics, PlayerArrowManager и ArrowVisualFactory без diff. Skeleton full arrow impact сохраняет XZ2.4/Y0.5; live-owner и owner-missing paths не объединялись. Arrow target damage использует shared hurt gate; physics/geometry unchanged. Existing arrow visual/collision tests выполняются в regression наборе.

# Save migration

Ни world/chunk формат, ни IndexedDB schema не менялись. Combat.restore игнорирует старые extra cooldown/Shield fields, whitelist-ит известные held IDs. Blocking/hurt timer/sprint latch/recoil не сериализуются. Existing `legacyItems` migration сохраняет другие slots/metadata/durability/bucket overflow и очищает только старый shield. Survival effects/save limitations остаются прежними.

# Tests

- Before edits: typecheck/build/size/archive PASS; full maxWorkers2:634/657,23failed,1RPCerror.
- Post implementation maxWorkers2:690/713,23failed,1RPCerror;6failed/64passed files;216.95s. Новые combat tests проходят.
- Failure groups: fluid-streaming3 и lighting-scheduler flight1 (`14816.667` vs `<8000`); CRLF GeneratedItemGeometry fingerprint1 (`e71967bd` vs `be428190`); fire-contact/sunlight/minecart14 timeouts, worldgen2 timeouts, lighting-jobs1 timeout; дополнительный wall-clock-sensitive lighting scheduler cursor assertion1 (`16 >16`). Baseline имел15 fire timeouts и не имел cursor assertion: это не идентичный набор, только одинаковое количество. Unrelated source/expectations не менялись.
- `npm run check` выполнен: typecheck PASS, default-concurrency tests675/713,38failed,2RPCerrors,11failed/59passed files,184.51s; команда остановилась на tests, build не достигнут. Помимо тех же streaming/fingerprint и CPU groups при default parallelism timeout получили block-break-batch1, hostile-spawn1, lava multi-seed1, mob-hurt-flash8, streaming-scheduler2; fire16, lighting-jobs2, worldgen2. Это не зелёный check и не 38 доказанных новых combat bugs.
- Финальный targeted набор: **194/194,14files,22.91s**, maxWorkers2. Files: combat47, classic-combat-integration17, mob-hurt-flash8, shield-removal6, player-physics5, gameplay-modal9, arrow-physics2, arrow-visual-cleanup9, fire-arrow-and-fire5, placement-support36, bucket-interaction31, armor-hud7, potion-effects-hud5, inventory7. Последний CPU soak test добавлен после full runs, поэтому final total714; full713 выше не выдаётся за повторный запуск после добавления soak.
- Отдельный финальный build PASS:127modules, JS959.51kB/gzip268.57, CSS38.69kB/gzip8.98,6.68s. Size/archive PASS:3.45MiB/186files, root index.html и прежний `/sdk.js` path. Прежние warnings external SDK/chunk>500kB не скрыты.
- Финальный отдельный `npm run typecheck` PASS. Lighting cursor assertion повторён без конкурирующей нагрузки: `npm test -- tests/lighting-scheduler.test.ts -t 'processLighting resumes a near flood owner' --maxWorkers=1` —1PASS/18skipped,1.14s; подтверждает нестабильность wall-clock budget test, не требует combat fix.

Full-suite failures не скрыты повышением timeout/сменой snapshot/threshold. Source audit сохраняет прежние geometry/fluid/placement files. Final targeted suite отдельно проверяет изменённые entry points и ближайшие regressions.

# Browser QA / Visual QA

**BLOCKED, не PASS.** Browser skill применён; существующий browser connection жив, но tabs/user.openTabs пусты. Предыдущая navigation/reload localhost4173 отклонена policy. Не обходил запрет через другой host/browser/CDP/standalone Playwright. Нет новых screenshots/FPS readings или вручную подтверждённого W-tap/pose/mobile feel.

В `TESTING.md` обновлена ручная matrix из8 сценариев. Deterministic spawned mobs использованы в component arena; отдельная production-heavy arena не добавлялась. Требуется разрешённый browser session для завершения приёмки.

# Performance

Gameplay остаётся20TPS; live camera/render RAF не изменены. Нет Mesh/Geometry/Material/Texture на click; block/swing используют cached object. Canonical KB scalar math, без десятков Vector3 на hit. One HurtResistance instance per living target, маленький result per attempt. Mob/projectile caps и budgeted meshing/lighting/streaming сохранены. CPU soak24mobs/300ticks/7200attempts и resource identities измеряются отдельно; это не GPU benchmark.

Final CPU soak: tick p95 **2.1287ms**, max29.1351ms в Node/Vitest, 300samples, 393ms test duration. Все24 живы, coordinates finite, scene object/geometry/material identities неизменны. Это descriptive timing под test runner, не hard performance budget/FPS claim; lighting/worldgen deliberately excluded из deterministic combat field. JS bundle вырос лишь на0.73kB (gzip+0.40kB); CSS уменьшился на0.24kB. Реальный GPU/live-world p95 не измерен.

# Files changed

- `src/combat/CombatSystem.ts`, new `HurtResistance.ts`: helpers, profiles, shared gate, transient sword use.
- `src/core/Game.ts`, `src/input/InputManager.ts`, `src/player/PlayerController.ts`: accepted-hit orchestration, click count, block move mapping, recoil/sprint latch.
- `src/entities/MobManager.ts`, `src/survival/SurvivalSystem.ts`: target gate, damage ordering, recoil integration/feedback.
- `src/items/registry.ts`, `src/items/types.ts`: damage totals, removed attackSpeed.
- `src/rendering/FirstPersonRenderer.ts`, `src/ui/GameUI.ts`, `src/style.css`: block pose, removed indicator.
- `tests/combat.test.ts`, new `tests/classic-combat-integration.test.ts`, `tests/mob-hurt-flash.test.ts`, `tests/shield-removal.test.ts`.
- `docs/PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `TESTING.md`, `MINECRAFT_1_9_REFERENCE.md`, new `MINECRAFT_1_8_COMBAT_REFERENCE.md`, this report.

# Architecture decisions

Расширены канонические CombatSystem/MobManager/PlayerController/FirstPersonRenderer. Единственный shared damage gate вместо второй combat implementation. Velocity stays blocks/s; arrows retain their independent blocks/tick representation. Distinct accepted/fullHurt preserves difference damage semantics. No whole-world physics rewrite, no schema migration.

# Known issues / Deferred 1.8 PvP features

- Browser acceptance и real-device/GPU/FPS soak pending; full-suite baseline failures unresolved.
- Tool wear1 вместо Java2 и strict sprint re-entry — явные task overrides.
- Alpha AI/death animation/collision/terrain step/slipperiness variants/network reconciliation не vanilla parity.
- Armor durability/enchantments/Protection/Knockback equipment/XP/fishing-rod PvP/multiplayer/sweep/advanced feedback не добавлены.
- Old natural regen/potions, sunlight policy, fire exceptions/save limitations не являются скрытой миграцией всей игры на1.8.

# Next work

Разрешённый browser session → выполнить8 manual scenarios из TESTING.md и снять real performance/resource counters. Отдельная задача для baseline test stability. Не расширять unrelated gameplay scope.

# Git status

На завершение реализации, до публикации: working tree dirty by design, только перечисленные combat/tests/docs изменения, без удаления чужих untracked; HEAD/origin/main5820d7d, ветка feat/playable-voxel-alpha. `git diff --check` PASS (только обычные LF→CRLF warnings). Config/reset/clean/stash/restore/rebase не выполнялись.

Публикация разрешена отдельной командой пользователя «сделай коммит и пуш». План поставки: один combat commit на существующей ветке и обычный fast-forward push HEAD→origin/main, без force. Фактический SHA — в Git history; результаты тестов и открытая browser приёмка от публикации не становятся PASS.
