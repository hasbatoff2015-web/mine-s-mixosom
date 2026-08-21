# Minecraft first-person transform reconstruction (audit)

Дата: 2026-08-21  
Ветка: `cursor/minecraft-item-pipeline-rework-935a`

## Goal

Восстановить математически vanilla idle first-person right-hand pipeline (без walking bob / swing / eat / use) и сравнить его с текущей Three.js цепочкой. Не подбирать `heldX/heldY/heldScale/pitch/yaw/roll` на глаз. `GeneratedItemGeometry` не менять. Production pose не переключать, пока conversion не доказан projected coordinates против Minecraft screenshot.

## Result

Adapter и QA overlay есть. Production transform **не** заменён. Главный visual mismatch — **ориентация** (текущий pose face-on, vanilla edge-on после `Ry(−90°)`), а не viewmodel FOV. Viewmodel уже 70°, как vanilla hand pass.

## Current Three.js transform chain

Иерархия `FirstPersonRenderer` (камера не двигается; look −Z, Y-up):

```text
PerspectiveCamera fov=70  near=0.01  far=12  aspect=canvasW/canvasH
  scene
    root            Group   — walk bob / swing / residual idle bob
      armPivot      Group   — empty-hand arm only; hidden when an item is held
      itemHolder    Group   — identity forever
        item model  Group   — applyItemViewTransform (production pose or held* QA)
          generated mesh    — identity; geometry already centered
      offhandHolder Group   — shield only
```

Порядок на каждом `Object3D`: Three.js `matrix = T * R * S`, `R` из `Euler(pitch, yaw, roll, 'XYZ')` через `object.rotation.set`. `applyItemViewTransform` пишет position/rotation/scale каждый кадр с неизменяемого preset (нет drift).

Idle (`movementSpeed=0`, swing complete, equip=1), **без** QA freeze:

| Node | position | Euler XYZ | scale |
| --- | --- | --- | --- |
| camera | `(0,0,0)` | `(0,0,0)` | `1` |
| root | `(0, sin(t·1.35)·0.004, 0)` | `(0,0,0)` | `1` |
| itemHolder | `(0,0,0)` | `(0,0,0)` | `1` |
| item model | `(0.50, -0.56, -0.82)` затем `y -= (1-equip)·0.22` | `(0, 0, 14°)` | `0.85` uniform |
| generated mesh | `(0,0,0)` | `(0,0,0)` | `1` |

`qaView=held&pose=idle` ставит `freezeIdleMotion`, поэтому root = I и equip = 1. Тогда **item world = item local = modelView** (camera I):

```text
T(0.50, -0.56, -0.82) * Rz(14°) * S(0.85)

[ 0.82475 -0.20563  0.00000  0.50000]
[ 0.20563  0.82475  0.00000 -0.56000]
[ 0.00000  0.00000  0.85000 -0.82000]
[ 0.00000  0.00000  0.00000  1.00000]
```

Projection: symmetric perspective, vertical FOV 70°, **не** world settings FOV. World camera default 75° + sprint/bow живёт в другом pass и не масштабирует предмет.

`heldScale/heldX/heldY/heldZ/heldRoll/heldPitch/heldYaw` остаются QA-only override этого pose. Они **не** участвуют в новом production solution.

## Vanilla transform chain

Правая рука, idle, Java 1.9 `ItemRenderer` (swing=0, equipProgress=0). `item/generated` и `item/handheld` делят один `firstperson_righthand` JSON:

```text
rotation    [0, -90, 25]     degrees
translation [1.13, 3.2, 1.13] model pixels  →  × 1/16 blocks
scale       [0.68, 0.68, 0.68]
```

Порядок GL (каждый вызов right-multiply):

```text
1. transformSideFirstPerson RIGHT, equip=0
     T_hand(0.56, -0.52, -0.72)
2. transformFirstPerson RIGHT, swing=0
     Ry(+45°) * Ry(−45°) = I     ← опущено
3. ItemTransform.apply (right hand)
     T_disp(1.13/16, 3.2/16, 1.13/16)
     * Rx(0) * Ry(−90°) * Rz(25°)
     * S(0.68)
4. renderItem baked-model centering
     T(−0.5, −0.5, −0.5)         ← НЕ применять к GeneratedItemGeometry
```

Наша геометрия уже в `X,Y ∈ [−0.5, 0.5]`, `Z ∈ ±0.03125` — это vanilla **после** шага 4. Повторный `T(−0.5)` сдвинул бы pivot.

Итоговая camera-space матрица (centering omitted):

