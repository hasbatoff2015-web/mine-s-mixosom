# Input, PvP timeline, teleport epoch, client settings — 2026-10-04

## Goal

Fix four reported online bugs without giving the client authority over position, damage, flight, or hit results:

1. Holding jump and spinning the hotbar wheel made movement hitch and prediction unstable.
2. Settings (FOV and the rest of that menu) reset on the next entry.
3. After a teleport, and sometimes without one, the player could be hit but could not hit anyone until reconnect.
4. While running, the local player could be far ahead of the pose other clients and the server were still hitting.

## Result

Hotbar selection is local until the next normal physics input or a same-frame action. The command queue keeps about four continuous commands (200 ms at 20 TPS) instead of up to 32. A hard teleport or respawn opens a new `movementEpoch` and drops pre-epoch movement, combat history, and pending actions. Client settings persist in `localStorage`. `MAX_PENDING_MELEE_TICKS` stays 8. `MAX_PVP_REWIND_TICKS` stays 5. Reach, occlusion, armor, Claims, and hurt resistance stay server-owned.

## Reproduced bugs

### BUG 1 — jump + wheel

On `main` at `a45b0ed`, `Game.commitOnlineHotbarSelect` did `inputSeq += 1`, sent a full `input` with `jump: false` / `manualJump: false`, and called `predictLocalMove`. Each wheel notch was a fake physics tick. Held Space (`jump: true`) then a wheel event (`jump: false`) then the next real tick (`jump: true`) created false jump edges, extra Y motion, and prediction corrections. A fast wheel also enqueued commands faster than 20 TPS.

After the fix, `commitOnlineHotbarSelect` only stores `pendingHotbar`. Fifty selections do not change `inputSeq`. The next normal input carries `selectedSlot`. A same-frame attack/use carries `action.selectedSlot`, and the server reads its own inventory slot.

### BUG 2 — settings

FOV, sensitivity, volume, render distance, and clouds lived only on `Game.settings` and a separate `GameUI` default object. Nothing wrote `localStorage`. A new `Game` or a page reload constructed the defaults again.

They now load once through `loadClientSettings` into `Game.settings`. The UI copies that object with `adoptClientSettings`. Apply sanitizes, writes `megacraft.settings.v1`, and applies the same object to audio, input, camera, fog, and clouds. Starting an online session does not assign `this.settings`.

### BUG 3 — attacks stop working

Two confirmed failure modes, both cleared by `resetConnectionInput` on reconnect:

- A burst of continuous commands could leave the FIFO up to 32 deep (about 1.6 s). The server still applies one command per tick. A new attack waits for its `commandSeq`. `MAX_PENDING_MELEE_TICKS` is 8, so the attack becomes `pending_timeout` / `stale` and deals no damage. Incoming attacks do not wait on the victim's outgoing queue, so the player can still be hit.
- `TeleportService` only called `controller.teleport`. Queued pre-teleport movement, combat history, and pending attacks stayed on the old timeline. `combatPoseAtTick` lerped any before/after samples, including a teleport from x=10 to x=500.

Not confirmed as a separate "damage bubble". Hurt-resistance `immune` is unchanged and is not this bug.

### BUG 4 — distant hits / desync

Part of the "I am far ahead, they still hit me" report is the same command backlog: the server (and therefore other clients) were still applying old movement while the local prediction had moved on. Remote players are also rendered about 80–180 ms in the past (`REMOTE_INTERP_DELAY_MS` 100). Melee may rewind a target up to 5 ticks (250 ms) when the rendered pose was actually in reach. That rewind is kept. It is not a client-authored hit.

No extra reach was found inside the existing five-tick window beyond the honest rewind contract, so `MAX_PVP_REWIND_TICKS` was not reduced. A forged future tick or a tick older than five is already `stale`. A tick from before the target's `movementEpoch` is now `stale` as well.

## Architecture decisions

