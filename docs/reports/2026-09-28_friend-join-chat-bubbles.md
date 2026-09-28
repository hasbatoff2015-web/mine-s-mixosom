# Friend join notices and player chat bubbles

## Goal

Tell online friends when a player actually comes online, and show that player's chat line above their nameplate for five seconds.

## Result

`WorldInstance.join` notifies mutual online friends only on an offline → connected edge. The line is ordinary system chat: `<ник> зашел в игру.` A real disconnect of the current connection sends `<ник> вышел из игры.` A second tab that replaces a live socket does not send either line.

`PlayerChatBubble` is a transient sprite on `RemotePlayerView`. The client builds it from a delivered player `ServerChatMessage`. There is no new protocol packet.

## Implemented

- `friendJoinChatText`, `friendLeaveChatText`, and `notifyFriendsOfPresence`. `wasConnected` is captured before `existing.connected = true`. New players and stored restores always notify on join. Leave runs only after `disconnect` accepts the live connectionId, sets `connected = false`, emits `playerQuit`, and broadcasts `player_left`. The joiner, strangers, pending requests and offline friends do not receive the line. One `crypto.randomUUID()` is shared by every recipient of that presence event. No `style`, no `NotificationService.notify`.
- `PlayerChatBubble` plus pure `wrapPlayerChatBubbleText` / `PlayerChatBubbleState` (32 columns, word wrap, hard wrap, 5000 ms). A new line replaces the previous one and restarts the timer. Canvas repaints only when the text or layout key changes. A canvas size change allocates a new `CanvasTexture` because Three.js does not resize `texStorage2D` on `needsUpdate`.
- The bubble sits above the nameplate, uses the hologram canvas helpers and `#fff7c2`, and follows the remote group. Invisibility and nameplate distance fade hide it. `reset` clears it. `dispose` releases the sprite, texture and material.
- `Game` calls `presentRemoteChatBubble` for `kind: 'player'` and passes the render `now` into `updateNameplate`. System, command and error lines do not create a bubble. The local player is not in `remotes`.

## Changed files

- `shared/friends.ts`
- `server/WorldInstance.ts`
- `src/core/Game.ts`
- `src/net/RemotePlayerView.ts`
- `src/rendering/player/PlayerChatBubble.ts`
- `src/rendering/player/playerChatBubbleLayout.ts`
- `tests/player-chat-bubble.test.ts`
- `tests/player-nameplate.test.ts`
- `tests/server/friend-join-chat.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`

## Architecture decisions

Chat delivery stays server-owned. The bubble is client presentation of a message the server already chose to deliver, so Clan and Nearby text is not broadcast to outsiders. World holograms stay persistent and editable; this bubble does not join that system. Session resume is not the online edge: `connected` before the join is.

## Tests

Targeted Vitest: 9 files, 84 tests, all passed. `typecheck:client`, `typecheck:server` and `npm run build` passed. GitHub CI was not run from this branch.

## Visual QA

Not run in a browser here. DEV checklist is in the task report: two clients, second tab, reconnect, long Russian text, global / nearby / clan, invisibility, leave before five seconds.

## Performance

One sprite and one canvas texture per remote player. Frames only update expiry, opacity and scale.

## Known issues

None found in the targeted suite.

## Deferred

Self bubble over the local model. Unread friend badge. Stacked bubbles.

## Next work

Manual QA on `https://dev.megacraft.agariobrainrot.ru` after `dev-switch cursor/friend-join-chat-bubbles`. Do not merge before that.

## Git

Branch `cursor/friend-join-chat-bubbles` from `origin/main` `0b7b06d27603e892cf2a6e75eb3f85d282ac3506`. Not merged. Production and the DEV VPS were not changed.
