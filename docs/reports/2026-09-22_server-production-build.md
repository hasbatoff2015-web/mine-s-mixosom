# Production server bundle

## Goal

Run the existing game server with plain Node, without `vite-node`, and without changing modes, worlds, or gameplay.

## Result

`npm run build:server` writes `dist/server/index.mjs` from `server/index.ts`. `npm run start:server` executes that file. Env (`SERVER_MODE`, `PORT`, `WORLD`, `WORLD_PATH`, and the rest of `loadServerConfig`) is unchanged. Dev scripts still call `vite-node`.

## Implemented

- esbuild bundle: ESM, `platform: node`, `target: node20`, `packages: 'external'` so `ws` resolves from `node_modules`.
- Build refuses `three` / `vite` imports.
- Build refuses a bundle that dropped `import()` or inlined `server/plugin-examples/hello.ts`.
- `scripts/server-production-smoke.mjs` builds, then starts Anarchy, Survival, and Peaceful one after another on `PORT=0` under a temporary `WORLD_PATH`. It checks HTTP 200, `ready`, `mode`, `world`, builtin plugin startup, SIGTERM exit 0, and removal of `.instance.lock`.
- `scripts/check-build.mjs` skips `dist/server/` so the Node bundle is not counted in the Yandex static archive.

## Changed files

- `package.json`, `package-lock.json`
- `scripts/build-server.mjs`
- `scripts/server-production-smoke.mjs`
- `scripts/check-build.mjs`
- `docs/LOCAL_SERVER.md`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`

## Architecture decisions

One esbuild outfile. Server imports stay extensionless in TypeScript. Dynamic `import(pathToFileURL(file).href)` is a non-literal import, so disk plugins are not bundled. Builtin plugins are static imports and are included.

`bundledExampleDir()` uses `import.meta.url`. After bundling, that URL is `dist/server/index.mjs`, so `FC_EXAMPLE_PLUGIN` does not see `server/plugin-examples`. Plugin loading was not redesigned. Builtin plugins do not use that path.

## Tests

`npm run smoke:server:prod`. Existing `npm run test:server` covers config and `/status` under vitest and does not require the bundle.

## Visual QA

Not applicable. No client UI change.

## Performance

Not measured. The bundle is a startup artifact, not a tick-loop change.

## Known issues

`FC_EXAMPLE_PLUGIN` and `.ts` files in `PLUGIN_DIR` still need `vite-node`. `npm run build` empties `dist/`, including `dist/server/`, so `build:server` has to be run again afterwards.

## Deferred

systemd, PM2, Nginx, TLS, WSS, Docker, firewall, Redis, PostgreSQL, client URL changes.

## Next work

Listen-error path that releases `.instance.lock`, and process logs, from the production audit. Not this change.

## Git

Feature branch `cursor/server-production-build-2f64`.
