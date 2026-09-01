# Plugin platform — local `/hello` QA

## Goal

Owner ran `npm run dev:server`, joined Anarchy, typed `/hello`, and got `Unknown command 'hello'`. Confirm runtime plugin discovery and make local QA of the example plugin possible without putting test fixtures on the production path.

## Result

Stock `npm run dev:server` still does **not** register `/hello`. That is expected: live discovery is `server/plugins/`, which stays empty. Canonical example moved to `server/plugin-examples/hello.ts`. Local QA: copy into `server/plugins/` or `FC_EXAMPLE_PLUGIN=1`.

## Implemented

- Production PluginManager still discovers only `config.pluginDir` (`$cwd/server/plugins` unless `FC_PLUGIN_DIR` / `PLUGIN_DIR`).
- Canonical `/hello` example: `server/plugin-examples/hello.ts` (plugin name `example`).
- Test fixture `tests/server/fixtures/plugins/hello.ts` re-exports that module. `broken.ts` / `invalid.ts` stay test-only.
- Opt-in `FC_EXAMPLE_PLUGIN=1` registers the bundled example without scanning fixtures.
- Startup log when zero plugins are enabled explains that `/hello` is not built-in.

## Changed files

- `server/plugin-examples/hello.ts`, `server/plugin-examples/README.md`
- `server/PluginManager.ts`, `server/WorldInstance.ts`, `server/config.ts`, `server/AnarchyServer.ts`
- `server/plugins/README.md`, `tests/server/fixtures/plugins/hello.ts`
- `tests/server/plugin-platform.test.ts`, `tests/plugin-boundaries.test.ts`
- `docs/PLUGINS.md`, `docs/LOCAL_SERVER.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/PROJECT_STATE.md`

## Architecture decisions

`/hello` is not a built-in command and is not shipped in the live plugin directory. Auto-enabling it on every `dev:server` would hide the no-plugin case. `FC_EXAMPLE_PLUGIN` is a QA flag, not a second discovery root. Do not point `FC_PLUGIN_DIR` at `tests/server/fixtures/plugins`.

## Tests

See the follow-up commit for targeted plugin-platform / boundaries results.

## Known issues

Owner local QA of `/hello` requires the copy or `FC_EXAMPLE_PLUGIN=1` after restart.

## Deferred

homes / tpa / economy / kits — still not Phase 8.

## Git

Branch: `cursor/plugin-platform-37a2`. Do not merge main. Do not touch PR #22 / #28 / #31.
