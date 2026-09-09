# Plugins

Phase 8 is a **server-only plugin platform**. Builtin Anarchy plugins (permissions, TPA, spawn, home, back, RTP, claims, holograms, AutoMine, Economy) now load from `server/builtin-plugins/` unless `FC_NO_BUILTIN_PLUGINS=1`. Auction House is **not** implemented.

Plugins talk to the Anarchy server through `ServerAPI`. They never run in the browser, Singleplayer, or the client bundle.

```text
Shared Game Core (GameplayKernel, useInteraction, VoxelWorld)
        │
        │  semantic decision points (break / place / damage / …)
        ▼
ServerGameplay / WorldInstance  (plugin event adapter)
        │
        ▼
EventBus  ──►  Plugins
        │
        └──►  Network (normal game state only)
```

## Trust model

Installing a plugin gives it **server-level authority** through the runtime. This is not a sandbox. Do not load code you do not trust. There is no marketplace, package manager, or remote installer.

## Server only

- Loaded by `AnarchyServer` after the world is READY, before the WebSocket listener is marked ready.
- Missing `server/plugins/` is fine. The server still starts.
- Singleplayer (`Game`) never imports `PluginManager`.
- Clients receive ordinary protocol messages. Plugins cannot send raw packets. Builtin claims denied-build feedback uses WorldInstance `ClaimBoundaryNetwork` (`claim_boundary` to one player), the same pattern as holograms. Successful iron/gold/diamond block-claims and overlap denies reuse that same unicast.

Restart the server to pick up **source file** changes. In-game `/plugins reload <name>` re-runs disable → cleanup → load → enable on the same instance. Failed plugins still need a restart.

## Lifecycle

```text
discover → load (onLoad once) → enable (onEnable once) → active → disable (onDisable once)
```

Guarantees:

- `onLoad` runs at most once per plugin instance.
- `onEnable` runs at most once. `enableAll()` is idempotent.
- `onDisable` runs at most once. Disable removes commands, listeners, and timers.
- A failed plugin is marked `failed`, logged with its name, and does not stop the server or other plugins.
- Disable is terminal for that instance. Restart the server (or register a new instance) to enable again.

Startup:

```text
load world → initialize gameplay / EventBus → discover+load plugins → enable plugins → listen / READY
```

Shutdown:

```text
disable plugins (flush registrations/tasks) → save world → close connections
```

`onLoad` / `onEnable` may return a Promise. The server waits up to **2 seconds**, then fails that plugin. Gameplay event handlers must be **synchronous**. A returned Promise is not awaited and is logged once per event name.

## Installation

`npm run dev:server` loads plugins from **`server/plugins/`** (`FC_PLUGIN_DIR` / `PLUGIN_DIR`). That is the live production discovery path.

- top-level `*.ts` / `*.js` / `*.mjs`
- skip `_` prefixed files, README, `.gitkeep`
- export `plugin`, or `default` (object or factory function)
- missing directory is fine — the server still starts
- `/hello` is **not** a built-in. Stock `server/plugins/` is empty on purpose. Core Anarchy plugins live in `server/builtin-plugins/` and are registered by `WorldInstance.loadPlugins()`.

The canonical example is `server/plugin-examples/hello.ts`. It is **not** auto-loaded. Broken/invalid modules stay under `tests/server/fixtures/plugins/` and must not be used as `FC_PLUGIN_DIR` for ordinary QA.

Local QA (pick one):

```bash
cp server/plugin-examples/hello.ts server/plugins/hello.ts
# restart npm run dev:server
```

or:

```bash
FC_EXAMPLE_PLUGIN=1 npm run dev:server
```

Do not commit a default `server/plugins/hello.ts`. Do not point `FC_PLUGIN_DIR` at `tests/server/fixtures/plugins` — that folder also contains broken/invalid fixtures.

```ts
import type { Plugin } from '../PluginManager';

export const plugin: Plugin = {
  name: 'example',
  version: '1.0.0',
  apiVersion: 1,
  onEnable(api) {
    api.registerCommand({
      name: 'hello',
      usage: '/hello',
      description: 'Example plugin ping',
      execute: (_args, sender) => ({ ok: true, lines: [`Hello, ${sender.name}`] }),
    });
    api.registerEvent('playerJoin', (event) => {
      api.log(`join ${event.name}`);
    });
  },
};
```

