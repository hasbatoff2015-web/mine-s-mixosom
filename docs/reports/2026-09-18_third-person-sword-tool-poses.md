# Third-person sword vs tool held poses

Дата: 2026-09-18  
Ветка: `cursor/moveitems-calibrator-d200`

## Goal

Записать в production third-person renderer две групповые позы: все мечи и все остальные инструменты. Не per-item exception для `diamond_sword` / `iron_pickaxe`. Не трогать first-person, block, generated, bow.

## Result

`PlayerVisual.setHeldItem` выбирает pose через `classifyThirdPersonHeldItem`: sword vs tool vs historical category.

## Sword IDs

Все `kind: 'weapon' && weapon === 'sword'`:

- wooden_sword
- stone_sword
- iron_sword
- diamond_sword
- ruby_sword
- titanium_sword

`gold_sword` в registry нет.

Pose:

```text
position  0 / 0.225 / -0.245
rotation  -0.1232 / 1.4668 / -0.1232
scale     0.55
```

## Other tool IDs

Все `kind: 'tool'` (pickaxe / axe / shovel / hoe, включая golden_hoe и ruby/titanium):

- wooden/stone/iron/diamond/ruby/titanium pickaxe, axe, shovel
- wooden/stone/iron/golden/diamond/ruby/titanium hoe

`gold_pickaxe` / `gold_axe` / `gold_shovel` в registry нет.

Pose (калибровка на iron_pickaxe):

```text
position  0 / 0.215 / -0.155
rotation  -0.1232 / 1.4668 / -0.1232
scale     0.55
```

## Unchanged

- first-person `FIRST_PERSON_SPRITE_POSE` `[0.67, -0.29, -0.70]` / `[1, -90, 34]°` / `0.60`
- `ItemRenderCategory` still `handheld` for swords and tools
- block / generated / handheld (stick, flint_and_steel, fire_arrow) / bow third-person numbers
- protocol, server, FirstPersonRenderer

## Where poses live

`src/rendering/player/thirdPersonHeldItem.ts` → `THIRD_PERSON_HELD_ITEM_DEFAULTS.sword` / `.tool`.

## Tests

Focused `tests/third-person-held-item.test.ts` plus `item-rendering` first-person regression.

```text
npm run typecheck / typecheck:client / typecheck:server  PASS
check:boundaries                                       PASS
vitest third-person + item-rendering + player-visual   3 files / 48 tests PASS
npm run build                                          PASS
```

Browser `/moveitems`: iron_pickaxe RESET y=0.215 z=-0.155 category tool; diamond_sword / wooden_sword y=0.225 z=-0.245 category sword; iron_axe matches pickaxe. Page stays up. `/` still the game menu.

## Visual QA

`/moveitems` RESET теперь показывает новые production defaults; калибратор не пишет отдельные override.

## Git

PR #95, без merge.
