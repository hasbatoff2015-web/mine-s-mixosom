# Local authoritative Anarchy server

Foundation pass: your PC runs a Node.js process that owns the Anarchy world. The browser client is not the source of truth for online play.

## Prerequisites

- Node.js 20+
- Repository dependencies: `npm install`
- Two terminals, or `npm run dev:anarchy`

No VPS, Docker, database, or public IP is required.

## Install

```bash
npm install
```

## Start server

```bash
npm run dev:server
```

Default bind: `ws://127.0.0.1:2567` (Vite client stays on **4173**).

Console should include:

```
[server] started
WebSocket listening on 127.0.0.1:2567
Frontier Cubes Server listening on ws://127.0.0.1:2567
[server] world loaded: anarchy
Anarchy server ready
```

Configurable env (never bake a machine-specific path or public hostname into gameplay):

| Variable | Default | Meaning |
| --- | --- | --- |
| `FC_SERVER_HOST` (`FC_HOST` / `HOST`) | `127.0.0.1` | Bind address. Use `0.0.0.0` for Radmin/LAN QA |
| `PORT` / `FC_PORT` | `2567` | Bind port |
| `WORLD` / `FC_WORLD` | `anarchy` | World id |
| `WORLD_PATH` / `FC_WORLD_PATH` | `server/data/worlds` | Relative directory for worlds |
| `WORLD_SEED` | `anarchy-spawn-v1` | Used only when creating a **new** world |
| `TICK_RATE` | `20` | Simulation ticks per second |
| `CHUNK_VIEW_RADIUS` | `4` | Chunk interest radius |
| `MAX_PLAYERS` | `300` | Join cap |
| `SERVER_NAME` | `Frontier Cubes Anarchy` | Status name |
| `PERSIST_INTERVAL_MS` | `30000` | Periodic save |
| `FC_PLUGIN_DIR` / `PLUGIN_DIR` | `server/plugins` | Live plugin directory (`npm run dev:server`) |
| `FC_EXAMPLE_PLUGIN` | unset | `1` / `true` loads bundled `/hello` without copying |
| `FC_OPERATORS` | empty | Comma-separated operator names |

HTTP `GET http://127.0.0.1:2567/status` returns `{ ready, online, maxPlayers, world, name }`.

The server process must compile and boot **without Three.js, DOM, or the Vite client**. Authoritative typecheck: `npm run typecheck:server`. Headless acceptance: `npm run smoke:server`. Import scan: `npm run check:boundaries` (server must not import `src/rendering/**`, `src/core/Game`, `three`).

Shared simulation used by this process is Node-safe (`npm run typecheck:sim`, `npm run smoke:sim`). Client stay on `npm run dev` / `npm run typecheck:client`.

## Start client

```bash
npm run dev
```

Default Vite bind is **localhost only** (not `0.0.0.0`). Open `http://127.0.0.1:4173` or `http://localhost:4173`.

LAN / Radmin VPN QA — opt in, do not leave this as the everyday default:

```bash
FC_DEV_HOST=0.0.0.0 npm run dev
```

Windows PowerShell:

```powershell
$env:FC_DEV_HOST="0.0.0.0"
npm run dev
```

`FC_VITE_HOST` is an alias. CLI `npx vite --host 0.0.0.0` also works. When Vite listens on `0.0.0.0`, `allowedHosts` is opened so a second PC can use the Radmin IP as the Host header.

Optional one-command both (still loopback Vite unless `FC_DEV_HOST` is set):

```bash
npm run dev:anarchy
```

## Connect

1. Open the Vite URL (port **4173**).
2. **Играть онлайн** → **Анархия PvP** → **Подключиться**.
3. If the server is down, the menu stays up and shows **Сервер недоступен**. There is no silent IndexedDB fallback.

**Выживание PvP** remains unavailable.

Query overrides: `?anarchyUrl=ws://127.0.0.1:2567` or `?anarchyHost=` / `?anarchyPort=`. Vite DEV opened at a LAN/VPN address uses that page hostname for the WebSocket by default. Production/Yandex builds stay on `ws://127.0.0.1:2567`.

## Two-client test

1. Start `npm run dev:server` and `npm run dev`.
2. Browser A: connect Anarchy.
3. Browser B (another window/profile): same origin, connect Anarchy.
4. A and B should see each other, movement, block break/place, chat, entity snapshots, and isolated `/give`.
5. Inventory/craft/attack are server-authoritative: one client cannot loot or damage as a local decision.

Same-machine two tabs share `sessionStorage` **per tab**, so they get distinct players.

## Radmin VPN (second PC, local QA only)

Radmin is not a production/Yandex path. Use it only so another machine on the same VPN can join the host's Anarchy process.

1. Both PCs in the same Radmin network. On the **host**, note the Radmin IPv4 (`ipconfig` / Radmin UI). It is often `26.x.x.x`.
2. Allow inbound **2567** (WebSocket) and **4173** (Vite) on the Radmin adapter if Windows Firewall prompts.
3. Host — Anarchy server on all interfaces (PowerShell):