- `COMMAND_QUEUE_LATENCY_BUDGET = 4`. `COMMAND_QUEUE_MAX = 32` remains the hard safety cap.
- `compactContinuousCommands` drops only a contiguous head prefix. It stops at an edge, a protected seq, or the budget. `mergeDroppedRange` returns undefined when the ranges are not adjacent, so a snapshot cannot tell the client to discard a command the server kept.
- Edges: jump, manualJump, use, mining, sneak, sprint, descend, flySprint, selectedSlot, vehicleForward. Steady `jump: true` may compact once the press edge is already applied or retained.
- Pending melee, bow release, entity-use, and bow-release boundary seqs are pinned before enqueue.
- `movementEpoch` starts at 0 on `ServerPlayer`, `PlayerSnapshot`, and optional `ClientInputMessage`. `hardRelocatePlayer` / `rebaseAfterHardRelocation` cover plugin and service teleports (`/spawn`, `/home`, `/tpa`, RTP, clan base, and the other `TeleportService` callers) plus respawn. Walking, knockback, minecart motion, bed stand-up, and a cancelled `playerMove` do not bump the epoch.
- Rebase does not call `resetConnectionInput`. `lastInputSeq`, `lastActionSeq`, and `appliedCommandSeq` stay. Queued movement is replaced with an idle sticky command. Pending actions get `reason: stale` (bow reject reason `teleport`).
- An input with a present `movementEpoch` that does not match is not enqueued. `lastInputSeq` still advances, so a later higher seq on the new epoch is accepted.
- Local prediction on a new epoch snaps to the snapshot and drops unacked entries. It does not replay them. Remote interpolation resets its buffer on an epoch change. `REMOTE_TELEPORT_DISTANCE = 6` remains a fallback.
- Combat and mob pose samples carry an epoch. Interpolation across epochs returns undefined. Pet hard teleport increments `poseEpoch` and clears pose history.
- Melee `itemSlot` is the validated action slot. Attacker geometry stays on `CombatPoseSample`. Bow release still requires the pose slot to match; it was not switched to the melee slot rule.
- Settings schema version is `1`. Bad JSON falls back to defaults. A bad field falls back alone. Out-of-range numbers clamp. `localStorage` failures do not throw into startup. Writes happen on Apply, not per frame.

## Changed files

- `src/core/Game.ts` — hotbar no longer sends input; epoch snap; settings load/save; DEV F3 epoch/queue/pending melee.
- `src/ui/clientSettings.ts` — new store.
- `src/ui/GameUI.ts` — `adoptClientSettings`.
- `src/net/hotbarSelection.ts` — comments match the new contract.
- `src/net/localPlayerPrediction.ts` — `rebasePredictedPlayerAfterMovementEpoch`.
- `src/net/remotePlayerInterpolation.ts` — epoch snap.
- `shared/playerCommand.ts`, `shared/commandCompaction.ts`, `shared/protocol.ts`.
- `server/playerCommandQueue.ts`, `server/WorldInstance.ts`, `server/gameplay.ts`, `server/combatPoseHistory.ts`.
- `src/entities/mobPoseHistory.ts`, `src/entities/MobManager.ts`.
- Tests listed below.
- `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`.

## Tests

New or updated coverage:

1. Space/wheel does not call `predictLocalMove` or bump `inputSeq` (`tests/hotbar-not-physics.test.ts`).
2. Fifty selections keep the same command seq.
3. Same-frame slot 5 attack uses the diamond sword in slot 5.
4. Rapid slot 3 attack uses slot 3.
5. A 15-command continuous burst compacts to the budget of 4.
6. Jump, sneak, descend, manualJump, use, mining, slot, sprint, and flight edges at the head are kept.
7. `queueCompacted` for continuous + edge does not include the retained edge; `discardCompactedPrediction` drops only that range.
8. A protected command seq survives a later continuous burst. World tests cover pending melee, bow, and entity-use.
9. Teleport clears pre-epoch jump/forward. The player does not jump at the destination.
10. An old-epoch packet is ignored; a higher seq on the new epoch is accepted. `lastInputSeq` is not reset to 0.
11. Local prediction discards N unacked moves on an epoch change and does not replay them.
12. Remote interpolation from x=10 epoch 0 to x=100 epoch 1 holds x=100 (`sampleCount === 1`).
13. Combat and mob rewind across an epoch is undefined. A live victim teleport makes an old `targetRenderTick` `stale`.
14. The first post-teleport melee hits without reconnect. A pre-teleport pending attack is `stale` and does not land.
15. A pre-teleport bow release does not spawn an arrow. A new draw/release after the epoch does. Existing `tests/server/bow-pvp-timeline.test.ts` still passes.
16. Settings: defaults, round-trip, malformed JSON, partial object, clamp, and online start does not rewrite settings.
17. The pending-timeout test still expects `pending_timeout`, but the backlog is alternating jump edges so the budget cannot collapse it. A separate test shows an identical continuous burst still hits.

`tests/classic-combat-integration.test.ts` two movement tests fail on `origin/main` as well (`InputManager` stub has no `sneak` state). They are not caused by this change.

