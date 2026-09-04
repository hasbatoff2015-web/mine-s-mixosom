# Online command pipeline v2

Date: 2026-09-04  
Source branch: `cursor/remote-player-interpolation-86e1`  
Source SHA: `ade7113122a9cdc5949ff34b10f19e17918285cb`  
Working branch: `codex/online-command-pipeline-v2`

## Goal

Remove the ambiguous Online movement/action timelines that cause local correction jitter, delayed-target block placement, delayed-look bow aim, and remote freeze/step motion. The governing contract is: the client owns captured intent; the server validates it and owns the result.

## Baseline

The requested `git fetch` could not write `.git/FETCH_HEAD` in the managed workspace and elevated fetch was denied. A read-only `git ls-remote` verified the current remote heads instead:

- `cursor/online-prediction-remesh-86e1` = `fd02b677c76652481f382a08177bcd81318252f4`;
- `cursor/remote-player-interpolation-86e1` = `ade7113122a9cdc5949ff34b10f19e17918285cb`;
- `main` = `4d803e5de22e551e3f71941c0abb03c91e78cf4c`.

The remote-interpolation branch contains the prediction branch and is one commit ahead, so it is the source. `main` was not merged.

Baseline focused gate:

```text
npx vitest run tests/prediction-timeline.test.ts tests/local-player-prediction.test.ts tests/server/client-server-lockstep.test.ts tests/local-motion-pipeline.test.ts tests/server/anarchy-server.test.ts tests/remote-player-interpolation.test.ts tests/remote-player-view.test.ts tests/remote-interp-diagnostics.test.ts tests/use-interaction.test.ts --maxWorkers=2

9 files, 108 tests passed.
```

## Old architecture / call graphs

### Client movement

```text
InputManager
-> Game.tickOnline
-> inputSeq++ / ClientInputMessage
-> AnarchyClient.send
-> predictLocalMove
-> PlayerController.tick
-> PredictionBuffer history keyed by client prediction tick and input seq
-> LocalPlayerRenderState
```

### Server movement

```text
WebSocket message
-> AnarchyServer.handlePlayMessage(input)
-> WorldInstance.applyInput
-> replace ServerPlayer.lastInput (latest-state sampling)
-> WorldInstance.simulateGameplayTick
-> tickConnectedPlayers
-> shared PlayerController.tick
-> ServerPlayer.snapshot / player_state
```

One input sequence can be used for several server ticks, several input sequences can be coalesced before one server tick, and skipped sequences are never simulated.

### Old reconciliation

```text
player_state WebSocket callback
-> Game.applyOnlinePlayerState
-> overwrite one latest pending snapshot slot
-> next Game.tickOnline / flushPendingLocalSnapshot
-> reconcilePredictedPlayer
-> synthesize comparable = lastAckedState + N repeats of latest input
-> accept bookkeeping, or authoritative restore + replay
```

This is ambiguous for changing inputs and loses the applied intervals of overwritten snapshots. `physicsTicks`, `inputSeq`, and `serverTick` do not identify the exact sequence of input states used across the full unacknowledged interval.

### Old block use

```text
client crosshair raycast
-> send generic `interact`
-> server processes later
-> ServerGameplay.useHeld
-> server raycasts from current position/yaw/pitch
-> use/place relative to the delayed server hit
```

The packet does not contain the clicked block, face, hit point, selected slot, action sequence, or movement context.

### Old bow release

```text
client sends input.use=false
-> server latches release
-> next server gameplay tick
-> ServerGameplay.releaseBow
-> direction from then-current PlayerController yaw/pitch
```

The release packet does not capture aim. A later look input can change the projectile direction.

### Existing remote presentation

```text
player_state.tick
-> RemoteInterpolationBuffer (8 samples)
-> estimated server tick - fixed 100 ms
-> interpolation
-> <=100 ms velocity extrapolation on underflow
-> capped hold
-> PlayerVisualAnimator
```

The sample timeline is already server-tick based. The remaining v2 work is adaptive bounded delay and richer jitter/buffer telemetry, while preserving the short bounded extrapolation and teleport/reset behavior.

## Result

Protocol v2 removes delayed intent reconstruction. Movement ACKs now contain the exact bounded authoritative applied-command timeline; discrete block and bow actions carry their captured context and a separate replay-safe action sequence; remote players use a bounded adaptive server-tick presentation buffer. Shared physics, fixed 20 TPS, WebSocket transport, persistence, plugin hooks, and server authority remain in place.

## Root causes

