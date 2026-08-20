# Goal

Заменить rejected pixel-silhouette extrusion (`GeneratedItemGeometry`) на data-driven low-poly visual families для всех 123 registry items. Cube blocks оставить atlas cubes. Не добавлять hoe / gold tools / golden apple. Не создавать вторую factory/renderer систему.

# Result

Все **123 / 123** item ID получают `itemVisualFamily`. Ни один текущий item не падает в `generic-fallback` и не использует pixel extrusion. `GeneratedItemGeometry.ts` удалён: импортов в `src/` нет.

`ItemVisualFactory` остаётся единственным adapter для first-person и dropped items. Геометрия строится один раз на family/part; кадр меняет только transform и bow limb/string pose.

# Implemented

- `itemVisualFamily()` маршрутизирует block shape, tool type, weapon, armor slot, food shape и named resources.
- `ItemFamilyGeometry`: reusable cuboid assemblies + diamond octahedron + posed bow + atlas shield plate.
- Special block items: torch (world stick), door panel, button cuboid, pressure plate; lever — mini base+handle.
- Tools/weapons: одна geometry на family × wood/stone/iron/diamond palette.
- Bow draw: geometric bend/string, gameplay stages/FOV сохранены.
- Shield: plate из `item/shield` atlas + rim/handle; off-hand raised pose сохранена.
- First-person family poses для door/lever/button/plate/arrow/stick/food-round/armor и tool yaw.

# Changed files

- `src/items/itemRenderProfiles.ts`
- `src/rendering/ItemFamilyGeometry.ts` (new)
- `src/rendering/ItemVisualFactory.ts`
- `src/rendering/FirstPersonRenderer.ts`
- `src/rendering/specialBlockGeometry.ts`
- `src/rendering/GeneratedItemGeometry.ts` (deleted)
- `tests/item-rendering.test.ts`
- `tests/lighting-physics-interaction.test.ts`
- `AGENTS.md`
- `docs/PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/TESTING.md`
- `docs/MINECRAFT_1_9_REFERENCE.md`
- `docs/reports/2026-08-20_held-item-family-meshes.md` — this file

# Architecture decisions

Pose category (`block` / `torch` / `generated` / `handheld` / `bow` / `shield`) остаётся для first-person animation. Mesh family — отдельный слой. `generated` теперь означает «palette family item», не extrusion.

Текстуры pack — источник palette/identity, не UV всей 32×32 icon на clean tool mesh. Cube/torch/door/button/plate по-прежнему берут atlas UV, потому что это block faces. Shield plate — единственный non-block atlas cuboid (`item/shield`).

`generic-fallback` — толстая карточка только для будущих неизвестных ID. Projectile `ArrowVisualFactory` не тронут.

Factory.dispose не чистит module-level family cache: cache общий на процесс, тесты создают много factory.

# Registry coverage

123 / 123.

| Family | Items |
| --- | --- |
| `block-cube` | 59 normal cube blocks (включая slabs/stairs/ladder/bed/chest) |
| `torch` | torch, redstone_torch |
| `door` | oak_door |
| `lever` | lever |
| `button` | stone_button |
| `pressure-plate` | oak_pressure_plate |
| `sword` | wooden/stone/iron/diamond_sword |
| `pickaxe` | wooden/stone/iron/diamond_pickaxe |
| `axe` | wooden/stone/iron/diamond_axe |
| `shovel` | wooden/stone/iron/diamond_shovel |
| `arrow` | arrow |
| `bow` | bow |
| `shield` | shield |
| `stick` | stick |
| `ingot` | iron_ingot, gold_ingot |
| `brick` | brick |
| `gem` | diamond |
| `chunk` | coal, charcoal |
| `flint` | flint |
| `clay-ball` | clay_ball |
| `pile` | gunpowder, redstone_dust |
| `string` | string |
| `feather` | feather |
| `leather` | leather |
| `book` | book |
| `food-round` | apple |
| `food-loaf` | bread |
| `food-cut` | beef, cooked_beef, porkchop, cooked_porkchop, chicken, cooked_chicken |
| `armor-helmet` | leather/iron/gold/diamond_helmet |
| `armor-chest` | leather/iron/gold/diamond_chestplate |
| `armor-legs` | leather/iron/gold/diamond_leggings |
| `armor-boots` | leather/iron/gold/diamond_boots |
| `generic-fallback` | 0 current items |

