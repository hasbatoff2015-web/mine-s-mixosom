# Minecraft Java 1.9 mob model reference

Этот файл фиксирует числа, использованные в alpha, и отделяет проверенные legacy-константы от осознанных приближений. Все координаты ниже заданы в model units (`16 units = 1 block`), углы — в радианах. Реализация находится в `src/entities/mobModels.ts`, преобразование координат — в `src/entities/LegacyModel.ts`.

## Статусы точности

- **Legacy match** — размер cuboid, `addBox` origin, pivot или базовый угол соответствует публичному legacy Java model layout, применимому к ветке 1.9.
- **Cross-version approximation** — значение устойчиво в близких legacy-версиях, но не объявляется побитово подтверждённым именно для 1.9.
- **Alpha approximation** — игровой pose/animation или визуальное решение проекта; это не обещание точного vanilla renderer behavior.

## Model-space adapter

| Параметр | Значение | Статус |
|---|---:|---|
| Units per block | `16` | Project contract |
| Default ground plane | legacy `Y=24` → world `Y=0` | Project contract |
| Pivot mapping | `(x, y, z) → (x/16, (24-y)/16, z/16)` | Exact coordinate conversion |
| Local box center | `(ox+sx/2, -(oy+sy/2), oz+sz/2) / 16` | Exact coordinate conversion |
| Euler mapping after Y reflection | `(rx, ry, rz) → (-rx, ry, -rz)` | Exact coordinate conversion |

`rotationPoint` и `addBox origin` принципиально не складываются как две мировые позиции: pivot становится transform node, а origin остаётся локальной геометрией внутри него. Именно смешение этих пространств было причиной неверных пропорций и вращения конечностей вокруг центра cuboid.

## Cow

| Part | Pivot | Boxes (`origin; size; UV`) | Статус |
|---|---|---|---|
| Head | `(0,4,-8)` | `(-4,-4,-6); 8×8×6; 0,0` | Legacy match |
| Horns | head | `(-5,-5,-4)` и `(4,-5,-4); 1×3×1; 22,0` | Legacy match |
| Body | `(0,5,2)`, `rx=π/2` | `(-6,-10,-7); 12×18×10; 18,4` | Legacy match |
| Udder | body | `(-2,2,-8); 4×6×1; 52,0` | Legacy match |
| Legs 1–4 | `(-4,12,7)`, `(4,12,7)`, `(-4,12,-6)`, `(4,12,-6)` | `(-2,0,-2); 4×12×4; 0,16` | Legacy match |

## Pig

| Part | Pivot | Boxes | Статус |
|---|---|---|---|
| Head | `(0,12,-6)` | `(-4,-4,-8); 8×8×8; 0,0` | Legacy match |
| Snout | head | `(-2,0,-9); 4×3×1; 16,16` | Legacy match |
| Body | `(0,11,2)`, `rx=π/2` | `(-5,-10,-7); 10×16×8; 28,8` | Legacy match |
| Legs 1–4 | `(-3,18,7)`, `(3,18,7)`, `(-3,18,-5)`, `(3,18,-5)` | `(-2,0,-2); 4×6×4; 0,16` | Legacy match |

## Sheep

Base skin и fleece — две отдельные definitions, которые делят имена/pivots articulated parts.

| Layer/part | Pivot | Boxes | Статус |
|---|---|---|---|
| Base head | `(0,6,-8)` | `(-3,-4,-6); 6×6×8; 0,0` | Cross-version approximation |
| Base body | `(0,5,2)`, `rx=π/2` | `(-4,-10,-7); 8×16×6; 28,8` | Legacy match |
| Base legs | `±3,12,7/-5` | `(-2,0,-2); 4×12×4; 0,16` | Alpha visual correction: skin legs reach ground below fleece |
| Wool head | same head pivot | `(-3,-4,-4); 6×6×6`, inflate `0.6` | Cross-version approximation |
| Wool body | same body pivot | `8×16×6`, inflate `1.75` | Legacy match |
| Wool legs | same leg pivots | `4×6×4`, inflate `0.5` | Cross-version approximation |

## Chicken

| Part | Pivot | Boxes | Статус |
|---|---|---|---|
| Head/beak/wattle | `(0,15,-4)` | `4×6×3 @ 0,0`; `4×2×2 @ 14,0`; `2×2×2 @ 14,4` | Legacy match |
| Body | `(0,16,0)`, `rx=π/2` | `(-3,-4,-3); 6×8×6; 0,9` | Legacy match |
| Legs | `(-2,19,1)`, `(1,19,1)` | `(-1,0,-3); 3×5×3; 26,0` | Legacy match |
| Wings | `(-4,13,0)`, `(4,13,0)` | `1×4×6; 24,13` | Legacy match |

