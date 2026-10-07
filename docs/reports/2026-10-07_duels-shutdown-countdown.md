# Duels: server shutdown, countdown heal, restore look — 2026-10-07

## Goal

Fix three lifecycle bugs without changing the accepted 1v1 rules, visuals, or icon.

## Result

Server shutdown during an active duel no longer forfeits the first disconnected player. Countdown acceptance no longer heals. Cancelling a countdown or fight sends one restore look to each still-connected participant.

## Implemented

- `AnarchyServer.stop()` calls `WorldInstance.prepareForServerShutdown()` before it iterates sockets. That calls `DuelService.shutdown()` while both players are still connected. Countdown and fighting cancel: pre-duel poses return, stats stay unchanged, and no forfeit drops are created. The later plugin `onDisable` calls `shutdown()` again. The phase is already idle, so the second call does not write a result.
- `onPlayerQuit` is unchanged. A real disconnect during fighting still forfeits. A real disconnect during countdown still cancels.
- `accept()` still validates, captures poses, closes transient UI, faces the players, teleports them, and enters countdown. It does not fill health or hunger or clear fire and effects.
- `enterFighting` calls `preparePlayers` only after both participants are connected and alive. Both are normalized together, then the phase becomes fighting, `БОЙ!` is shown, and the burst and start message are sent. If either participant fails the check, nobody is prepared and the countdown is cancelled.
- `suppressesIncomingDamage` is true for countdown participants, so survival environment damage and explosion damage are skipped for those five seconds. `shouldCancelPlayerDamage` still rejects `playerDamage` during countdown. Loot-winner protection is unchanged.
- `restorePreDuelPose` sends one `player_look` with `reason: 'duel_restore'` when the player is still connected. The client applies it through the existing `applyDuelStartLook` path. Look is not locked.

## Changed files

- `server/AnarchyServer.ts`, `server/WorldInstance.ts`, `server/services/duels.ts`
- `shared/protocol.ts`, `src/core/Game.ts`, `src/net/duelStartLook.ts`
- `tests/server/duels-service.test.ts`, `tests/server/duels-world.test.ts`, `tests/server/anarchy-server.test.ts`
- `tests/duel-start-look-client.test.ts`, `tests/duel-effect-protocol.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

Server shutdown and a player quit stay different calls. The quit path still owns forfeit and countdown cancel. The process-stop path cancels an unfinished match before persistence. Survival normalization waits until the fight actually starts, so a countdown cancel has nothing to roll back. The restore look is one packet, not a field on every snapshot.

## Tests

- `tests/server/anarchy-server.test.ts` — 29 passed, including a real `AnarchyServer.stop()` during fighting with two sockets, then a restart from the same data directory. No win, no loss, diamonds remain, poses are not the arena.
- `tests/server/duels-world.test.ts` — 18 passed. Fighting disconnect still forfeits. Countdown disconnect keeps health 5, hunger 7, fire, and the invisibility effect, and sends `duel_restore`. Fight start still applies the old preparation. Countdown `playerDamage` and 25 survival ticks do not kill. A dead participant aborts fight start with no heal and no burst. Plugin disable during countdown restores pose and look without a heal. Listener-count reload still passes.
- `tests/server/duels-service.test.ts` — 23 passed. Countdown suppresses incoming damage. Refused preparation cancels with no burst and no `DUEL_STARTED`. Shutdown of countdown and fighting still writes no result.
- `tests/duel-effect-protocol.test.ts` — 2 passed. `duel_restore` parses. Unknown reasons and non-finite angles are rejected.
- `tests/duel-start-look-client.test.ts` — 2 passed. `duel_start` and `duel_restore` update input, the local player, and the next predicted command. Mouse delta and a touch swipe still turn away.
- Also green: duel look math (1), local prediction (34), prediction invariant (8), prediction timeline (8), hologram style/timer/hit/transient (10/10/4/1), firework burst (3), game menu GUI (11), server game menu (11), plugin platform (19), server process lifecycle (5, 1 skipped).
- `npm run typecheck:client`, `npm run typecheck:server`, `npm run check:boundaries`, `npm run build`, and `git diff --check` passed.
- `npx vitest run` — 3171 passed, 22 failed, 1 skipped, 340 files. The 22 failures are the previously recorded set: arrow panel UVs, classic combat presentation (2), fence jump, production MP3 count (2), remote breaking overlays (13), pet hit registration (2), bow draw FIFO. Passed count is 7 above the previous 3164, matching the new tests. No duel test failed. Local Vitest, not GitHub CI.

## Visual QA

Not repeated in this pass. The task states that ordinary two-client DEV gameplay and visual QA had already passed. Hologram size, font, burst, and the menu icon were not changed.

## Performance

No meshing, tick-rate, or particle-budget change. Shutdown adds one idle-safe duel cancel before the existing disconnect loop.

## Known issues

The 22 full-suite failures above remain. TNT and `/kill` during a duel are still deferred to spawn and claim permissions.

## Deferred

No survival rollback of durability or consumables used after the fight has started. Server shutdown keeps the state the fight already reached and only refuses a false forfeit.

## Next work

Manual check of a restart during a live fight, if a second DEV pass is requested. Draft PR **#122** stays open.

## Git

Branch `cursor/duels-plugin-arena-1v1-6694`. Not merged. No rebase and no force push.
