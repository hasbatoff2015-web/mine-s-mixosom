# Production release tooling

## Goal

Install the existing Node bundle as a release directory and switch the three systemd units onto it without touching world saves.

## Result

`npm run pack:release` writes `dist/server/index.mjs`, a tiny `package.json`, and `node_modules/ws`. `scripts/deploy-release.sh` copies that tree into `/opt/frontier-cubes/releases/<id>/`, swaps `current` with `ln` + `mv -Tf`, restarts the three existing units, and runs the `/status` check. Failure restores the previous symlink. `scripts/rollback-release.sh` switches back. `scripts/cleanup-releases.sh` is dry-run unless `--apply`.

## Implemented

- Release id is a 12-character git SHA or an explicit `--release-id`. No timestamps.
- The VPS does not run npm. `ws` stays external, matching `scripts/build-server.mjs`.
- World paths are rejected by the helper and by the shell scripts. Copying a release uses an allowlist, so a `worlds/` directory in the upload is not installed.

## Changed files

- `scripts/release-ops.mjs`
- `scripts/deploy-release.sh`
- `scripts/rollback-release.sh`
- `scripts/cleanup-releases.sh`
- `scripts/lib/release-common.sh`
- `package.json` (`pack:release`)
- `tests/server/release-deploy.test.ts`
- `docs/DEPLOYMENT.md` and pointers in `docs/SYSTEMD.md`, `docs/LOCAL_SERVER.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

Symlink replace is `ln -s new current.new` then `mv -Tf current.new current`. Unit files still point at `/opt/frontier-cubes/current/dist/server/index.mjs`, so a release switch does not need `daemon-reload`.

## Tests

- `npm run typecheck` — pass.
- `npm run build` — pass.
- `npm run build:server` — `dist/server/index.mjs` (1.5 MB). `ws` stays external.
- `npm run check:boundaries` — pass.
- `npm run test:server` — 74 files, 708 tests pass, including `tests/server/release-deploy.test.ts` (id rules, allowlist install, cleanup plan, script text, bash deploy/rollback/cleanup with a fake `systemctl`).
- `npm run smoke:server:prod` — anarchy, survival, and peaceful each returned `ready: true`, exited 0 on SIGTERM, and removed `.instance.lock`.
- `npm run pack:release` — wrote the bundle, `package.json`, `RELEASE_ID`, and `node_modules/ws`. No world paths. Installing that archive without healthy `/status` exited non-zero and left the worlds directory alone.

## Visual QA

Not applicable.

## Performance

Not measured.

## Known issues

Optional native `ws` peers (`bufferutil`, `utf-8-validate`) are not copied. The server runs without them.

`npm run pack:release` with no arguments writes `release/<git-sha>/`. The first version required `--out` and threw `The "paths[0]" argument must be of type string` because `path.resolve(undefined)` ran on the missing path.

`child.kill('SIGTERM')` on Windows is `TerminateProcess` (Node.js `child_process` docs). The process exit code is `null`, and `server/index.ts` does not get to run. A fresh world logs `world saved` during `initialize()`, before listen, so that line in the smoke dump is not a SIGTERM save. POSIX smoke and `server-process-lifecycle` still require exit 0, one `[server] stopped`, and lock removal. Windows tests assert the abrupt kill instead of treating `null` as success. Production `shutdown()` is unchanged.

`server-modes` expected `` `${dataDir}/anarchy` ``. `worldDirectory` already normalizes separators to `dataDir/<worldId>`. On Windows `mkdtemp` keeps backslashes, so the test now compares the normalized form. `worldDirectory` itself was not changed.

`tick-load-flight` (`max < 80`, `mean < 50`) is the existing host-load gate. This PR does not change tick, `setView`, or that threshold. A Windows `test:server` run reported max 85.06 ms and mean 67.13 ms. That is the documented baseline under parallel load, not a release-tooling regression.

## Deferred

Nginx, TLS, GitHub Actions, Docker, PM2, provider APIs.

## Next work

A firewall and reverse proxy in front of `0.0.0.0:2567-2569`.

## Git

Feature branch `cursor/release-deploy-tooling-2f64`.
