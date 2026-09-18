# 2026-09-18 — Repair potion: 50% of max durability + armor bar

## Goal

Fix PR #94 on `cursor/repair-potion-d200`:

1. Repair potion restores a fixed 50% of **maximum** durability, not 50% of lost durability.
2. Show the existing durability bar on armor items (inventory, hotbar, armor slots) and keep it live after armor wear and after drinking the potion.

## Result

Done. Shared helper `restoredRemainingDurability` is now `min(max, current + round(max * 0.5))`. Armor uses the same `slotDurabilityBarHtml` path as tools. Equipped armor now loses remaining durability on armor-mitigated hits so the bar can appear in play.

## Implemented

### Formula

Old: `current + round(lost * 0.5)` where `lost = max - current`.

New: `newDurability = min(maxDurability, currentDurability + round(maxDurability * 0.5))`. Intact (`current >= max`) unchanged. Non-durability items unchanged. Fully repaired stacks omit `durability` (pristine).

Examples for max=100:

- 100 → 100, 90 → 100, 70 → 100, 60 → 100, 50 → 100
- 40 → 90, 20 → 70, 10 → 60, 1 → 51, 0 → 50
- two drinks: 20 → 70 → 100, 10 → 60 → 100

Rounding is `Math.round(max * fraction)` (integer-safe for 0.5 and in-game max values). Odd max (wooden 59): `round(29.5) = 30`.

### Where the logic lives

- Shared math: `src/inventory/stack.ts` `restoredRemainingDurability` / `repairItemLostDurability`
- Singleplayer: `SurvivalSystem.consumeFood` → `inventory.repairLostDurability`
- Anarchy: `server/gameplay.ts` after captured-slot consume → `player.inventory.repairLostDurability` + `inventoryDirty`

### Armor durability UI

- Extracted `slotDurabilityBarHtml` in `src/ui/inventoryLayout.ts`
- `GameUI.slotHtml` uses it for every slot, including `armor-head` / `armor-chest` / `armor-legs` / `armor-feet`, hotbar, main inventory, offhand
- CSS: `.slot .durability` z-index 3 so the bar sits above armor silhouettes; `.mc-panel .mc-slot .durability` keeps the same overlay in the inventory panel
- Bar only if `definition.durability` exists **and** `stack.durability` is set (remaining HP; omit = pristine)

### Live updates

- Slot signature already includes durability, so `patchSlotHost` / `applySlotSnapshots` rewrite the bar without remounting
- SP: `refreshOpenInventory` every tick while the modal is open; HUD every 2 ticks
- Anarchy: `inventoryDirty` on potion consume and on `DamageResult.armorWorn`; inventory snapshot restores stacks; open inventory re-paints via `applyAuthoritativeCursor` / `refreshOpenInventory`

### Armor wear (needed for the bar to appear)

Armor never lost durability before, so equipped pieces stayed pristine and the bar never showed. `SurvivalSystem.damage` now calls `Inventory.damageEquippedArmor(armorDurabilityLoss(raw))` when the hit is not an armor-bypass source. Loss per piece: `max(1, round(raw / 4))`. Anarchy `ServerPlayer` marks `inventoryDirty` when `armorWorn`.

## Changed files

- `src/inventory/stack.ts`, `src/inventory/inventory.ts`
- `src/items/types.ts`, `src/items/registry.ts`
- `src/survival/SurvivalSystem.ts`
- `server/WorldInstance.ts`
- `src/ui/inventoryLayout.ts`, `src/ui/GameUI.ts`, `src/style.css`, `src/core/Game.ts`
- `src/i18n/ru.ts` (tooltip text matches the new formula)
- `tests/repair-potion.test.ts`, `tests/server/repair-potion.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

Unchanged: potion asset/color/name/stack/drink time/no recipe/Buyer example/tool durability cost.

## Architecture decisions

- Remaining-durability model unchanged (`stack.durability` omitted = max).
- One helper for SP and Anarchy. Food flag name `repairLostDurabilityFraction` kept (still the 0.5 passed into the helper).
- Armor bar reuses `slotHtml`; no second overlay system.
- Armor wear lives on the canonical `SurvivalSystem.damage` path so SP and Anarchy cannot diverge.

## Tests

- Sim: max=100 table, odd max, two drinks 20→full, sword/tool/armor/hotbar/main/offhand, non-durability untouched, tooltip, shared bar renderer for all four armor pieces, slot patch on durability change, SurvivalSystem wears all four pieces, fall does not.
- Server: drink still repairs sword/pickaxe/helmet and syncs snapshot; two drinks fully restore a 20-durability sword; armor hit flushes remaining durability; drink when nothing damaged; Buyer example.

## Visual QA

DEV `GameUI` fixtures (no pointer lock / no in-world drink):

- `?qaUi=creative` → tab **Инвентарь**: green durability bars on diamond helmet/chest/legs/boots armor slots, iron helmet in the grid, same overlay as tools.
- Hover **Зелье починки**: tooltip «Восстанавливает 50% максимальной прочности всех повреждённых предметов».
- `?qaUi=hud-full`: iron pickaxe on the hotbar shows the existing green bar (tool path unchanged).

In-world drink + taking a hit with inventory open were not click-tested (pointer lock). Those paths are covered by sim/server tests (`consumeFood`, two drinks, `armorWorn` → `inventoryDirty` snapshot).

## Performance

Repair still walks ≤41 slots once per drink. Armor wear is four `damageItem` calls per accepted hit. Inventory patch is signature-gated.

## Known issues / Deferred

- Tooltip text was updated to describe 50% of max durability (the old “потерянной” string would have been wrong). Visual tooltip chrome is unchanged.
- Buyer still only buys from players.

## Next work

None for this formula/UI fix.

## Git

Branch `cursor/repair-potion-d200` (existing PR #94). No new branch. No merge.
