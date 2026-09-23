# Production VPS readiness

## Goal

Confirm the post-#106 server can be installed, started, restarted, updated, and rolled back on one Ubuntu machine, and close the gaps that would bite the first boot.

## Result

Release packing, the three systemd units, atomic `current`, world/release separation, and the single shutdown path were already in place. This change does not add a proxy, TLS, or another process manager.

## Implemented

- Documented first boot as `systemctl enable` without `--now`, then `deploy-release.sh`. Starting units before `current` exists makes `Restart=on-failure` loop every 5 seconds.
- A dead pid in `.instance.lock` is still replaced. The replacement is now logged as `world lock stale`. Acquire and release are logged. A live pid still rejects the second process.
- Failed rollback switches `current` back and runs the same `/status` check as a failed deploy.
- `/status` health check also requires `name`, `online`, `maxPlayers`, and `tickRate`. The socket opens only after the world is `READY`.

## Changed files

- `server/worldLock.ts`
- `scripts/rollback-release.sh`
- `scripts/check-game-servers.mjs`
- `tests/server/world-lock.test.ts`
- `tests/server/release-deploy.test.ts`
- `tests/server/systemd-units.test.ts`
- `docs/DEPLOYMENT.md`, `docs/SYSTEMD.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

No second copy of deploy, systemd, or shutdown. Unit files stay as they are: `User=frontier-cubes`, `NoNewPrivileges=true`, `PrivateTmp=true`, `KillSignal=SIGTERM`, `TimeoutStopSec=30`. World directories stay mode `750`.

## Tests

`tests/server/world-lock.test.ts` covers a live pid and a dead pid. The bash deploy test covers a failed rollback that restores the active release. The unit test reads the three signal names and the `/status` fields.

## Visual QA

Not applicable.

## Performance

No gameplay or tick thresholds changed.

## Known issues

`TimeoutStopSec=30` can SIGKILL a very large save. The next start clears that dead lock. Optional `ws` native peers are still not packed.

## Deferred

Firewall, Nginx, TLS/WSS, a domain, Docker, Redis, PostgreSQL.

## Next work

The first real VPS install using `docs/SYSTEMD.md` and `docs/DEPLOYMENT.md`.

## Git

Feature branch `cursor/production-vps-readiness-2f64` from `1475e9545c01c28c35eb8819a5d2a74600c14030`.