```powershell
$env:FC_SERVER_HOST="0.0.0.0"
npm run dev:server
```

Git bash / Linux:

```bash
FC_SERVER_HOST=0.0.0.0 npm run dev:server
```

Console must include `WebSocket listening on 0.0.0.0:2567`. `http://127.0.0.1:2567/status` on the host still works.

4. Host — Vite on all interfaces (second terminal, PowerShell):

```powershell
$env:FC_DEV_HOST="0.0.0.0"
npm run dev
```

Git bash / Linux:

```bash
FC_DEV_HOST=0.0.0.0 npm run dev
```

5. Host browser: `http://127.0.0.1:4173/` → **Играть онлайн → Анархия PvP**. Client WebSocket: `ws://127.0.0.1:2567`.
6. Friend browser: `http://<RADMIN_IP>:4173/`. Vite DEV uses the page host, so the client WebSocket is `ws://<RADMIN_IP>:2567`. Explicit override if needed: `http://<RADMIN_IP>:4173/?anarchyHost=<RADMIN_IP>`.

Do not set `FC_SERVER_HOST` to the Radmin IP alone if the host still wants `127.0.0.1:2567` — that bind would skip loopback. `0.0.0.0` keeps both.

cmd.exe: `set FC_SERVER_HOST=0.0.0.0` then `npm run dev:server` (no `VAR=value cmd` syntax).

## Server data location

Runtime files (gitignored):

```
server/data/worlds/anarchy/
  meta.json      # seed, spawn, timestamps
  world.json     # modifications, blockStates, chests, furnaces, droppedItems, mobs, minecarts, fallingBlocks, redstone
  players.json   # last known player snapshots (inventory, survival, cursor)
```

Logical gameplay state is `WorldSnapshot` (`src/save/types.ts`). `FsWorldStore` maps that snapshot onto the three files. Do not treat `WorldDiskState` as a second independent format.

Paths are relative to the process working directory. Do not put `C:\Users\...` in server code.

After restart the server **loads** this folder. It does **not** regenerate terrain deltas and does **not** import `.schem`.

Missing `meta.json` = empty world (procedural create). Corrupt or incomplete existing files throw `PersistenceError` and must not be overwritten with a new procedural world.

## Authority

**Online Anarchy (`Играть онлайн → Анархия PvP`)**

SERVER owns: world blocks/chunks **including `BlockRenderState`** (facing, door/button, fluid level), spawn, player position/health/hunger/effects/gamemode, inventory/equipment/crafting, drops and pickups, mobs, melee (including PvP) and arrows, fluids/fire/TNT/explosions, minecarts, commands, 20 TPS tick, filesystem persist.

The 20 TPS simulation **order** is `src/gameplay/GameplayKernel.ts`, the same sequencer singleplayer `Game` uses. `VoxelWorld.tick` (fluids/time/furnaces) runs once per kernel tick. `FC_DEBUG_TICK=1` appends that order to the existing 200-tick server log.

CLIENT owns: rendering, input collection, UI, **smooth local chase toward the last accepted server pose**, remote player interpolation, **time-based interpolation for other server entities**, local chunk mesh/light, visual mining overlay, visual-only bow charge while RMB is held. Live `block_update`/`block_batch` apply id+state via `applyNetworkBlockChanges`; online client does not tick fluids.

CLIENT MUST NOT: write authoritative voxels, decide loot/craft/damage/death/explosion/effect expiry/pickup, persist Anarchy to IndexedDB, give itself items, change gamemode locally.

Local player: input → server 20 TPS `PlayerController` → `player_state` with `tick` → client ignores stale ticks → exponential correction toward the pose. Camera look stays on `InputManager`; snapshots do not overwrite yaw/pitch. Hard snap only if error ≥ 6 blocks. Combat/use/mining holds are `input.mining` / `input.use`; break/place remain explicit requests that the server re-validates (reach, look, mining progress).

Remote players: snapshot history → interpolation with ~80 ms delay. Crosshair attack against a remote sends `{ type: 'attack' }`; the server raycasts AABBs.

Mobs / drops / arrows / minecarts / TNT / falling blocks: the same ~80 ms snapshot buffer (`EntityInterpolationBuffer`). Spawn is immediate; large corrections snap; yaw uses shortest-angle lerp. Do not assign `mesh.position = serverPosition` on every tick.

Server → client also includes `entity_event` (`hurt`, `death`, `projectile_spawn`, `projectile_hit`) keyed by `entityId`. Interest snapshots put arrows/TNT before mobs/items so the cap of 96 cannot starve projectiles.

**Singleplayer** uses `IdbWorldStore` (IndexedDB `frontier-cubes-saves` / `worlds`). No server required. Logical record is `WorldSnapshot` (`schemaVersion` 1).

IndexedDB may still hold a historical `anarchy` world from before this pass. That copy is **not** shared across machines and is **not** the online authority.