Env:

- `FC_PLUGIN_DIR` / `PLUGIN_DIR` — override the live plugin directory
- `FC_EXAMPLE_PLUGIN=1` — register the bundled example without copying it into `server/plugins/`
- `FC_OPERATORS` — comma-separated player names treated as OP (seeded into PermissionService, cannot `/deop`)
- `FC_NO_BUILTIN_PLUGINS=1` — skip permissions/TPA/home/claims/holograms/AutoMine/economy pack

## Permissions

`CommandRegistry` still accepts legacy `permission: 'operator'`. Any other string is a permission node (`home.use`, `plugins.manage`, `server.*`). OP (`/op`, `FC_OPERATORS`) matches every node. Default/moderator/admin/vip/premium roles exist as infrastructure; vip/premium are not auto-assigned.

The server process stdin is a `ConsoleCommandSender` (`kind: 'console'`). It is not a player, not `FC_OPERATORS`, and not a PermissionService role. `hasPermission` is always true, so `op Misha` and `/op Misha` both run through the same `CommandRegistry`. Replies go to stdout. Unknown commands print `Unknown command ...` and do not stop the process.

In-game: `/permissions help`, `/op`, `/deop`, `/plugins help`. Server terminal: `op`, `plugins`, `permissions roles` (leading `/` optional).

## Builtin Anarchy plugins

| Plugin | Commands | Persistent data |
| --- | --- | --- |
| permissions | `/permissions`, `/op`, `/deop` | `plugin-data/permissions.json` |
| plugin-admin | `/plugins` | — |
| tpa | `/tpa`, `/tpahere`, `/tpaccept`, `/tpdeny` | config |
| spawn | `/spawn`, `/setspawn` | world spawn + config |
| home | `/home`, `/sethome`, `/homes`, `/delhome` | `plugin-data/home/homes.json` |
| back | `/back` | memory (teleport history) |
| rtp | `/rtp` | config |
| rtpportal | `/rtpportal` | `plugin-data/rtpportal/portals.json` |
| claims | `/claim` | `plugin-data/claims/claims.json` (optional `anchor` + `blockClaimSeq`) |
| holograms | `/holograms` (`/hologram reset`) | `plugin-data/holograms/holograms.json` (lines + font/size/style + background + billboard/yaw + timer) |
| automine | `/automine` | `plugin-data/automine/automines.json` (+ `originals/<name>.json`) |
| economy | `/balance`, `/bal`, `/pay`, `/baltop`, `/transactions`, `/eco` | `plugin-data/economy/balances.json`, `transactions.json`, `placed-blocks.json` |

`/tp <x> <y> <z>` remains a builtin and is not replaced by TPA.

## Economy (Мегакоин)

`EconomyService` (`server/services/economy.ts`) is the only balance API. Future Trader / Auction plugins must call it (`deposit` / `withdraw` / `transfer` / `hasBalance`); they must not read `balances.json` themselves.

