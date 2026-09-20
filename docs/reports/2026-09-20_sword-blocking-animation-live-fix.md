# Sword blocking animation — live Anarchy invisible pose fix

Дата: 2026-09-20  
Ветка: `cursor/sword-blocking-animation-7e91`  
PR: #99  
Не мержить.

## Goal

Предыдущая реализация blocking overlay формально прошла unit tests, но в живой игре при удержании ПКМ с мечом замедление работало, а визуальная поза меча не менялась (first-person idle). Нужно найти runtime-причину, починить pipeline, не переписывая `/moveitems` / `PlayerVisual` / `FirstPersonRenderer`.

## Result

Найдена и исправлена потеря состояния на Anarchy-клиенте. Overlay transform был написан правильно и уже отличался от idle, когда `swordBlocking === true`. В живом Anarchy этот флаг на локальном клиенте никогда не становился `true`.

## Почему предыдущая реализация не была видна

Два разных потребителя RMB:

1. **Движение** в `tickOnline`: `using = gameplayAllowed && this.input.using` → `movementDuringItemUse(..., using)`. Замедление ×0.2 работало без `CombatSystem`.
2. **Визуал** в `updateFirstPerson` / `updatePlayerPresentation`: читает `session.combat.swordBlocking`.

`combat.swordBlocking` выставляется только в `CombatSystem.updateUse`. SP `tickPlayers` это вызывал. **Anarchy `tickOnline` не вызывал `updateUse` вообще.** `setHeldItem` каждый тик оставлял флаг `false` (тот же предмет → не сбрасывает, но и не включает). First-person `applyFirstPersonSwordBlockingOverlay` получал `progress = 0` и early-return. Third-person local — то же.

Тесты кормили `swordBlocking: true` напрямую в renderer, поэтому проходили.

Это не overwrite overlay → idle: порядок в `FirstPersonRenderer.update` уже был `applyItemViewTransform` (base) затем overlay. Overlay просто не запускался.

## Где терялось состояние

```
ПКМ → InputManager.using = true
  → tickOnline: send use, movementDuringItemUse(using)     // slowdown OK
  → (не было combat.updateUse)
  → combat.swordBlocking остаётся false
  → updateFirstPerson: state.swordBlocking = false
  → FirstPersonRenderer.update: blockingProgress stays 0
  → applyFirstPersonSwordBlockingOverlay early-return
  → visible sword = idle FIRST_PERSON_SPRITE_POSE
```

Remote observer theoretically still получал server `presentation.swordBlocking`, потому что сервер `WorldInstance` уже вызывал `combat.updateUse` из `input.use`. Локальный игрок себя не видел в block pose.

## Как исправлено

Общий helper `Game.syncLocalCombatUse`:

1. `combat.setHeldItem(selected)`
2. `combat.setOffhand(offhand)`
3. `combat.updateUse(input.using, gameplayAllowed, alive)`

Вызывается из **обоих** путей: `tickOnline` и `tickPlayers`, до `firstPerson.setHeldItems` / `playerVisual.setHeldItem`.

Gameplay (damage, hitbox, slowdown numbers) не менялся.

## Как теперь применяется first-person transform

Каждый render frame, после fixed tick:

1. `updateFirstPerson` копирует `session.combat.swordBlocking` в `FirstPersonFrameState`.
2. `FirstPersonRenderer.update` считает `blocking = swordBlocking && isSwordItem(mainItem)`, lerp `blockingProgress` за 0.1 с.
3. На том же `mainModel`, который рисуется: `applyItemViewTransform` (idle / QA calibration) → equip dip → `applyFirstPersonSwordBlockingOverlay` extra TRS.
4. `setHeldItems` не пересоздаёт mesh, пока item id тот же; blocking progress не сбрасывается.

Idle pose `FIRST_PERSON_SPRITE_POSE` не перезаписывается. Overlay: position `(-0.30, 0.18, 0.08)`, rotation `(-0.65, 0.52, 1.00)` rad — поднять, к центру, заметный угол.

