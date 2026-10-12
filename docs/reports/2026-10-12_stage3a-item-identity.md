# Stage 3A — server-authoritative unique item identity

Date: 2026-10-12

## Goal

Give each new physical copy of a collectible painting or the God Sword a server-generated UUID, and keep that UUID through ordinary movement. Do not add an ownership ledger, a quantity ledger, or a PostgreSQL migration.

## Result

The canonical field is `metadata.itemInstanceId`. Twenty collectible painting types and `god_sword` are the only tracked types. `requiresUniqueItemIdentity` is the single predicate. `maxStack = 1` does not by itself qualify an item.

A new UUID is minted only when a physical instance is created: an authoritative Creative catalog grant, an authorized `/give` or plugin give, a Creative painting placement, or the one-time upgrade of an old tracked stack that has no id. Slot moves, cursor moves, containers, trades, auctions, drops, pickups, Survival placement, and painting drops keep the existing id. `cloneStack` does not mint.

## Implemented

- `src/inventory/itemInstance.ts` reads, checks, and assigns the id. Callers pass the UUID function. Shared simulation code does not call `crypto` itself.
- `ServerGameplay.applyInventory` stamps tracked stacks after the shared inventory helper. `creativeCatalogGrant` still returns a stack with no id, so client prediction does not invent a persistent one.
- `/give` and the plugin `give` create one stack per tracked instance. Ordinary resources still use `Inventory.addItem`.
- Survival placement copies the held id onto `BlockRenderState.paintingInstanceId` and consumes the item. Creative placement mints a new block id and leaves the held id in place. A rejected placement does not write a block id and does not consume a Survival item.
- Manual Survival breaks, support removal, and explosions rebuild the drop from `paintingInstanceId`. Creative breaks still do not drop a painting.
- Old inventories receive an id once when the player is loaded. A second load keeps it. Old placed paintings with no id still render from `paintingItemId`. Breaking one mints a single drop id. There is no world scan on startup.
- `NetworkBlockState` carries a validated `paintingInstanceId` so a live block update does not strip the server id. Inventory actions still cannot submit an id. The parser drops unknown fields.
- `WorldInstance.retainHeldReturn` sets `dirty` for an online player, so the existing periodic save writes `heldReturns`.

## Changed files

- `src/inventory/itemInstance.ts`
- `src/inventory/index.ts`
- `src/blocks/types.ts`
- `src/world/painting.ts`
- `src/gameplay/useInteraction.ts`
- `src/core/Game.ts`
- `server/gameplay.ts`
- `server/WorldInstance.ts`
- `shared/protocol.ts`
- `tests/server/stage3a-item-identity.test.ts`
- `tests/collectible-painting-explosion.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`

## Architecture decisions

One field, inside existing metadata. A second top-level `ItemStack.itemInstanceId` was not added. Block identity lives on the existing block-state object, not in a new table. Minting stays at the server boundary that already owns the result. Settlement code was not given new SQL. A copied stack is not treated as a new item.

## Identity lifecycle

| Transition | UUID |
| --- | --- |
| Creative grant | new |
| `/give` of a tracked item | new, one per instance |
| Creative painting place | new on the block; held id unchanged |
| Survival painting place | same id moves from the stack to the block |
| Slot, cursor, hotbar, container | same |
| Drop and pickup | same |
| Break, TNT, support removal | same id on the drop |
| Trade and auction | same |
| `heldReturns` | same |
| Save and load | same |
| Legacy stack with no id | one new id, then stable |
| Legacy placed painting with no id | one new id when it is actually dropped |

## World persistence

`paintingInstanceId` is an optional string on `BlockRenderState`. `sanitizeBlockRenderState` removes a non-UUID value and keeps a valid one, together with `paintingItemId` and facing. `serializeBlockStates` already stores the object. The texture is still chosen from `paintingItemId`.

## Tests

`tests/server/stage3a-item-identity.test.ts` asserts concrete ids, including:

