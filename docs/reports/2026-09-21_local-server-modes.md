# Local server modes

## Goal

Run Anarchy, Survival, and Peaceful as three local processes of the same server. Each process owns one world directory. Anarchy behavior stays the current one.

## Result

`SERVER_MODE` selects the rules. `WORLD` selects the directory and defaults to the mode. `PORT` is unchanged. Survival allows PvP and refuses blasts. Peaceful refuses player-vs-player damage and refuses blasts. Builtin plugins are the same list. Plugin JSON stays under that world's `plugin-data/`.

## Implemented

- `ServerMode` on `ServerConfig`, `WorldInstance.serverMode`, and `ServerGameplay.serverMode`.
- Blank mode is Anarchy. A non-blank unknown mode throws.
- `pvpAllowed` in `hurtPlayerResult` before health changes. Mob and fall/lava paths are untouched.
- `explosionsAllowed` in `enqueueExplosion` before `ExplosionQueue` edits voxels. Ordinary, powerful, and destructive TNT, TNT minecart, and creeper already enter that function.
- `.instance.lock` in the world directory. A live owner pid blocks a second `initialize`.
- `/status` includes `mode`.
- `npm run dev:server:anarchy|survival|peaceful` via `scripts/dev-server-mode.mjs` (Node sets env, so PowerShell and Unix both work).
- Client `?server=anarchy|survival|peaceful` maps to local ports 2567 / 2568 / 2569. Existing `anarchyUrl` / `anarchyHost` / `anarchyPort` still override.

## Changed files

- `server/config.ts`, `server/worldLock.ts`, `server/gameplay.ts`, `server/WorldInstance.ts`, `server/AnarchyServer.ts`
- `shared/config.ts`, `src/net/AnarchyClient.ts`, `package.json`, `scripts/dev-server-mode.mjs`
- `tests/server/server-modes.test.ts`, `tests/server/anarchy-server.test.ts`
- `docs/LOCAL_SERVER.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

One codebase, one process, one world directory, mode from config. No second plugin tree, no claims clone, no Colyseus, no Docker/Nginx/WSS. The blast cancel matches the existing cancellable `explosion` event: the fuse may still consume the primed actor, and the blast does not change voxels or apply explosion damage.

## Tests

`tests/server/server-modes.test.ts`: default mode, invalid mode, distinct directories, lock, PvP per mode, peaceful fall damage, TNT and TNT minecart per mode, `/status`, client URL presets.

`npm run typecheck` passed. `npm run build` passed. `npm run check:boundaries` passed.

`npm run test:server`: 654 passed, 5 failed. Those five also fail on `origin/main` without this branch: `anarchy-plugins` `blockBreak` listener counts (expected 2 and 3, actual 4 and 5) and three AutoMine `still resetting` drains.

## Visual QA

No UI picker. Connect with `http://localhost:4173/?server=survival` (or `peaceful` / `anarchy`) while that process is listening.

## Performance

No tick-budget or meshing change. The mode check is a branch on the existing damage and explosion events.

## Known issues

Lighting TNT still replaces the block with a primed entity. On Survival and Peaceful the following blast is cancelled, so neighbors stay. The primed actor is still consumed when the fuse ends. TNT minecart `explodeNow` still removes the cart; the blast does not break blocks.

## Deferred

VPS, Docker, Nginx, TLS, WSS, domain, systemd, PM2, Redis, PostgreSQL, server browser UI.

## Next work

Owner live QA of three local processes. Later, bind the same three processes behind a reverse proxy without changing simulation.

## Git

Branch `cursor/multi-server-modes-2f64` from `origin/main` (`d2d45e6`, PR #99 included).
