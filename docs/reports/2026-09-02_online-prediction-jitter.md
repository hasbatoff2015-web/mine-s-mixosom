# Online Anarchy: prediction-history jitter fix

Date: 2026-09-02  
Branch: `cursor/online-prediction-remesh-86e1` (PR #37)  
**Do not merge main.**

## Goal

Localhost Online Anarchy movement must feel like singleplayer. Manual QA after the first prediction pass still saw 20 Hz jitter on walk, sprint, jump, strafe, creative flight, and fly+SHIFT descend. Urgent block remesh stays.

Do not change GRAVITY, JUMP_VELOCITY, WALK_SPEED, SPRINT_SPEED, 20 TPS, or offline physics.

## Exact root cause

`reconcilePredictedPlayer` ran on **every** `player_state`:

1. Restore the snapshot pose onto the live `PlayerController`.
2. Replay every unacked input.
3. Compare **current live pose vs post-replay pose**, not snapshot-at-N vs predicted-at-N.

History stored inputs only, not the predicted movement state after each `seq`. Even a correct prediction was rewound every 50 ms. `PlayerController.tick` copies `previousPosition = position` at the start of each replayed tick, so render interpolation (`previousPosition → position`) saw a new pair at packet rate. Tiny float/timing differences after replay became visible 20 Hz jitter.

Server semantics made this worse if treated as “replay every skipped seq”: `lastInput` is replaced between ticks; each server tick simulates **that one** input once. `PlayerSnapshot.inputSeq` is `lastInputSeq` for that tick, not a guarantee that seq N-1 was simulated.

## Prediction-history design

Bounded 64 entries:

```text
{ seq, input: PredictedMove, state: PlayerMovementState after that tick }
```

`PlayerMovementState` is movement-only: position, velocity, onGround, sneak/sprint, jumpHeld, isFlying, flyWindowTicks, flyIgnoreGroundTicks, onLadder, fallDistance, meleeKnockback. No health/inventory/world/combat.

`predictLocalMove` = `PlayerController.tick` + record state at `seq`.

## Reconciliation policy

On `player_state` with `inputSeq = N`:

| Case | Action |
| --- | --- |
| `N` missing / `N < lastAckedSeq` | ignore movement |
| `N === lastAckedSeq` | ignore (server reused lastInput for another tick) |
| `history[N]` matches snapshot (xz ≤ 0.03, y ≤ 0.05, speed ≤ 0.2, same onGround/flying) | ack `seq ≤ N`; **do not** change position, velocity, or previousPosition; **do not** replay |
| mismatch, distance < 6 | restore snapshot pose (flight internals from `history[N]` if the protocol omits them), replay **only** `seq > N`, rewrite those history states |
| distance ≥ `LOCAL_SNAP_DISTANCE` (6) | hard snap; `previousPosition = position` |

Rendering stays `previousPosition → position` with the fixed-step alpha. A snapshot between frames is invisible when the ack is accepted.

## Server inputSeq semantics

`applyInput` stores `lastInput` / `lastInputSeq`. `tickConnectedPlayers` applies `lastInput` **once** per tick. Overwritten seqs between ticks are not simulated. Snapshot `inputSeq` means: “this pose is after one physics step using that latest input.” Client replay of skipped seqs would invent extra steps the server never ran. Coalescing correction: restore the snapshot for N and replay only seqs the server has not used yet (`> N`).

Optional `PlayerSnapshot.flying` is included so flight corrections can restore `isFlying`.

## Tests

`tests/local-player-prediction.test.ts` (22):

- predict without snapshot
- matching ack → no pose/previousPosition change
- tiny error → no touch
- delayed snapshot → no jitter
- duplicate inputSeq → ignore
- mismatch at N + pending N+1… → rewind + replay
- coalesced latest-input-only
- walk / sprint / jump / delayed jump ack / repeated jumps / landing / falling
- creative fly up / fly forward + SHIFT descend
- fast direction change
- large snap
- reconnect seq reset

## Acceptance (this pass)

Targeted prediction tests **22/22** plus urgent remesh and player-main integration. `typecheck` / `typecheck:sim` / `typecheck:client` / `typecheck:server` / `check:boundaries` / `smoke:sim` / `smoke:server` PASS. `test:sim` **42/42**. `test:server` **74/74**. `build` PASS.

## Remaining manual QA

Owner two-client localhost vs singleplayer:

- walk, sprint, jump series, run+jump, fall, land
- fast strafe
- creative fly forward, fly+SHIFT descend
- F3 `Pred accept … corr/s=0` while moving on a quiet localhost (corrections should be rare)

Urgent remesh (place/break/border/door) must still be immediate.

## Files changed

- `src/net/localPlayerPrediction.ts` — history + accept/correct/snap policy
- `src/player/PlayerController.ts` — `captureMovementState` / `applyMovementState`
- `src/core/Game.ts` — `predictLocalMove`; DEV F3 pred line
- `src/net/index.ts`
- `shared/protocol.ts` / `server/WorldInstance.ts` — optional `flying`; inputSeq comments
- `tests/local-player-prediction.test.ts`
- `tests/player-main-integration.test.ts`
- docs

## Git

Same PR branch. Do not merge main.
