# Shared first-person held-item pose candidates

Дата: 2026-08-21  
Ветка: `cursor/minecraft-item-pipeline-rework-935a`

## Goal

Остановить pixel-perfect Minecraft screen01 audit. Подобрать **один** визуально хороший shared first-person pose для уже закрытой `GeneratedItemGeometry` (`item/generated`, `item/handheld`, bow base). Minecraft — visual/technical reference (читаемый front, тонкий depth, не зубы side spans), не 1:1 pixel target.

Production defaults **не** переключались. Три candidate позы живут только в QA (`qaPose=` / `held*`).

## Result

Смена цели зафиксирована:

```text
pixel-perfect vanilla projection  →  visual shared Minecraft-like pose
```

Три QA candidate:

| | pitch | yaw | roll | scale | xyz |
| --- | ---: | ---: | ---: | ---: | --- |
| A subtle | 4 | 8 | 14 | 0.85 | 0.50, −0.56, −0.82 |
| B balanced | 8 | 18 | 16 | 0.88 | 0.51, −0.54, −0.80 |
| C stronger | 12 | 32 | 18 | 0.92 | 0.52, −0.52, −0.76 |

Положительный pitch открывает верхнюю thickness; положительный yaw — левую. Yaw ≪ vanilla −90°, чтобы side spans кирки не становились гребнями.

`?qaPoseCompare=1` циклит representative items без правки query (клавиши `1–8`, `[` `]`).

## Implemented

- QA candidates A/B/C в `heldItemQa.ts` (`qaPose=subtle|balanced|stronger`).
- Merge: `qaPose` затем явный `held*` (явный побеждает).
- `qaPoseCompare=1` в harness: цикл 8 representative items без правки query.
- Production `FIRST_PERSON_SPRITE_POSE` не менялся.
- Документация цели: visual shared pose, не pixel-perfect F2.

## Changed files

См. Git ниже. `GeneratedItemGeometry.ts` не менялся.

## Architecture decisions

Один shared idle base для generated/handheld/bow. Candidates только QA. Vanilla matrix остаётся research. Выбор A/B/C — локально глазами, не mathematical winner. Анимации остаются overlay на base transform.

## Geometry baseline

`src/rendering/GeneratedItemGeometry.ts` **не менялся**.

Не возвращались family meshes, manual 3D tools, row-span front extrusion.

Production `FIRST_PERSON_SPRITE_POSE` остаётся `[0.50, -0.56, -0.82]`, Euler `[0, 0, 14]°`, scale `0.85`.

## Shared pose architecture

`itemRenderProfiles`: `generated`, `handheld` и `bow` делят один объект `FIRST_PERSON_GENERATED`. Block cubes — отдельный pose. Shield — отдельный.

`FirstPersonRenderer.update` каждый кадр:

1. берёт shared first-person transform;
2. опционально подменяет его QA `held*` / `qaPose`;
3. пишет TRS на item root через `applyItemViewTransform`;
4. поверх накладывает equip dip, eat, bow texture stage, shield raise;
5. walk bob / swing живут на `root`, не в item pose.

Анимации не ломались.

Vanilla matrix adapter остаётся diagnostic-only. Предыдущие F2/matrix reports не переписывались.

## Candidate A — subtle

Почти face-on. Минимум боковин. Близко к текущему production, плюс 4° pitch / 8° yaw.

```text
heldScale=0.85
heldX=0.50
heldY=-0.56
heldZ=-0.82
heldRoll=14
heldPitch=4
heldYaw=8
```

URLs:

```text
?qaItem=iron_pickaxe&qaView=held&pose=idle&qaPose=subtle&heldScale=0.85&heldX=0.5&heldY=-0.56&heldZ=-0.82&heldRoll=14&heldPitch=4&heldYaw=8
?qaItem=diamond_sword&qaView=held&pose=idle&qaPose=subtle&heldScale=0.85&heldX=0.5&heldY=-0.56&heldZ=-0.82&heldRoll=14&heldPitch=4&heldYaw=8
?qaPoseCompare=1&qaView=held&pose=idle&qaPose=subtle
```

## Candidate B — balanced

Front читается. Depth заметна. Рекомендуемый первый взгляд.

```text
heldScale=0.88
heldX=0.51
heldY=-0.54
heldZ=-0.80
heldRoll=16
heldPitch=8
heldYaw=18
```

URLs:

