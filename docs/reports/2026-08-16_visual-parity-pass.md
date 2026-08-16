# Visual parity pass — 2026-08-16

## Итог

Проход закрыл три заметных визуальных архитектурных дефекта playable alpha без добавления нового gameplay content:

1. leaves больше не смешиваются с water/glass и не делают зелёные pixels полупрозрачными;
2. все восемь существующих мобов перешли с одноцветных box placeholders на локальные legacy entity UV sheets и articulated pivot rigs;
3. lever и очевидные тонкие redstone/utility blocks перестали рендериться как полные кубы.

World generation, combat formulas, inventory, drops, mob AI/hitboxes и Yandex lifecycle не менялись.

## Leaves: before / after

| До | После |
| --- | --- |
| `opaque:false` одновременно означал face visibility и blended material | `opaque`, `occludesFaces`, `renderLayer` и `renderShape` имеют независимые обязанности |
| leaves, water и glass попадали в одну transparent geometry | отдельные opaque, cutout, glass-translucent и water-translucent buffers/materials |
| глобальная opacity `0.76`, blending, `depthWrite:false` | leaves: `alphaTest=0.42`, `opacity=1`, `transparent=false`, `depthWrite=true`, `depthTest=true` |
| соседний ствол просвечивал сквозь окрашенный pixel | окрашенный pixel полностью закрывает фон; фон виден только через alpha hole |

Oak, birch и spruce leaves зарегистрированы как `cutout`. Biome tint остался RGB-множителем и не меняет alpha. Glass использует opacity `0.52`, water — `0.70` и отдельный render order.

## Подключённые entity sheets

Importer whitelist вырос со 140 до 150 runtime assets. Добавлены только следующие локальные файлы из пользовательского pack:

| Runtime path | Source sheet | Physical / logical size |
| --- | --- | --- |
| `entity/cow.png` | `entity/cow/cow.png` | `128×64` / `64×32` |
| `entity/pig.png` | `entity/pig/pig.png` | `128×64` / `64×32` |
| `entity/chicken.png` | `entity/chicken.png` | `128×64` / `64×32` |
| `entity/sheep.png` | `entity/sheep/sheep.png` | `128×64` / `64×32` |
| `entity/sheep_fur.png` | `entity/sheep/sheep_fur.png` | `128×64` / `64×32` |
| `entity/zombie.png` | `entity/zombie/zombie.png` | `128×128` / `64×64` |
| `entity/skeleton.png` | `entity/skeleton/skeleton.png` | `128×64` / `64×32` |
| `entity/creeper.png` | `entity/creeper/creeper.png` | `128×64` / `64×32` |
| `entity/spider.png` | `entity/spider/spider.png` | `128×64` / `64×32` |
| `entity/spider_eyes.png` | `entity/spider_eyes.png` | `128×64` / `64×32` |

Raw `assets/` остаётся локальным и игнорируется Git. В production не добавлены другие entity sheets, logos, panorama, paintings, Mojang patterns или сторонние namespaces.

## Модели восьми мобов

- Cow: body, head, horns/details, four pivot legs.
- Pig: body, head, snout, four pivot legs.
- Chicken: body, head, beak, wattle, wings, two legs.
- Sheep: base skin плюс inflated white `sheep_fur` overlay на body/head/legs.
- Zombie: humanoid head/torso, two arms, two legs; walking and forward combat arm pose.
- Skeleton: отдельные тонкие arms/legs и torso, а не перекрашенный zombie rig.
- Creeper: head/body/four opposing legs и сохранённый fuse pulse.
- Spider: head/thorax/abdomen/eight pivot legs плюс alpha-tested glow-style eyes overlay.

Quadruped/creeper legs продолжают двигаться противоположными парами. Zombie/skeleton limbs и spider legs анимируются на pivots. `MobDefinition` AABB и вся AI/gameplay simulation не зависят от visual hierarchy.

## Generic textured cuboid

`src/rendering/TexturedCuboid.ts` создаёт 24 независимые вершины и 6 face quads вместо одинаковой `BoxGeometry` UV-развёртки. Для каждого face вычисляется legacy cross-layout rectangle из:

```text
textureOffset + width + height + depth
```

Logical coordinates нормализуются через actual image scale, поэтому `64×32` layout одинаково адресует 1× sheet и физический `128×64` 2× sheet. Поддержаны `mirror`, physical size и `inflate` для overlays. Entity textures используют sRGB, nearest filtering, no mipmaps и shared cache с корректным `dispose()`.

