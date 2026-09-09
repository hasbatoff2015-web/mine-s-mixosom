# Melee PvP hit registration on the client render timeline

## Goal

Исправить промахи online melee при fast flick и движущейся remote-цели, сохранив инвариант **CLIENT OWNS INTENT. SERVER OWNS RESULT**, текущий PlayerCommand FIFO/prediction pipeline и все существующие combat/protection rules.

## Result

Production online melee больше не отправляет bare `{ type: 'attack' }`. LMB/touch attack формирует sequenced `action(kind=attack)` с `actionSeq`, `commandSeq`, captured slot, live yaw/pitch и optional `targetId + targetRenderTick` только для remote player, реально выбранного crosshair на уже отрисованной timeline. Сервер ждёт exact authoritative command-boundary, при необходимости делает bounded target rewind и самостоятельно доказывает hit.

## Root causes

1. Production path обходил существующий `captureAttack`, поэтому attack не был связан с input/command timeline.
2. Сервер сразу использовал receipt-time `controller.eyePosition()` / `viewDirection()`, даже если command с новым look ещё стоял в FIFO.
3. Клиент выбирал remote player по delayed interpolated `group.position`, а сервер проверял только current authoritative AABB. Обычный adaptive delay 80–180 ms создавал систематическое расхождение видимой и проверяемой позиции.

## Implemented

- `AttackAction` и additive protocol fields получили optional `targetId`/`targetRenderTick`; protocol version остаётся 3.
- `RemotePlayerView` сохраняет только последнюю pose, уже применённую при обычном render sample, и отдаёт read-only `lastRenderTick`. Второй `sample()` при клике не выполняется.
- Client raycast выбирает remote относительно block/mob/minecart distances и отправляет hint только если remote действительно ближайший объект под crosshair.
- `server/combatPoseHistory.ts` хранит 12 authoritative post-tick poses. Exact `commandBoundary` отделяет реально dequeued command от sticky repeats.
- Если matching command ещё в FIFO, attack ждёт в очереди максимум из 32 intents. После полного physics/gameplay/riding tick записывается pose и pending attack разрешается. Missing/old command даёт stale rejection.
- Target AABB rewind выполняется в `WorldInstance.resolveSequencedAttack` через `rewindCombatPose`, до вызова `ServerGameplay.attack`. Допустимо максимум 5 ticks = 250 ms при 20 TPS; future и более старые requests отклоняются. Fractional tick линейно интерполирует authoritative AABB между соседними samples.
- `ServerGameplay.attack` заново проверяет authoritative attacker ray, historical target AABB, reach <=3 и current-world voxel occlusion. Затем используются прежние plugin/Claims, damage, armor, blocking, hurt resistance, critical, knockback и durability paths.
- Hinted target miss не выбирает другого player. Без player hint продолжают работать mob/minecart/block/air attacks и swing presentation. Dedicated legacy attack остаётся safe current-state fallback. Bow/projectile physics не менялись.
- `action_result.combat` различает `hit`, `miss`, `immune`, `blocked`, `occluded`, `out_of_reach`, `stale`; это diagnostics, не источник gameplay state.

## Changed files

- `shared/playerActions.ts`, `shared/protocol.ts`
- `src/net/actionIntent.ts`, `src/net/onlineActionMessages.ts`, `src/net/RemotePlayerView.ts`
- `src/core/Game.ts`
- `server/combatPoseHistory.ts`, `server/WorldInstance.ts`, `server/gameplay.ts`, `server/AnarchyServer.ts`
- `tests/combat-pose-history.test.ts`, `tests/melee-action-intent.test.ts`, `tests/remote-action-presentation.test.ts`, `tests/server/melee-lag-compensation.test.ts`
- `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/TESTING.md`, этот report

## Architecture decisions

- Captured client yaw/pitch остаются intent/diagnostics и проходят finite validation. Реальный ray direction берётся из yaw/pitch exact authoritative command pose после server simulation.
- Blocks не rewind-ятся: LOS проверяет текущую voxel geometry, намеренно консервативно.
- Hitbox не раздувается; client distance/damage не принимаются.
- `action_result.ok` по-прежнему означает принятие action, а не обязательный damage. Hurt resistance поэтому возвращает `ok: true` + `combat.result: immune`.

## Tests

- Focused client/history/server: 4 files, 24/24 PASS.
- Existing combat/network/action/interpolation/prediction regression: 16 files, 309/309 PASS.
- Plugin boolean compatibility + server melee after fix: 2 files, 27/27 PASS.
- `npm run test:sim`: 9 files, 42/42 PASS.
- `typecheck`, `typecheck:sim`, `typecheck:client`, `typecheck:server`: PASS.
- `check:boundaries`: PASS.
- `npm run build`: PASS (existing `/sdk.js` and large-chunk warnings only).
- `git diff --check`: PASS (Windows LF→CRLF notices only).

Full `npm test -- --maxWorkers=2` ran 200 files and reached 1907/1924 before a newly exposed `hurtPlayer` boolean-contract regression was corrected. The correction passes `plugin-platform` and melee tests together (27/27). Other failure classes are unrelated and already documented on this host: default 5s timeouts in `worldgen-terrain` and `fire-contact-sunlight-minecart`, the `tick-load-flight` <80 ms wall-clock gate, and the unchanged `minecraft-reference-extractor` parse failure. Standalone reruns reproduced those baseline classes; no test limit was relaxed.

## Visual QA

Manual two-client browser QA was not performed. It remains an explicit owner item in `ROADMAP.md`; automated tests exercise the two-player authoritative path without a browser.

## Performance

Per connected player: a bounded 12-sample history and at most 32 pending melee intents. Lookup work is bounded linear scan over these tiny arrays. There is no unbounded history, world scan, extra interpolation sample, remesh or change to 20 TPS.

## Known issues

- Full default-timeout suite remains baseline-red on this machine for the unrelated classes listed above.
- Live two-client latency/throttling and mobile touch feel still require owner QA.

## Deferred

- Bow/projectile lag compensation; the authoritative pose history is reusable, but projectile physics is deliberately untouched in this commit.
- Historical block geometry and any hitmarker UI.

## Next work

Run two Anarchy clients with normal and throttled latency: verify stationary, fast flick, moving target, current wall rejection, repeat hits during hurt resistance, and landscape-mobile attack input while watching F3 melee diagnostics.

## Git

- Branch: `codex/pvp-hit-registration-v2`
- Base: `eb82417b70fb81932c6ba140b9a809b456d52dec`
- Commit message: `fix: align melee pvp hits with client timeline`
- No merge to `main`.
