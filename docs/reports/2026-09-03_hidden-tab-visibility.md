# Hidden-tab Page Visibility vs Online movement

Date: 2026-09-03  
Branch: `cursor/online-prediction-remesh-86e1` (PR **#37**)  
Scope: single game tab, same WebSocket, visible → hidden → visible. Not duplicate-tab sessionToken.

## Goal

Owner QA: switch from Online Anarchy to another tab (ChatGPT) for ~2 s and return. Movement jitter can become much worse immediately, then another hide/show can make it smooth again. No second game tab.

Instrument Page Visibility, measure what actually runs while hidden, prove the desync, then apply a resume policy **without** changing prediction tolerances, physics, interpolation, or server TPS.

## Result

Root cause is **hidden-tab scheduling**, not duplicate sockets.

While the game tab is `BACKGROUND`:

1. `worldSimulationActive('BACKGROUND')` is false, so `Game.frame` zeroes the accumulator and **does not** run `tick()` / `tickOnline`.
2. Client prediction rate = **0** (except one idle tick we now send on hide).
3. Client input send rate = **0** after that idle.
4. Server keeps `lastInput` (W / sprint / flight / SHIFT) and simulates **20 TPS**.
5. `player_state` still arrives on the open WebSocket. The client keeps only the **latest** pending snapshot (`pendingLocalSnapshot`), so there is no 40-packet FIFO.
6. Those snapshots reuse the last `inputSeq`. `inspectPredictedPlayer` treats `ackSeq === lastAckedSeq` as **`duplicate-seq` ignored**.
7. Local pose is frozen; server walked `WALK_SPEED × hiddenSeconds` (~8.6 m in 2 s).
8. On resume, a frozen RAF can feed up to `MAX_FRAME_DELTA` (0.25 s) → **4 catch-up ticks** from the stale pose. The 2 s wall-clock remainder is dropped, not replayed.
9. First new seq after resume compares `history[N]` (idle/catch-up from the hide pose) to the server pose ~8.6 m away → correction/snap storm. Another hide/show can look “smooth” if it happens to idle the server or resync by accident.

This is **not** a server input backlog. `applyInput` is still latest-state: a burst of packets replaces `lastInput` and bumps `lastInputSeq`. Sticky `lastInput` while the client is frozen is the problem.

## Implemented

### Diagnostics (DEV)

- `PageVisibilityProbe` (`src/debug/pageVisibilityProbe.ts`): `visibilitychange` / `focus` / `blur`, hidden↔visible logs with pred seq, ack seq, pending history, accumulator, alpha, last snapshot time.
- Counts while hidden: inputs, prediction ticks, `player_state`.
- Resume window ~500 ms: packet time, `inputSeq`, `physicsTicks`, authoritative vs history pose, correction result.
- First 20 visible frame deltas.
- F3:
  ```
  visibility=visible/hidden
  focus=1/0
  hiddenDurationMs=…
  resumeTicks=…
  resumeSnapshots=…
  inGap=…ms inBurst=…
  ```
- Console: `[vis]`, `[vis-raw]`, `[vis-resume]`, `[vis-resync]`.
- Server `tickClock.inputGapMs` / `inputPackets` (gap since last input packet, packets since last flush). Not a gameplay change.

### Resume policy (proven, then applied)

Does **not** change walk physics, `PREDICTION_ACCEPT_*`, render lerp, or 20 TPS.

- **Hide** (`PLAYING` → `BACKGROUND`): one `sendOnlineIdle` so the server stops applying held W/sprint/flight/SHIFT.
- **Show** (`BACKGROUND` → `PLAYING`): set `previousTime = now`, `accumulator = 0` (no wall-clock catch-up). Force-apply the latest pending `player_state` (`visibility-resync`), reset prediction history, `lastAckedSeq = snapshot.inputSeq`. Preserve yaw/pitch. `LocalPlayerRenderState.snapTo` so render does not lerp across the frozen pose.
- Counted as `visibility-resync`, not `corr/s`.
- Pause menu already sent idle; hide from `PAUSED` does not send a second policy idle.

`InputManager` still clears held keys on `visibilitychange` (stuck-key safety). After resume the player may need to tap W again if the browser does not repeat `keydown`.

## Measured (deterministic sim, 2 s hide = 40 server ticks)

| Metric | Legacy (before policy) | After policy |
| --- | --- | --- |
| Hidden-tab input rate | **0 /s** | **1 idle** total (~0.5/s over 2 s) |
| Hidden-tab prediction rate | **0 /s** | **1 idle tick** |
| Snapshot receive while hidden | **20 /s** (WS still delivers; latest slot only) | same |
| Snapshot burst after resume | **1** pending slot (not 40) | **1** forced resync |
| First correction after resume | **xz ≈ 8.6 m** (`duplicate-seq` then snap) | **none** (resync, then lockstep) |
| Accumulator / time jump | RAF freeze → 4 ticks + drop; leftover wall-clock discarded by `MAX_FRAME_DELTA` | clock reset, **0** catch-up |
| Server input burst | gap, then 4 catch-up seqs as latest-input (not a FIFO replay) | 1 idle on hide, then 20/s |
| 5× walk hide/show | correction storm each time | **corr = 0** |
| Flight + SHIFT | server keeps descending; large pose gap | **corr = 0** after resync |

## Architecture decisions

- Do not keep predicting/sending WASD while hidden. Browser RAF is throttled or frozen; client/server phase would still drift.
- Do not FIFO snapshots or inputs. Latest pending snapshot + latest `lastInput` stay.
- Do not enlarge accept tolerances or disable reconcile for normal play.
- Idle-on-hide is the same packet pause menu already sends.
- Resync is a visibility lifecycle action, not a prediction-algorithm change.

## Tests

```text
npx vitest run tests/hidden-tab-motion.test.ts tests/local-player-prediction.test.ts tests/fixed-step.test.ts tests/server-tick-clock.test.ts
```

`tests/hidden-tab-motion.test.ts`: BACKGROUND pauses prediction; hide/resume decisions; 2 s frame clamp is 4 ticks; legacy freeze + duplicate-seq + ~8.6 m correction; resume policy idle+resync corr=0; 5× walk; flight+SHIFT; F3 probe lines.

typecheck client/server/sim PASS.

## Visual QA

Could not pointer-lock a browser tab here. Owner: **one game tab**, walk continuously, switch to another tab for 1–2 s, return, keep walking. Repeat 5×. Then flight and flight+SHIFT. Expect `corr/s=0` after resume, `visibility=` flipping, `hiddenDurationMs≈2000`, `inGap` rising while hidden then returning to ~50 ms. Console `[vis-resync]` once per return, not a corr storm.

## Performance

Probe is DEV counters + throttled F3. No extra meshes, no extra server TPS.

## Known issues

- Browser may not fire `keydown` again if W stayed physically held. Movement stops until the key is tapped. Preferable to stuck keys + jitter.
- If no `player_state` arrived while hidden, the first snapshot after resume still force-resyncs (flag stays set).
- `predNoSend` skips the hide idle (DEV isolation).

## Deferred

- Do not predict while hidden with a different clock.
- Do not keep keys held across hide.
- Duplicate-tab session isolation remains a separate owner rule (one tab).

## Next work

Owner one-tab hide/show QA on PR #37. Do not merge main.

## Git

Branch `cursor/online-prediction-remesh-86e1`. Continuation of PR #37.