## Zombie

| Part | Pivot | Boxes | Статус |
|---|---|---|---|
| Head + outer layer | `(0,0,0)` | `8×8×8 @ 0,0`; same inflate `0.5 @ 32,0` | Cross-version approximation |
| Torso | `(0,0,0)` | `(-4,0,-2); 8×12×4; 16,16` | Legacy match |
| Arms | `(-5,2,0)`, `(5,2,0)` | `4×12×4`; left mirrored classic UV `[40,16]` | Legacy match |
| Legs | `(-1.9,12,0)`, `(1.9,12,0)` | `4×12×4`; left mirrored classic UV `[0,16]` | Legacy match |
| Forward arm pose | idle `+1.2`, attack `+1.55` plus small walk offset in Three.js Euler | Alpha approximation |

Zombie cuboid dimensions and pivots were retained. The missing-leg/backward-arm regression came from 64×64 player overlay UVs and applying Minecraft `-1.2` directly to Three.js; both were corrected without guessed mesh offsets. Headwear still uses local `alphaTest=0.45`.

## Skeleton

| Part | Pivot | Boxes | Статус |
|---|---|---|---|
| Head/torso | biped pivots | `8×8×8`; `8×12×4` | Legacy match |
| Arms | `(-5,2,0)`, `(5,2,0)` | `(-1,-2,-1); 2×12×2; 40,16` | Legacy match |
| Legs | `(-2,12,0)`, `(2,12,0)` | `(-1,0,-1); 2×12×2` | Legacy match |
| Ranged arm pose | attack `rx=-1.15` | Alpha approximation; not full vanilla bow pose |

Skeleton torso alone renders `DoubleSide`, so thin ribs/spine remain readable from front and rear. Zombie and other ordinary cuboids remain `FrontSide`; this is a targeted rendering approximation, not a global material change.

## Creeper

| Part | Pivot | Boxes | Статус |
|---|---|---|---|
| Head | `(0,6,0)` | `(-4,-8,-4); 8×8×8; 0,0` | Legacy match |
| Body | `(0,6,0)` | `(-4,0,-2); 8×12×4; 16,16` | Legacy match |
| Legs | `(-2,18,4)`, `(2,18,4)`, `(-2,18,-4)`, `(2,18,-4)` | `4×6×4; 0,16` | Legacy match |
| Fuse pulse/scale | project state animation | Alpha approximation |

## Spider

| Part | Pivot | Boxes/angles | Статус |
|---|---|---|---|
| Head | `(0,15,-3)` | `(-4,-4,-8); 8×8×8; 32,4` | Legacy match |
| Neck | `(0,15,0)` | `6×6×6; 0,0` | Legacy match |
| Abdomen | `(0,15,9)` | `(-5,-4,-6); 10×8×12; 0,12` | Legacy match |
| Leg pivots | alternating `x=-4/+4`, `y=15`, `z=2,1,0,-1` | eight `16×2×2` boxes | Legacy match |
| Outer base Y angles | `±π/4`; inner pairs `±π/8` | alternating signs | Legacy match |
| Base Z angles | outer `±π/4`; inner `±0.74·π/4` | alternating signs | Legacy match |
| Eye glow overlay | same head box, inflate `0.1` | Alpha rendering approximation |

## Animation contract

- Every animated part stores `baseRotationX/Y/Z` once and each frame computes `base + offset`; angles never accumulate.
- Quadrupeds use diagonal signs `[+,-,-,+]`; chicken and bipeds use opposing left/right signs.
- Chicken wing flap, spider eight-leg phase offsets, zombie forward arms (`+1.2` Three.js Euler, not Minecraft `-1.2`) and skeleton ranged pose are bounded alpha approximations. Zombie left limbs use mirrored classic `64×32` UV slots, not empty 64×64 player overlay slots.
- Soft entity separation is horizontal steering, not a rigid-body solver. Pair checks are capped at `1024` per update and population caps keep the pass bounded.

## Sources and limitations

- Forge 1.9.4 JavaDocs expose the relevant legacy model class API and fields: [ModelBiped](https://skmedix.github.io/ForgeJavaDocs/javadoc/forge/1.9.4-12.17.0.2051/net/minecraft/client/model/ModelBiped.html) and [JavaDocs index](https://skmedix.github.io/ForgeJavaDocs/).
- Public historical source mirrors were used to cross-check cuboid/pivot constants for `ModelCow`, `ModelPig`, `ModelQuadruped`, `ModelChicken`, `ModelCreeper`, `ModelSpider` and the sheep layers.
- This project does not claim decompiled Mojang source provenance. Anything not independently confirmed for the exact 1.9 class is explicitly marked **Cross-version approximation** or **Alpha approximation**.
