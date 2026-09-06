# Anarchy Plugin Platform — permissions, teleport pack, claims, holograms

## Goal

Build on the existing server Plugin Platform (Phase 8) so Anarchy plugins can be administered in-game: permissions/roles/OP, shared teleport, TPA/spawn/home/back/RTP/portal, claims, holograms. Do not add a second plugin system. Do not implement Auction House. Do not rewrite networking or player visuals.

## Result

Existing `PluginManager`, `CommandRegistry`, `EventBus`, discovery, and scoped cleanup were **extended**. Builtin plugins load from `server/builtin-plugins/` on `WorldInstance.loadPlugins()` (disable with `FC_NO_BUILTIN_PLUGINS=1`). Persistent plugin JSON lives next to the world save. `/tp <x> <y> <z>` is unchanged.

## What already existed (reused)

- `PluginManager` lifecycle (`onLoad` / `onEnable` / `onDisable`), scoped `ServerAPI`, timers, command/event cleanup
- `EventBus` pre-cancellable gameplay events
- `CommandRegistry` + chat dispatch in `WorldInstance.handleChat`
- `FC_OPERATORS` (now a seed for OP, not a parallel check)
- Authoritative `PlayerView.teleport` / `controller.teleport`
- World spawn in `WorldInstance.spawn` + `serverWorld.spawn` persistence
- Disk discovery `server/plugins/` (still empty of modules)
- Plugin boundary tests

## New services

| Service | Role |
| --- | --- |
| `PermissionService` | roles, nodes, wildcards, OP/DEOP, persist |
| `PluginConfigService` | in-game `/plugin config set` + JSON defaults |
| `TeleportService` + `TeleportHistoryService` | one teleport path + `/back`/death |
| `RtpService` + `RtpSessionManager` | bounded safe RTP, shared by command and portal |
| `PlayerSelectionService` | pos1/pos2 for claims and portals |
| `JsonFileStore` | atomic JSON under `<worldDir>/plugin-data/` |

## Plugins created

permissions, plugin-admin, tpa, spawn, home, back, rtp, rtpportal, claims, holograms.

Auction House: not registered. Comment only in `builtin-plugins/index.ts`.

## Commands

- `/permissions help|info|roles|grant|revoke|role …`
- `/op <player>` `/deop <player>`
- `/plugins help|list|info|enable|disable|reload`
- `/tpa` `/tpahere` `/tpaccept` `/tpdeny` (`/tp` untouched)
- `/spawn` `/setspawn`
- `/home` `/sethome` `/homes` `/delhome`
- `/back`
- `/rtp`
- `/rtpportal pos1|pos2|create|remove|list|info`
- `/claim …` (create/delete/members/flags/admin)
- `/holograms …` (create/delete/list/info/move/line/range)

Every plugin has `/<plugin> help` with name, description, usage, permissions.

## Permissions

Default role: `spawn.use`, `home.use`, `home.sethome`, `tpa.use`, `tpa.accept`, `rtp.use`, `back.use`, `claim.use`, `claim.create`.

Admin: `server.*`, `plugins.manage`, `claim.*`, `holograms.*`, teleport family wildcards.

VIP/Premium exist as role catalog (`home.multiple`, `home.limit.premium`) and are **not** auto-assigned donate roles.

OP matches every node. `FC_OPERATORS` names cannot be `/deop`.

## Persistent data

`<dataDir>/<worldId>/plugin-data/` — permissions, plugin configs, homes, claims, holograms, RTP portals. World spawn still uses `world.json` / `serverWorld.spawn`. Teleport history is in-memory (resets on restart).

## Tests

- `tests/server/permissions.test.ts` — default, role, wildcard, OP, DEOP, persist
- `tests/server/anarchy-plugins.test.ts` — TPA, spawn/home/back, OP/plugins, RTP bounds, portal trigger, claims events, holograms persist
- `tests/server/plugin-platform.test.ts` — reload lifecycle added
- `tests/plugin-boundaries.test.ts` — walks `server/services` + `server/builtin-plugins`

Results:

1. `npm run typecheck` PASS
2. `npm run typecheck:server` PASS
3. `npm run test:server` PASS (15 files, 139 tests)
4. `npm run test:sim` PASS (9 files, 42 tests)
5. `npm run build` PASS (client dist has no `PluginManager` / `PLUGIN_API_VERSION`)
6. `npm run check:boundaries` PASS

## Architecture decisions

- Do not rewrite PluginManager; add `enable()` / `reload()` that re-run lifecycle after disable cleanup. `enableAll()` still does not revive explicitly disabled plugins.
- Permission nodes are strings on `CommandHandler.permission`; `'operator'` stays for compatibility.
- Builtin plugins are code modules, not dropped into `server/plugins/`, so the stock extra-plugin directory stays empty.
- RTP completion runs on the 20 TPS tick (`RtpSessionManager.tick`), not ad-hoc `setInterval` in each plugin.
- Hologram MVP is server data + enter-range chat. No protocol/Three.js renderer (parallel visual/network work stays untouched).
- Claim `fire-spread` and `mob-spawn` flags persist but are not enforced: those events do not exist yet.

## Visual QA

Not applicable for this server-only change. No browser/player-visual edits.

## Performance

RTP search is capped (`attemptsPerTick`, `maxChunkGenerates`, `maxAttempts`). No full 20k×20k scan in one tick. Plugin event dispatch remains a per-event listener walk.

## Known issues / limitations

- Holograms are not 3D world text; nearby players get a chat dump once per enter-range.
- Teleport history does not survive process restart.
- Claim `fire-spread` / `mob-spawn` stored only.
- `/plugins reload` does not re-import ESM source; file edits need a restart.
- Home limits use permission nodes, not assigned VIP/Premium donate roles.

## Deferred

Auction House, hologram click/pages/placeholders/animations, WorldGuard-like regions, client hologram entities.

## Next work

Owner live Anarchy QA: `/op`, TPA, homes, RTP water portal, claims PvP, hologram range. Later: client holograms, AH after inventory GUI.

## Git

Branch: `cursor/anarchy-plugin-platform-3f93` from `origin/main` `03685a9`.
