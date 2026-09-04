# Online networking v2

Date: 2026-09-04  
Branch: `cursor/online-networking-v2-3ff8`  
Base: `c5fba74` (PR #39 `cursor/local-aim-desync-86e1`)  
Do **not** merge main. Do **not** rewrite #37/#38/#39. Keep this PR **draft** until two-client live QA is confirmed.

## 1. Branch / commits

See `git log --oneline cursor/online-networking-v2-3ff8 ^c5fba74`.

- `ee6d364` — Phase 0 baseline report only.
- `c2bce99` — protocol 2, FIFO movement, intent actions, reconciliation, tests.

## 2. Baseline architecture

Recorded in `docs/reports/2026-09-04_online-networking-v2-baseline.md` from HEAD `c5fba74`.

Old production path: latest-input `lastInput`, `inputSeq` ≠ server physics tick, empty `interact` re-raycast, mining retarget via `lookHit`, bow fire from controller look on use falling edge, Model B checkpoint extraTicks, `PREDICTION_ACCEPT_XZ=0.03`.

## 3. Root causes

| Symptom | Cause |
|---|---|
| Local jitter | ACK compared a reconstructed checkpoint / `history[latest]` to a tick that applied a different command (or extra sticky ticks). Accepted snapshots still wrote live pose in earlier patches. `predNoState=1` hid incoming `player_state`. |
| Block target desync | Server rebuilt target from delayed current ray. Neighbor B replaced client A. |
| Bow aim desync | Projectile direction taken from controller yaw/pitch when the packet was processed, not from release. |
| Remote jitter / glide | Packet-rate stepping and unbounded smoothing in older remotes. PR #38 already moved remotes onto `serverTick`; v2 keeps that clock and adds telemetry. |

## 4. Old architecture

CLIENT predicts every 20 TPS tick keyed by `inputSeq`. SERVER replaces `lastInput` on packet arrival and simulates that latest state once per tick. Several client packets between ticks coalesced. Reconciliation treated `inputSeq` as if it named a physics checkpoint (Model B extraTicks). Discrete actions did not carry target/aim.

## 5. New architecture

CLIENT OWNS INTENT. SERVER OWNS RESULT.

- Movement commands are queued FIFO. One command per physics tick. Empty queue repeats last applied command.
- ACK names `serverTick` + `ackCommandSeq`. Optional `appliedSteps[]` (max 4) lists the simulated ticks in that outer loop.
- Discrete actions carry `actionSeq` (dedupe) and `commandSeq` (movement context) plus explicit target or aim.
- Server validates intent and either executes that intent or rejects. It never silently substitutes a current-ray neighbor.
- Local first-person capture uses PR #39 live look. Physics stays on `PlayerController` at 20 TPS.
- WebSocket transport kept. Singleplayer, persistence, inventory authority unchanged.

## 6. Exact protocol contracts

`PROTOCOL_VERSION = 2`. Join with protocol 1 → `unsupported protocol 1`.

New / required fields (see `shared/protocol.ts`, `shared/playerActions.ts`):

- `input.clientTick`
- `player_state` / snapshot: `ackCommandSeq`, `appliedSteps[]`
- `interact` / `action` / `place_block` / `break_block`: `actionSeq`, `commandSeq`, target/face/hit when targeted
- `bow_release`: `actionSeq`, `commandSeq`, `yaw`, `pitch`
- `action_result`: accept/reject echo for the requester

## 7. Movement timeline semantics

```text
serverTick N → takeForTick() → commandSeq S (or sticky last S)
→ physics with that command
→ AppliedMovementStep { serverTick: N, commandSeq: S, pose }
```

Example: packets 120 then 122 arrive before tick 503; 121 never sent.

- 501 → 120
- 502 → 120 (if 122 not yet taken) or 122 depending on queue order
- If 120 and 122 are both queued: 501→120, 502→122

Two packets before one tick apply the **first** queued command this tick; the second waits for the next tick. They are not latest-input coalesced.

Queue bound 32 (drop oldest). Jump is a command flag on its own seq, not OR-coalesced into a later packet.

## 8. ACK semantics

`ackCommandSeq` is the command **applied** on the last physics tick represented by this snapshot, not the latest packet received (`lastInputSeq` is still the receive filter).

`appliedSteps` lets a catch-up outer loop show every simulated tick (bounded).

## 9. Reconciliation semantics

1. Ignore stale/duplicate `serverTick` (or seq when tick is absent).
2. Locate `history[ackCommandSeq]`.
3. Compare predicted post-state to snapshot (xz/y 1e-4, speed 1e-3, onGround, flying).
4. Equivalent → consume acked history, update lastAcked* — **do not write live pose/velocity/previousPosition**.
5. Mismatch → restore snapshot movement, drop acked entries, replay remaining commands onto current predicted time.

Automated: `diffMotionFull(before, after) === []` on accepted ACK.

## 10. Block intent semantics

Client captures target/face/hit from live crosshair (`captureBlockUse` / break start/finish).

Server `validateBlockTargetIntent`: bounds, unit face, finite hit, reach from current eye to **client hit**, LOS along that same ray to cell A. Then execute A.

If LOS/reach/empty fail → reject. Current look seeing B is irrelevant.

Mining: `break_start` locks `miningTarget`. `advanceMining` never retargets from `lookHit`. Finish uses the locked cell, not a later neighbor.

Untargeted `interact` (no fields) is still allowed for bow charge / eat. SP tests without intent still use current look as orientation.

## 11. Bow intent semantics

Draw starts via `interact` (useHeld). Fire **only** on `bow_release` with captured yaw/pitch. `advanceUseHold` on use falling edge cancels charge and does **not** spawn an arrow.

Server validates bow equipped, draw active, charge, ammo, gamemode. Launch speed/damage/crit/flame stay server-owned. Initial direction = `viewDirectionFromLook(captured yaw, pitch)`.

Duplicate `actionSeq` / `lastBowReleaseSeq` rejected. Release without draw → `no-draw`.

## 12. Remote interpolation semantics

Unchanged clock from PR #38:

```text
clockTick = latestServerTick + (now - latestReceivedAt) / 50ms
renderTick = max(prev, clockTick - 2)
```

Lerp xyz/pitch/velocity; shortest-path yaw; midpoint booleans. Underflow: velocity coast ≤ 100 ms then freeze. Teleport/rejoin: reset buffer. No infinite extrapolation.

## 13. Session / reconnect semantics

One logical player → one live `connectionId`. Stale sockets are ignored.

`resetConnectionInput` on resume: `lastInputSeq` reconnect sentinel, `appliedCommandSeq = -1`, `lastActionSeq = -1`, `lastBowReleaseSeq = -1`, command queue cleared to idle look.

Hidden tab: still send one idle command (pause policy). Server then stickies idle instead of leftover walk. Resume still force-resyncs prediction history because the client did not predict while hidden.

## 14. Security

Client is not trusted for damage, inventory, block result, projectile speed, world writes, pose authority, charge duration, or arbitrary targets. Intent is validated (reach, LOS to A, item, slot, duplicate seq, alive).

## 15. Performance

Command queue 32, action history conceptually 64, prediction history 64, remote buffer 8, appliedSteps 4. No per-frame network logs. Telemetry is bounded rings.

## 16. Tests

Focused packs:

- `tests/player-command-queue.test.ts`
- `tests/block-action-intent.test.ts` / `tests/block-intent-motion.test.ts`
- `tests/bow-release-intent.test.ts`
- `tests/online-networking-v2-contract.test.ts`
- `tests/local-player-prediction.test.ts` (accepted ACK zero live mutation)
- `tests/prediction-timeline.test.ts` (FIFO; latest-input kept only as obsolete contrast)
- `tests/checkpoint-extra-source.test.ts` (history[N], extraTicks=0)
- `tests/local-motion-pipeline.test.ts`
- `tests/server/client-server-lockstep.test.ts`
- `tests/server/anarchy-server.test.ts` (FIFO jump, bow_release, protocol 2)
- `tests/remote-player-interpolation.test.ts`
- `tests/hidden-tab-motion.test.ts`

Typecheck: `typecheck:client` / `:server` / `:sim` PASS. `check:boundaries` PASS.

Full `npm test`: networking/SP gameplay packs green after FIFO rewrites. Known environment issues on this VM (not caused by the protocol):

- `tests/authored-item-assets.test.mjs` — missing `assets/minecraft/textures/items/*`
- some `tests/fire-contact-sunlight-minecart.test.ts` cases — `VoxelWorld.getChunk` exceeds 5s test timeout

## 17. Manual QA

Two processes: `npm run dev:server` and `npm run dev`. Two browser profiles. Protocol 2 on both.

**A. Local:** connect, stand 30s, WASD, sprint, circles, stairs, jump, W+mouse, 360+W, creative fly, fly+SHIFT, reconnect, hidden tab. F3: `corr/s` and `acceptMut/s` should stay ~0 on localhost lockstep. No 1–2 block teleports.

**B. Block:** crosshair between two logs — outline, client intent, and server result are the same cell or an explicit reject. Walking / flick place must not silently choose the neighbor.

**C. Bow:** aim, release, immediately flick mouse. Projectiles follow captured aim. F3 Bow `ang` ≈ 0.

**D. Remote:** observer watches walk/sprint/jump/strafe/fly/stop/reverse. No freeze-step, no infinite glide, jumps stay ballistic.

## 18. Remaining known issues

- Two-client live QA is **not** confirmed in this cloud run (no second interactive browser pair).
- Attack / pickup still lack full captured-aim payloads (melee still server current ray).
- Remote attack/mining/bow presentation flags remain false/0 (PR #38 follow-up).
- `lookHit` fallback still exists for **intent-less** place/use (SP fixtures, untargeted charge). Network targeted paths must send intent.
- DEV isolation flags still exist; production builds ignore them (`import.meta.env.DEV === false`).

## 19. Migration / compatibility

Incompatible with protocol 1 clients/servers. No world-file migration. `server/data/worlds/anarchy/` layout unchanged. IndexedDB singleplayer saves untouched.

## 20. Final SHA

Branch HEAD after the docs commit. Run `git rev-parse HEAD` on `cursor/online-networking-v2-3ff8`.