- **Local jitter:** `inputSeq` identified a latest movement state, but reconciliation sometimes treated it like a simulated physics checkpoint. Client commands can be coalesced while one server command can be sampled across several ticks. Repeating one latest input over a `serverTick` gap cannot reconstruct transitions, so valid snapshots could compare against the wrong historical pose.
- **Block placement/break:** a generic `interact` or delayed server raycast omitted the client-selected target, face, hit point, slot, and command context. The server could authoritatively raycast a different adjacent block after position/look changed.
- **Bow aim:** release was inferred from `input.use` becoming false and used then-current server yaw/pitch, so a newer look command could rotate the shot away from the release aim.
- **Remote jitter:** a fixed 100 ms delay ignored real arrival jitter. Short underflow alternated bounded coast and new samples without an explicit recovery phase, producing visible freeze/step transitions.

## New architecture

### Movement timeline semantics

```text
input sample
→ movement command seq
→ local fixed-tick prediction
→ server latest-state sampling at fixed 20 TPS
→ AppliedInputTick(serverTick, seq, full movement command)
→ player_state ACK
→ exact scratch historical replay
→ accept no-op or authoritative restore + replay newer commands
→ local adjacent-pose render interpolation
```

`seq` is a monotonic movement command/state id. `serverTick` is the authoritative simulation checkpoint. `inputSeq` ACKs the latest command sampled by that checkpoint, while `appliedTicks` describes every server tick and complete movement state needed to reproduce the interval. One command may occur in multiple rows. Coalesced/skipped seqs have no row and are never invented. The client filters rows after `lastAckedServerTick`, requires a contiguous exact interval, runs the shared `PlayerController` on scratch state, and compares that pose. A match changes bookkeeping only. A mismatch restores the authoritative snapshot and replays buffered client commands with `seq > inputSeq` once. The server trace is capped at 16 rows; an interval outside the cap takes a deterministic correction instead of a heuristic replay.

### Action semantics

Every discrete action has a session-local monotonic `actionSeq`, the movement `commandSeq` at capture, and the captured `selectedSlot`. The server consumes the action sequence once, rejects replay/out-of-order and future command context, and rechecks the live selected slot.

Block hit messages carry target xyz, target block id, axis face, and world-space hit xyz. Server validation checks player alive, bounds, finite/inside hit, exact current block id/non-Air, reach from authoritative eye, line of sight, and exact first ray hit/face. The validated target is passed to shared use/placement/mining logic. No delayed raycast can substitute target B for captured target A. Breaking is explicit start/abort/finish and remains progress/server-authoritative.

Bow release is an explicit edge with captured yaw/pitch. Server validation owns held item, active draw, minimum charge, action dedupe, arrow availability/consumption, and projectile spawn. Direction is derived from captured look; server-side spread is zero for this exact release vector. Singleplayer retains its existing default spread path.

### Remote interpolation

Remote samples stay keyed by monotonic `player_state.tick`. Each buffer holds at most 12 snapshots. Arrival jitter is measured against the expected `tickGap × 50ms`; delay is `clamp(100ms + p95, 80..180ms)`. The renderer interpolates enclosing authoritative ticks, extrapolates velocity for at most 100 ms on real underflow, then holds the cap. Arrival after extrapolation blends recovery for at most 100 ms. A six-block discontinuity and dead→alive reset snap the timeline. Diagnostics expose arrival p50/p95, chosen delay, buffer depth ms, underflow, extrapolation, and stale counters.

## Files / subsystems

- Protocol/config: `shared/config.ts`, `shared/protocol.ts`.
- Client command capture and dispatch: `src/net/playerActions.ts`, `src/net/AnarchyClient.ts`, `src/core/Game.ts`, `src/gameplay/useInteraction.ts`.
- Server validation/authority: `server/playerActionValidation.ts`, `server/WorldInstance.ts`, `server/gameplay.ts`, `server/AnarchyServer.ts`.
- Prediction/diagnostics: `src/net/localPlayerPrediction.ts`, `src/net/correctionDiagnostics.ts`.
- Remote presentation/diagnostics: `src/net/remotePlayerInterpolation.ts`, `src/net/remoteInterpDiagnostics.ts`.
- Projectile seam: optional spread parameter in `src/combat/PlayerArrowManager.ts`; existing SP call sites keep the old default.
- Local launcher: `scripts/dev-anarchy.mjs` (removed an invalid TypeScript return annotation from executable JavaScript).
- Tests: new applied-timeline and player-action matrices plus updated protocol, WebSocket, persistence, remote, gameplay, plugin, and use tests.

## Tests

Baseline before edits: focused 9 files / 108 tests passed.

Implemented deterministic coverage:

- 25 applied-timeline cases: sustained modes, jump/flight, packet phases/batches, repeated command ticks/catch-up, transitions, jump latch, rapid yaw, continuous turning, and deterministic incomplete-trace correction.
- 13 explicit-action cases: placement during movement, target flick, invalid/replayed intents, break lifecycle, exact bow release in four locomotion states, later-look independence, survival/Creative ammo and charge rules.
- 24 remote perfect/jitter/delay/batch/missing/stale/teleport/respawn/walk/jump/stop/extrapolation cases, including the 12-snapshot cap.
- Updated live WebSocket and persistence cases use protocol-v2 messages and verify legacy `block_result` rejection.

The final command results are recorded at the end of this report after the release gate.

## Manual QA

Run one local server and client A. Test sustained walk/sprint/strafe, jump/land, Creative hover/ascend/descend, direction transitions and rapid mouse turning. Expected: stable presentation, `corr/s=0` under ordinary localhost delivery, and no accepted ACK writes to local motion. Place/use/break while moving and while flicking from target A to B; only A may mutate. Abort and restart breaking. Fully charge a bow, release, then immediately flick; the arrow must keep the release direction and consume exactly one Survival arrow (none in Creative).

Open client B with an independent session. Observe A walk/sprint/strafe/jump/fall/fly, abruptly stop, teleport, die/respawn. With `?remoteDiag=1`, expect adaptive delay within 80–180 ms, ordinary localhost underflow near zero, no permanent freeze-step, no glide through jump/fall, ≤100 ms coast only when packets are truly missing, and a clean teleport/respawn snap. Finally smoke Singleplayer movement, placement, breaking, and bow use.

## Performance

- Simulation remains fixed 20 TPS; no extra world or gameplay tick was added.
- Server records one applied-command row per player per physics tick in a bounded 16-row array. Those rows are sent only to their owning client; remote snapshots omit them, so the new payload is O(16) per connection rather than multiplied by observed players. It does not grow with session length.
- Client prediction history remains capped at 64. Exact comparison uses one scratch controller over at most the received trace, with no live-world mutation.
- Remote buffer grows from 8 to 12 snapshots and keeps only 32 arrival-jitter samples. Interpolation/recovery is render-only and O(buffer size).
- Action packets add captured context only on discrete use/break/release events, not every frame.

## Known limitations

- The authoritative applied timeline is bounded. A client stalled beyond the retained 16 ticks intentionally corrects to the server instead of reconstructing missing history.
- `action_result.ok` means the validated intent was accepted for authoritative processing; plugins or gameplay rules may still prevent a requested mutation, whose truth remains the subsequent block/inventory state.
- Remote held-item/appearance and attack/mining/bow/eating animation metadata are still outside this protocol pass.
- Manual native pointer-lock/two-client visual acceptance must be performed by the owner on the target machine.
- The first localhost launcher attempt exposed a pre-existing JavaScript syntax error in `scripts/dev-anarchy.mjs` (`(): void` in an `.mjs` file); the annotation was removed and `node --check` passes.

## Branch / final SHA

- Source branch: `cursor/remote-player-interpolation-86e1`.
- Verified remote source SHA: `ade7113122a9cdc5949ff34b10f19e17918285cb`.
- Working branch: `codex/online-command-pipeline-v2`.
- Final SHA: pending. The managed environment rejected permission to create git commits; the complete change remains in the working tree for review.

## Final validation results

```text
npm run typecheck                                      PASS
npm run typecheck:sim/client/server                    PASS
npm run check:boundaries                               PASS
npm run smoke:sim                                      PASS
npm run smoke:server                                   PASS
npm run test:sim                                       PASS — 9 files / 42 tests
focused networking/action/prediction/remote gate       PASS — 10 files / 147 tests
prediction regression recheck                          PASS — 3 files / 63 tests
npm run build                                          PASS
npm run check:size / check:archive                     PASS — 3.96 MiB / 284 files
node --check scripts/dev-anarchy.mjs                    PASS
npm test -- --maxWorkers=2                             1458 pass / 19 fail / 1 worker error
npm run test:server                                    111 pass / 2 fail
```

The full/server failures are not in the new networking paths: heavy worldgen/minecart cases exceed the repository's 5 s default on this host; `minecraft-reference-extractor.test.mjs` has an existing parse error; the closed `GeneratedItemGeometry` source hash already differs; and `tick-load-flight` measures 97–106 ms max against its 80 ms threshold despite that streaming code being untouched. A concurrent persistence case timed out in `test:server` but passes sequentially 6/6. The ordinary tick-latency test passes (observed max gameplay 9.86–15.40 ms).

Local browser smoke reached the Anarchy HUD through a protocol-v2 welcome; server telemetry held 19.8–20.2 TPS, ~20 snapshots generated/s and ~18–20 sent/s. The automation viewport was portrait and the rotate overlay correctly blocked pointer-lock gameplay, so movement/action and two-client visual acceptance remain the manual owner checklist above.