```text
M = T_hand * T_disp * Ry(−90°) * Rz(25°) * S(0.68)

[ 0.00000 -0.00000 -0.68000  0.63062]
[ 0.28738  0.61629  0.00000 -0.32000]
[ 0.61629 -0.28738  0.00000 -0.64938]
[ 0.00000  0.00000  0.00000  1.00000]
```

Origin → `(0.630625, −0.320, −0.649375)`. Front `+Z` → camera `−X` (ребро к камере, не «лицом»).

1.8 имел дополнительный `S(0.4)` и `Ry(45°)` в hand transform; в 1.9 scale целиком в JSON, а idle `transformFirstPerson` взаимно уничтожается. Reference проекта — 1.9.

## Coordinate-system differences

Minecraft item/first-person и Three.js viewmodel:

- оба right-handed, Y-up, камера смотрит −Z;
- generated SOUTH front = +Z в обоих;
- **basis conversion = I**. Не менять оси и не отбрасывать `Ry(−90°)` как «перевод в Three.js».

Предыдущий комментарий в `itemRenderProfiles` («Y=−90 только basis conversion, поэтому pitch/yaw=0») был неверен. `Ry(−90°)` — часть display transform: после него спрайт лежит в camera YZ (front смотрит в −X). Текущий production pose с yaw=0 / roll=14 — face-on художественная калибровка.

Three.js `Euler(..., 'XYZ')` для тройки `[0, −90, 25]` **совпадает** с 1.9 `Rx*Ry*Rz`. Это совпадение, не API. Minecraft 1.16 `qz*qy*qx = Rz*Ry*Rx` уже даёт другой `+X`. Adapter всегда собирает матрицу явно.

Centering: vanilla baked model занимает `[0,1]`; наш mesh уже centered. Cube block items тоже centered (`corner − 0.5`).

## FOV / projection comparison

| Pass | Vanilla 1.9 | Frontier Cubes |
| --- | --- | --- |
| Hand / viewmodel FOV | **70°** vertical (`getFOVModifier(partial, false)`), settings FOV не используется | **70°** `FirstPersonRenderer.camera` |
| World FOV | settings, default 70°, sprint/bow modifiers | settings `60–100`, default **75°**, sprint +7°, bow до −8° |
| Hand near | 0.05 | 0.01 |
| Hand far | `renderDistance*16*2` | 12 |
| Projection | `gluPerspective` vertical FOV | Three.js `PerspectiveCamera` vertical FOV |
| Aspect | width/height | width/height |

Near/far не меняют on-screen size, только precision глубины.

Reference screenshot ~2048×1152 → aspect `1.77778`. При том же aspect и FOV 70° origin:

| Pose | camera origin | screen01 (top-left) |
| --- | --- | --- |
| Current production | `(0.50, −0.56, −0.82)` | `(0.7449, 0.9877)` почти нижний край |
| Proposed vanilla | `(0.6306, −0.32, −0.6494)` | `(0.8901, 0.8519)` правее и выше |

Если бы item pass был 75° вместо 70°, `|ndc|` origin current pose сжался бы ~9% (`1.091 → 0.996`). **Наш viewmodel уже 70°**, значит расхождение размера/позиции с настоящим Minecraft first-person screenshot **нельзя** чинить scale/position hacks «под FOV». World-FOV 75 vs 70 меняет только фон полного кадра.

Не компенсировать FOV через `heldScale`.

Главный mismatch: production показывает **лицо** спрайта камере; vanilla показывает **ребро** (`Ry(−90°)`), а ширина на экране — перспектива вдоль camera Z. Front-corners делят camera X; screen-X всё равно расходится из-за perspective divide.

## Exact conversion proposal

Один adapter: `src/rendering/heldItemVanillaTransform.ts`.

```text
minecraftItemTransformToMatrix4(JSON)
  = T(translationPx / 16) * Rx * Ry * Rz * S

minecraftRotationDegToQuaternion(deg)
  = quat(Rx * Ry * Rz)     // не Object3D.rotation.set

composeVanillaIdleFirstPersonRightHand()
  = T(0.56, -0.52, -0.72) * displayMatrix
    [* T(-0.5) only if the mesh is still [0,1] baked]
```

Запись на Three.js item root (когда conversion будет доказан): `matrix.decompose(position, quaternion, scale)` → `object.matrixAutoUpdate` TRS. Не шесть независимых Euler knobs.

Generated и handheld idle FP используют **один** semantic transform (как JSON).

## Expected production transform

Пока **не** применять. Кандидат без per-item tweaks:

```text
item.matrix = composeVanillaIdleFirstPersonRightHand()
root / itemHolder / mesh = I
camera fov = 70  (уже так)
```

