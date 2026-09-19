# 2026-09-19 — Timed world events + event chest

## Goal

Reusable real-time world-events foundation on Anarchy, first event = daily Crimson Relic chest + ~5×5 mini-location, shared `/wand`, special event-chest texture that keeps the vanilla chest UV/alpha.

## Result

Timed events are a builtin plugin (`world-events`) plus `WorldEventsManager`. The first type is `resource_chest`: warn −15 min, spawn locked chest + shrine, unlock +5 min, cleanup +2 h with world restore. Shared `/wand` uses `PlayerSelectionService.click` (pos1 → pos2 → cycle). AutoMine keeps a private selection and skips clicks while shared wand mode is active. Event chest is `BlockId.EventChest = 166` with `entity/chest/event.png`.

## Implemented

1. **Scheduler** (`server/services/eventScheduler.ts`) — wall clock, `server-local` or `utc` policy, daily HH:MM, warning/unlock/cleanup offsets.
2. **Manager** (`server/services/worldEvents.ts`) — phases `scheduled → warning_sent → spawned_locked → active_unlocked → (cleanup) completed`. Persist `plugin-data/world-events/state.json`. Recover timers on load; overdue cleanup runs immediately.
3. **Templates** — capture from wand volume (exactly one chest = anchor), 0/90/180/270 yaw, default `chest_shrine` 5×5 that sinks one layer into the ground.
4. **Loot** — rolled once at spawn, written into coord-keyed chest slots, not re-rolled on open.
5. **Site search** — ring 3000–5000 from spawn, border ±10000, skip claims / AutoMine / RTP portals / homes / players / water / lava / steep / playerish blocks.
6. **Protection** — cancel `blockBreak`/`blockPlace` in the event volume; TNT skips protected voxels via `ServerGameplay.isExplosionProtected`. Locked chest cancels `playerInteract` with a remaining-time message.
7. **`/wand`** — give wooden axe, click1/click2, `/wand clear`. `/automine wand` deactivates shared wand mode so AutoMine is unchanged.
8. **Texture** — `scripts/paint-event-chest.mjs` recolors `scripts/event-chest-source.png` (vanilla 128×128 UV/alpha stand-in for the Windows-only `event_chest.png`) into crimson relic + gunmetal/gold/ruby. Alpha mask and canvas size stay 1:1.

## Changed files

New: `server/services/eventScheduler.ts`, `eventTemplates.ts`, `eventLoot.ts`, `worldEvents.ts`; `server/builtin-plugins/wand.ts`, `worldEvents.ts`; `scripts/paint-event-chest.mjs`, `scripts/event-chest-source.png`; `public/textures/entity/chest/event.png`, `public/textures/block/event_chest.png`; tests under `tests/server/event-*.ts`, `world-events*.ts`, `wand-selection.test.ts`, `tests/event-chest*.ts`.

Updated: Plugin wiring (`WorldInstance`, builtin index/context), AutoMine skip + deactivate, `PlayerSelectionService` wand mode, permissions `wand.*` / `events.*`, `BlockId.EventChest`, chest render/use/collision/inventory, GameUI title, explosion `canDestroy`.

## Architecture decisions

- Reuse PluginManager + JsonFileStore + cancellable events. Do not invent a second chest inventory or a second mesher.
- AutoMine selection stays private. Shared wand is an explicit mode (`activateWand`) so wooden-axe mining is not captured unless `/wand` was used.
- Event chest is a new block id (166 after OakSign 165) so the entity sheet can differ without a protocol container kind. Window kind remains `chest`.
- Templates store every cell including air so placement/cleanup footprints are exact. Snapshot cells include block state and chest slots.
- Timezone policy is a flag today (`useServerLocalTime`); `eventScheduler` is the extension point for a named zone later.
- Windows `E:\Games\Minecraft123\...\event_chest.png` is not in this repo. The committed source is the same 128×128 UV layout as `entity/chest/normal.png`.

## Commands

- `/wand`, `/wand clear`
- `/events status|force spawn|force cleanup|reload`
- `/events template save|info|list|delete <name>`

## Config (`plugin-data/config/world-events.json`)

`enabled`, `dailyTime` (`20:00`), `useServerLocalTime`, `warningMinutes` 15, `unlockDelayMinutes` 5, `durationMinutes` 120, `spawnMinDistance` 3000, `spawnMaxDistance` 5000, `worldBorder` 10000, `templateName` `chest_shrine`, `announceCoordinates`.

## Tests

```text
npx vitest run tests/server/event-scheduler.test.ts tests/server/event-templates.test.ts tests/server/wand-selection.test.ts tests/server/world-events.test.ts tests/server/world-events-plugin.test.ts tests/server/auto-mine.test.ts tests/event-chest.test.ts tests/event-chest-texture.test.mjs tests/chest-model.test.ts tests/portal-chest-texture.test.mjs tests/special-preview-contract.test.ts --maxWorkers=2
```

**11 files / 44 tests PASS** (scheduler 4, templates 3, wand 2, world-events 7, plugin 2, AutoMine 3, event-chest 2, texture 3, chest-model 10, portal texture 4, special-preview 4). Related regression: portal-chest + anarchy-chest-sync + plugin-boundaries **27/27 PASS**.

`npm run typecheck`, `typecheck:server`, `typecheck:client`, `typecheck:sim`, `check:boundaries` — PASS.

## Visual QA

Inspected committed atlases:

- `entity/chest/event.png` — 128×128; same island layout as `normal.png` (latch 12×10, lid 28×28, body strips). Crimson body, gunmetal latch with ruby, gold/ruby diamonds on lid and front. Transparent padding unchanged.
- `block/event_chest.png` — 16×16 crimson tile with gold band and ruby latch.
- `entity/chest/normal.png` and `portal.png` unchanged.

In-game pointer-lock Anarchy session was not available in this cloud agent.

## Manual QA

A. `/wand` → click1 / click2 / `/wand clear`  
B. Build 5×5 with one chest → save template → list/info  
C. `/events force spawn` → shrine + locked chest + coords in chat  
D. After unlock delay, chest opens and loot is stable  
E. `/events force cleanup` restores voxels and chest state  
F. Restart during locked / unlocked / after expiry  
G. Event chest reads as crimson relic; wooden and portal chests unchanged  

## Known issues / deferred

- Named IANA timezone is not implemented; server-local vs UTC only.
- Search gives up after `maxSearchAttempts` and skips that day rather than crashing.
- Original Windows `event_chest.png` pack file was not available on the agent VM.
- Live in-game Anarchy browser QA (pointer lock) was not run in this cloud agent.

## Git

Branch `cursor/world-events-event-chest-525a` off `main`. No merge/rebase/force-push.