- Currency display name: **Мегакоин** / **Мегакоинов**. Internal plugin name: `economy`.
- New player: **100**. Maximum: **999 999 999**. Integers only. Negative balances are rejected. Deposit that would exceed the max is rejected (no clamp, no overflow).
- Identity: `playerId` (UUID). Display names are cached for `/baltop` and `/pay`; they are not the storage key. `/pay` may target an offline stored profile.
- Persistence: `plugin-data/economy/balances.json`, `transactions.json`, `placed-blocks.json`.
- Transactions: every balance change writes a row (`transactionId`, `type`, `amount`, `balanceBefore`/`After`, `reason`, `timestamp`, optional `relatedPlayerId` / `pairId`). Transfers write two linked rows and are atomic.
- Reasons include `BLOCK_BREAK`, `MOB_KILL`, `PLAYER_KILL`, `PLAYER_TRANSFER`, `ADMIN_*`, `TRADER_*`, `AUCTION_*`, `OTHER`.
- Block rewards (natural / AutoMine-generated only): Dirt/Grass/Sand/Gravel/Clay/Sandstone **1**, Stone **2**, logs **3**, Coal Ore **8**, Diamond Ore **25**. Player-placed copies pay **0**. TNT / explosion `blockBroken` (no `playerId`) pays **0**. AutoMine fill uses `applyBlockBatch` (not `blockPlaced`) and clears placed marks so regenerated ore pays through the same table.
- Mob rewards: chicken 2, pig/sheep 3, cow 4, spider 8, zombie 10, skeleton 12, creeper 15. Unknown kinds pay 0. One `entityId` cannot be rewarded twice.
- PvP: killer receives `floor(victimBalance * 0.10)`, victim loses that amount, atomic, reason `PLAYER_KILL`. Balance 0 or 1 → 0. Same killer→victim pair has a **5 minute** anti-farm cooldown (PvP itself is unchanged). Duplicate `entityDeath` for the same death does not double-pay.
- Commands: `/balance` `/bal`, `/pay`, `/baltop`, `/transactions`, `/eco give|take|set|reset|balance|transactions`.
- Permissions: `economy.balance`, `economy.pay`, `economy.baltop`, `economy.transactions`, `economy.admin`, `economy.*`. Default role gets the player nodes. Admin role gets `economy.*`. OP bypasses via PermissionService.

## API version

`PLUGIN_API_VERSION` is `1`. It is independent of:

- WebSocket protocol version
- `WORLD_SCHEMA_VERSION`
- schematic import version

If a plugin sets `apiVersion` to something else, it is refused with an explicit error. Inline test plugins may omit the field (treated as current).

## ServerAPI

Plugins receive a frozen `ServerAPI` scoped to that plugin:

| Method | Role |
| --- | --- |
| `apiVersion` | `PLUGIN_API_VERSION` |
| `getStatus()` | world id, seed, tick rate, tick number, player count |
| `getWorld()` | seed, spawn, time, `getBlock` / `setBlock` / `breakBlock`, entity id lookup |
| `getPlayers()` / `getPlayer(id or name)` | online players |
| `broadcast(text)` | system chat |
| `registerCommand(handler)` | existing `CommandRegistry`; returns unregister |
| `registerEvent(name, handler)` | EventBus; returns unsubscribe |
| `scheduleOnce(ms, fn)` / `scheduleRepeating(ms, fn)` | Node timers; cancelled on disable |
| `log(message)` | `[server] plugin <name> …` |
| `hasPermission` / `isOperator` | PermissionService |
| `teleport` / `lastTeleport` / `consumeLastTeleport` | TeleportService |
| `loadData` / `saveData` | namespaced JSON under `plugin-data/` |
| `loadConfig` / `getConfig` / `setConfig` | in-game mutable plugin config |
| `formatHelp` | standard `/<plugin> help` lines |

`registerCommand` / `registerEvent` / timers are remembered. On disable they all disappear. You do not need to store every handle yourself.

### World

`setBlock` / `breakBlock` go through the authoritative world view (bounds, known ids, persist, broadcast). This is a trusted server mutation, not a client break/place request. It does not impersonate a player’s reach/mining checks.

`breakBlock` is `setBlock(Air)` — it does not simulate tool harvest or drops.

### Player

Safe fields/actions: id, name, connected, gamemode, health, position, snapshot, teleport, sendMessage, give, removeItem, clearInventory, hasItem, kick.

Not exposed: WebSocket, session token, input sequence, interpolation, renderer, DOM.

### Commands

One registry (`server/commands.ts`). Built-ins stay: `/help` `/gamemode` `/seed` `/give` `/time` `/tp` `/clear` `/kill`. `/spawn` is provided by the Spawn plugin.

Permission:

- default `player` — anyone online
- `operator` — OP / `FC_OPERATORS`
- any other string — permission node (`home.use`, `plugins.manage`, wildcards)
- `ConsoleCommandSender` — trusted stdin, bypasses every node without being a player

`/<plugin> help` is the standard help form. Help for a plugin root command is available without admin unless that command itself is operator-only (`/op`).

