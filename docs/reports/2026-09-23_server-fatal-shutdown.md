# Server fatal shutdown

## Goal

Make the production server release its world lock and exit when listen fails or a fatal runtime error escapes the tick.

## Result

`SIGINT`, `SIGTERM`, `SIGHUP`, a failed `listen`, `uncaughtException`, and `unhandledRejection` call one `shutdown`. The first call runs `AnarchyServer.stop()` (save, unlock, close HTTP/WebSocket). A second call returns immediately. Signals exit 0. Startup and fatal errors exit 1.

## Implemented

- `server/index.ts` shares `stopping` across those paths.
- `AnarchyServer.start` logs `listen failed` with mode, world, host, port, and the Node error message, then throws so the process entry can stop.
- `FC_TEST_FATAL=exception|rejection` is a test-only crash after a successful start. Production does not set it.

## Changed files

- `server/index.ts`
- `server/AnarchyServer.ts`
- `tests/server/server-process-lifecycle.test.ts`
- `scripts/server-production-smoke.mjs` (clears `FC_TEST_FATAL` in the child env)
- `docs/LOCAL_SERVER.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

No second shutdown helper. The process entry owns exit codes. `start()` does not release the lock itself; `stop()` does, including after a failed listen, because the lock was taken in `initialize()` before `listen`.

## Tests

`tests/server/server-process-lifecycle.test.ts` builds `dist/server/index.mjs` and spawns `node` against temporary `WORLD_PATH`s.

- Holder stays up while a second process on the same port and a different world exits 1, logs `EADDRINUSE` with mode/world/host/port, and leaves no lock. Holder then SIGTERM exits 0 and its lock is gone.
- Two SIGTERMs produce one `stopped`, `world saved`, exit 0, lock removed.
- `FC_TEST_FATAL=exception` and `rejection`: log, `world saved`, one `stopped`, lock removed, exit 1.

## Visual QA

Not applicable.

## Performance

Not measured. Shutdown still uses the existing save.

## Known issues

`FC_EXAMPLE_PLUGIN` still does not see `server/plugin-examples` from the production bundle. Async `stop()` after `uncaughtException` is the requested save path; the process does not keep serving.

## Deferred

systemd, PM2, Nginx, TLS, firewall, Redis, PostgreSQL.

## Next work

Process manager units, from the production audit. Not this change.

## Git

Feature branch `cursor/server-fatal-shutdown-2f64`.