## Lever geometry, orientation и state

`BlockDefinition.renderShape='lever'` исключает lever из generic cube path. Builder создаёт:

- небольшую textured stone base;
- отдельную тонкую handle с local `block/lever` texture; прозрачный legacy tile обрезается до logical handle region;
- pivoted rotation около `±0.28π`, так что ON/OFF меняют реальную геометрию.

Placement выводит attachment из clicked face: top → floor, underside → ceiling, side → wall. Для wall сохраняются north/south/east/west; floor/ceiling получают горизонтальную ориентацию из взгляда игрока.

`RedstoneSystem` state version поднята до `2`: lever snapshot хранит `attachment`, `facing`, `active`. Restore принимает version `1` и назначает fallback `floor/north`; signal semantics и derived wire recalculation не изменены. Любое visual source/power change помечает соответствующий chunk dirty, поэтому handle/wire обновляются после toggle без смены BlockId.

## Остальные исправленные non-cube blocks

- Torch и redstone torch: crossed alpha-tested planes.
- Redstone wire: тонкий ground quad с `0..15` power tint.
- Stone button: малый stone cuboid, powered state уменьшает выступ.
- Oak pressure plate: тонкая oak plate, powered state уменьшает высоту.

Stairs, door, ladder, bed, chest и полноценные connection meshes dust намеренно остались за пределами прохода.

## Automated tests

Добавлено/расширено покрытие:

- render-layer classification и leaves/water/glass separation;
- special render shapes, включая lever not-cube;
- разные handle angles для powered/unpowered;
- redstone v2 lever orientation round-trip и v1 fallback;
- descriptors всех 8 `MobKind`;
- наличие 10 imported runtime sheets/layers;
- logical 1×/2× UV equivalence, expected face rect и bounds `0..1`;
- создание всех восьми articulated textured hierarchies.

Финальный результат: `10` test files, `60/60` tests green.

## Browser visual QA

На локальном WebGL dev server проверены три контролируемые сцены:

- Scene A / Forest: пять деревьев друг за другом; зелёные leaf pixels полностью закрывают соседние trunks/crowns, alpha holes показывают sky, water остаётся translucent.
- Scene B / Mobs: одновременно cow, pig, chicken, sheep, zombie, skeleton, creeper и spider; у каждого собственный sheet, детали читаются на faces, fur/eyes overlays видимы, limbs имеют pivot hierarchy.
- Scene C / Lever: пары OFF/ON на floor, wall и ceiling плюс torch, redstone torch, dust, button и plate; base неподвижна, handle меняет угол, full-block artifacts отсутствуют.

В browser log не было runtime/WebGL warning/error; присутствовали только служебные debug-сообщения Vite. Временный QA route после проверки удалён из продукта.

## Build и размер архива

```text
npm run assets:import   PASS — 150/150
npm run typecheck       PASS
npm test                PASS — 10 files, 60 tests
npm run build           PASS — 54 modules transformed
npm run check:size      PASS — 0.86 MiB, 153 files
npm run check:archive   PASS — 0.86 MiB, 153 files
```

Main JS: `666.52 kB` (`176.91 kB` gzip). CSS: `13.81 kB` (`4.05 kB` gzip).

Production archive изменился с `0.82 MiB / 143 files` до `0.86 MiB / 153 files`: `+0.04 MiB` и ровно `+10` whitelisted entity textures. Предупреждение Vite о main chunk больше 500 kB остаётся неблокирующим P1 optimization item.

## Известные ограничения

- Translucent faces water/glass не сортируются индивидуально внутри chunk pass.
- Legacy UV models приближены к Java 1.9 proportions, но не являются bit-exact копией renderer/model classes.
- Button orientation пока не имеет отдельного persisted face state; этот pass гарантирует non-cube visual, но не полный blockstate system для всех thin blocks.
- Dust визуально остаётся простым quad без directional connections.
- Asset provenance/license по-прежнему требует письменного подтверждения до публичного релиза.

## Git

Исходная ветка синхронизирована обычным `git pull --ff-only`. Планируемый release commit: `feat: complete visual parity pass`. Push выполняется как обычный `HEAD:main`, без force push; конкретный commit SHA и remote outcome сообщаются в финальном ответе, поскольку commit не может надёжно содержать собственный hash.
