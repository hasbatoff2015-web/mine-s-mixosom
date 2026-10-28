# Stage 2C settlement journal

Crash consistency between PostgreSQL money and filesystem item state. Stage 3 unique-item UUIDs were not started. PR #129 stays draft.

## What landed

Migration `0006` `gameplay_settlements` stores kind, phase, immutable payload hash, and optional request id. The primary key is `(deployment_id, economy_scope, settlement_id)`. Open rows are indexed by deployment, scope, and world. The table is mutable. `COMPLETE`, `CANCELLED`, and `RECOVERY_REQUIRED` do not move themselves forward.

Player `settlementReceipts` live on the player row. Old saves omit the field. Critical player writes and full snapshots share `WorldInstance.saveQueue` and `FsWorldStore.chain`.

Auction create writes a `PENDING_ESCROW` listing, then the seller receipt, then `ACTIVE`. Browse hides pending rows. Recovery deletes a pending listing with no receipt and activates one that has a receipt. Purchases use `AUCTION_PURCHASE / economySettlementId`. Startup reads that ledger source and finishes delivery once.

Postgres trade money is one `settleNet` on `TRADE / settlementId`. A offers 200 and B offers 75 means A loses 125 and B gains 125, one operation. Unfinished offer stacks are merged back into the saved inventory until the escrow receipt exists.

Buyer UI slots are merged into the saved inventory until a sale receipt exists. The sale journal row is written before that receipt. Clan creation journals the reserved `clan-N` before the fee.

Block rewards in postgres mode wait for one coalesced world save that started after those breaks were queued. A failed save pays nothing. A crash before the save pays nothing. A crash after the save and before the credit can drop that reward. That is at-most-once, not exactly-once.

## Tests this run

Auction listing restart cases A, B, and C passed. The reward barrier paid a two-item batch only after the first save resolved, then the later item on the next save, and paid nothing when save returned false.

Full Vitest without PostgreSQL: 26 failed, 3454 passed, 51 pending, 385 files. Fresh `origin/main` `2dd09ee`: 26 failed, 3352 passed, 1 pending, 359 files. The 26 failure names match. No new failure.

Disposable PostgreSQL: 57 passed, 1 pending, 0 failed, including fresh `0001`–`0006`.

`typecheck`, client, server, and import boundaries passed. `typecheck:sim` matches main. Client build 10.31 MiB. Smoke SIGTERM 0 with the database URL cleared. Manual QA was not run.

Purchase, buyer, trade, and clan crash cells are implemented in startup recovery. This run did not execute a separate restart test for every one of those cells.
