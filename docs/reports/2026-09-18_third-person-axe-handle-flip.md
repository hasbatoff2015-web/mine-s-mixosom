# Third-person axe 180° handle flip

Дата: 2026-09-18  
Ветка: `cursor/moveitems-calibrator-d200`

## Goal

Развернуть все топоры в third-person на 180° вокруг продольной оси рукояти, сохранив tool position, scale и общий наклон. Кирки, лопаты, мотыги и мечи не трогать. First-person / block / generated / bow не трогать.

## Result

`classifyThirdPersonHeldItem`: sword → axe → tool → historical category.

Axe pose = shared `TOOL_POSE` composed with a local-space 180° quaternion:

```text
qAxe = qToolPose * qFromAxisAngle(normalize(1, 1, 0), π)
```

Three.js `Object3D.rotation` is Euler XYZ radians of that quaternion. Position and scale stay on the tool pose.

## Flip axis

Generated sprite geometry lives in XY (front +Z). Texture UV (0,0) is local −X−Y, (1,1) is +X+Y. Axe/pickaxe handles run bottom-left → top-right, so the local handle axis is `(1, 1, 0)`.

A 180° roll around that axis keeps the handle tilt and moves the head to the other side of the handle. This is not a single-Euler `+π` tweak and not an in-plane Z spin (that would reverse head and grip).

## Axe IDs

Все `kind: 'tool' && tool === 'axe'`:

- wooden_axe
- stone_axe
- iron_axe
- diamond_axe
- ruby_axe
- titanium_axe

`gold_axe` в registry нет. Отдельного per-item override нет.

## Pose values

Shared with other tools:

```text
position  0 / 0.215 / -0.155
scale     0.55
```

Axe Euler XYZ (radians), 4 d.p. as COPY:

```text
rotation  3.0184 / -1.4668 / -1.4476
```

Exact: `3.0183926535897934 / -1.4668 / -1.447596326794896`.

Unflipped tool/pickaxe/shovel/hoe rotation remains `-0.1232 / 1.4668 / -0.1232`.

## Unchanged

- pickaxe / shovel / hoe tool pose
- sword pose `0 / 0.225 / -0.245`, `-0.1232 / 1.4668 / -0.1232`, `0.55`
- first-person `FIRST_PERSON_SPRITE_POSE`
- `ItemRenderCategory` still `handheld` for swords and tools
- block / generated / handheld / bow third-person numbers
- protocol, server, FirstPersonRenderer

## Where poses live

`src/rendering/player/thirdPersonHeldItem.ts` → `THIRD_PERSON_HELD_ITEM_DEFAULTS.axe` via `flipAroundLocalAxis(TOOL_POSE, AXE_HANDLE_LOCAL_AXIS, π)`.

`PlayerVisual.setHeldItem` already applies `defaultThirdPersonHeldItemTransformForItem`.

## Tests

Focused `tests/third-person-held-item.test.ts`.

## Visual QA

`/moveitems`: wooden/iron/diamond axe RESET shows blade on the other side of the handle vs previous tool pose; iron_pickaxe stays unflipped.

## Git

PR #95, same branch. Do not merge.
