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
| Legs | `(-2,19,1)`, `(1,19,1)` | logical `(-1,0,-3); 3×5×3; **26,0**`, physical shin `1×5×1` | Legacy pivot/layout; pack face-UV adaptation |

This pack's physical `128×64` (`64×32` logical) `entity/chicken` sheet leaves most of the vanilla `[26,0]` cuboid-cross island transparent. The authored yellow foot is logical `32,0..35,3`; the only opaque shin column is `36,3..37,8`. `faceUvRects` deliberately reuses those pixels on all six faces, while `physicalSize=[1,5,1]` prevents a three-column painted quad from looking like extra legs. The rig still contains exactly two parts, their hip pivots and grounded Y remain unchanged, the left is mirrored, and gait signs stay `[+1,-1]`.
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
| Ranged arm pose | bow arm `(1.35,-0.10,-0.08)`, draw arm `(1.10,0.55,0.15)` | Bounded alpha ranged pose |

Skeleton torso alone renders `DoubleSide`, so thin ribs/spine remain readable from front and rear. One shared-factory bow item visual is created with the mob, attached below the right-arm pivot through a hand anchor, and reused for its lifetime; the anchor cancels arm-X rotation so the bow stays readable while the two arms form distinct bow/draw poses. Zombie and other ordinary cuboids remain `FrontSide`; this is a targeted rendering approximation, not a global material change.

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

## Wolf

Logical texture `64×32`. Physical runtime sheets are `128×64` (`entity/wolf/wolf`, `wolf_angry`, `wolf_tame`, `wolf_collar`). Gameplay kind is `wolf`; appearance is state-driven, not extra kinds.

| Part | Pivot | Boxes (`origin; size; UV`) | Статус |
|---|---|---|---|
| Head | `(-1,13.5,-7)` | main `(-3,-3,-2); 6×6×4; 0,0`; ears `(-3,-5,0)` / `(1,-5,0); 2×2×1; 16,14`; muzzle `(-1.5,0,-5); 3×3×4; 0,10` | Legacy match |
| Body | `(0,14,2)`, `rx=π/2` | `(-4,-2,-3); 6×9×6; 18,14`; this pack remaps empty top `(24,14)` → painted `(30,14)` | Legacy match + local UV |
| Mane | `(-1,14,-3)`, `rx=π/2` | `(-4,-3,-3); 8×6×7; 21,0` | Standing neck Z matches sitting `(-1,16,-3)` |
| Legs 1–4 | `(-2.5,16,7)`, `(0.5,16,7)`, `(-2.5,16,-4)`, `(0.5,16,-4)` | `(-1,0,-1); 2×8×2; 0,18` | Legacy match |
| Tail | `(-1,12,8)` | `(-1,0,-1); 2×8×2; 9,18` | Legacy match |

Sitting pose uses the same legacy-to-Three adapter (`legacyRotationToThree`, Y reflection). Absolute sitting pivots: mane `(-1,16,-3)` `rx=2π/5`; body `(0,18,0)` `rx=π/4`; tail `(-1,21,6)`; rear legs `y=22` `rx=3π/2`; front legs `rx=5.811947`. **Legacy match** for coordinates; conversion is the project contract.

Walk: diagonal quadruped gait `[+,-,-,+]` plus a small tail wag. **Alpha approximation**. Sitting zeroes walk phase. Collar overlay (`wolf_collar`, inflate, `petLayer=collar`) is visible only when `ownerId` is set. Wild angry uses `wolf_angry`; tamed uses `wolf_tame`.

## Cat

Logical texture `64×32`. Physical sheets `128×64`. Gameplay kind is `cat` with `variant=black|red|siamese`. `ocelot.png` is an unused reference asset; ocelot is not a spawn kind.

Geometry is legacy `ModelOcelot`.

| Part | Pivot | Boxes | Статус |
|---|---|---|---|
| Head | `(0,15,-9)` | main `(-2.5,-2,-3); 5×4×5; 0,0`; nose `(-1.5,0,-4); 3×2×2; 0,24`; ears `(-2,-3,0)` UV `0,10` and `(1,-3,0)` UV `6,10` | Legacy match |
| Body | `(0,12,-10)`, `rx=π/2` | `(-2,3,-8); 4×16×6; 20,0` | Legacy match |
| Tail1 | `(0,15,8)`, `rx=0.9` | `(-0.5,0,0); 1×8×1; 0,15` | Legacy match |
| Tail2 | `(0,20,14)`, standing `rx=0.9` (vanilla `setRotationAngles` copies tail1) | `(-0.5,0,0); 1×8×1; 4,15` | Legacy match for pivot/box; standing `rx` from animation contract |
| Back legs | `(1.1,18,5)`, `(-1.1,18,5)` | `(-1,0,1); 2×6×2; 8,13` | Legacy match |
| Front legs | `(1.2,13.8,-5)`, `(-1.2,13.8,-5)` | `(-1,0,0); 2×10×2; 40,0` | Legacy match |

Sitting offsets from the standing baseline (legacy): body `Y-4, Z+5`, `rx=π/4`; head `Y-3.3, Z+1`; tail1 `Y+8, Z-2`, `rx=1.7278761`; tail2 `Y+2, Z-0.8`, `rx=2.670354`; front legs `y=15.8, z=-7`, `rx=-0.157`; back legs `y=21, z=1`, `rx=+π/2` (legacy; the adapter reflects X). Converted through the project adapter each frame from base transforms — no accumulated offsets. Walk uses separate front/back legs, `legacyRotationToThree` for swing, and a light tail motion. **Alpha approximation**.

## Animation contract

- Every animated part stores `baseRotationX/Y/Z` once and each frame computes `base + offset`; angles never accumulate.
- Quadrupeds use diagonal signs `[+,-,-,+]`; chicken and bipeds use opposing left/right signs.
- Chicken wing flap, spider eight-leg phase offsets, zombie forward arms (`+1.2` Three.js Euler, not Minecraft `-1.2`) and skeleton ranged pose are bounded alpha approximations. Zombie left limbs use mirrored classic `64×32` UV slots, not empty 64×64 player overlay slots.
- Soft entity separation is horizontal steering, not a rigid-body solver. Pair checks are capped at `1024` per update and population caps keep the pass bounded.

## Sources and limitations

- Forge 1.9.4 JavaDocs expose the relevant legacy model class API and fields: [ModelBiped](https://skmedix.github.io/ForgeJavaDocs/javadoc/forge/1.9.4-12.17.0.2051/net/minecraft/client/model/ModelBiped.html) and [JavaDocs index](https://skmedix.github.io/ForgeJavaDocs/).
- Public historical source mirrors were used to cross-check cuboid/pivot constants for `ModelCow`, `ModelPig`, `ModelQuadruped`, `ModelChicken`, `ModelCreeper`, `ModelSpider` and the sheep layers.
- This project does not claim decompiled Mojang source provenance. Anything not independently confirmed for the exact 1.9 class is explicitly marked **Cross-version approximation** or **Alpha approximation**.
