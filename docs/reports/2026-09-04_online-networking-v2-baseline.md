# Online networking v2 — Phase 0 baseline

Date: 2026-09-04  
Branch: `cursor/online-networking-v2-3ff8`  
Source HEAD: `c5fba74` (`origin/cursor/local-aim-desync-86e1`, PR #39)  
Lineage: PR #39 (local aim) → PR #38 (remote interp) → PR #37 (prediction/checkpoint) → `origin/main` `4d803e5`  
This phase does **not** change gameplay behavior.

Do not merge main. Do not rewrite #37/#38/#39 in place.

## Goal

Record the real call graphs, temporal axes, and intent-loss sites **before** the v2 redesign, using the current repository rather than assumed SHAs.

## Repository state used

| Ref | SHA | Notes |
|---|---|---|
| `origin/main` | `4d803e5` | UI PR #22 merged; Anarchy already in main |
| PR #37 `cursor/online-prediction-remesh-86e1` | `fd02b67` | local prediction + checkpoint Model B |
| PR #38 `cursor/remote-player-interpolation-86e1` | `ade7113` | remote server-tick interpolation |
| PR #39 `cursor/local-aim-desync-86e1` | `c5fba74` | live camera look for local pick/bow |
| This branch | created from `c5fba74` | new work only |

## Current architecture (short)

**Contract claimed:** server-authoritative Anarchy, 20 TPS, WebSocket JSON, `PROTOCOL_VERSION = 1`.

**Contract actually implemented:** latest-input *state* movement, not a command timeline. Discrete actions (`interact`, `attack`, bow release) do not carry captured client intent. Local prediction compares a reconstructed checkpoint to snapshots using pose tolerances. Remote players already use a server-tick buffer (PR #38). Local first-person aim is live (PR #39) but is **not** sent on the wire.

```text
CLIENT OWNS: input collection, local prediction pose, live RAF aim, rendering
SERVER OWNS: physics pose, inventory, world, combat result, projectile spawn
AMBIGUOUS: which inputSeq a serverTick simulated; which block/aim an action used
```

---

## A. Call graphs (actual)

### CLIENT MOVEMENT

```text
InputManager.movement() / yaw / pitch          (every RAF; physics copy at 20 TPS)
  → Game.tickOnline
       flushPendingLocalSnapshot               (queued player_state from WS)
       player.yaw/pitch = input.yaw/pitch
       inputSeq += 1
       predictedMoveFromInput(seq, move, look)
       AnarchyClient.send({ type:'input', seq, axes, look, mining?, use? })
       predictLocalMove → PlayerController.tick → history[seq] = postState
  → RAF render
       LocalPlayerRenderState.sample(accumulator)
       applyImmediateRenderLook(camera, input)  (live aim, not tick look)
```

Incoming:

```text
WS player_state
  → handleOnlineMessage → applyOnlinePlayerState
  → overwriteLatestSlot(pendingLocalSnapshot)     // coalesce to latest packet
  → next tickOnline / flushPendingLocalSnapshot
  → reconcilePredictedPlayer(checkpoint vs snapshot)
```

### CLIENT ACTION

```text
Live aim: localInteractionAim(eye, input.yaw/pitch)   // PR #39, RAF
  → session.target = world.raycast(origin, direction)

Use press:
  → send { type:'interact' }                          // NO target, face, hit, seq

Break:
  → send { type:'break_block', x, y, z }              // coords only; no face/hit/actionSeq

Place (live):
  → same empty interact                               // server re-raycasts
  place_block exists in protocol/tests only

Bow:
  press  → interact (starts server bowUseTicks)
  hold   → input.use = true on movement packets
  release → input.use = false
           Game.releaseBow is SINGLEPLAYER ONLY
           server advanceUseHold uses controller.viewDirection() at process time
```

### SERVER MOVEMENT

```text
AnarchyServer.onMessage
  → parseClientMessage
  → WorldInstance.applyInput
       reject stale/duplicate seq and stale connectionId
       lastInput = packet                                 // overwrite
       pendingJump |= jump
       pendingUseRelease on use falling edge
       controller.yaw/pitch written immediately           // for inter-tick raycasts

startLoops (absolute 20 Hz)
  → gameplayTicksDue → tick() | tickCatchUp(n)
       simulateGameplayTick
         GameplayKernel → tickConnectedPlayers
           apply lastInput ONCE (latest state, not FIFO)
           skipped seqs are never simulated
       flushTickNetwork once per outer loop
         player_state { tick, physicsTicks, players[].inputSeq, appliedTicks[≤8] }
```

### REMOTE

```text
player_state.tick
  → RemotePlayerView.applySnapshot(snap, now, tick)
  → RemoteInterpolationBuffer (max 8)
  clockTick  = latestServerTick + (now - latestReceivedAt) / 50ms
  renderTick = max(prev, clockTick - 2)
  lerp / velocity extrap ≤ 100ms / then hold capped pose
```

Entity mobs/drops still use arrival-time `EntityInterpolationBuffer` (~80 ms). That is a separate timeline.

---

## B. Where each temporal token lives

| Token | Where | Meaning today | Ambiguity |
|---|---|---|---|
| packet arrival | WS callback | not simulation time | used as remote clock *elapsed origin* |
| `serverTick` / `player_state.tick` | `WorldInstance.tickNumber` | physics checkpoint of last simulated tick in the flush | catch-up folds N ticks into one packet |
| `inputSeq` / `ClientInputMessage.seq` | client 20 TPS counter | latest movement **state id** | **not** a physics tick |
| `physicsTicks` | outer loop catch-up count | how many latest-input steps this flush ran | cannot recover the N poses without `appliedTicks` |
| `appliedTicks` | last 8 `{tick, seq, y, vy, …}` DEV trace | hints which seq ran on which tick | incomplete pose; not an ACK contract |
| snapshot ack | client treats `inputSeq` + `tick` as ack | checkpoint = lastAckedState + simTicks of latest input | extra client seqs with other WASD stay in live pose |
| reconciliation history | `PredictionBuffer.entries` keyed by **seq** | one post-state per seq (overwrite if same seq) | seq ≠ predTick |
| current latest input | `ServerPlayer.lastInput` | sticky overwrite | intermediate WASD/look lost |
| server re-raycast | `useHeld` / `advanceMining` / `placeBlock` lookHit / `attack` / `releaseBow` | reconstructs target/aim from **current** controller look | client live aim is not on the wire |
| block target | client `session.target` vs server `lookHit` | two independent DDAs | neighbor-face substitution |
| bow direction | SP: `bowSpawnFromAim(liveAim)`; Online: `controller.viewDirection()` | online uses process-time look | post-release yaw packets change the arrow |
| remote arrival time | `receivedAt` on latest sample only | clock elapsed term | sample timestamps stay on serverTick (PR #38) |

---

## C. Conflicting timelines

1. **Client pred tick** (local 20 TPS) ≠ **server physics tick** (absolute 20 Hz slot, catch-up 2–4).
2. **inputSeq** ≠ **serverTick**. Two client packets before one server tick → `seqGap=2`, `physicsTicks=1`.
3. **RAF live aim** (PR #39) ≠ **fixed-tick controller look** copied into `input` packets ≠ **server look at action process time**.
4. **player_state flush** can cover several physics ticks (`physicsTicks=N`) while ACK compares one checkpoint pose.
5. **Remote renderTick** is serverTick − 2; **entity** interpolation is arrival − 80 ms.
6. **pendingLocalSnapshot** is latest-packet overwrite: WS arrival can replace an unflushed snapshot before the 20 TPS reconcile.

---

## D. Where client intent is lost

| Action | Client knew | Wire | Server used |
|---|---|---|---|
| Place / use | live target + face + hit | `{type:'interact'}` | `performUseHeld` raycast from sticky look |
| Break finish | live target | `{type:'break_block',x,y,z}` | client coords (good) **but** mining progress is `lookHit` (can be neighbor) |
| Mining hold | live target | `input.mining` bool | `advanceMining` → current look, **switches target** |
| Bow release | live yaw/pitch at mouse-up | `use:false` on a later input | `controller.viewDirection()` when the tick runs |
| Attack | live aim | `{type:'attack'}` | server raycast now |
| Movement look between ticks | each packet | latest packet only | overwritten |

---

## E. Where the server reconstructs intent

- `ServerGameplay.useHeld` → `performUseHeld` with no `ctx.hit` → `world.raycast(eye, viewDir)`.
- `placeBlock` still consults `lookHit` and can reject `look` (does not silently write B, but live path never sends `place_block`).
- `advanceMining` **does** silently retarget to the current look block.
- `releaseBow` always reads controller look at fire time.
- `attack` raycasts now.

This is the forbidden pattern: *packet arrived later, I will look at what the player currently sees*.

---

## F. Where accepted snapshots mutate live player

`reconcilePredictedPlayer` on `accepted` / `ignored` does **not** call `applyMovementState`. Probe `accept-invisible` vs `accept-mutated` exists.

Live mutation still happens on:

- `corrected` / `snapped` → `restoreAuthoritativePlayer`
- `snapped` → `previousPosition.copy(position)`
- hidden-tab force resync
- welcome / teleport
- every `PlayerController.tick` (copies previousPosition at tick start — simulation, not ACK)

**However:** `commitPredictionCheckpoint` on accept overwrites `lastAckedState.xyz` from the snapshot while keeping checkpoint velocity from `comparable`. Soft-reject of `speed`/`onGround`/`flying` is treated as accept. Next checkpoint therefore starts from a hybrid pose. That is bookkeeping that can cause a later false correction.

`PREDICTION_ACCEPT_XZ = 0.03`, `PREDICTION_ACCEPT_Y = 0.05`, `PREDICTION_ACCEPT_SPEED = 0.2` are still the accept gate. Pose-only accept is a tolerance hack relative to the v2 contract.

---

## G. DEV flags / leftover heuristics (not production paths)

Client URL (DEV only, `predIsolation.ts`): `predNoNet`, `predNoSend`, `predNoState`, `predStateObserve`, plus skip-reconcile/survival/riding/gamemode/respawn/look/render.

Owner QA: `predNoState=1` almost removed local jitter → incoming `player_state` / reconciliation, not `PlayerController`.

Still present in prediction:

- `comparableExtraTicks(physicsTicks, seqGap)` fallback path (`history[N]+extra`)
- `seqGap` in inspect/HUD
- checkpoint `simTicks = serverTick - lastAckedServerTick` (stale lastAckedServerTick produced extra=3)
- `pendingJump` / `pendingUseRelease` coalesce hacks
- `PLAYER_NET_REACH` slack 1.5 as delayed-ray compensation
- localhost RTT `netTiming` on snapshots (DEV)

Server env: `FC_DEBUG_NET`, `FC_DEBUG_BOW`, `FC_DEBUG_TICK`, `FC_DEBUG_TICK_MS`, `FC_DEBUG_SNAP`. No server isolation flags.

---

## H. What #37 / #38 / #39 got right (keep)

| PR | Keep |
|---|---|
| #37 Model B checkpoint | Do not treat `inputSeq` as a physics tick. Server latest-input is explicit. Accept must not be seqGap heuristics. |
| #37 accept-invisible | Accepted ACK must not write live pose. |
| #38 | Remote samples keyed by `serverTick`; bounded buffer; extrap cap then freeze; shortest yaw. |
| #39 | Local camera / crosshair / SP bow share live aim; physics look stays 20 TPS. |

## What they cannot finish (replace)

| Symptom | Why patch-on-patch failed |
|---|---|
| Local jitter | Checkpoint still maps a *state id* onto a reconstructed pose; changing inputs between coalesced seqs leave extra ticks in live motion; tolerances hide then later explode as corrections. |
| Neighbor block | Live client never sends the crosshair target; server DDA at process time. |
| Bow aim | Release is a `use` edge, not an immutable aim sample. |
| Remote glide/step | PR #38 is close; clock origin still uses latest packet `receivedAt`; no full telemetry contract. |

---

## I. Unanswered questions in the current protocol

These currently depend on timing luck or reconstruction:

1. **What does this ACK confirm?** `inputSeq` of the latest state used, plus `tick` of the last physics step in a possibly multi-tick flush.
2. **Which command did server tick 804 simulate?** Only if DEV `appliedTicks` still holds 804; production clients do not use that as the reconcile key.
3. **Which aim spawned this arrow?** Server look at `releaseBow`, not client release sample.
4. **Why did the neighbor block get used?** Server `lookHit` ≠ client `session.target`.
5. **Which history entries did the server confirm?** `consumeOldestPredTicks(simTicks)` — a **count**, not a commandSeq range.

---

## J. Baseline tests (this phase, no behavior change)

Recorded from the checkout at `c5fba74` before v2 edits. Commands and counts are in the v2 implementation report once the suite is re-run after each phase.

Existing related packs (must not be silently weakened):

- `tests/local-player-prediction.test.ts`
- `tests/prediction-timeline.test.ts`
- `tests/server/client-server-lockstep.test.ts`
- `tests/remote-player-interpolation.test.ts`
- `tests/local-aim.test.ts`
- `tests/use-interaction.test.ts`
- `tests/server/anarchy-server.test.ts` / `anarchy-gameplay.test.ts`

## K. Redesign decisions locked for later phases

1. **CLIENT OWNS INTENT. SERVER OWNS RESULT.**
2. Explicit `actionSeq` + `commandSeq` on discrete actions. Server validates intent A → execute A or reject. Never substitute B.
3. Bow release carries immutable yaw/pitch.
4. Movement ACK names `serverTick` + `ackCommandSeq` (+ bounded `AppliedMovementStep[]` on catch-up).
5. Accepted ACK: `diffMotionFull(before, after) === []`.
6. `PROTOCOL_VERSION` bump when semantics change. Old clients must not silently talk to the new server.
7. WebSocket stays. 20 TPS stays. Singleplayer / persistence / inventory authority stay.
8. Isolation flags remain DEV diagnostics only.

## Changed files (this phase)

- `docs/reports/2026-09-04_online-networking-v2-baseline.md` (this file)

## Next

Phase 1: block action intent contract + failing tests, then implementation.
