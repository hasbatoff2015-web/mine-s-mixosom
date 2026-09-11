# 2026-09-11 — Buyer NPC system (скупщики)

## Goal

Add a persistent, server-authoritative system of static NPC buyers. Each NPC buys exactly one configured item for Megacoins, using the existing EconomyService and HologramNetwork, with inventory-style admin/trade GUIs.

## Result

Builtin `buyer` + `BuyerService`. Admins create/move/delete/configure NPCs with `/buyer` and an Auction House-style GUI. Players RMB a configured NPC and sell stacks of that one item. No second wallet, no second hologram renderer, no mob AI.

## Implemented

- 1 buyer = 1 known Item ID. Whole pumpkin/melon blocks (`pumpkin`, `melon`), not seeds/slices. Price integer 1…999 999 999 MK / item.
- Payout `quantity × pricePerItem` via `EconomyService.deposit(..., 'TRADER_SELL')`. Failed deposit restores the trade slot.
- Static NPC: `BuyerNpcView` on existing `PlayerVisual` + skin `buyer_merchant` (emerald-tinted explorer; not in `PRODUCTION_PLAYER_SKINS`). Not a mob: no walk, look-at, physics, knockback, fire, drown, damage, death, TNT.
- Commands: `/buyer create|move|delete|list` (aliases `/buyers`, `/скупщик`). Create at admin pose (position + yaw/pitch) and opens admin GUI.
- Permissions: `buyer.use` (default), `buyer.create`, `buyer.delete`, `buyer.move`, `buyer.list`, `buyer.edit`, `buyer.*` (admin). OP bypass through PermissionService.
- RMB: server reach + permission check. Admin/OP → admin GUI. Player with `buyer.use` → trade GUI. Spoofed client menu choice is ignored.
- Admin GUI: name, item, price, hologram text, «Выбрать товар» (inventory picker), «Сохранить», «Удалить скупщика», optional «Открыть торговлю».
- Player GUI: one window, no confirm. Item, price/each, trade slot (matching ID only), quantity, total, **ПРОДАТЬ**. Close / E / disconnect returns the slot. Overflow is stored in `buyers.json` `returns` and restored on join.
- Bound hologram `buyer-<id>` through existing HologramNetwork. Admin-set text, no HP/health bar. `/buyer move` moves hologram; `/buyer delete` removes it. `/holograms` cannot create/delete/move/edit `buyer-*`. RMB on the hologram opens the buyer GUI.
- Protocol: client `buyer_interact` / `buyer_action` (intent only). Server `buyers` NPC snapshot + `buyer` GUI snapshot. Sell ignores spoofed price/item/quantity.
- Persistence: `plugin-data/buyers/buyers.json` via JsonFileStore. Restart restores NPC, item, price, pose, hologram. `ensureHolograms()` removes orphan `buyer-*` records.
- Anti-dupe: player+NPC locks; items live in the session trade slot (not inventory) until sell or close; second sell sees an empty slot; stale NPC returns `BUYER_STALE_ERROR`.

## Changed files

- `shared/buyers.ts`, `shared/protocol.ts`
- `server/services/buyer.ts`, `server/services/holograms.ts` (`upsert` / `remove` / `setPosition` / `setLines`), `server/services/permissions.ts`
- `server/builtin-plugins/buyer.ts`, `index.ts`, `context.ts`, `holograms.ts`
- `server/WorldInstance.ts`, `server/AnarchyServer.ts`
- `src/net/BuyerNpcView.ts`, `src/ui/buyerGui.ts`, `src/ui/GameUI.ts`, `src/core/Game.ts`
- `src/player/appearance/builtinSkins.ts`, `public/textures/player/skins/buyer_merchant.png`
- `tests/server/buyer.test.ts`, `tests/server/buyer-plugin.test.ts`, `tests/buyer-gui.test.ts`, `tests/server/permissions.test.ts`, skin tests
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/PLUGINS.md`, `docs/TESTING.md`

## Architecture decisions

- Not MobManager: buyers are not damageable entities and must not tick AI. Dedicated snapshot `buyers` + client view.
- Player model + distinct NPC skin: villager PNGs exist under `assets/minecraft/textures/entity/villager/` but are unwired; no villager 3D pipeline. Adding one would be a new renderer.
- Trade items sit in `session.tradeSlot` (removed from inventory) so a double-click cannot sell the same stack twice.
- Hologram names are reserved `buyer-<id>` so HologramService stays the only renderer and buyer text cannot be edited as a free hologram.
- Example prices (Pumpkin 50, Melon 50, Golden Apple 600) are constants for tests/docs, not the only legal values.

## Tests

Focused: buyer 15/15, buyer-plugin 5/5, buyer-gui 6/6, permissions 5/5, auction 24/24, auction-plugin 9/9, auction-gui 6/6, clan 20/20, clan-plugin 7/7, clan-gui 7/7, economy 15/15.

`test:server` **45 files / 467 tests PASS**. Four typechecks (`typecheck` / `typecheck:client` / `typecheck:server` / `typecheck:sim`), `check:boundaries`, and `build` PASS.

## Visual QA

Live Anarchy in Chrome (`Op` on local `npm run dev:server`):

- `/buyer create Farmer` opens inventory-style admin GUI (name, empty item, price, hologram, choose/save/trade/delete, close ×).
- Item picker from inventory sets whole Pumpkin; price 50; save persists.
- Trade GUI: 32 pumpkins, 50 МК / шт., «Вы получите: 1 600 Мегакоинов», ПРОДАТЬ.
- After a patch, placing the stack empties the GUI inventory grid and enables ПРОДАТЬ (previously the in-place snapshot left sell disabled and a stale grid).
- Sell chat: «Вы продали 32 × Тыква за 1 600 Мегакоинов.» Hotbar empty. NPC uses `buyer_merchant` skin; hologram «Farmer» has no HP.

Not live-tested here: `/buyer move`, server restart restore, two adjacent buyers, a non-OP second client. Those remain on the owner checklist.

## Performance

No per-NPC timer, poll, or tick broadcast. `buyers` snapshot is sent on create/move/delete/configure and on join. Visuals reuse `PlayerVisual` with `movementSpeed: 0`. Transactions run only on interact/sell.

## Known issues / Deferred

- Live Anarchy GUI QA at multiple UI scales.
- Optional admin «trade as player» is present as «Открыть торговлю»; not required.
- Villager models are still unused; if a villager mesh is wired later, buyers can switch to it without a second service.

## Next work

Owner live checklist: create Farmer → pose/look → unkillable → OP admin GUI / player trade GUI → Pumpkin 50 → sell 32 for 1600 → reject wrong item → close returns stack → `/buyer move` with hologram → change item/price → restart restore → `/buyer list` → delete → two adjacent buyers → double-sell → non-admin permissions → UI scales.

## Git

Branch `cursor/buyer-system-a8dc` from `origin/main@5492846`.
