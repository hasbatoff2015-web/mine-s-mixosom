# Farming V1 + Networking V2 union

## Goal

Integrate Networking V2 (`e5c77f3`, PR #42) onto Farming `main` (`aa0ee07`, PR #43) without a blind whole-file take and without rolling back either side.

## Result

The working tree is a **union**:

- Farming V1 remains the source of truth for crops, IDs 150–157, kernel `tickFarming`, `hydrated`/`age`, assets, and farming tests.
- Networking V2 is the source of truth for movement, ACK, prediction, remote interpolation, action intent, protocol 3, and server tick catch-up.

Latest-input + `stepTowardTarget` chase is not the online production path.

## SHAs

| Role | SHA |
|---|---|
| Farming `main` | `aa0ee07403874fc72e483f53c2b1db176d33b649` |
| Networking V2 | `e5c77f334fa46b726372fb7d7d27283f213ea184` |
| Merge-base | `4d803e5de22e551e3f71941c0abb03c91e78cf4c` |

Method: `git merge e5c77f3 --no-commit --no-ff` onto `origin/main`, then **manual** verification of auto-merged code and **manual** union of the four doc conflicts. No `-X theirs` / `-X ours`.

## Conflict resolution

Git content-conflicted only documentation. Code overlap auto-merged because Farming and V2 mostly touched different hunks. Those auto-merges were audited, not trusted blindly.

### GameplayKernel.ts

Kept Farming: `world → farming → falling → players → …` and `tickFarming()`. V2 did not change this file vs merge-base, so HEAD (Farming) is the result.

### protocol.ts

Union: V2 `ackCommandSeq`, `action` / `bow_release`, applied steps **and** Farming `NetworkBlockState.hydrated` / `age` parse (`age` clamped 0…7).

### config.ts

`PROTOCOL_VERSION = 3` from V2. Server bind/tick/player caps unchanged.

### Game.ts

Farming: `FarmingSystem` on the session, `tickFarming` in the SP kernel, farming drops.  
V2: `createPredictionBuffer` / `predictLocalMove` / `reconcilePredictedPlayer`, sequenced actions, `localAim`, no `stepTowardTarget(position)` chase. `stepOnlineAuthority` only copies live look.

Online still skips the world kernel (`shouldRunClientWorldSimulation(true) === false`), so the client does not tick farming.

### server/gameplay.ts

Farming: `FarmingSystem`, connected-player active centers, farming drops.  
V2: `validateBlockTargetIntent`, historical `commandSeq` eye, `useHeld(intent, commandSeq)`. `useContext` still passes Farming `random`.

### WorldInstance.ts

Farming host stays inside `ServerGameplay.tick` → `tickFarming`.  
V2: `PlayerCommandQueue`, `commandFromInput` / `takeForTick`, `gameplayTicksDue` + `tickCatchUp` (not `setInterval(tick, 50)`), `ackCommandSeq` on snapshots.

## Networking V2 that landed

- `shared/playerCommand.ts`, `shared/playerActions.ts`, `shared/actionPoseHistory.ts`, `shared/commandCompaction.ts`
- `server/playerCommandQueue.ts`, `server/tickScheduler.ts`
- `src/net/localPlayerPrediction.ts`, `remotePlayerInterpolation.ts`, `actionIntent.ts`, `onlineActionMessages.ts`
- `src/player/localAim.ts`
- Prediction tests, FIFO tests, remote interpolation tests, lockstep tests

## Farming V1 that stayed

- `src/farming/**`, IDs 150–157, items/recipes/hoes/food
- `public/textures/block|item` farming assets
- `scripts/benchmark-farming.ts`, `?qaFarming=1`
- Farming tests including `tests/farming-tick-budget.test.ts` from the regression investigation

## Tests

- `typecheck`, `typecheck:sim`, `typecheck:client`, `typecheck:server` PASS
- `check:boundaries` PASS
- `test:sim` 9 files / **42/42**
- `test:server` 12 files / **120/120** (includes `tests/server/farming-v2-two-client.test.ts`)
- Directed: farming + V2 contract + kernel + remote interpolation + FIFO + union identity **77/77**
- `build` PASS (`tsc --noEmit && vite build`)

`tick-load-flight` can flake under a fully parallel `test:server` (mean ~60 ms vs 50 ms budget when other WorldInstances contend). Isolated and with `{ retry: 2 }` it stays under budget. Not a production tick spike: empty Anarchy tick mean **0.14 ms**, one farmland+water mean **0.94 ms** / max **3.2 ms**. Sparse pulse bench: 1024 cells **2.4 ms**, 4096 **8.6 ms**.

## Multiplayer validation

Protocol-level two clients on a real `WorldInstance` (fresh world):

1. Walker queues forward then reverse; each physics tick ACKs one command (`ackCommandSeq` 1 then 2). Watcher receives `player_state` with that ACK. This is FIFO, not latest-input overwrite.
2. Farmer writes Farmland + `hydrated: true`; Peer receives `block_update`/`block_batch` with the same state.
3. Server `lastTickMs` on that walk tick was &lt; 50 ms.

Existing suites also cover two-client respawn movement, WebSocket entity snapshots, farming authority, and client/server lockstep prediction.

Live Chromium two-window smoothness is still **owner QA** on a real desktop. This cloud VM previously rendered Anarchy at ~4 FPS, which cannot prove or disprove rubber-band.

## Remaining issues

- Owner two-client smoothness on a real desktop (cloud VM historically ~4 FPS).
- Full vitest still has pre-existing timeouts (minecart/worldgen/lighting) — do not mask.
- `Unknown block id: 150` on a **pure #42 checkout** is gone on this tree because Farming IDs are present.
