# Stage 2B request scope and commit success

Narrow follow-up after `8f3f7a1`. Stage 2C is not started. PR #129 stays draft.

## Goal

Stop a request UUID committed in one gameplay mode from replaying in another, and stop a successful money commit from being reported as a failure when a later account read fails.

## Result

`idempotency_requests` is keyed by `(deployment_id, request_scope, request_id)`. Admin stays `global`. Gameplay uses `economy:anarchy`, `economy:survival`, or `economy:peaceful`. `PostgresGameplayEconomy.command()` updates the cache from the committed result and does not call `warm()`. A replay does not copy an older balance into the cache.

## Migration

`0005` `idempotency_request_scope` adds `request_scope TEXT NOT NULL DEFAULT 'global'`, drops the default, checks the value, and replaces the primary key. `0001`–`0004` are unchanged. Old rows remain `global` with their response. `admin_audit_log` is unchanged.

## Tests

Disposable PostgreSQL: the new file passed 4 tests (cross-scope give, clan fee, transfer cache, `0005` upgrade). The full PostgreSQL set passed 57 with 1 pending. Full Vitest without `FC_TEST_DATABASE_URL`: 26 failed, 3449 passed, 51 pending, 384 files. Fresh `origin/main` `2dd09ee`: 26 failed, 3352 passed, 1 pending, 359 files. The 26 failure names match. No new failure.

`typecheck`, `typecheck:client`, `typecheck:server`, and `check:boundaries` passed. `typecheck:sim` matches main. Client build 10.31 MiB. Smoke SIGTERM 0 with the database URL cleared. Manual QA was not run.

## Stage 2C

Unchanged: auction item/money, trade items/money, buyer item/money, clan persistence/fee, block reward/world snapshot.
