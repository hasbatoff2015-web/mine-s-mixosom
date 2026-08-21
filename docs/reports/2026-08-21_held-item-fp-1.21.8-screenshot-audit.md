# Held-item F2 1.21.8 screenshot audit

Дата: 2026-08-21  
Ветка: `cursor/minecraft-item-pipeline-rework-935a`

## Goal

Закрыть несостыковки предыдущего transform audit **доказательно**, не включая proposed vanilla matrix в production:

1. Почему reconstruction даёт `front → camera −X` (`front·look ≈ 0`), а F2 screenshot показывает большую лицевую texture.
2. Сравнить idle first-person right-hand цепочки Java **1.9** и Java **1.21.8** (visual reference — 1.21.8; gameplay reference проекта остаётся 1.9).
3. Показать реальные basis vectors, не предполагать `I`.
4. Спроецировать opaque silhouette landmarks `iron_pickaxe` (не AABB) на screen01 и сравнить с чистым F2 2048×1152.
5. FOV sensitivity 60/70/75/80 без смены production FOV.

`GeneratedItemGeometry`, production pose и `held*` knobs не менялись.

## Result

- «Edge-on» в прошлом audit — **ошибка интерпретации метрики**, не ошибка матрицы. `front·look(-Z) ≈ 0` значит «плоскость перпендикулярна оси взгляда», а не «лицо не видно». Предмет сидит **справа** от камеры; `front·toCamera ≈ 0.657` (grazing ≈ 49°), лицевая SOUTH texture занимает большую площадь. Это совпадает с F2: большая front face, толщина слева и сверху.
- Idle right-hand **1.9 и 1.21.8 дают одну и ту же camera-space matrix** (JSON display SAME, hand translation SAME, swing=0 SAME, JOML `rotationXYZ` == GL `Rx*Ry*Rz` для `[0,-90,25]`). Одна candidate matrix, не две.
- Hand/viewmodel FOV **70** подтверждён для 1.21.8 API + constants + пользовательским тестом FOV 70 vs 97 (мир менялся, кирка нет). World FOV setting **не** параметр подгонки held item. Production FOV не меняли.
- Silhouette landmarks vs F2: **X у on-screen точек близко** (left tip Δx ≈ 0.001), есть **систематический сдвиг вниз** (left tip Δy ≈ 0.061 ≈ 70 px). Это не pixel-perfect. Matrix **не** применена в production.
- Authoritative screenshot: F2 Java 1.21.8, 2048×1152, без window chrome. Старый кадр с title bar/taskbar больше не используется.

## Why current matrix looked edge-on

Прошлая проверка смотрела только `front · look`, где `look = (0,0,−1)`.

После `Ry(−90°)` generated front `+Z` становится camera `−X`:

```text
front_camera = (−1, 0, 0)
front · look = 0
```

Это **перпендикулярность к оси взгляда**, не «ребро к камере так, что лица не видно».

Камера в origin смотрит −Z. Origin предмета ≈ `(0.631, −0.32, −0.649)` — **справа**. Вектор на камеру `normalize(−origin) ≈ (−0.657, 0.333, 0.676)`.

```text
front · toCamera ≈ 0.657
grazing ≈ 48.9°
```

Аналогия: картина на стене справа. Её нормаль почти вдоль −X (к центру кадра), почти ортогональна взгляду вперёд, но картина всё равно заполняет кадр.

Perspective по camera Z даёт ширину на экране, хотя все front-corners делят camera X (плоскость YZ). F2 это подтверждает: большая лицевая площадь + extrusion на **левой и верхней** кромке (правая/нижняя скрыты).

Неверная метрика: `front·look`. Верная для видимости лица: `front·toCamera` (и сами projected silhouette points).

Полная перепроверка цепочки (ни один пункт не переворачивает front в +Z к камере):

| Шаг | Результат |
| --- | --- |
| Generated basis | SOUTH front `+Z`, NORTH back `−Z`; X right, Y up. Three.js mesh: front `+halfDepth`, normal `(0,0,1)`. SAME |
| Bake / centering | Vanilla baked `[0,1]` затем `T(−0.5)`. Наш mesh уже centered. Translation не меняет оси. SAME axes |
| `firstperson_righthand` | `T(1.13,3.2,1.13)/16 * Rx(0)*Ry(−90)*Rz(25)*S(0.68)` |
| Hand offset | `T(0.56, −0.52, −0.72)` (1.21.8 yarn `EQUIP_OFFSET_TRANSLATE_*`) |
| Swing=0 | `Ry(+45)*Ry(−45)=I` |
| Multiply order | column-major, column vectors, right-multiply = GL / PoseStack. `T*R*S` |
| JOML vs GL | `Quaternionf.rotationXYZ` == `Rx*Ry*Rz` для этой тройки |
| Camera / view | viewmodel I, look −Z, Y-up, right-handed. Нет extra pre/post rotation на idle item path |
| Handedness / signs | не требуется axis swap; `Ry(−90)` — display, не «конвертация в Three.js» |

