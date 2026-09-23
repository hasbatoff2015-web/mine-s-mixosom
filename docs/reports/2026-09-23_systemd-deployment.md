# systemd deployment

## Goal

Run the existing production bundle as three independent processes under systemd, with world data outside the release directory.

## Result

`deploy/systemd/` has one unit and one env file per mode. Each unit executes `/usr/bin/node /opt/frontier-cubes/current/dist/server/index.mjs` as user `frontier-cubes`. Worlds resolve to `/var/lib/frontier-cubes/worlds/anarchy|survival|peaceful`. Install, upgrade, and rollback are in `docs/SYSTEMD.md`.

## Implemented

- Units: `Restart=on-failure`, `RestartSec=5`, `KillSignal=SIGTERM`, `TimeoutStopSec=30`, `NoNewPrivileges=true`, `PrivateTmp=true`, journald.
- Env files set `HOST`, `PORT`, `SERVER_MODE`, `WORLD`, `WORLD_PATH`, tick rate, view radius, max players, persist interval, and `PLUGIN_DIR`. No secrets.
- `npm run status:servers` checks the three `/status` endpoints.
- `tests/server/systemd-units.test.ts` loads the env files through `loadServerConfig` and checks the units. No systemd daemon is required.

## Changed files

- `deploy/systemd/*`
- `scripts/check-game-servers.mjs`
- `package.json` (`status:servers`)
- `tests/server/systemd-units.test.ts`
- `docs/SYSTEMD.md`, `docs/LOCAL_SERVER.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

`WORLD_PATH` stays the parent directory, matching `loadServerConfig`. The env value is `/var/lib/frontier-cubes/worlds`. Combined with `WORLD=anarchy|survival|peaceful`, the on-disk world is the directory named in the install doc. The config code was not changed.

`TimeoutStopSec=30` matches this step. A very large `world.json` must finish saving inside that window.

## Tests

Static unit/env test. Existing `smoke:server:prod` still covers the Node bundle. `status:servers` is an operator command and is not run in CI, because the three listeners are not up there.

## Visual QA

Not applicable.

## Performance

Not measured.

## Known issues

Ports bind on `0.0.0.0`. Firewall and TLS are not in this change. `FC_EXAMPLE_PLUGIN` still does not see `server/plugin-examples` from the bundle.

## Deferred

Nginx, HTTPS/WSS, domain, Docker, PM2, Redis, PostgreSQL, provider-specific VPS images.

## Next work

Reverse proxy and firewall for `0.0.0.0:2567-2569`.

## Git

Feature branch `cursor/systemd-deployment-2f64`.
