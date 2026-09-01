# Plugins

Phase 8 is a **server-only plugin platform**. It is not homes, economy, TPA, kits, or moderation. Those are future features.

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
- Clients receive ordinary protocol messages. Plugins cannot send raw packets.

Restart the server to reload plugins. There is no hot reload.

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
- `/hello` is **not** a built-in. Stock `server/plugins/` is empty on purpose.

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
- `FC_OPERATORS` — comma-separated player names treated as `operator`

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

`registerCommand` / `registerEvent` / timers are remembered. On disable they all disappear. You do not need to store every handle yourself.

### World

`setBlock` / `breakBlock` go through the authoritative world view (bounds, known ids, persist, broadcast). This is a trusted server mutation, not a client break/place request. It does not impersonate a player’s reach/mining checks.

`breakBlock` is `setBlock(Air)` — it does not simulate tool harvest or drops.

### Player

Safe fields/actions: id, name, connected, gamemode, health, position, snapshot, teleport, sendMessage, give, removeItem, clearInventory, hasItem, kick.

Not exposed: WebSocket, session token, input sequence, interpolation, renderer, DOM.

### Commands

One registry (`server/commands.ts`). Built-ins stay: `/help` `/gamemode` `/seed` `/spawn` `/give` `/time` `/tp` `/clear` `/kill`.

Permission is minimal:

- default `player` — anyone online
- `operator` — name listed in `FC_OPERATORS`

There is no permission database.

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
| `vehicleEnter` / `vehicleExit` | before mount/dismount | stay as-is |
| `playerMove` | after physics moved the player | teleport back |

### Post (observation)

Not cancellable.

| Event | When |
| --- | --- |
| `playerJoin` / `playerQuit` | after session connect/disconnect |
| `blockBroken` / `blockPlaced` | after the voxel write |
| `playerDamaged` / `entityDamaged` | after health applied |
| `entityDeath` | after a player or mob dies |
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
  → blockBroken (post)
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

Phase 8 does **not** add plugin storage. A future namespaced data API is allowed; do not add a database now.

## What this is not

- Not a Bukkit/Spigot jar loader
- Not a second combat / fluid / inventory system
- Not client mods
- Not gameplay plugins (homes, TPA, economy, kits, moderation)