Production pose с yaw=0 по-прежнему face-on (`front = +Z`, `front·look = −1`). Это художественная калибровка, не vanilla.

## Minecraft 1.9 chain

Правая рука, idle, swing=0, equipProgress=0 (`ItemRenderer`).

```text
1. transformSideFirstPerson RIGHT
     T(0.56, -0.52, -0.72)
2. transformFirstPerson RIGHT, swing=0
     Ry(+45°) * Ry(−45°) = I
3. ItemCameraTransforms / ItemTransform.apply  (item/generated = item/handheld FP RH)
     rotation    [0, -90, 25]
     translation [1.13, 3.2, 1.13] px  →  × 1/16
     scale       [0.68, 0.68, 0.68]
     GL: T * Rx * Ry * Rz * S
4. renderItem
     T(−0.5, −0.5, −0.5)   ← omit for GeneratedItemGeometry
5. Hand projection
     getFOVModifier(partial, false) → 70° vertical
     gluPerspective(70, aspect, 0.05, far)
```

`item/handheld` наследует тот же `firstperson_righthand`, что `item/generated`. `iron_pickaxe` parent `item/handheld`.

## Minecraft 1.21.8 chain

Visual reference пользователя: Java **1.21.8**. Assets (`misode/mcmeta` `1.21.8-assets`):

- `assets/minecraft/items/iron_pickaxe.json` → model `minecraft:item/iron_pickaxe`
- `models/item/iron_pickaxe.json` → parent `item/handheld`, `layer0` iron_pickaxe
- `models/item/handheld.json` `firstperson_righthand`: `[0,-90,25]` / `[1.13, 3.2, 1.13]` / `0.68` — **бит-в-бит как 1.9 generated/handheld**
- `models/item/generated.json` тот же FP RH display

Yarn 1.21.8 `HeldItemRenderer` constant-values:

```text
EQUIP_OFFSET_TRANSLATE_X = 0.56
EQUIP_OFFSET_TRANSLATE_Y = -0.52
EQUIP_OFFSET_TRANSLATE_Z = -0.72
```

`applyEquipOffset` at fully equipped (`equipProgress = 0`): `T(±0.56, -0.52, -0.72)`. SAME.

`applySwingOffset` / `swingArm` at swing=0: `Ry(+45)*Ry(−45)=I`. SAME.

`Transformation.apply` (yarn `net.minecraft.client.render.model.json.Transformation`): translate, then quaternion, then scale. 1.21 uses JOML `Quaternionf.rotationXYZ` (intrinsic XYZ). Для `[0,-90,25]` это совпадает с 1.9 `Rx*Ry*Rz` (доказано тестом `angleTo < 1e-6` и поэлементным равенством итоговых 4×4).

`GameRenderer.getFov(Camera, float, boolean changingFov)` всё ещё существует. `changingFov=false` исторически (1.8–1.21.4 Mojmap) начинает с **`70.0F` и не читает options FOV**. 1.21.8 добавил отдельный `hud3dProjectionMatrixBuffer` / `PROJECTION_3D_HUD_Z_FAR = 100` и `CAMERA_DEPTH = 0.05` (near). Пользовательский тест FOV setting 70 vs 97: world perspective менялся, **held iron_pickaxe — нет**. Если бы hand pass брал world FOV, линейный размер сдвинулся бы как `tan(97°/2)/tan(70°/2) ≈ 1.61` (~38%). Этого не было.

Итого 1.21.8 idle RH:

```text
T_hand(0.56, -0.52, -0.72)
  * T_disp(1.13, 3.2, 1.13)/16
  * rotationXYZ(0, −90°, 25°)
  * S(0.68)
  [* T(−0.5) only if baked [0,1]]
hand FOV 70, near 0.05
```

Матрица **численно равна** 1.9 compose (centering omitted).

## Differences