## Plugin API

Plugins run **only** on the Anarchy server. See `docs/PLUGINS.md`.

They receive a frozen, per-plugin `ServerAPI`:

- lifecycle `onLoad` / `onEnable` / `onDisable`
- `getWorld()` / `getPlayers()` / `getPlayer(id|name)` / `getStatus()`
- `broadcast(text)` / `log`
- `registerCommand` / `registerEvent` (handles cleaned up on disable)
- `scheduleOnce` / `scheduleRepeating` (cancelled on disable)

`PLUGIN_API_VERSION` is `1` (not the protocol or world schema).

Trusted server code, not a sandbox. No hot reload. No marketplace.

`/hello` is **not** a built-in. Default `server/plugins/` is empty. For local QA:

```bash
cp server/plugin-examples/hello.ts server/plugins/hello.ts
# restart npm run dev:server
```

or `FC_EXAMPLE_PLUGIN=1 npm run dev:server`.

Starter plugins such as homes/economy/kits/tpa are **not** implemented in this pass.

## Commands (server registry)

Online chat lines starting with `/` go to the server registry: `/help`, `/gamemode`, `/seed`, `/spawn`, `/give`, `/time`, `/tp`, `/clear`, `/kill`. Plugin commands join the same registry. Singleplayer still has its own client command path when not connected.

## Protocol (JSON over WebSocket)

Client → server: `join`, `input`, `break_block`, `place_block`, `chat`, `view`, `ping`

Server → client: `welcome`, `player_joined`, `player_left`, `player_state`, `block_update`, `block_result`, `chunk_data`, `unload_chunk`, `chat`, `error`, `pong`, `status`, `inventory`, `entity_snapshot`, `entity_event`, `health`, `effects`, `time`, `command_result`

`inventory` is also the chest/furnace GUI sync: `window.slots` is applied to the live container even while that GUI is already open. Other players viewing the same chest receive the same message (their inventory + shared slots). No extra protocol type.

`block_result` is sent to the requester on every break/place (ok or reason: `reach` / `bounds` / `empty` / `occupied` / `inventory` / …). `player_state.tick` is monotonic; clients drop stale snapshots.

Shared types: `shared/protocol.ts`. Incoming messages are type-checked; client coordinates/inventory/gamemode are not trusted.

Join bootstrap reuses the existing save representation: **seed + modification deltas + blockStates**. Unmodified terrain is generated from the same seed on both sides. Live edits are `block_update` deltas. `view` / `chunk_data` / `unload_chunk` are the interest-radius streaming hooks.

## Current accepted spawn map

The playtested Anarchy spawn (schematic baked into **your browser IndexedDB**) is **not** in git and **not** on the server disk.

This pass:

- does **not** auto-import `frontier_spawn2.schem` on startup;
- creates a new server world with seed `anarchy-spawn-v1` and a **procedural** spawn (`estimateWorldSpawn`) if `server/data/worlds/anarchy/` is empty.

### Missing migration step

To move the IndexedDB world onto the server:

1. Export the IndexedDB record `frontier-cubes-saves` / `worlds` / id `anarchy` as JSON (`WorldSnapshot` / `SerializedWorldState`).
2. Run **explicitly** (never on ordinary startup):

```bash
npm run server:import -- path/to/anarchy-idb.json
```

3. Restart `npm run dev:server`.

Use `--force` only if a server world already exists and you intend to overwrite it.

## Future VPS migration

Take the same Node process. Change `FC_SERVER_HOST`/`HOST`/`PORT`/`WORLD_PATH` (and later TLS/reverse proxy). Do not rewrite world simulation. There is no Docker requirement in this pass.

## Gameplay on the server

`WorldInstance` ticks players then `ServerGameplay.tick`: world (fluids/furnaces/time/support) → falling → arrows (including player hitboxes) → minecarts → mobs → drops/pickup → redstone → explosions. Block deltas flush as one `block_update` or `block_batch`. Per-player `entity_snapshot` uses interest radius 48 (arrows packed first). `entity_event` is broadcast the same tick.

Commands: `/help` `/gamemode` `/seed` `/spawn` `/give` `/time` `/tp` `/clear` `/kill`. `playerCommand` is cancellable. Results go out as `command_result`.

Lighting is not a second online engine. `LightingAdapter` classifies the server world as **immediate** (`deferredLighting = false`): `setBlock` relights before return, and `processDeferredLighting` is a no-op so the Node tick cannot run the client budgeted scheduler. The client stays **deferred** and drains with `WORLD_LIGHT_BUDGET_MS = 2`. Flood code remains `LightEngine`. Simulation RNG on the server is `systemRandomFn` (`RandomSource`), the same adapter as Singleplayer; it is not a world-seeded live stream.

## Foundation limits (intentional)

Not in this pass: VPS deploy, accounts, auth, anti-cheat beyond reach/look/mining-progress checks, production plugins, runtime `.schem`, auto IndexedDB import on server start.
