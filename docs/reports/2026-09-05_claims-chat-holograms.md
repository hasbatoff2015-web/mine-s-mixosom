# Claims overlap/priority, chat scroll, 3D holograms, spawn respawn

## Goal

Fix Anarchy respawn to use world spawn, rewrite Claims V1 for overlapping regions with per-flag priority and real `mob-spawn` enforcement, make the existing chat log scrollable with a history cap, and render holograms as 3D billboards instead of a range chat dump.

## Result

Done. No second claims/chat/hologram system. Shared simulation stays Node-safe. Plugins still cannot send raw packets.

## Implemented

- Death respawn uses `WorldInstance.spawn` (`/setspawn`), not `SurvivalSystem.spawnPoint`.
- Claims store partial flags. Overlaps resolve **per flag** by highest explicit priority, else the global default.
- Default flags: `pvp=false`, `mob-spawn=true`, `mob-damage=true`, `block-break=false`, `block-place=false`, `explosions=true`, `player-damage=true`, `item-drop=true`, `item-pickup=true`. `fire-spread` removed.
- `mob-spawn=false` cancels **new** mob creation via cancellable `mobSpawn`. Existing mobs stay. `force` restore/debug bypasses.
- `/claim priority <name> <n>` (−1e6…1e6, default 0). Owner / `claim.admin` / OP.
- `/claim info` shows name, owner, priority, members, volume, own flags, effective flags at feet.
- Backward-compatible migration: old full-boolean flags stay explicit (minus `fire-spread`), priority 0.
- `GameUI` `#chat-log` is overflow-y auto. Desktop wheel on the log, mobile `touch-action: pan-y` when chat is open. Stick-to-bottom; otherwise keep scroll and show «↓ Новые сообщения». Cap `MAX_CHAT_MESSAGES = 200`.
- Server `HologramNetwork` broadcasts `{ type: 'holograms' }`. Client `HologramRenderer` draws facing sprites, range-culls, and removes on delete.

## Changed files

- `server/services/claims.ts`, `server/builtin-plugins/claims.ts`
- `server/events.ts`, `server/pluginEventAdapter.ts`, `server/gameplay.ts`, `src/gameplay/simulationEvents.ts`, `src/entities/MobManager.ts`
- `server/services/holograms.ts`, `server/builtin-plugins/holograms.ts`, `server/WorldInstance.ts`, `server/AnarchyServer.ts`, `shared/protocol.ts`
- `src/rendering/HologramRenderer.ts`, `src/core/Game.ts`
- `src/chat/chatScroll.ts`, `src/chat/ChatLog.ts`, `src/ui/GameUI.ts`, `src/style.css`
- `tests/server/claims.test.ts`, `tests/server/anarchy-plugins.test.ts`, `tests/server/chat-scroll.test.ts`, `tests/chat-commands.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/PLUGINS.md`

## Architecture decisions

- Partial `ClaimFlagMap` rather than `boolean | undefined` sentinels. Missing key = not set.
- Trust for break/place uses the **setter** claim. If nobody set the flag, any overlapping owner/member is trusted so a new empty-flag garden still works for its owner.
- Holograms stay on the existing protocol union. Welcome includes a snapshot because `onMessage` is wired after `connect()`.
- Chat scroll is DOM-only. No server involvement. `#chat` stays `pointer-events: none` except when open; the log is clickable on fine pointers so desktop can wheel without opening T, while mobile does not steal the joystick.

## Tests

- Default flags, migration, per-flag priority, spawn/arena PvP vs block-break, `mob-spawn` cancel + keep existing, priority command permissions, respawn at `/setspawn`.
- Chat cap 200 and stick-to-bottom helpers.
- Hologram persist + protocol snapshot, no enter-range chat dump.

## Visual QA

Not run in this cloud pass (no live Anarchy client walkthrough). Owner should confirm chat wheel/swipe and hologram billboards in-world.

## Performance

Unchanged meshing/TPS. Chat DOM is capped at 200 lines. Hologram sprites are bounded by protocol (64 holograms, 8 lines).

## Known issues

- Unsetting a flag back to “inherit” is not a command (only `true`/`false`).
- Two owners can still share a claim name; `/claim priority` matches the first stored name.

## Deferred

Hologram animations, clicks, pages, actions, placeholders. Auction House.

## Next work

Owner QA of spawn/arena overlap, chat scroll on a phone, and hologram visibility/range.

## Git

Branch `cursor/claims-chat-holograms-3f93` from `cursor/nickname-console-3f93`.
