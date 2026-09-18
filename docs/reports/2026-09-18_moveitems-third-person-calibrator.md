# Third-person held-item calibrator (`/moveitems`)

Дата: 2026-09-18  
Ветка: `cursor/moveitems-calibrator-d200`

## Goal

Дать отдельный DEV/calibration режим для ручной настройки position/rotation/scale предметов в руке **remote / third-person** игрока. First-person pose уже настроен и не должен меняться. Подобранные числа не записываются в production: их копируют и передают отдельной задачей.

## Result

`http://localhost:4173/moveitems` открывает маленький открытый voxel-мир, канонический `PlayerVisual` от третьего лица и live-панель для реального held-item renderer, которым пользуются remote players.

## Implemented

- Маршрут DEV `/moveitems` (Vite SPA fallback + pathname check в `main.ts`).
- Сцена: `VoxelWorld` + `WorldRenderer` (поляна), orbit-камера (drag/wheel + sliders), `PlayerVisual` на поверхности.
- Каталог реальных item id: featured tools/swords/bow + остальные registry items по kind.
- Live pos X/Y/Z, rot X/Y/Z (радианы, как production `Object3D.rotation.set`), scale X/Y/Z. Смена предмета сохраняет per-item значения.
- RESET к production default выбранного предмета. COPY / COPY ALL в буфер.
- Production defaults вынесены в `thirdPersonHeldItem.ts` **без смены чисел**. `PlayerVisual.applyHeldItemCalibration` — только live overlay.

## Changed files

- `src/rendering/player/thirdPersonHeldItem.ts` (новый)
- `src/rendering/player/PlayerVisual.ts` (reuse defaults + live overlay API)
- `src/dev/moveItemsRoute.ts` (новый)
- `src/dev/MoveItemsHarness.ts` (новый)
- `src/dev/MoveItemsPanel.ts` (новый)
- `src/main.ts`
- `vite.config.ts`
- `tests/third-person-held-item.test.ts` (новый)
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`
- этот report

Не менялись: `FirstPersonRenderer`, `FIRST_PERSON_SPRITE_POSE`, `itemRenderProfiles` numbers, gameplay, protocol, server.

## Architecture decisions

Remote held item уже шёл через `RemotePlayerView` → `PlayerVisual.setHeldItem` → `ItemVisualFactory.createItemModel` → category transform. Калибратор использует этот же `PlayerVisual`, а не копию. First-person calibrator (`?qaItem=` / `HeldItemPosePanel`) не подключён.

`/moveitems` — только `import.meta.env.DEV`. Production bundle не тянет harness (dynamic import внутри DEV-ветки). Числа category defaults не пишутся обратно в renderer.

Rotation в UI — радианы, потому что production `model.rotation.set(-0.16, 0, -0.72)`. Рядом показывается градусная подсказка.

## Parameters

| | range | step |
| --- | --- | --- |
| position X/Y/Z | −2 … 2 | 0.005 |
| rotation X/Y/Z (rad) | ±2π | 0.01 |
| scale X/Y/Z | 0.05 … 3 | 0.01 |

Камера: drag по canvas, wheel zoom, sliders orbit/pitch/distance. Позы idle/walk/mining.

## Copy format

```text
Item: iron_pickaxe

position:
  x: ...
  y: ...
  z: ...

rotation:
  x: ...
  y: ...
  z: ...

scale:
  x: ...
  y: ...
  z: ...
```

## Tests

- Path `/moveitems` / trailing slash.
- Production category defaults.
- First-person pose regression.
- Per-item store + RESET isolation.
- COPY / COPY ALL text.
- `PlayerVisual` applies defaults then live overlay; switching items restores that item's production default before overlay.

```text
npm run typecheck                  PASS
typecheck:client / typecheck:server PASS
check:boundaries                   PASS
vitest third-person + item-rendering + player-visual  3 files / 47 tests PASS
npm run build                      PASS (harness not in production JS)
```

## Visual QA

Browser Chromium, Vite `http://localhost:4173/moveitems`:

- Default camera is a front three-quarter on the right hand so the held item is visible (back view hid the thin sprite).
- `iron_pickaxe` uses the real generated handheld mesh at production hip pose (the remote-player bug this tool is for).
- Item switch: pickaxe → diamond_axe → diamond_sword, models swap immediately.
- Live px / rz / scale sliders move the sword without reload.
- RESET restores handheld defaults `0, -0.04, -0.06` / `-0.16, 0, -0.72` / `0.55` and status `reset to production default`.
- COPY → `copied item`; COPY ALL → `copied all`.
- Canvas drag orbits the camera.
- `http://localhost:4173/` still opens the normal Frontier Cubes menu, not the calibrator.

## Performance

Один `PlayerVisual`, радиус мира 2 chunk, budgeted `rebuildDirty` как у vegetation QA. Не для production gameplay.

## Known issues

- Калибратор не пишет выбранные числа в `applyHeldItemTransform`. Это follow-up после ручной сессии.
- Offhand не калибруется (remote offhand сейчас только Totem с отдельным hardcoded pose).

## Deferred

- Production write подобранных third-person poses.
- Per-item (не category) production table, если калибровка покажет что кирка и меч должны отличаться.

## Next work

После ручной калибровки вставить скопированные значения в production third-person renderer отдельной задачей.

## Git

Ветка `cursor/moveitems-calibrator-d200` от `main` (`7c8a733`). PR #95.