# Display nickname + server console

## Goal

Two small independent additions on the Anarchy plugin-platform branch:

1. A local display nickname (main-menu «Аккаунт») sent on join. Not an account system.
2. A trusted `ConsoleCommandSender` that reads server stdin and dispatches through the existing `CommandRegistry`.

## Result

Done. No second plugin system, no auth/OAuth/Yandex SDK, no playerId rewrite, no Networking V2 / farming / claims / mesher changes.

## Implemented

### Nickname

- Shared `sanitizePlayerName` (`shared/playerName.ts`): non-empty, max 16, no spaces/control chars, Latin/Cyrillic/digits/`_`/`-`.
- Client persists in `localStorage` key `fc.player.nickname`.
- Main menu button «Аккаунт» opens a panel (current nick, input, Save, Back) on the existing `GameUI` stack.
- `AnarchyClient` join payload includes the stored nick when valid.
- `WorldInstance.join` still falls back to `Player-XXXX` (`Player-` + first 4 hex chars of the UUID). `playerId` stays a UUID.

### Console

- `CommandSender.kind === 'console'` with `hasPermission(...) === true`.
- `server/index.ts` attaches stdin after `AnarchyServer.start()`. Tests that construct `AnarchyServer` do not get a stdin listener.
- `op Misha` and `/op Misha` both go through `CommandRegistry`. Replies print to stdout. Unknown commands do not crash the process.
- Plugin extra-checks that call `api.hasPermission(sender.playerId, …)` treat `playerId === 'console'` as a bypass. A player nicknamed `Console` is not privileged.

## Changed files

- `shared/playerName.ts` (new)
- `shared/protocol.ts`
- `src/net/playerNickname.ts` (new)
- `src/net/AnarchyClient.ts`, `src/net/index.ts`
- `src/ui/GameUI.ts`, `src/core/Game.ts`, `src/style.css`
- `server/commands.ts`, `server/WorldInstance.ts`, `server/PluginManager.ts`, `server/AnarchyServer.ts`
- `server/console.ts` (new), `server/index.ts`
- `tests/player-nickname.test.ts` (new), `tests/server/console-and-nickname.test.ts` (new)
- `tests/ui-main-integration.test.ts`, `tests/plugin-boundaries.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/PLUGINS.md`

## Architecture decisions

- Nickname is display-only. Identity remains `playerId` + `sessionToken`.
- Do not rename a live session from the Account menu; the panel states the nick applies on the next connect.
- Console is not modeled as a player and is not seeded into `PermissionService` / `FC_OPERATORS`.
- No second command dispatcher.

## Nickname flow

```text
Account panel → localStorage fc.player.nickname
        → Game.connectOnlineServer → AnarchyClient join.name
        → parseClientMessage sanitizePlayerName
        → WorldInstance.join({ name })
        → ServerPlayer.name (playerId stays UUID)
```

Unset or invalid nick → omit `name` → `Player-${id.slice(0, 4)}`.

## Console flow

```text
process.stdin (server/index.ts)
        → attachServerConsole
        → AnarchyServer.dispatchConsole
        → WorldInstance.dispatchConsole
        → normalizeConsoleCommand (optional /)
        → CommandRegistry.dispatch(createConsoleCommandSender())
        → stdout
```

## Tests

Covered:

1. Player without permissions cannot `/op`
2. Console can `/op`
3. Console `hasPermission` is true for any node
4. Console can `/plugins list`
5. Nickname persists in injected local storage
6. Valid nick is placed on the join payload / accepted by `parseClientMessage`
7. Unset nick keeps `Player-XXXX`
8. `playerId` is not replaced by the nick

## Visual QA

Main-menu Account panel on the existing menu stack (button, current nick, validation, save, back).

## Performance

No tick/mesh/network hot-path changes.

## Known issues

Changing nick while already connected does not retitle the live `ServerPlayer`. Reconnect to apply.

## Deferred

Registration, login, password, email, OAuth, Yandex SDK, avatars, friends, account DB.

## Next work

Owner QA: set nick, join Anarchy, confirm chat/list/commands show it; `op <nick>` from the server terminal.

## Git

Branch `cursor/nickname-console-3f93` from `cursor/anarchy-plugin-platform-3f93`.