# Geometry

Большинство family — 1–4 axis-aligned cuboids (12 tris каждый). Diamond — octahedron (8 tris). Bow — grip + two-segment limbs + string (72 tris), draw вращает pivots. Shield — textured plate + rim + rear handle (36 tris).

| Family | Approx tris | Shape |
| --- | ---: | --- |
| block-cube / torch / door / button / plate | 12 | atlas cuboid |
| gem | 8 | octahedron |
| stick / generic-fallback | 12 | rod / thick card |
| ingot / brick / flint / clay-ball / leather / food-loaf / food-cut / armor-chest / armor-boots / lever | 24 | 2 cuboids |
| axe / shovel / chunk / pile / feather / food-round / armor-helmet / armor-legs | 36 | 2–3 cuboids |
| sword / pickaxe / arrow / string / book / shield | 36–48 | 3–4 cuboids |
| bow | 72 | posed group |

# Materials

- Cube/special blocks: existing atlas materials by render layer.
- Palette items: `MeshBasicMaterial` на hex, cache по цвету. Wood/stone/iron/diamond и leather/iron/gold/diamond узнаются цветом, не иконкой.
- Shield plate: nearest `item/shield` texture; rim/handle solid.
- PNG pack не изменялся.

# First-person poses

Tools: `[18, -42, -58]°`, scale `0.56` (Y-up handle, читаемое ребро головы). Torch: stick pose. Arrow/door/lever/button/plate/stick/apple/armor имеют отдельные offsets. Bow: base `[6, -18, -12]°` + existing charge pose + geometric string. Shield raised pose и eat animation не ломались.

# Dropped items

`createDroppedItemVisual` вызывает тот же `createItemModel`. Bob/rotation/stack copies (`1/2/17/33` → 1–4) и entity lighting сохранены.

# Tests

`npm run check` green:

```text
tsc --noEmit: PASS
Vitest:       21 files, 130 tests, 130 passed
Vite build:   72 modules
Size/archive: 0.93 MiB / 165 files
Main JS:      732.57 kB / 196.74 kB gzip
```

`tests/item-rendering.test.ts`: 15 tests, включая audit 123/123, instantiate-all, non-cube bounds, triangle budget, pickaxe geom reuse, bow string Z, generic-fallback только для unknown id.

# Visual QA

Headless cloud agent не рендерит first-person WebGL screenshots. Локально: `npm run dev` и `?qaItem=<id>`.

# Performance

- Geometry cache: `partCache` / `namedBoxCache` / factory `blockGeometries`.
- Color materials reuse.
- Нет per-frame rebuild, per-pixel cubes, extra item lights.
- Типично 8–48 tris, bow 72. Дешевле rejected extrusion.

# Known issues

- First-person angles — project-tuned, не vanilla JSON display.
- Slabs/stairs/ladder/bed/chest в руке всё ещё cube; world specialized mesh отложен.
- Palette не сэмплирует PNG в runtime: цвета заданы по identity pack, без изменения файлов.
- Off-hand кроме щита по-прежнему требует полировки.

# Deferred

- GUI 3D item icons.
- World specialized meshes для slab/stairs/bed/chest/ladder.
- Bit-exact vanilla held transforms.

# Next recommended work

Локальный visual QA representative items (список в TESTING.md / final report). После подтверждения — commit/push по отдельной просьбе.

# Git

Ветка `cursor/lighting-torch-selection-fix-935a`. Working tree dirty. Commit/push **не** выполнялись — по явной просьбе до подтверждения отчёта. Merge в main не делался.
