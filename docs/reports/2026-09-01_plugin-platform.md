# Phase 8 — Plugin platform

## Goal

Finish the Anarchy **plugin API** on the authoritative server: lifecycle, scoped ServerAPI, semantic gameplay events, cancellation, isolation, discovery. Not homes / TPA / economy.

## Result

Server-only plugin platform stacked on PR **#34** (`81211b1`). Shared Game Core stays free of `PluginManager`. Singleplayer unchanged. Protocol unchanged.

## Current Plugin Foundation (audit)

Already existed before this pass:

- `PluginManager`, frozen `ServerAPI`, `EventBus`, `CommandRegistry`
- Events emitted from `ServerGameplay` / `WorldInstance` (many pre-cancellable)
- `enableAll()` on server start
- `plugins.register(...)` only from tests
- no disk discovery, no scoped cleanup, no `PLUGIN_API_VERSION`, no exception isolation, no kernel-adjacent catalog

## Plugin Lifecycle

`discover → load (onLoad once) → enable (onEnable once) → active → disable (onDisable once)`

`enableAll` is idempotent. Disable is terminal for that instance. Failed plugin → `failed`, server continues.

## ServerAPI

Per-plugin frozen object: status, world, players, broadcast, commands, events, timers, log. Player views wrap `ServerPlayer` (no socket/token/input). World `setBlock` is authoritative persist+broadcast.

## EventBus

Pre-cancellable before mutation; post observation after. Registration order. Handler throws are logged; remaining listeners run. Promises from handlers are not awaited.

## Kernel / Event Adapter

`src/gameplay/simulationEvents.ts` (shared catalog + no-op sink). `server/pluginEventAdapter.ts` maps to EventBus. `useInteraction.allowPlace` / `allowInteract` / `onPlaced` are the place/interact hooks. `GameplayKernel` remains tick-order only.

## Commands

Same `CommandRegistry`. Plugin `registerCommand` returns unregister. `permission: 'operator'` uses `FC_OPERATORS`. Built-ins unchanged.

## Cancellation

Authoritative for break, place, damage, interact, drop, pickup, command, explosion, vehicle, move-revert. `craft` is post-only (cancel ignored).

## Cleanup

Plugin-owned commands, listeners, and timers are flushed on disable.

## Error Isolation

Catch/log plugin name + event/command. `onEnable` throw fails that plugin only.

## Async

Gameplay decisions stay synchronous. Startup hooks may Promise, 2s timeout. Timers are not the 20 TPS tick.

## Security Model

Trusted server-side code. Not a sandbox.

## Discovery / Loading

`server/plugins/` (`FC_PLUGIN_DIR`). Missing dir OK. Realpath confined to that directory. One bad file does not stop others.

## Versioning

`PLUGIN_API_VERSION = 1`.

## Example Plugin

`tests/server/fixtures/plugins/hello.ts` — `/hello` + join log. Not a production Anarchy feature.

## Tests

`tests/server/plugin-platform.test.ts`, `tests/plugin-boundaries.test.ts`, plus existing Anarchy/server packs. Full check recorded after the run.

## Performance

Dispatch is a per-event array walk. No per-tick plugin scan. No filesystem in gameplay events.

## Singleplayer

`Game.ts` does not import PluginManager.

## Network

No protocol change.

## Remaining Work

homes / tpa / economy / kits / moderation — **future**, not Phase 8.

## Git

- Branch: `cursor/plugin-platform-37a2` (requested name `cursor/plugin-platform-bbb1`; agent suffix `-37a2`)
- Base: `cursor/inactive-client-world-sync-37a2` (PR **#34**)
- Do not merge main.