| Этап | 1.9 | 1.21.8 | |
| --- | --- | --- | --- |
| Generated model basis (SOUTH +Z, Y-up, RH) | item/generated bake | тот же ItemModelGenerator contract | **SAME** |
| `firstperson_righthand` JSON | `[0,-90,25]` / `[1.13,3.2,1.13]` / `0.68` | тот же JSON в generated + handheld | **SAME** |
| Hand translation | `0.56, -0.52, -0.72` | yarn EQUIP_OFFSET same floats | **SAME** |
| Attack/swing at swing=0 | `Ry+45 * Ry−45 = I` | `applySwingOffset` same identity | **SAME** |
| Equip at idle | equipProgress=0 → no extra −0.6 Y | same | **SAME** |
| Model transform apply | GL `T*Rx*Ry*Rz*S` | JOML `rotationXYZ` then scale; same 4×4 for this triple | **SAME result** |
| Camera / viewmodel FOV | `getFOVModifier(..., false)` → 70 | `getFov(..., false)` + separate HUD projection; settings FOV не двигает руку | **SAME 70** |
| Render matrix order | column vector, right-multiply | PoseStack / JOML column-major, right-multiply | **SAME** |
| Near | 0.05 | `CAMERA_DEPTH` 0.05 | **SAME** |
| Far / 3D HUD buffer | `renderDistance*16*2` | HUD far 100; **не влияет на screen size** | CHANGED (irrelevant to pose) |
| Item model assets layout | `models/item/*.json` | плюс `items/iron_pickaxe.json` wrapper, тот же block-model display | CHANGED packaging, **SAME display** |
| 1.15–1.19.2 quaternion `qz*qy*qx` | n/a | **не 1.21.8**; для этой задачи не смешивать | CHANGED in the middle, **restored by 1.21.8** |

Idle first-person right-hand **результат одинаковый**. Не смешивать с 1.15–1.19.2 и не делать вторую production matrix.

## Basis vectors

Локальные оси generated mesh / vanilla after centering:

```text
X = (1,0,0)  texture right
Y = (0,1,0)  texture up (PNG top)
Z = (0,0,1)  SOUTH front
```

| Stage | X | Y | Z / front | origin |
| --- | --- | --- | --- | --- |
| local generated | 1, 0, 0 | 0, 1, 0 | 0, 0, 1 | 0, 0, 0 |
| after bake centered | 1, 0, 0 | 0, 1, 0 | 0, 0, 1 | 0, 0, 0 |
| after FIRST_PERSON_RIGHT_HAND display | 0, 0.423, 0.906 | 0, 0.906, −0.423 | **−1, 0, 0** | 0.071, 0.200, 0.071 |
| after outer hand T | 0, 0.423, 0.906 | 0, 0.906, −0.423 | **−1, 0, 0** | 0.631, −0.320, −0.649 |
| camera space (view I) | same as after hand | same | **−1, 0, 0** | 0.631, −0.320, −0.649 |

Hand translation не крутит оси.

Three.js **production** idle (не vanilla), camera I:

| | X | Y | Z / front | origin |
| --- | --- | --- | --- | --- |
| production TRS | 0.970, 0.242, 0 | −0.242, 0.970, 0 | **0, 0, 1** | 0.50, −0.56, −0.82 |

Minecraft item/first-person eye space и Three.js viewmodel: оба Y-up, right-handed, look −Z, generated SOUTH = +Z. Таблица выше получена применением **той же** vanilla 4×4 в Three.js **без** axis swap. Если бы нужен был conversion ≠ I, `Ry(−90)` не дал бы front = −X. Conversion = I **доказан этими векторами**, не принят a priori.

`Ry(−90°)` — часть JSON display, не «перевод базиса в Three.js».

## Correct candidate matrices

1.9 и 1.21.8 **одна** matrix (centering omitted):

```text
T(0.56, -0.52, -0.72) * T(1.13, 3.2, 1.13)/16 * Ry(−90°) * Rz(25°) * S(0.68)

[ 0.00000 -0.00000 -0.68000  0.63062]
[ 0.28738  0.61629  0.00000 -0.32000]
[ 0.61629 -0.28738  0.00000 -0.64938]
[ 0.00000  0.00000  0.00000  1.00000]
```

Transformed unit axes (camera): X `(0, 0.423, 0.906)`, Y `(0, 0.906, −0.423)`, Z `(−1, 0, 0)`.

Front normal camera: `(−1, 0, 0)`. `front·toCamera ≈ 0.657`.

**Не применена** в production. `composeVanillaIdleFirstPersonRightHand` == `composeVanilla1218IdleFirstPersonRightHand`.

Текущий production (для сравнения, не candidate):