Не делать: «sword looks low → +X 0.05», «pickaxe too vertical → roll −4». Сравнение — projected `screen01` тех же пяти точек на screenshot 2048×1152 (или том же aspect) при FOV 70°.

`held*` knobs остаются QA, чтобы измерить текущий pose, не чтобы строить новый.

## QA instrumentation

`?qaItem=iron_pickaxe&qaView=held&pose=idle`

Overlay (и `captureHeldItemMatrixDebug`):

- camera type / vertical FOV / aspect / near / far;
- item local, item world, modelView (column-vector 4×4);
- proposed vanilla idle RH matrix (**не** applied);
- reference points: origin, topLeft, topRight, bottomLeft, bottomRight;
- для каждой: local, camera-space, NDC, `screen01 = [(ndcX+1)/2, (1−ndcY)/2]` (как screenshot, origin top-left).

`pose=idle` замораживает residual `sin` bob ±0.004, иначе world matrix дрожит каждый кадр.

Точки вне NDC `[-1,1]` нормальны: у vanilla низ рукояти уходит под низ экрана (`bottomRight screen01 y > 1`).

## Geometry confirmation

`src/rendering/GeneratedItemGeometry.ts` **не менялся**.

- Source djb2 lock: `be428190` (any edit of `GeneratedItemGeometry.ts`, including comments)
- plus-mask(8) topology fingerprint: 56 verts / 28 tris / 12 spans; pos/nrm/uv/idx FNV hashes в `tests/held-item-vanilla-transform.test.ts`

Не трогались: topology, span algorithm, UV, winding, depth, materials.

## Implemented

- Canonical Minecraft→Three.js matrix/quaternion adapter, не подключён к `applyItemViewTransform`.
- Held matrix overlay + freeze idle bob in QA.
- Исправлена документация: `Ry(−90°)` не basis conversion.
- Production `FIRST_PERSON_SPRITE_POSE` без изменений.

## Changed files

- `src/rendering/heldItemVanillaTransform.ts` (new)
- `src/rendering/FirstPersonRenderer.ts`
- `src/dev/ItemQaHarness.ts`
- `src/items/itemRenderProfiles.ts` (comment only)
- `tests/held-item-vanilla-transform.test.ts` (new)
- `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/TESTING.md`, `docs/MINECRAFT_1_9_REFERENCE.md`
- `docs/reports/2026-08-21_held-item-vanilla-transform-audit.md`

Не менялся: `src/rendering/GeneratedItemGeometry.ts`.

## Architecture decisions

- Матрицы, не artistic Euler. Production switch только после совпадения projected points со screenshot.
- Centering не дублировать.
- Viewmodel FOV оставить 70°; не масштабировать предмет под world FOV.
- `held*` не удалять, но не использовать как источник нового pose.

## Tests

`tests/held-item-vanilla-transform.test.ts`: JSON 1/16, `Rx*Ry*Rz` vs later `Rz*Ry*Rx`, centering omit, production pose lock, projected origins at 70°/16:9, live renderer snapshot equals production matrix and not vanilla.

`npm run check`: typecheck PASS, 22 files / 143 tests PASS, Vite 74 modules, 0.93 MiB / 165 files. Main JS 729.55 kB / 196.63 kB gzip.

## Visual QA

Локально открыть `?qaItem=iron_pickaxe&qaView=held&pose=idle` и снять overlay `screen01` против Minecraft screenshot того же aspect. Это следующий proof step, не часть этого change.

## Performance

Только QA overlay string + несколько Matrix4 clone на held QA frame. Production mesh path не затронут.

## Known issues

- Production pose всё ещё face-on calibration.
- Vanilla proposed corners часто вне экрана — так устроен 1.9 held item, не баг projection.
- Overlay не выравнивает screenshot автоматически; нужны ручные `screen01` числа с reference кадра.

## Deferred

- Production switch на `composeVanillaIdleFirstPersonRightHand`.
- Screenshot-driven numeric match (pixel или `screen01` из reference).
- Left-hand / third-person / GUI / ground adapters.
- Swing/eat/bow use-animation reconstruction.

## Next work

1. Снять `screen01` с Minecraft 2048×1152 iron_pickaxe idle FP (FOV hand 70).
2. Сравнить с overlay `PROPOSED vanilla`.
3. Если точки совпадают — decompose matrix в production TRS одним adapter call.
4. Если нет — искать пропущенный vanilla шаг (arm-only vs item, 1.8 leftover, left-hand flag), **не** крутить шесть knobs.

## Git

Feature branch `cursor/minecraft-item-pipeline-rework-935a`. Production pose и `GeneratedItemGeometry` не менялись.
