# Held-item live pose calibrator (QA)

Дата: 2026-08-21  
Ветка: `cursor/minecraft-item-pipeline-rework-935a`

## Goal

Дать DEV/QA live-панель для ручной калибровки first-person held-item pose: X/Y/Z, Pitch/Yaw/Roll, Scale. Результат копируется как query / TS object для будущего production write. Production pose и `GeneratedItemGeometry` не менялись.

## Result

В `?qaView=held` и `?qaPoseCompare=1` справа появляется control panel. Значения применяются сразу, без reload. Смена предмета pose не сбрасывает.

## Implemented

- Live state `HeldItemQaLiveState` + ranges/step/nudge/copy/storage helpers в `heldItemQa.ts`.
- DOM panel `src/dev/HeldItemPosePanel.ts` (только Item QA harness).
- `FirstPersonRenderer.setHeldQaOverride` для runtime override без записи `FIRST_PERSON_SPRITE_POSE`.
- Item switch 1–8 / `[` `]` на любом held QA; pose сохраняется.
- Optional `sessionStorage` key `held-item-qa-pose`. URL `qaPose`/`held*` побеждает storage.

## Changed files

- `src/rendering/heldItemQa.ts`
- `src/rendering/FirstPersonRenderer.ts`
- `src/dev/HeldItemPosePanel.ts` (новый)
- `src/dev/ItemQaHarness.ts`
- `tests/item-rendering.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`
- этот report

`GeneratedItemGeometry.ts` и production `FIRST_PERSON_SPRITE_POSE` numbers не в diff как изменения значений.

## Architecture decisions

Панель существует только в DEV item harness (dynamic import из `main.ts` при `qaItem`/`qaPoseCompare`). Gameplay, saves, dropped items, block poses не подключены. Storage ключ QA-specific. Mouse manipulators опциональны и работают только на canvas (Alt-drag rotate, Shift-drag XY, wheel scale, Ctrl-wheel Z).

## QA panel

Справа: sliders + numeric inputs для семи параметров, reset presets, COPY POSE / QUERY / TS, кнопки 1–8 предметов.

## Controls

| | range | step |
| --- | --- | --- |
| X/Y | −2 … 2 | 0.01 |
| Z | −3 … 0 | 0.01 |
| Pitch/Yaw | −90 … 90 | 1° |
| Roll | −180 … 180 | 1° |
| Scale | 0.1 … 3 | 0.01 |

Active field: клик по slider/input. Arrows ±step, Shift×10, Alt×0.1.

## Copy

`COPY POSE` — `heldScale=` … `heldRoll=` блок.  
`COPY QUERY` — `?qaItem=...&qaView=held&pose=idle&heldScale=...`.  
`COPY TS` — `{ position, rotationDeg, scale }`.

## Item switching

1–8, `[` `]`, `,` `.`, `n` `p`, или кнопки панели. Pose не reset.

## Tests

- Parse `held*` / copy POSE / QUERY / TS helpers.
- Live state update, clamp, reset production, no mutation of `FIRST_PERSON_SPRITE_POSE`.
- URL wins over `held-item-qa-pose` storage.
- Item switch keeps live pose; `setHeldQaOverride` applies immediately.

```text
TypeScript: tsc --noEmit — PASS
Vitest:     22 files, 156 tests — PASS
Vite build: 75 modules — PASS
Size/archive: 0.94 MiB / 165 files — PASS
Main JS: 736.40 kB / 199.04 kB gzip; CSS: 12.90 kB / 3.82 kB gzip
```

## Visual QA

Открыть:

```text
?qaPoseCompare=1&qaView=held&pose=idle
?qaItem=iron_pickaxe&qaView=held&pose=idle
```

Выставить pose, переключить на `diamond_sword`, COPY.

## Performance

Только QA DOM + key/pointer listeners. Production mesh path не затронут кроме крошечного `setHeldQaOverride`.

## Known issues

- Held QA больше не печатает полный F2 matrix overlay по умолчанию (мешает калибровке). Inspect/`qaSideDebug` без изменений.
- sessionStorage восстанавливается только если в URL нет `qaPose`/`held*`.

## Deferred

- Запись выбранных чисел в `FIRST_PERSON_SPRITE_POSE` после ручного выбора.

## Next work

Пользователь калибрует локально и присылает COPY TS / QUERY.

## Git

Ветка `cursor/minecraft-item-pipeline-rework-935a`. **Не commit, не push, не merge `main`.**
