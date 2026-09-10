# 2026-09-10 — Economy plugin (Мегакоин)

## Goal

Add a builtin Anarchy Economy plugin and a central `EconomyService` so all future money systems (traders, auction, kill/mining rewards) mutate one integer currency through the existing PluginManager, PermissionService, EventBus, CommandRegistry, and JsonFileStore. Currency display name is **Мегакоин**. Do not add a second wallet, persistence layer, or AutoMine-specific currency.

## Result

Builtin plugin `economy` + `EconomyService` on `WorldInstance`. Balances are keyed by `playerId` (UUID). New players start at **100**. Maximum **999 999 999**. Integers only. Overflow deposits are rejected (no clamp). Transfers are atomic two-row writes. AutoMine fill/restore uses the same reward table after clearing placed-cell marks. TNT/explosion `blockBroken` (no `playerId`) pays 0. Live browser Anarchy QA was **not** run.

## Implemented

1. **EconomyService API.** `getBalance`, `hasBalance`, `deposit`, `withdraw`, `transfer`, `setBalance`, `resetBalance` (back to 100), `getTransactionHistory`, `getTopBalances`. Future Trader/Auction call `deposit`/`withdraw`/`transfer` with `TRADER_*` / `AUCTION_*` reasons; they must not read `balances.json`.
2. **Persistence.** Existing `JsonFileStore` under `<worldDir>/plugin-data/`: `economy/balances.json`, `economy/transactions.json`, `economy/placed-blocks.json`. Flushed on each balance mutation, on world `save()`, and on plugin disable.
3. **Transactions.** Every mutation writes `transactionId`, `playerId`, `type`, `amount`, `balanceBefore`/`After`, `reason`, `timestamp`, optional `relatedPlayerId` / `pairId`. Transfers write two linked rows or neither balance changes.
4. **Player commands.** `/balance` `/bal` `/money`, `/pay`, `/baltop`, `/transactions` `/tx`. Russian messages, space thousands separator (`1 250 Мегакоинов`). `/pay` works for offline stored profiles, rejects self-pay, rejects non-positive integers, has no fee.
5. **Admin.** `/eco give|take|set|reset|balance|transactions`. OP bypass via PermissionService. Offline targets via `WorldInstance.findPlayerIdentity`.
6. **Permissions.** `economy.balance`, `economy.pay`, `economy.baltop`, `economy.transactions`, `economy.admin`, `economy.*`. Default role gets the player nodes. Admin role gets `economy.*`.
7. **Block rewards.** Central `BLOCK_REWARDS`: Dirt/Grass/Sand/Gravel/Clay/Sandstone **1**, Stone **2**, Oak/Birch/Spruce log **3**, Coal Ore **8**, Diamond Ore **25**. Iron/Gold/Redstone/Titanium are unpaid. Player-placed cells (tracked on `blockPlaced`) pay 0. Explosion `blockBroken` without `playerId` pays 0.
8. **AutoMine.** Same `rewardBlockBreak` path. Fill/restore `applyBlockBatch` does not emit `blockPlaced`; `onBlocksWritten` clears placed marks so regenerated ore is treated as generated content.
9. **Mob rewards.** Central `MOB_REWARDS`: chicken 2, pig/sheep 3, cow 4, spider 8, zombie 10, skeleton 12, creeper 15. Unknown kinds 0. One `entityId` cannot be paid twice. Killer comes from authoritative `entityDeath.playerId` + `mobKind` (melee and projectile).
10. **PvP.** Atomic `floor(victimBalance * 0.10)` from victim to killer, reason `PLAYER_KILL`. 0 or 1 → 0. Same killer→victim pair: **5 minute** cooldown (PvP itself unchanged). Duplicate `entityDeath` within 500 ms on the same victim is ignored. `entityDeath.playerId` remains the victim for TeleportService `/back`.
11. **Identity.** Lookup is UUID first, then case-insensitive name, including disconnected `players` and `storedPlayers`. Display names are cached only for `/baltop` / messages.

## Changed files