## Как применяется third-person transform

`updatePlayerPresentation` → `PlayerVisual.update({ swordBlocking: session.combat.swordBlocking })` → animator lerp arm + `syncHeldItemBlocking` пишет extra TRS на stored `/moveitems` base того же `heldModel`. `setHeldItem` no-op при том же id, поэтому model не пересоздаётся после overlay.

## Как remote player получает состояние

Без нового протокола. Сервер как раньше: `input.use` → `combat.updateUse` → `presentation.swordBlocking` в `player_state`. `RemotePlayerView.interpolate` передаёт `actions.swordBlocking` в тот же `PlayerVisual.update`.

## Changed files

- `src/core/Game.ts` — `syncLocalCombatUse`; tickOnline + tickPlayers
- `tests/classic-combat-integration.test.ts` — Anarchy `Game.tick()` → `swordBlocking` → FP/TP transform ≠ idle
- `tests/sword-blocking-visual.test.ts` — skip-`updateUse` leaves idle matrix; non-zero overlay offsets
- `tests/player-main-integration.test.ts` — source contract helper on both tick paths + FP/TP copy
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, этот отчёт

## Architecture decisions

Не второй RMB detector и не новая pose table. Один helper, чтобы Anarchy не мог снова разойтись с SP. Overlay values не раздувались «наугад»: причина была в флаге, не в величине TRS.

## Tests

```text
npx vitest run tests/sword-blocking-visual.test.ts tests/player-visual-animation.test.ts tests/classic-combat-integration.test.ts tests/combat.test.ts tests/third-person-held-item.test.ts tests/remote-action-presentation.test.ts tests/server/remote-presentation.test.ts tests/player-main-integration.test.ts --maxWorkers=2
```

**8 files / 132 tests PASS.** `npm run typecheck` PASS. `npm run build` PASS (301 modules, JS 1524.89 kB / gzip 434.99 kB).

Ключевой новый контракт: `using=true` + меч без `updateUse` → first-person matrix equals idle; после `updateUse` / Anarchy `tick()` → `swordBlocking === true`, `blockingProgress === 1`, matrix distance > 0.2.

## Visual QA

Live Anarchy on this host (`npm run dev:anarchy`, `http://127.0.0.1:4173`, `ws://127.0.0.1:2567`):

- **First-person:** diamond sword idle (lower-right diagonal) → hold RMB → sword raises toward screen center and turns across the view → release → idle. Confirmed on screenshots.
- **Local third-person (F5):** idle sword hidden at the hip → hold RMB → blade visibly raised at the shoulder → release → hip. Confirmed on screenshots.
- **Two clients connected** in the same Anarchy world (nameplates `Player-46c7` / second client). Browser-side remote pose screenshots were interrupted by spawn PvP deaths.
- **Live two-client protocol on the same running server:** two WebSocket clients `BlockActor` / `BlockObserver`. Actor `/give diamond_sword`, `use: true` → observer `player_state` for that actor `presentation.swordBlocking === true` and `heldItemId === 'diamond_sword'`; `use: false` → `swordBlocking === false`. PASS.

Remote third-person rendering uses the same `PlayerVisual` overlay that local F5 already showed raising the sword; the missing piece before this fix was only the local `tickOnline` flag.

## Performance

Без новых аллокаций. Один extra `updateUse` на Anarchy tick (уже был в SP).

## Known issues

- Browser-to-browser remote pose photo was not completed here (Anarchy spawn PvP deaths). Live WS observer still received `presentation.swordBlocking` true/false from the actor.

## Deferred

Owner visual acceptance; do not merge.

## Next work

Owner photo of remote third-person blocking pose. Do not merge to main.

## Git

Branch `cursor/sword-blocking-animation-7e91`. Fix `d506b360c21b842fad5ce177e33a66b2486a5bdb`. HEAD pending. Do not merge.
