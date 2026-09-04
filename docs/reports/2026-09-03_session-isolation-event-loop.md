# Session isolation and event-loop / reconnect load

Date: 2026-09-03  
Branch: `cursor/online-prediction-remesh-86e1` (PR **#37**)  
**Do not merge main.**

## Goal

Owner QA: a second tab/session can change jitter severity; after reconnect a ~1697 ms frame spike; after ~1 min `corr/s=0` but motion still feels off; flight drops `snapSent` to ~15 and `corr/s` to ~11. Isolate multi-tab resume, then find whether remaining jitter is event-loop / world load, not prediction.

## Result

1. **1697 ms client spike:** reconnect path is `welcome` JSON parse + `world.restore(modifications)` + `LOADING_WORLD` generate/mesh/light. That work is **other/main-thread**, not PlayerController. DEV now logs `[reconnectLoad]` (parse ms, bytes, modChunks) and `[frameSpike]` / `[longtask]` with subsystem breakdown. A map-fill restore of 120 chunks stays well under 250 ms in tests; a 1.7 s hitch is welcome parse + first loading/mesh burst, not a 20 TPS physics bug.
2. **snapSent ≈ 15 during flight:** outer loop stalls. `syncChunksFor` called `serializeModifications()` (entire world) for **every newly streamed column**, then generated+lit new terrain on the same callback. Flying crosses columns fast → callback > 50 ms → skipped slots → fewer snapshots → catch-up corrections. `corr/s` here is a **symptom**.
3. **Server event-loop delay:** instrumented (`monitorEventLoopDelay`, lateness, callback ms). Flight load was chunk serialize/generate on the tick callback, which **is** event-loop delay.
4. **World/chunk/mesh workload:** yes. Warm-up after 1–2 min matches `knownChunks` filling and fewer new generates. `?quietWorld=1` caps client streaming to 1 chunk for A/B.
5. **Corrections:** after a healthy 20 Hz outer loop they were ~0 (previous pass). When snapSent collapses, corrections return. Do not retune prediction until F3 shows `snapSent/s≈20` and `sess socks=1`.

## Session invariant

Before: resume replaced `existing.sink` but left the old WebSocket in `AnarchyServer.sockets`. Both could `applyInput()`. Old `close` called `disconnect()` on the live player.

After: new `connectionId` on every join/resume; old socket gets `session_taken` and is marked superseded; `applyInput` / `disconnect` require the live id.

**Manual QA: exactly one game tab.** Duplicating a tab copies `sessionStorage` token.

## Implemented

- Server connection id + stale-socket reject; F3 `sess socks/src/snap/join/resume/fp`
- `serializeChunkModifications`; max 2 new generates per sync; drain each outer loop
- tickClock: lateness, callbackMs, ELD mean/p95/p99/max, tickWall, entities, chunkSend/gen
- Client `[reconnectLoad]`, `[frameSpike]>=100ms`, `PerformanceObserver('longtask')`
- DEV `?quietWorld=1`

Not changed: gravity, speeds, interpolation, prediction tolerance, snapshot rate, TPS.

## Tests

- `npx tsc --noEmit` / sim / client / server typecheck: PASS
- Focused session/load/fingerprint/quiet/longtask + anarchy-server: PASS
- `test:sim` **42/42**; `test:server` **94/94**; tick-clock **6/6**; prediction **29/29**; isolation flags **8/8**; plugin-platform **18/18**
- `npm run build` PASS

## Visual QA

This environment cannot pointer-lock Online. Owner: one tab, then walk/sprint/jump/strafe/flight/fly+SHIFT. Optional `?quietWorld=1`. Copy F3 `loop` / `load` / `sess` / `corr/s`.

## Git

Branch `cursor/online-prediction-remesh-86e1`.
