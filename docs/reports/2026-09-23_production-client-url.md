# Production client endpoint

## Goal

Point the production browser build at `wss://megacraft.agariobrainrot.ru` and `https://megacraft.agariobrainrot.ru/status`. Keep `npm run dev` on `ws://127.0.0.1:2567`.

## Result

`vite build` loads `.env.production`. The Anarchy card reads `VITE_ANARCHY_URL` for both the socket and `/status` (`wss` → `https`). Survival and Peaceful stay on local ports 2568 and 2569 because nginx only proxies Anarchy. The menu badge shows the selected card's host (`localhost` or the public hostname). Query overrides still win.

## Implemented

- `.env.production` — `VITE_ANARCHY_URL=wss://megacraft.agariobrainrot.ru`. Not loaded by `npm run dev`.
- `anarchyStatusUrl()` derives `/status` from that WebSocket URL.
- Query `anarchyUrl` / `anarchyHost` / `anarchyPort` / `anarchyStatus` keep their previous jobs. `anarchyUrl` still does not rewrite the status URL.

## Changed files

- `.env.production`
- `vite.config.ts` (comment only)
- `src/vite-env.d.ts`
- `src/net/AnarchyClient.ts`
- `tests/anarchy-client-url.test.ts`
- `docs/LOCAL_SERVER.md`
- `docs/PROJECT_STATE.md`

## Architecture decisions

The hostname stays in the Vite production env file. `shared/config.ts` defaults stay `127.0.0.1:2567`. Protocol, server, and gameplay are unchanged.

## Tests

`tests/anarchy-client-url.test.ts`: local default, production env, derived status, query priority over env, other mode presets.

## Known issues

None in this pass.

## Deferred

Survival and Peaceful production hostnames. Nginx and the game server were already deployed.

## Next work

Publish the `vite build` output behind the same domain as the WebSocket.

## Git

Working tree only. No commit in this pass.
