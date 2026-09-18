# 2026-09-18 — Repair potion (Зелье починки)

## Goal

Add a drinkable **Зелье починки** that restores 50% of missing durability on every player-owned durability item, using the existing potion/consumable, inventory, and Buyer APIs. No craft recipe. Server-authoritative in Anarchy.

## Result

Done. `potion_repair` is a food potion like invisibility/regeneration: 32-tick drink, glass bottle return, stack 64. Effect is an inventory mutation, not a status HUD effect. Buyer assortment uses the existing per-NPC `itemId` + `pricePerItem` config with documented example **500** MK.

## Implemented

- Item id `potion_repair`, Russian name **Зелье починки**, tooltip «Восстанавливает 50% потерянной прочности всех предметов».
- Drink restores `round(lost * 0.5)` remaining durability on every stack whose definition has `durability` (tools, weapons, armor, flint and steel, bow, …). Pristine items (omitted durability = max) are unchanged. Fully repaired stacks drop the durability field.
- Slot coverage is `Inventory.slotRefs()`: hotbar 0–8, main 9–35, armor, offhand. No hardcoded sword/tool list.
- Singleplayer: `SurvivalSystem.consumeFood` calls `inventory.repairLostDurability` when the food flag is set. Anarchy: server consumes the captured slot, then repairs, then returns the bottle and sets `inventoryDirty` for the existing inventory snapshot.
- No crafting recipe. Creative catalog includes it via `obtainableItems()`.
- Buyer example constants `BUYER_EXAMPLE_REPAIR_POTION_ITEM` / `PRICE` (500). A configured скупщик can buy the potion from a player; Buyer is not turned into a shop.
- Visual: same `potion_bottle_drinkable.png` + `potion_overlay.png` composition, teal tint `[18, 181, 164]`.

## Changed files

- `src/items/types.ts`, `src/items/registry.ts`
- `src/i18n/ru.ts`, `src/i18n/displayNames.ts`, `src/i18n/index.ts`
- `src/inventory/stack.ts`, `src/inventory/inventory.ts`
- `src/survival/SurvivalSystem.ts`, `server/gameplay.ts`
- `src/ui/GameUI.ts`
- `scripts/authored-item-assets.mjs`, `public/textures/item/potion_repair.png`
- `shared/buyers.ts`
- `tests/repair-potion.test.ts`, `tests/server/repair-potion.test.ts`, plus small registry/tooltip/placement/content updates
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/ASSET_AUDIT.md`, `docs/TESTING.md`

## Architecture decisions

- Remaining durability model is unchanged (`stack.durability` omitted = pristine). Repair is the inverse of `damageItem`, not a parallel damage field.
- Instant inventory effect lives on `FoodProperties.repairLostDurabilityFraction` instead of a new status id, because there is nothing to tick or show on the potion HUD.
- Anarchy still does not pass inventory into `consumeFood` (that would remove from the wrong slot). Repair is applied on the same server consume path that already decrements the captured slot.
- Buyer stays a скупщик. Price is configuration in `shared/buyers.ts`, not combat/gameplay code. A real NPC shop was explicitly deferred for Totem and is not introduced here.

## Tests

- Sim: 50% missing durability, multi-item/hotbar/armor/offhand, non-durability untouched, last potion consumed, no recipe, buyer example, tooltip hint.
- Server: authoritative drink repairs sword/pickaxe/helmet, syncs `inventory` snapshot, still drinks when nothing is damaged; Buyer can sell a configured `potion_repair` stack at 500 MK.

## Visual QA

See the agent run notes after live/dev checks.

## Performance

No per-tick work. Repair walks `slotRefs()` once per drink (≤ 41 slots).

## Known issues / Deferred

- Buyer NPC still only buys from players. Obtaining the potion in Survival Anarchy is Creative `/give`, another player, or admin-configured trade of an already owned stack — same as the other drinkable potions, which also have no recipes.
- `Math.round` on a 1-point gap restores that last point (0.5 → 1). Floor would leave max-1 forever.

## Next work

If a seller NPC is added later, reuse the same example item/price constants instead of a second catalog.

## Git

Branch `cursor/repair-potion-d200` from `origin/main` including merged PR #93 (`ce6facd`).
