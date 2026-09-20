# Sword blocking — held sword follows the arm

Дата: 2026-09-20  
Ветка: `cursor/sword-blocking-animation-7e91`  
PR: #99  
Не мержить.

## Goal

На живых скриншотах при ПКМ правая рука поднималась в blocking pose, а меч оставался в старой позиции и «отрывался» от руки. Нужно, чтобы меч оставался прикреплённым к руке, как при ЛКМ attack.

## Result

Third-person больше не пишет отдельный extra TRS на меч. Используется тот же attachment, что у ЛКМ: `rightArm` → `heldItem` → sword mesh с `/moveitems` local calibration. Рука lerp’ится в `THIRD_PERSON_SWORD_BLOCKING_ARM`; меч следует автоматически. `THIRD_PERSON_HELD_ITEM_DEFAULTS.sword` не менялся.

## Как ЛКМ держит меч в руке

`PlayerVisualAnimator.triggerSwing` / mining меняют только `rightArmX/Y/Z`. `applyPose` пишет это в `rig.rightArm.rotation` (YXZ). Меч — child `rig.heldItem`, который child `rightArm`. Local pose меча — production `/moveitems` (`THIRD_PERSON_HELD_ITEM_DEFAULTS.sword`). Parent transform двигает world pose. Отдельного world-space rewrite нет.

## Почему ПКМ это ломал

`applyThirdPersonSwordBlockingTransform` каждый кадр задавал мечу extra local position/rotation поверх calibration (`rotation ≈ (-0.18, -0.85, -1.25)`). Origin generated-спрайта — не рукоять. Extra rotation крутила спрайт вокруг центра, пока рука поднималась, и визуальный клинок оставался у старого места. Рука и меч расходились.

Это не world-space parent bug: иерархия была верная. Ломал именно второй, независимый pose layer на самом мече.

## Что изменено

- `PlayerVisual`: held item всегда local `/moveitems` / live calibration. `syncHeldItemBlocking` extra TRS убран.
- `PlayerVisualAnimator`: по-прежнему lerp только правой руки (как swing).
- `swordBlockingVisual.ts`: `THIRD_PERSON_SWORD_BLOCKING_OFFSET` и `applyThirdPersonSwordBlockingTransform` удалены.
- First-person: overlay на `mainModel` оставлен — в FP рука скрыта (`armPivot` sibling, не parent предмета).

## `/moveitems`

`THIRD_PERSON_HELD_ITEM_DEFAULTS.sword` не трогался. Live `applyHeldItemCalibration` остаётся idle base; во время ПКМ local числа те же; после отпускания — те же.

## Tests

```text
npx vitest run tests/sword-blocking-visual.test.ts tests/player-visual-animation.test.ts tests/classic-combat-integration.test.ts tests/combat.test.ts tests/third-person-held-item.test.ts tests/remote-action-presentation.test.ts tests/server/remote-presentation.test.ts tests/player-main-integration.test.ts --maxWorkers=2
```

**8 files / 132 tests PASS.** `npm run typecheck` PASS. `npm run build` PASS (301 modules, JS 1523.88 kB / gzip 434.79 kB).

## Visual QA

`/?qaPlayer=1` (тот же `PlayerVisual`, что local TP и `RemotePlayerView`):

- Idle: меч в правой руке у бедра.
- Block: рука поднимается, клинок остаётся в этой руке (не на старом месте у бедра).
- Release: калиброванный idle.
- First-person: idle справа вертикально → block к центру/поперёк → restore.

Live Anarchy (`http://127.0.0.1:4173`, `ws://127.0.0.1:2567`):

- First-person: `/give diamond_sword`, idle → hold RMB → меч уходит в use pose → release.
- Local third-person front (F5×2): idle у бедра → RMB рука вверх, меч в этой руке.
- Смерть на спавне / respawn / `/gamemode creative`: поза сбрасывается и снова работает после give.
- Два живых WS-клиента: observer видит `presentation.heldItemId=diamond_sword` и `swordBlocking` true при `use`, false после отпускания. Remote mesh = тот же `PlayerVisual`, что на qaPlayer/local TP.

## Performance

## Performance

Меньше работы на кадр (нет extra Euler/Quat на TP меч).

## Known issues

Нет.

## Deferred

Owner visual acceptance. Do not merge.

## Git

Branch `cursor/sword-blocking-animation-7e91`. Code `b591152`. Do not merge.
