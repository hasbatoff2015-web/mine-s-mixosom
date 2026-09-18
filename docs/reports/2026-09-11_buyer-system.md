# 2026-09-11 — Buyer NPC system (скупщики)

## Goal

Add a persistent, server-authoritative system of static NPC buyers. Each NPC buys exactly one configured item for Megacoins, using the existing EconomyService and HologramNetwork, with inventory-style admin/trade GUIs.

Follow-up (2026-09-12): make buyer hologram setup the **full shared hologram editor**, not an inline text field, without a second hologram system.

## Result

Builtin `buyer` + `BuyerService`. Admins create/move/delete/configure NPCs with `/buyer` and an Auction House-style GUI. Players RMB a configured NPC and sell stacks of that one item. No second wallet, no second hologram renderer, no mob AI.

Buyer hologram `buyer-<id>` is a normal `HologramRecord`. Admin GUI button «Настроить голограмму» opens the existing GameUI hologram editor (`hologram_editor` / `hologram_update`). There is no BuyerHologramService, no second protocol, and no copy of the editor.

## Implemented

- 1 buyer = 1 known Item ID. Whole pumpkin/melon blocks (`pumpkin`, `melon`), not seeds/slices. Price integer 1…999 999 999 MK / item.
- Payout `quantity × pricePerItem` via `EconomyService.deposit(..., 'TRADER_SELL')`. Failed deposit restores the trade slot.
- Static NPC: `BuyerNpcView` on existing `PlayerVisual` + skin `buyer_merchant` (not in `PRODUCTION_PLAYER_SKINS`). Not a mob: no walk, look-at, physics, knockback, fire, drown, damage, death, TNT.
- Commands: `/buyer create|move|delete|list` (aliases `/buyers`, `/скупщик`). Create at admin pose (position + yaw/pitch) and opens admin GUI.
- Permissions: `buyer.use` (default), `buyer.create`, `buyer.delete`, `buyer.move`, `buyer.list`, `buyer.edit`, `buyer.*` (admin). OP bypass through PermissionService.
- RMB: server reach + permission check. Admin/OP → admin GUI. Player with `buyer.use` → trade GUI. Spoofed client menu choice is ignored. RMB on the bound hologram also opens the buyer GUI, not the hologram editor.
- Admin GUI: name, item, price, «Настроить голограмму», «Выбрать товар», «Сохранить», «Удалить скупщика», optional «Открыть торговлю». Hologram appearance is **not** mixed into those fields.
- Shared hologram editor (same screen as `/holograms` RMB): multiline text, size, font (Inter / Press Start 2P / sans-serif), Normal/Bold/Italic/Bold Italic, background on/off + width/height, billboard vs fixed (fixed yaw from the editor player's look), timer kind/duration. Save is `hologram_update`.
- Player GUI: one window, no confirm. Item, price/each, trade slot (matching ID only), quantity, total, **ПРОДАТЬ**. Close / E / disconnect returns the slot. Overflow is stored in `buyers.json` `returns` and restored on join.
- Bound hologram `buyer-<id>` through existing HologramNetwork. Default text on create is the buyer name; after editor Save the lines are ordinary hologram content (not hardcoded name/price/item in the renderer). `/buyer move` moves hologram position only (NPC yaw ≠ hologram yaw). `/buyer delete` removes it. `/holograms` cannot create/delete/move/line/range/reset `buyer-*`.
- Protocol: client `buyer_interact` / `buyer_action` (intent only, including `edit_hologram`). Server `buyers` NPC snapshot + `buyer` GUI snapshot. Sell ignores spoofed price/item/quantity. `hologram_update` on `buyer-<id>` requires the hologram to belong to that buyer and `buyer.edit` / `buyer.*` / OP. `holograms.create` is not enough. Client `buyerId` is not trusted; the editor opens from the server session.
- Persistence: `plugin-data/buyers/buyers.json` via JsonFileStore for NPC pose/item/price. Hologram appearance persists in `plugin-data/holograms/holograms.json`. Restart restores both. `ensureHolograms()` creates a missing bound hologram with defaults (including old `hologramText` if present), repositions an existing one without rewriting appearance, and removes orphan `buyer-*` records.
- Anti-dupe: player+NPC locks; items live in the session trade slot (not inventory) until sell or close; second sell sees an empty slot; stale NPC returns `BUYER_STALE_ERROR`.

## Changed files

- `shared/buyers.ts`, `shared/protocol.ts`
- `server/services/buyer.ts`, `server/services/holograms.ts` (`upsert` / `remove` / `setPosition` / `setLines` / `updateAppearance`), `server/services/permissions.ts`
- `server/builtin-plugins/buyer.ts`, `index.ts`, `context.ts`, `holograms.ts`
- `server/WorldInstance.ts`, `server/AnarchyServer.ts`
- `src/net/BuyerNpcView.ts`, `src/ui/buyerGui.ts`, `src/ui/GameUI.ts`, `src/core/Game.ts`, `src/style.css`
- `src/player/appearance/builtinSkins.ts`, `public/textures/player/skins/buyer_merchant.png`
- `tests/server/buyer.test.ts`, `tests/server/buyer-plugin.test.ts`, `tests/buyer-gui.test.ts`, `tests/server/permissions.test.ts`, skin tests
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/PLUGINS.md`, `docs/TESTING.md`

## Architecture decisions

- Not MobManager: buyers are not damageable entities and must not tick AI. Dedicated snapshot `buyers` + client view.
- Player model + distinct NPC skin: villager PNGs exist under `assets/minecraft/textures/entity/villager/` but are unwired; no villager 3D pipeline. Adding one would be a new renderer.
- Trade items sit in `session.tradeSlot` (removed from inventory) so a double-click cannot sell the same stack twice.
- Hologram names are reserved `buyer-<id>` so HologramNetwork stays the only renderer. BuyerService owns the binding and the `buyer.edit` gate; it does not duplicate HologramService, HologramRenderer, or the editor.
- Example prices (Pumpkin 50, Melon 50, Golden Apple 600) are constants for tests/docs, not the only legal values.

## Tests

Focused: buyer 17/17, buyer-plugin 6/6, buyer-gui 6/6, hologram-editor 9/9, hologram-style 8/8, hologram-hit 3/3, hologram-timer 10/10, auction 24/24, auction-plugin 9/9, auction-gui 6/6, clan 20/20, clan-plugin 7/7, clan-gui 7/7, economy 15/15. `test:server` **45 files / 470 tests PASS**. Four typechecks, `check:boundaries`, and `build` PASS.

Contracts covered in this follow-up:

1. Buyer create also creates hologram `buyer-<id>` with default appearance.
2. Admin `edit_hologram` unicasts the shared `hologram_editor`.
3. A normal player cannot open or save that editor.
4–12. Text, font, style, size, background on/off, background size, billboard/fixed, fixed yaw, timer, and other existing hologram fields persist.
13. `/buyer move` changes position (and NPC yaw) but not hologram appearance/yaw.
14. Restart restores appearance from holograms.json.
15. Delete buyer deletes its hologram.
16. `/holograms` cannot edit `buyer-*`.
17. Forged `hologram_update` / `edit_hologram` without `buyer.edit` (including `holograms.create` only, or a far `buyer.edit` player) is denied.

## Visual QA

Live Anarchy in Chrome (`Op` on local `npm run dev:server`) from the original pass:

- `/buyer create Farmer` opens inventory-style admin GUI (name, empty item, price, choose/save/trade/delete, close ×).
- Item picker from inventory sets whole Pumpkin; price 50; save persists.
- Trade GUI: 32 pumpkins, 50 МК / шт., «Вы получите: 1 600 Мегакоинов», ПРОДАТЬ.
- After a patch, placing the stack empties the GUI inventory grid and enables ПРОДАТЬ (previously the in-place snapshot left sell disabled and a stale grid).
- Sell chat: «Вы продали 32 × Тыква за 1 600 Мегакоинов.» Hotbar empty. NPC uses `buyer_merchant` skin; hologram «Farmer» has no HP.

This hologram-editor follow-up is covered by server tests (editor open, appearance persist, move/restart, permission). Live click-through of «Настроить голограмму» was not run in this cloud agent.

## Performance

No per-NPC timer, poll, or tick broadcast. `buyers` snapshot is sent on create/move/delete/configure and on join. Visuals reuse `PlayerVisual` with `movementSpeed: 0`. Transactions run only on interact/sell. Buyer hologram appearance uses the existing holograms broadcast.

## Known issues / Deferred

- Live Anarchy GUI QA at multiple UI scales, including the hologram editor opened from the buyer button.
- Optional admin «trade as player» is present as «Открыть торговлю»; not required.
- Villager models are still unused; if a villager mesh is wired later, buyers can switch to it without a second service.
- The shared hologram editor has no yaw slider; fixed yaw is captured from the player's look when switching billboard → fixed, same as ordinary holograms. `/buyer move` does not overwrite that yaw.

## Next work

Owner live checklist: create Farmer → pose/look → unkillable → OP admin GUI / player trade GUI → Pumpkin 50 → sell 32 for 1600 → reject wrong item → close returns stack → «Настроить голограмму» full editor → `/buyer move` keeps hologram settings → change item/price → restart restore → `/buyer list` → delete → two adjacent buyers → double-sell → non-admin permissions → UI scales.

## Git

Branch `cursor/buyer-system-a8dc` from `origin/main@5492846`.