- `server/services/economy.ts` — service, tables, formatting, persistence
- `server/builtin-plugins/economy.ts` — commands, events, permissions
- `server/builtin-plugins/index.ts`, `context.ts` — register plugin + `lookupPlayer`
- `server/WorldInstance.ts` — `economy`, `findPlayerIdentity`, persist/load, AutoMine `onBlocksWritten`
- `server/services/permissions.ts` — default/admin economy nodes
- `server/services/autoMine.ts` — `onBlocksWritten` hook
- `server/events.ts`, `server/gameplay.ts`, `src/combat/PlayerArrowManager.ts` — additive `attackerId` / `mobKind` on `entityDeath`
- `tests/server/economy.test.ts`, `tests/server/economy-plugin.test.ts`, `tests/server/anarchy-plugins.test.ts`
- `docs/PLUGINS.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/LOCAL_SERVER.md`

## Architecture decisions

- Vault-style: service on `WorldInstance`, plugin only registers commands/events. No second PermissionService or JsonFileStore.
- The voxel world has no origin metadata, so player-placed cells are a Set of `"x,y,z"` in plugin-data. AutoMine fill is not `blockPlaced`; clearing those cells is required so regenerated ore pays.
- Deposit-over-max is **reject**, not clamp, so traders/auctions cannot silently under-credit.
- `/eco reset` restores the starting **100**, not zero.
- PvP duplicate guard is a 500 ms burst on the victim, not a permanent UUID mark (playerId is stable across lives). Same-pair anti-farm is a separate 5-minute cooldown.
- `entityDeath.playerId` semantics are unchanged (killer for mobs, victim for players) so `/back` keeps working. Economy reads additive `attackerId` / `mobKind`.

## Tests

Focused:

```text
npx vitest run tests/server/economy.test.ts tests/server/economy-plugin.test.ts tests/server/anarchy-plugins.test.ts tests/server/auto-mine.test.ts tests/plugin-boundaries.test.ts --maxWorkers=2
```

- `tests/server/economy.test.ts` **14/14 PASS** (start 100, deposit/withdraw/transfer atomicity, overflow/negative/insufficient, reset, persistence, tables, PvP floor/cooldown/zero/cap).
- `tests/server/economy-plugin.test.ts` **10/10 PASS** (`/bal` `/pay` offline `/baltop` `/eco *` `/transactions`, natural/placed/TNT/AutoMine blocks, mob duplicate, PvP 10%, restart).
- `tests/server/anarchy-plugins.test.ts` **36/36 PASS** (`blockPlaced`/`blockBroken` listener counts now 2: claims + economy).
- `tests/server/auto-mine.test.ts` **3/3 PASS**.
- `tests/plugin-boundaries.test.ts` **4/4 PASS**.

Gates:

- `npm run test:sim` **12 files / 65 tests PASS**
- `npx vitest run tests/server tests/fs-world-store.test.ts --maxWorkers=2` **39 files / 386 tests PASS**
- `typecheck`, `typecheck:server`, `typecheck:sim`, `check:boundaries` PASS
- `npm run build` PASS (`dist/assets/index-D_1ySB-S.js` 1,335.28 kB / gzip 387.74 kB)

## Visual QA

Not performed. This pass is server commands, persistence, and reward pipelines. No in-game Anarchy client session was started. Headless `WorldInstance` covered `/bal` `/pay` `/baltop` `/eco`, natural vs placed vs TNT vs AutoMine breaks, mob/PvP events, and restart.

## Performance

Balance/transaction writes are small JSON files, same atomic temp+rename as other plugin-data. Placed-cell set is flushed on a 2 s timer plus world save. Death/cooldown maps are bounded (prune). No meshing, atlas, or tick-budget change.

## Known issues

- Placed-block tracking is cell-level, not a voxel origin bit. A crash in the 2 s window before flush could theoretically drop a just-placed mark; world save also flushes.
- Same-victim PvP duplicate window is 500 ms (same death burst). A different killer on a later death after that window can be paid unless the 5-minute same-pair cooldown applies.
- `/pay` notifies an online recipient in third person (`Steve получил …`), matching the requested copy.

## Deferred

Trader plugin, Auction House, auction fee, player-facing reward-table commands. Owner live Anarchy QA of `/pay` offline, AutoMine diamond, TNT ore, and PvP 10%.

## Next work

Owner: start `npm run dev:server`, `/bal`, `/pay` to an offline name, mine natural Stone vs a placed Stone, explode Diamond Ore with TNT (0), kill a cow then a zombie, PvP 10% then re-kill inside 5 minutes (no second payout).

## Git

- Branch: `cursor/economy-plugin-a8dc`
- Commit: `e8b0249ba825d79ba99e08d09bc6343e352ecae0`
- Base: current `main` (`4de8994`)
- PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/81
