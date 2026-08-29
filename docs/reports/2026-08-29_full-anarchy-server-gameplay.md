# Full Anarchy server gameplay

Date: 2026-08-29  
Branch: `cursor/full-anarchy-server-gameplay-bbb1`  
Base: `origin/main` `a056e6f` (lighting PR #13)  
QA foundation HEAD (this branch started from): `15ca54f`  
Draft PR: this branch (not PR #14)

## Goal

One integration pass: move listed Anarchy gameplay to server-authoritative so the same Node process is VPS-ready later. Keep singleplayer IndexedDB simulation intact. Add tests and docs. Open a draft PR. Do not merge main.

## Result

Listed systems run as request → server validate → server mutate → sync. The client in `ONLINE_ANARCHY` does not tick world/mobs/fluids/combat/drops. Singleplayer still uses `Game.tick()` and IndexedDB. Spawn import remains a **manual** `npm run server:import` step.

## Implemented

- `server/gameplay.ts` (`ServerGameplay`) reuses existing World, recipes, MobManager, CombatSystem, SurvivalSystem, RedstoneSystem, ExplosionQueue, DroppedItemManager, MinecartManager, PlayerArrowManager. Dummy `THREE.Group` for Node. `deferredLighting = false`. `onCommittedBlocks` → batched block deltas.
- `WorldInstance` tick: player physics → survival → mining/use hold → `gameplay.tick` → riding → flush blocks / `player_state` / per-player `entity_snapshot` / dirty inventory / health / effects. Time every 20 ticks.
- Protocol v1 additions: client `inventory_action`, `craft`, `interact`, `attack`, `pickup`, `vehicle_input`; `input.mining` / `use` / `vehicleForward`. Server `block_batch`, `health`, `effects`, `entity_snapshot`, `command_result`, `time`. Unknown server types still rejected.
- Shared `src/inventory/inventoryUiAction.ts`. Client `src/net/applyEntitySnapshots.ts` applies snapshots onto existing managers (no second visual system).
- Online client: `tickOnline` only. Attack/interact/inventory/Q-drop go to the server. Mining overlay is local; break still requires server mining progress (survival hardness > 0 needs ≥ 0.95). `spawnDroppedStack` is a no-op online. Mob `automaticSpawning: false` online. Death screen skipped; server auto-respawns after dropping survival inventory.
- Melee PvP: server AABB raycast vs other survival players; client sends `attack` when a remote is the closest living target. Arrows can hit players (`ownerId` skip).
- Commands: existing plus `/give` `/time` `/tp` `/clear` `/kill`. Cancellable `playerCommand`.
- Persist: `world.json` chests/furnaces/droppedItems/mobs/minecarts/fallingBlocks/redstone. Players store survival + cursor. `importWorld.ts` copies those dump fields. **Never** auto-import on startup. **No** `.schem`.

## Changed files

- `server/gameplay.ts` (new), `server/WorldInstance.ts`, `server/AnarchyServer.ts`, `server/events.ts`, `server/persistence.ts`, `server/importWorld.ts`
- `shared/protocol.ts`
- `src/inventory/inventoryUiAction.ts` (new), `src/net/applyEntitySnapshots.ts` (new)
- `src/core/Game.ts`, `src/ui/GameUI.ts`, managers (drops, falling, mobs, minecarts, arrows, redstone, survival, World)
- `tests/server/anarchy-gameplay.test.ts` (new), `tests/server/anarchy-server.test.ts`
- Docs: `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `LOCAL_SERVER.md`, this report

## Architecture decisions

- One kernel, two runtimes: Node dummy scene vs browser Game. No `NewInventory` / second mesher / second combat.
- Fluids: server owns the existing queue; broadcast **resulting** block changes only. Sea work can occupy the 48-update/tick budget (existing fairness). Lighting stays the existing engine (server eager, client deferred).
- Mode boundary: `session.online` skips `Game.tick()` simulation. Entity IDs are server-assigned.
- Craft result goes to **cursor** (same as the container UI); depositing is a second inventory click.
- Stone without a pickaxe does not drop (harvest rules). Dirt/default drops do.
- Survival death drops inventory then respawns immediately (Anarchy; no client death screen).

## Tests

Targeted:

- `tests/server/anarchy-server.test.ts` — 12/12 (foundation + look-at-target break/place)
- `tests/server/anarchy-gameplay.test.ts` — 10/10 (inventory/craft, mining+drops, pickup isolation, commands, persist, PvP+mobs, death drops, golden apple, TNT+fluid write, two WS clients)

`npx tsc --noEmit` — clean.

Full `npm run check` results are recorded below after the run. Pre-existing full-suite failures must not be “fixed” by deleting tests: authored-item assets ENOENT in Cloud, `tests/fire-contact-sunlight-minecart.test.ts` timeouts, occasional vitest RPC `onTaskUpdate`.

## Visual QA

Not claimed. Owner two-client localhost QA is the next gate. This environment did not run a browser two-client Anarchy session.

## Performance

20 TPS, interest streaming (48 / 96), block deltas, dirty persist. Primary target: 2 local players. Metrics log every 200 ticks.

## Known issues

- Online inventory UI waits for the next `inventory` snapshot (no local prediction).
- Instant server respawn: no death screen online.
- Fluid queue can starve a fresh source for many ticks if spawn-chunk sea already fills `FLUID_UPDATES_PER_TICK`.
- Creative still does not drop on death (matches singleplayer).
- No accounts, TLS, or VPS config beyond env host/port.

## Deferred

- VPS deploy, auth, DB cluster, production plugins
- Runtime `.schem`
- Auto IndexedDB import on server start
- Accepted spawn map is still only in the owner’s browser until they export and run `npm run server:import`

## Next work

Owner: two-client QA (movement, break/place, inventory, PvP, reconnect, persist). Then explicit spawn dump import. Do not merge main until that QA.

## Git

See the PR body and the closing summary for SHAs after commit/push.

## Migration Summary

| System | Authority |
| --- | --- |
| World / blocks / chunks | Server `VoxelWorld` + persist |
| Player position | Server `PlayerController`; client chase |
| Health / hunger / effects | Server `SurvivalSystem`; `health` / `effects` |
| Inventory / equipment / crafting | Server `applyInventoryUiAction` |
| Drops / pickup | Server `DroppedItemManager`; client display-only |
| Combat (mobs + PvP + arrows) | Server `attack` / arrow tick |
| Mobs | Server `MobManager`; `automaticSpawning` off on client |
| Fluids / fire / TNT | Server world tick + redstone + explosion queue |
| Potions | Server food use hold / `consumeFood` |
| Minecart | Server manager + `vehicle_input` |
| Gamemode / commands | Server registry |
| Persistence | `server/data/worlds/anarchy/` |

## Remaining Client-Only

Input, look, UI, mesh/light, interpolation, visual mining overlay, first-person view, audio, pointer lock. Singleplayer keeps the full local simulation.

## Anarchy Spawn honesty

Accepted spawn lives in the owner’s **browser IndexedDB**. Server uses `server/data/worlds/anarchy/`. First start = procedural + `estimateWorldSpawn`. Transfer is still **manual**: export dump → `npm run server:import -- dump.json` → restart server. No auto-import. No runtime `.schem`.