```text
T(0.50, -0.56, -0.82) * Rz(14°) * S(0.85)

[ 0.82475 -0.20563  0.00000  0.50000]
[ 0.20563  0.82475  0.00000 -0.56000]
[ 0.00000  0.00000  0.85000 -0.82000]
[ 0.00000  0.00000  0.00000  1.00000]
```

## Front normal

Почему Minecraft на F2 показывает front:

- SOUTH face остаётся «лицевой» texture после bake.
- Display `Ry(−90)` поворачивает эту нормаль в −X.
- Item стоит в +X; камера смотрит на него сбоку от look-axis.
- `front·toCamera > 0` → front не backface.
- Толщина 1/16 даёт видимые side faces на силуэте слева/сверху.

Production наоборот ставит front в +Z (вдоль взгляда), поэтому выглядит «плакатом».

## Landmark projection

Не AABB. Точки из opaque alpha `iron_pickaxe` 32×32 (PNG top-left = +Y, front Z = +1/32). Явные texel, не ручной fit под F2:

| name | texel | local xyz |
| --- | --- | --- |
| leftHeadTip | 10, 6 | −0.172, 0.297, 0.031 |
| topWoodCap | 27, 6 | 0.359, 0.297, 0.031 |
| headHandleJunction | 20, 13 | 0.141, 0.078, 0.031 |
| handleBottom | 5, 29 | −0.328, −0.422, 0.031 |
| rightMetal | 28, 22 | 0.391, −0.203, 0.031 |

F2 metadata (authoritative):

```text
version          Java 1.21.8
capture          F2 framebuffer, no chrome
framebuffer      2048 × 1152
aspect           16:9
player FOV set   70
hand FOV used    70  (not the settings slider)
item / pose      iron_pickaxe idle, swing 0, no use, no move
pixel read       ±12 px  (not subpixel)
```

Screen01 = `[(ndcX+1)/2, (1−ndcY)/2]`, origin top-left. F2 pixel → `px/2048, py/1152`.

Projection: viewmodel perspective **FOV 70**, aspect 2048/1152, near 0.01 (production; vanilla near 0.05 не меняет xy).

### Minecraft F2 visual-read vs predicted

| Landmark | F2 px | F2 screen01 | production screen01 | Δ prod | vanilla 1.9/1.21.8 screen01 | Δ van |
| --- | --- | --- | --- | --- | --- | --- |
| leftHeadTip | 1618, 688 | 0.7900, 0.5972 | 0.6505, 0.8154 | −0.140, +0.218 | 0.7912, 0.6584 | **+0.001, +0.061** |
| topWoodCap | 1965, 608 | 0.9595, 0.5278 | 0.8723, 0.7171 | −0.087, +0.189 | 0.9769, 0.5470 | +0.017, +0.019 |
| headHandleJunction | 1890, 690 | 0.9229, 0.5990 | 0.8037, 0.9200 | −0.119, +0.321 | 0.9183, 0.7824 | −0.005, +0.183 |
| handleBottom | 1740, 1152 | 0.8496, 1.0000 | 0.6600, 1.3778 | clipped | 0.8351, 1.1593 | X good; **below frame** |
| rightMetal | 2048, 765 | 1.0000, 0.6641 | 0.9374, 1.0825 | clipped | 1.1988, 1.1787 | **off +X and +Y** |

Vanilla camera xyz (FOV70), all share camera X ≈ 0.609 (front plane after Ry−90):

| name | camera xyz | NDC | screen01 |
| --- | --- | --- | --- |
| leftHeadTip | 0.609, −0.186, −0.841 | 0.582, −0.317, 0.978 | 0.7912, 0.6584 |
| topWoodCap | 0.609, −0.034, −0.513 | 0.954, −0.094, 0.963 | 0.9769, 0.5470 |
| headHandleJunction | 0.609, −0.231, −0.585 | 0.837, −0.565, 0.968 | 0.9183, 0.7824 |
| handleBottom | 0.609, −0.674, −0.730 | 0.670, −1.319, 0.974 | 0.8351, 1.1593 |
| rightMetal | 0.609, −0.333, −0.350 | 1.398, −1.357, 0.945 | 1.1988, 1.1787 |

Интерпретация, **не** pixel-perfect claim:

- leftHeadTip X почти совпал с F2; Y ниже на ~70 px. Больше uncertainty ±12 px.
- topWoodCap ближе всех (Δ ≈ 0.02).
- Junction X хорош; Y сильно ниже — либо texel «шея рукояти» не то же место, что visual junction на F2, либо тот же Y-bias, усиленный более низким local Y.
- handleBottom в vanilla **должен** уходить под низ кадра (`screen01 y > 1`). F2 точка на y=1152 — **clip edge**, не 3D конец рукояти.
- rightMetal геометрически — нижний правый зуб. Его проекция за правым и нижним краем. F2 (2048, 765) — **пересечение силуэта с правым краем кадра**, скорее правый край **головки**, не тот же 3D texel. Сравнивать clip pixel с off-screen landmark нельзя.

Vanilla суммарно ближе к F2, чем face-on production, но **Y systematic bias остаётся**. Следующий шаг — искать пропущенный vanilla translation/bob/near-UI, **не** крутить `held*`.

## FOV sensitivity

Production FOV **не меняли** (70). Только проекция той же vanilla matrix:

| FOV | leftHeadTip screen01 | topWoodCap screen01 |
| --- | --- | --- |
| 60 | 0.8531, 0.6921 | 1.0784, 0.5570 |
| **70** | **0.7912, 0.6584** | **0.9769, 0.5470** |
| 75 | 0.7657, 0.6445 | 0.9352, 0.5429 |
| 80 | 0.7430, 0.6322 | 0.8980, 0.5392 |

FOV 70→80 двигает left tip X на ~0.048. Пользовательский world FOV 70 vs 97 **не** дал такого сдвига кирки → hand pass не world FOV. Не компенсировать pose через FOV.

## Reference requirements

Для pixel/screen01 proof нужен **чистый F2** (или точный crop framebuffer) плюс metadata:

- framebuffer width / height (здесь 2048×1152)
- aspect (16:9)
- Minecraft version (здесь 1.21.8)
- player FOV **setting** (здесь 70) — для world pass
- явное подтверждение, что сравниваем **hand pass FOV 70**, не settings
- item id, idle, swing=0, no use, no movement
- без Windows title bar / taskbar

Кадр с chrome **запрещён** для numeric match. Этот F2 — authoritative. Uncertainty visual-read ±12 px; для subpixel нужны выделенные texel-markers или второй zoomed crop.

## Geometry

`src/rendering/GeneratedItemGeometry.ts` **не менялся**.

- Source djb2 lock: `be428190`
- plus-mask(8): 56 verts / 28 tris / 12 spans; pos/nrm/uv/idx FNV в `tests/held-item-vanilla-transform.test.ts`

## Tests

`tests/held-item-vanilla-transform.test.ts`: 1.9==1.21.8 matrix, JOML vs GL, facing `front·toCamera`, axis stages, silhouette texels, F2 screen01, FOV 60/70/75/80, overlay, geometry lock. `tests/item-rendering.test.ts` использует общий `ironPickaxeSilhouette`.

`npm run check`: typecheck PASS, 22 files / 150 tests PASS, Vite 75 modules, 0.94 MiB / 165 files. Main JS 735.81 kB / 198.86 kB gzip.

## Visual QA

`?qaItem=iron_pickaxe&qaView=held&pose=idle`

Overlay: production + proposed vanilla matrices, facing metrics, axis stages, silhouette local/camera/screen01, F2 comparison **через камеру 2048×1152 FOV70** (не live canvas aspect). Vanilla **не** applied. Residual idle bob заморожен.

## Performance

Только QA overlay. Production mesh path без изменений.

## Known issues

- Production всё ещё face-on calibration.
- Vanilla Y ниже F2 (~0.06 на left tip). Не закрыто.
- handleBottom / rightMetal: F2 pixels на краю кадра ≠ off-screen 3D landmarks.
- 1.21.8 `getFov` body не дизассемблирован из jar в этой среде; вывод 70° опирается на стабильный API `getFov(..., changingFov)`, yarn `CAMERA_DEPTH`, HUD projection split, 1.21.4 Mojmap `70.0F` when `useFovSetting=false`, и эмпирический 70 vs 97.

## Deferred

- Production switch на shared 1.9/1.21.8 matrix.
- Объяснение Y-bias (пропущенный шаг, не six knobs).
- Left-hand / third-person / GUI / ground.
- Swing/eat/bow reconstruction.

## Next work

1. Если Y-bias найдёт недостающий vanilla translate — добавить в adapter, снова спроецировать те же пять texel.
2. Если left/cap X уже в допуске и Y закрыт — **один** `decompose` shared matrix в production TRS.
3. Не подгонять Euler/`held*` и не менять FOV.

## Git

Feature branch `cursor/minecraft-item-pipeline-rework-935a`. Research/QA only. Production pose и `GeneratedItemGeometry` не менялись. Не merge в `main`.