### Inventory

`give` / `removeItem` / `clearInventory` / `hasItem` use `Inventory` operations. Raw slot arrays are not part of the plugin surface.

## Events

Events are **gameplay** events, not renderer events. No `PlaySound`, `CreateMesh`, or hurt-flash.

Registration order is the dispatch order. There is no priority framework.

### Pre (cancellable)

The plugin runs **before** the simulation mutates. `event.cancel()` means the action does not happen. The client gets rejection / current state.

| Event | When | Cancel means |
| --- | --- | --- |
| `blockBreak` | after reach/mining checks, before air write | block stays |
| `blockPlace` | `allowPlace` in shared `useInteraction` | block not placed |
| `playerDamage` / `entityDamage` | before health change | health unchanged |
| `playerInteract` | before use-target (chest, door, …) | interact skipped |
| `itemDrop` / `itemPickup` | before spawn / inventory add | no drop / no pickup |
| `playerCommand` | after `/`, before registry dispatch | command does not run |
| `explosion` | before the explosion queue | TNT/creeper does not enqueue |
| `mobSpawn` | before a new mob is created | mob is not spawned |
| `vehicleEnter` / `vehicleExit` | before mount/dismount | stay as-is |
| `playerMove` | after physics moved the player | teleport back |

### Post (observation)

Not cancellable.

| Event | When |
| --- | --- |
| `playerJoin` / `playerQuit` | after session connect/disconnect |
| `blockBroken` / `blockPlaced` | after the voxel write (player mining, or each cell `ExplosionQueue` actually destroyed) |
| `playerDamaged` / `entityDamaged` | after health applied |
| `entityDeath` | after a player or mob dies (`playerId` is killer for mobs, victim for players; optional `attackerId` / `mobKind`) |
| `playerCommandExecuted` | after dispatch (`ok` is the result) |
| `fluidUpdate` | after a committed fluid cell |
| `projectileHit` | arrow hit with coordinates |
| `craft` | after the inventory craft transaction |

`craft` still has a `cancel()` method for historical typing. **Cancel does nothing** — the craft already committed. Do not treat it as a pre-event.

### Example: break

```text
break_block request
  → server validation (reach, bounds, mining)
  → blockBreak (pre)     plugin may cancel
  → if not cancelled: set Air, drops, notify clients
  → blockBroken (post, playerId set)

ExplosionQueue.applyBlockBatch
  → blockBroken (post, playerId omitted) for each destroyed voxel
  Nearby blast that did not destroy a cell does not emit.
```

### Example: damage

```text
attack / fall / projectile
  → playerDamage or entityDamage (pre)
  → if not cancelled: apply damage
  → playerDamaged / entityDamaged
  → entityDeath if dead, then respawn as today
```

Payloads carry ids, positions, block ids, item ids, amounts, causes. Never Mesh, Object3D, sockets, or DOM.

## Errors

A plugin callback that throws is caught, logged as `plugin <name> event|command <id> threw: …`, and the server continues. The offending listener is not required to kill the plugin; the EventBus still skips that throw. `onEnable` throws → plugin `failed`, registrations from that plugin are flushed.

Do not swallow errors silently.

## Tick safety

Plugin callbacks run on the Node event loop / server tick that emitted the event. Do not:

- busy-loop
- `await` inside a gameplay handler
- touch the world from a second thread (there isn’t one)

`scheduleOnce` / `scheduleRepeating` run later on the event loop, still through `ServerAPI`. They are cleared on disable. Do not use raw `setInterval` — it will survive disable.

## Persistence

Plugin JSON lives next to the world save: `<dataDir>/<worldId>/plugin-data/`. Config defaults are written on enable so admins can also change them with `/<plugin> config set`.

## What this is not

- Not a Bukkit/Spigot jar loader
- Not a second combat / fluid / inventory system
- Not client mods
- Not Auction House / kits. Economy (Мегакоин) **is** implemented as a builtin plugin + `EconomyService`.
- Not a WorldGuard clone (claims are overlapping regions with per-flag priority; iron/gold/diamond blocks create extra cuboid claims in the same store)