- two Creative painting grants produce different UUIDs, and a diamond grant has none;
- `/give painting_01_villager_hmm 3` produces three different ids;
- a forged `itemInstanceId` on `inventory_action` is not the cursor id;
- `11111111-1111-4111-8111-111111111111` survives clone, serialize, deserialize, slot, cursor, hotbar, portal chest, drop, and pickup;
- Survival placement writes that same id and consumes the stack;
- two Creative placements write `22222222-2222-4222-8222-222222222222` and `33333333-3333-4333-8333-333333333333` while the held id stays `11111111-1111-4111-8111-111111111111`;
- an occupied cell does not mint and does not consume the stack;
- TNT and support removal return the placed id;
- a second player load keeps the migrated id and does not add a second painting;
- auction buy and trade completion keep `11111111-1111-4111-8111-111111111111` and `22222222-2222-4222-8222-222222222222`;
- an online trade cancel parks the painting in `heldReturns` and sets `dirty`. A second cancel does not mint another id and does not set `dirty` again;
- God Sword durability stays 1 and attack damage stays 10. One point of damage still destroys the stack.

## Performance

Ordinary ticks, movement, and inventory clicks add no database queries. Minting one UUID is a local `crypto.randomUUID` call. A tracked stack or placed painting stores one string. Save cadence is the existing dirty timer. Assigning a missing legacy id, or parking an online `heldReturns` stack, sets `dirty` so that timer writes the change. There is no owner map and no periodic reconciliation.

## Validation

| Command | Result |
| --- | --- |
| `npx vitest run tests/server/stage3a-item-identity.test.ts` | PASS, 9 tests |
| `npm run typecheck` | PASS |
| `npm run typecheck:client` | PASS |
| `npm run typecheck:server` | PASS |
| `npm run typecheck:sim` | FAIL, the same 9 DOM and virtual-module errors |
| `npm run check:boundaries` | PASS |
| `npm run build` | PASS, 10.31 MiB, `assets/index-BEH4sKqC.js` |
| `npm run build:server` | PASS |
| `npm run check:size` | PASS, 10.31 MiB |
| `npm run smoke:server:prod` | PASS, anarchy, survival, and peaceful SIGTERM exit 0 |
| `git diff --check` | PASS |
| `npx vitest run` with `FC_TEST_DATABASE_URL` unset | 26 failed, 3496 passed, 51 skipped, 389 files |
| Fresh `origin/main` `2dd09ee` full Vitest, same unset | 27 failed, 3351 passed, 1 pending, 359 files |
| PostgreSQL integration and migration manifest on `fc_foundation_test` | PASS, 7 files, 56 tests. Logs show migrations `0001`–`0006` |

The branch failures are the main set except `tests/server/auto-mine.test.ts` (“restores original blocks on delete and batches first fill”), which failed on this fresh main run and passed on the branch run. No new failure name appeared. The God Sword mob test fails on both.

Manual gameplay QA: NOT RUN.

GitHub Actions: NOT RUN.

## Known limitations

- Stage 3A does not record where an item is, and it does not prove that an old duplicate never existed. That is Stage 3B.
- Stage 3A does not count diamonds or other stackable resources. That is Stage 3C.
- Old placed paintings are not rewritten at startup. They receive an id when a drop is actually created.
- A crash before the next world save can still lose an unsaved stack. The accepted Stage 2C filesystem-and-crash limitation is unchanged. No new filesystem transaction was added.
- Destroyed swords and destroyed paintings are not written to SQL.

## Deferred

Stage 3B: ownership and location, duplicate detection, and any response to a duplicate. Stage 3C: quantity accounting for selected stackable resources. Admin login and the admin panel stay later stages.

## Git

Branch `cursor/admin-antidupe-postgres-foundation-26a8`. Parent `738517a`. Stage 3A commit `d99a167` (`Give collectible paintings and the God Sword stable instance ids`). `origin/main` remains `2dd09ee`. The branch is 31 commits ahead and 0 behind. Draft PR #129. Not merged.