```text
?qaItem=iron_pickaxe&qaView=held&pose=idle&qaPose=balanced&heldScale=0.88&heldX=0.51&heldY=-0.54&heldZ=-0.8&heldRoll=16&heldPitch=8&heldYaw=18
?qaItem=diamond_sword&qaView=held&pose=idle&qaPose=balanced&heldScale=0.88&heldX=0.51&heldY=-0.54&heldZ=-0.8&heldRoll=16&heldPitch=8&heldYaw=18
?qaPoseCompare=1&qaView=held&pose=idle&qaPose=balanced
```

## Candidate C — stronger 3D

Больше перспективы, всё ещё не edge-on (yaw 32°, не 90°).

```text
heldScale=0.92
heldX=0.52
heldY=-0.52
heldZ=-0.76
heldRoll=18
heldPitch=12
heldYaw=32
```

URLs:

```text
?qaItem=iron_pickaxe&qaView=held&pose=idle&qaPose=stronger&heldScale=0.92&heldX=0.52&heldY=-0.52&heldZ=-0.76&heldRoll=18&heldPitch=12&heldYaw=32
?qaItem=diamond_sword&qaView=held&pose=idle&qaPose=stronger&heldScale=0.92&heldX=0.52&heldY=-0.52&heldZ=-0.76&heldRoll=18&heldPitch=12&heldYaw=32
?qaPoseCompare=1&qaView=held&pose=idle&qaPose=stronger
```

`qaPose=` можно сузить одним `held*`, например `&heldYaw=22`.

## Representative items

Обязательно на одном pose:

- handheld: `iron_pickaxe`, `diamond_sword`, `stick`
- generated: `coal`, `apple`, `arrow`
- bow: `bow` standby (`pose=idle` / `pose=base`)
- extra: `torch` (generated held path)

`qaPoseCompare=1` cycle: 1 pickaxe, 2 sword, 3 coal, 4 arrow, 5 stick, 6 apple, 7 bow, 8 torch. `[` `]` / `,` `.` / `n` `p` — соседний слот.

Критерий выбора локально: кирка хороша, меч не сломан, coal/arrow нормальны, texture узнаваема. После выбора — небольшой final tuning, затем один production write в `FIRST_PERSON_SPRITE_POSE`.

## Animation compatibility

Без изменений: swing, eat, bow use/texture stages, equip, shield, walk bob. Shared pose — только idle base.

Block item pose не трогали.

## Tests

- Shared generated/handheld/bow first-person transform (один и тот же объект `FIRST_PERSON_GENERATED`).
- Нет per-item sprite pose у tools/resources.
- Production defaults locked: `[0.50, -0.56, -0.82] / [0, 0, 14]° / 0.85`.
- `qaPose` merge (`held*` wins) + `qaPoseCompare` parse.
- Geometry tests не менялись.

```text
TypeScript: tsc --noEmit — PASS
Vitest:     22 files, 152 tests — PASS
Vite build: 75 modules — PASS
Size/archive: 0.94 MiB / 165 files — PASS
Main JS: 736.36 kB / 199.03 kB gzip; CSS: 12.90 kB / 3.82 kB gzip
```

## Visual QA

Локально открыть три `qaPoseCompare` URL выше, прогнать 1–8, сравнить A/B/C. Не сравнивать pixel-to-pixel с F2.

## Performance

Только QA parse + keydown cycle. Production mesh path не затронут.

## Known issues

- Candidates не утверждены глазами. Production всё ещё face-on roll-14.
- Vanilla F2 projection research остаётся в предыдущих reports, не как production contract.

## Deferred

- Выбранный candidate → `FIRST_PERSON_SPRITE_POSE`.
- Pixel-perfect vanilla matrix production switch.

## Next work

Локальный A/B/C выбор, затем один production pose write без per-item exceptions.

## Git

Ветка: `cursor/minecraft-item-pipeline-rework-935a` (HEAD `781da42`). **Не commit, не push, не merge `main`.**

Изменены (working tree):

- `src/rendering/heldItemQa.ts` — candidates, `qaPose`, `qaPoseCompare`
- `src/dev/ItemQaHarness.ts` — цикл representative items
- `src/main.ts` — `qaPoseCompare=1` без `qaItem`
- `src/items/itemRenderProfiles.ts` — комментарий; production pose без изменений
- `tests/item-rendering.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`
- `docs/reports/2026-08-21_held-item-shared-pose-calibration.md` (новый)

`GeneratedItemGeometry.ts` не в diff.
