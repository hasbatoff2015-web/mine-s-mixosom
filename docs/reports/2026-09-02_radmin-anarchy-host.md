# Radmin / LAN bind for local Anarchy QA

Date: 2026-09-02  
Branch: `cursor/radmin-anarchy-host-86e1`  
Base: `origin/main` `020d9d3`

## Goal

Let a second PC on Radmin VPN join the host's local Anarchy process (`npm run dev:server`) without making that the default, without a public VPS, and without changing production/Yandex.

## Result

The WebSocket server still defaults to **`127.0.0.1:2567`**. Canonical env **`FC_SERVER_HOST`** can bind `0.0.0.0`. Vite `npm run dev` is **localhost-only** by default; **`FC_DEV_HOST=0.0.0.0`** opts into LAN. Localhost Anarchy and singleplayer are unchanged.

## Implemented

- `loadServerConfig` reads `FC_SERVER_HOST`, then aliases `FC_HOST` / `HOST`, then `127.0.0.1`. Values are trimmed (PowerShell-friendly).
- `http.listen(port, host)` is unchanged; host is now the resolved env value.
- Startup prints `WebSocket listening on <host>:<port>`. Existing `Frontier Cubes Server listening on ws://…` remains. Wildcard bind still exposes a loopback connect URL via `wsUrl()`.
- Vite no longer uses `host: true` / `--host 0.0.0.0`. Default `localhost`. Opt-in `FC_DEV_HOST` / `FC_VITE_HOST`; wildcard also sets `allowedHosts: true` so Vite 7 does not 403 a Radmin `Host` header.
- Vite DEV opened at a non-loopback hostname uses that host for Anarchy WS/status. Query `anarchyHost` / `anarchyUrl` still win. Production builds (`import.meta.env.DEV === false`) stay on `ws://127.0.0.1:2567`.

## Changed files

- `server/config.ts`, `server/AnarchyServer.ts`
- `src/net/anarchyUrls.ts`, `src/net/AnarchyClient.ts`
- `vite.devHost.ts`, `vite.config.ts`, `package.json`, `scripts/dev-anarchy.mjs`, `tsconfig.json`
- `tests/server/server-host.test.ts`, `tests/server/anarchy-server.test.ts`, `tests/vite-dev-host.test.ts`, `tests/anarchy-client-url.test.ts`
- `docs/LOCAL_SERVER.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `README.md`

## Architecture decisions

- Bind address is config, not a second server. No Colyseus, no protocol change, no public IP baked into gameplay.
- Default stays loopback. `0.0.0.0` is explicit QA. Binding the Radmin IP alone would break host `127.0.0.1:2567`.
- Vite was previously `0.0.0.0` in both `package.json` and `vite.config.ts`. That is no longer the default.
- Client auto-host is gated on Vite DEV + non-loopback `location.hostname`, so Yandex production does not follow the CDN hostname.

## Tests

- `npm run typecheck` PASS
- `npm run typecheck:server` PASS
- `npm run typecheck:client` PASS
- `npm run typecheck:sim` PASS
- Targeted vitest: `server-host`, `vite-dev-host`, `anarchy-client-url`, `anarchy-server`, `anarchy-gameplay` — **5 files / 53 passed**
- `npm run test:server` — **6 files / 78 passed**
- `npm run check:boundaries` PASS
- `npm run build` PASS (192 modules). Production bundle still defaults `127.0.0.1` / `2567`.
- Live: `FC_SERVER_HOST=0.0.0.0 PORT=2569` → `LISTEN 0.0.0.0:2569`, log `WebSocket listening on 0.0.0.0:2569`, `GET http://127.0.0.1:2569/status` 200.
- Live Vite default → `::1:4179` / Local URL only. `FC_DEV_HOST=0.0.0.0` → `0.0.0.0:4179` and a Network URL.

## Visual QA

Not a rendering change. Browser join from a second physical PC is owner Radmin QA.

## Performance

No tick/render path change.

## Known issues

- Windows Firewall may still block 2567/4173 until the host allows the Radmin adapter.
- PowerShell does not accept `FC_SERVER_HOST=0.0.0.0 npm run …`; use `$env:FC_SERVER_HOST="0.0.0.0"`.
- Two-PC Radmin session is not runnable in this cloud agent environment.

## Deferred

Public TLS/VPS, accounts, changing production Anarchy off localhost.

## Next work

Owner Windows + Radmin two-client join.

## Exact QA commands

Replace `26.x.x.x` with the host Radmin IPv4 (`ipconfig` / Radmin UI).

### 1. Server through Radmin (host PC)

PowerShell:

```powershell
$env:FC_SERVER_HOST="0.0.0.0"
npm run dev:server
```

cmd.exe:

```bat
set FC_SERVER_HOST=0.0.0.0
npm run dev:server
```

Git bash / Linux:

```bash
FC_SERVER_HOST=0.0.0.0 npm run dev:server
```

Expect: `WebSocket listening on 0.0.0.0:2567`. Host loopback check: `http://127.0.0.1:2567/status`.

### 2. Vite through Radmin (host PC, second terminal)

PowerShell:

```powershell
$env:FC_DEV_HOST="0.0.0.0"
npm run dev
```

cmd.exe:

```bat
set FC_DEV_HOST=0.0.0.0
npm run dev
```

Git bash / Linux:

```bash
FC_DEV_HOST=0.0.0.0 npm run dev
```

Equivalent: `npx vite --host 0.0.0.0`. Do not leave this as the everyday default.

### 3. URL the friend opens

```text
http://26.x.x.x:4173/
```

Fallback if the menu shows «Сервер недоступен»:

```text
http://26.x.x.x:4173/?anarchyHost=26.x.x.x
```

Host's own browser stays on `http://127.0.0.1:4173/`.

### 4. WebSocket endpoint the client uses

| Who | Page | WebSocket |
| --- | --- | --- |
| Host | `http://127.0.0.1:4173/` | `ws://127.0.0.1:2567` |
| Friend | `http://26.x.x.x:4173/` | `ws://26.x.x.x:2567` |

Override: `?anarchyUrl=ws://26.x.x.x:2567` or Vite `VITE_ANARCHY_URL`.

## Git

Branch `cursor/radmin-anarchy-host-86e1`. Do not merge main until owner Radmin QA.