## Manual QA

NOT MANUALLY VERIFIED. No two-client session and no DEV deploy were run in this pass. Production was not touched.

## Performance

No per-frame `localStorage` write, no input packet per wheel event, no extra physics tick per selection, no unbounded history. Combat history caps are unchanged. Queue compaction shortens bursts.

## Known issues

- A jump (or other edge) sitting at the head blocks prefix compaction until that command is consumed. A malicious alternating-edge burst fills the queue to 32. Further packets are rejected as `overload` and are not simulated. Ordinary WASD still compacts to 4 and is not rejected. See the follow-up below. The first version of this branch shifted those accepted edges off the head. That is no longer the case.
- `targetRenderTick` inside five ticks is still a hint the server honors when the authoritative pose at that tick is in reach. That is the lag-compensation contract, not an extra exploit found in this pass.
- Bed enter/exit and movement-cancel rollback stay on the same epoch. They are continuous local motion, not a server teleport.
- Two-client running desync was not measured live. The queue budget removes the chronic 10–30 tick delay that produced it. Normal interpolation delay remains.

## Deferred

- A server-owned estimate of the exact render tick the client should have seen, beyond epoch + max rewind + authoritative ray/reach/occlusion.
- DEV two-client latency QA.

## Follow-up — hard overload admission

The first queue cap shifted the head whenever `length > 32`, including jump and other edges, and stopped entirely when that head seq was pinned. A pinned head let the array grow past 32. The regression that expected jump seqs 1..2 to disappear was describing that bug.

Admission is now:

- Soft budget stays 4. Only a contiguous continuous prefix is removed. Edges and pinned seqs stay.
- Hard bound is `COMMAND_QUEUE_MAX` (32) queued commands. There is no extra reserve. A command that still does not fit is not pushed. `enqueue` returns `overload`.
- `lastEnqueuedSeq` is the highest seq the queue has seen, including rejects. A repeat of that seq is `duplicate`. A higher seq is eligible. `lastInputSeq` in `applyInput` still moves first, so the packet filter matches.
- The client hears every skipped span through `queueSkippedRanges` (max 8, adjacent spans merged). `queueCompacted` is sent only for a single span. A prefix drop of 1..5 plus a later reject of 21..23 is two ranges. It is not reported as 1..23.
- Ranges are copied onto the snapshot and cleared after that flush, so the same span is not replayed forever. WebSocket delivery is ordered, so one snapshot is the notification.
- An overload seq is remembered until teleport or reconnect. A bow, melee, or entity-use that was waiting on it, or that arrives later, is `command_overload` immediately. It does not sit until `pending_timeout`. A boundary already in the queue is left there. If it is deeper than 8 ticks, the existing `pending_timeout` test still applies. That timeout was not raised.
- Teleport still discards the queued array, bumps `movementEpoch`, and does not rewind `lastInputSeq`. Pre-epoch input is not simulated. The next higher seq on the new epoch is accepted.
- DEV F3 shows queue depth, compaction count, overload count, and pending melee. Overload is not logged unless `FC_DEBUG_NET=1`.

`MAX_PENDING_MELEE_TICKS` remains 8. `MAX_PVP_REWIND_TICKS` remains 5. Settings, remote interpolation, reach, armor, Claims, and hurt resistance were not changed.

## Follow-up — skipped-range overflow

`recordDroppedRange` stops at 8 disjoint spans and returns false. `noteOverload` ignored that false. The command stayed out of the FIFO, the seq high-water moved past it, and the client was never told. A 1000-packet edge burst did not show this: those rejects are adjacent and merge into one span.

When the exact list cannot take another disjoint skip, the queue sets `notifyOverflow` to that seq. Until `clearNotifiedSkips` (the snapshot flush), every newer command is also `overload`, even if a tick freed a slot, and the span grows as one suffix. The snapshot sends `queueSkippedRanges` (max 8) and `queueSkippedOverflow`. The client discards both and does not join them across the gap. `queueCompacted` is omitted while the suffix is present.

Action classification keeps the suffix after the flush (`actionRejectSuffixes`, cap 8, oldest dropped). Teleport and reconnect clear it. `PROTOCOL_VERSION` is 4. A v3 join is `unsupported protocol 3`.

## Next work

Manual QA on DEV for jump+wheel, settings reload, post-teleport melee, and two-client sprint. Do not merge from this report.

## Git

Feature branch off `origin/main` `a45b0ed`. Draft PR only. Production untouched.
