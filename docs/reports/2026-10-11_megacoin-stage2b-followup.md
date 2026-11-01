# Stage 2B follow-up

Correctness fixes after the postgres gameplay cutover. Stage 2C is not started. PR #129 stays draft.

## Goal

Close six audited gaps: optional money request ids, auction source `listingId:buyerId`, one wallet shared by server mode, unhandled tracked rejections, fire-and-forget join preparation, and stale Stage 2A documentation.

## Result

A modified client cannot move Megacoins in postgres mode by omitting `clientRequestId`. An auction sale is `AUCTION_PURCHASE` plus a server-owned `economySettlementId`. Anarchy, Survival, and Peaceful wallets are separate rows. Join waits for `preparePlayer`. Background `track` consumes rejections. JSON currency is still not an authority in postgres mode.

## Implemented

- Money boundaries reject a missing or non-UUID client request before a mutation: `/pay`, `/eco give`, `/eco take`, `/eco set`, `/eco reset`, buyer sell, auction buy, clan `confirm_create`, and trade accept when either offer has money. Console commands get `crypto.randomUUID()`.
- New listings and relists store `economySettlementId`. Old files gain one UUID on load and are saved before purchase. A replayed or conflicting settlement does not grant the item.
- Migration `0004_gameplay_economy_scope` adds `economy_scope`. Old rows become `legacy_global` via `ADD COLUMN ... DEFAULT` and then `DROP DEFAULT`. No `UPDATE` of append-only tables. No balance change.
- `MegacoinService` is constructed with `deploymentId` and `serverMode`. Queries are scoped inside the repository.
- `track` attaches a rejection handler before pending-set bookkeeping. `ECONOMY_DRAIN_MS` stays 5000.
- Postgres `join` calls `preparePlayer` before maps are published for a new or stored player, and before resume connection fields, `playerJoin`, chunks, overflow restore, friend notices, and welcome.

## Architecture decisions

- `deployment_id` is the environment. `economy_scope` is `ServerConfig.serverMode`. World path, hostname, port, and display name are not identity.
- Trade validates the request UUID and still posts money under `settlementId` (`:a`, `:b`, `:a:undo`). One idempotency request is not wrapped around both legs. Trade is not crash-atomic.
- A listing whose money committed and whose JSON is still `ACTIVE` fails closed for a later buyer. It is not automatically repaired.

## Stage 2C

These crash windows remain:

- auction money committed, listing JSON not `SOLD`, item not delivered
- trade money then items
- buyer money then item consumption
- clan fee then clan JSON
- block reward committed, world snapshot still contains the block; a new `rewardEventId` can pay again

## Tests

Focused unit files (`auction`, `economy-track`, `money-request-boundary`, `megacoin`, `migration-manifest`, `economy-plugin`, `trade`, `clan`, `buyer`): 92 passed.

Full Vitest without `FC_TEST_DATABASE_URL`: 26 failed, 3449 passed, 47 pending, 383 files.

Fresh `origin/main` `2dd09ee` on this machine: 27 failed, 3351 passed, 1 pending, 359 files. The branch's 26 failure names are all in that main run. Main also failed once on `urgent live block remesh dirties collision immediately and remeshes without waiting on pending light` (`expected true to be false`). That test passed on the branch and this follow-up does not edit it.

PostgreSQL on `fc_foundation_test` only: 53 passed, 1 pending, 0 failed. Files: foundation 12, megacoin ledger 16, gameplay 12, scope 3, join/requests 3, server-process lifecycle 7 passed and 1 pending.

`typecheck`, `typecheck:client`, `typecheck:server`, and `check:boundaries` passed. `typecheck:sim` has the same 9 DOM/virtual-module errors as `origin/main`.

`npm run build` client payload 10.31 MiB. `build:server` `dist/server/index.mjs` 1.8mb, `pg` external. `smoke:server:prod` anarchy, survival, and peaceful reached ready and exited 0 on SIGTERM with the database URL cleared. `git diff --check` is clean.

Manual QA was not run.

## Git

`origin/main` stayed `2dd09ee7e555896b652789408b4ae93a094cef3b`. Feature commits on `cursor/admin-antidupe-postgres-foundation-26a8`: `8415b20`, `f7c446e`, `918278c`, `60af3df`, plus this report. Not merged.
