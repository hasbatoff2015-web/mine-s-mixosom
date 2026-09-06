# 2026-09-06 — Integrate remote actions into plugin/mining line

## Goal

Produce one integration branch that keeps the current plugin/claims/mining working line and adds Networking V2 remote-player action presentation from PR #54. Do not merge PR #54 into `main`. Do not file-takeover conflicting sources.

## Result

Merge of `codex/remote-action-presentation-v2` (`63e8358e`) into `cursor/claim-boundary-depth-3f93` (`9c92b176`) on branch `cursor/integrate-remote-actions-3f93`. Functional union, not cherry-pick. Integration commit `b1f8e6d6`. Automated gates passed. Live two-Chrome Anarchy join + Networking V2 remote interpolation confirmed; full visual crack/swing checklist remains owner QA (SwiftShader ~4 FPS).

## Ancestry

```text
03685a9a  main
e5c77f33  cursor/online-networking-v2-integrated-3ff8   (Networking V2; ancestor of BOTH lines)
├── 63e8358e  codex/remote-action-presentation-v2       (PR #54, +1 commit)
└── … plugin / claims / chat / mining lock / in_progress / claim 3px
    9c92b176  cursor/claim-boundary-depth-3f93
        └── (this merge) cursor/integrate-remote-actions-3f93
```

- Merge-base(working, PR54) = Networking V2 `e5c77f33`.
- Unique to PR #54 vs working: one commit, `63e8358e feat(net): replicate authoritative remote player actions and cracks`.
- Unique to working vs PR #54: plugin platform, permissions/OP, claims, holograms, chat/nickname/console, mining lifecycle chain (PRs #59–#61), claim boundary depth (PR #62).
- Networking V2 was already in the working line; PR #54 is not an independent overlay on `main`.

## Implemented

Merge (not cherry-pick) of PR #54 head. Conflicts resolved as union:

| File | Resolution |
|---|---|
| `server/WorldInstance.ts` | Keep PluginManager, permissions, claims, holograms, teleport, mining lock, command queue. Add `PlayerPresentationState`, `presentSwing()`, `presentation()`, snapshot/remoteInfo payload, 5th `onBlockReplaced` abort hook. Constructor keeps 4th `worldSpawn`. |
| `server/gameplay.ts` | Keep `clearMiningLock`, `miningStartCommandSeq`, `survivalFinishLockReject`, current begin/advance/break/abort. Add `presentSwing` hooks, captured `blockId`, `onBlockReplaced`, voxel mismatch abort via `clearMiningLock` (not a raw wipe). |
| `shared/protocol.ts` | Auto-merge: optional `presentation?` on `PlayerSnapshot` / `RemotePlayerInfo`; `PROTOCOL_VERSION` stays 3. |
| `src/core/Game.ts` | Auto-merge: claims + holograms + local mining finish + `RemotePlayerInfo` spawn + remote overlay invalidate on block updates. |
| `src/rendering/BlockBreakingOverlay.ts` | Auto-merge: shared overlay + empty-shape geometry dispose. Local stage mapping unchanged. |
| Docs | Keep both histories; add this integration as the latest pass. |

New from PR #54 (no conflict): `shared/playerPresentation.ts`, `RemoteBreakingOverlays.ts`, `RemotePlayerView` callbacks, WorldRenderer remote group, presentation tests, PR #54 report.

Unchanged from our line: `ClaimBoundaryRenderer` (3px, depthTest/Write true, no overlay renderOrder, `#ff0000`), mining lock files, plugins.

## Architecture decisions

- Working branch is source of truth for mining/claims/plugins. PR #54 is source of truth for presentation and the Networking V2 pieces it adds on top of V2 (already present).
- `onBlockReplaced` is a 5th constructor arg so plugin respawn `worldSpawn` is not overwritten.
- Presentation mining requires captured `blockId`; `beginMining` already sets it. Tests that asserted exact `{x,y,z}` now `toMatchObject` so they still prove lock coords without dropping `blockId`.
- No second protocol. No mining rewrite. No claim renderer rollback.

## Tests

All required gates on this branch after the merge:

| Gate | Result |
|---|---|
| `typecheck` / `typecheck:client` / `typecheck:server` / `typecheck:sim` | PASS |
| `check:boundaries` | PASS |
| Directed mining + claims + presentation + Anarchy (12 files) | **140/140** |
| `test:sim` | **9 files / 42 tests** |
| `test:server --maxWorkers=2` | **24 files / 230 tests** (includes `tick-latency` / `tick-load-flight`; no flake this run) |
| Extra V2 + plugin/claims (`player-command-queue`, `online-networking-v2-contract`, `local-player-prediction`, `remote-player-interpolation`, `plugin-platform`, `console-and-nickname`, `claim-commands`, `permissions`) | **8 files / 114 tests** |
| `build` | PASS (vite client) |

No production thresholds were relaxed. `miningTarget` assertions in lifecycle/oak-planks/player-actions tests now `toMatchObject({x,y,z})` so captured `blockId` from presentation does not break lock-coord checks.

Live wire against the **restarted** Anarchy process (`ws://127.0.0.1:2567`, plugins: permissions/claims/holograms/…): two WebSocket clients. Observer welcome carries actor `presentation`; attack miss publishes `swingSeq=1`; `player_state` has `heldItemId`/`bowCharge`/`foodUseProgress`/`swordBlocking`; disconnect emits `player_left`. 9/9 PASS.

## Visual QA

Two Chromium clients (`ObserverA`, `ActorB`) joined the same live Anarchy world after server restart on merged code. Status `online: 2`. F3 on both:

- Observer: `Remote 03b49ec7 … interpolate buf=3/3.6 n=12 delay=180ms snap/s=14` (ActorB).
- Actor: `Remote 27c19a87 … interpolate buf=3/3.6 n=12 delay=180ms snap/s=19` (ObserverA).
- `TPS 20`, `Ack cmd=…`, prediction/reconciliation lines present. Actor survival with iron pickaxe; observer creative. Actor hold-mine excavated dirt.

Cloud SwiftShader ran at **~4 FPS**. Remote player model and crack overlays were **not** independently accepted as a complete visual pass (spawn pit, look direction, frame hitch). Wire + F3 interpolation **do** prove presentation and Networking V2 on the live process. Claim 3px/depth remains covered by `tests/claim-boundary.test.ts` (`linewidth=3`, `depthTest=true`); not re-shot as a deny-build overlay in this pass.

Owner still needs native two-desktop checklist: held item, crack stages 0–9, abort/switch/finish, swing miss, bow, food, sword block, disconnect/reconnect, A+B same/different blocks, claim occlusion.

## Performance

No meshing/network rewrite. Overlay still one mesh per target; max progress, no remesh on stage change.

## Known issues

PR #54 was `mergeable=false` into `main` because it sits on Networking V2 plus conflicts with the plugin/mining line. This branch is the intended merge vehicle.

## Deferred

Owner two-client live acceptance before merging this branch to `main`. Do not merge GitHub PR #54 itself.

## Next work

Owner QA of the union, then merge `cursor/integrate-remote-actions-3f93` → `main`.

## Git

Branch: `cursor/integrate-remote-actions-3f93`  
Parents: `9c92b176` (ours) + `63e8358e` (PR #54)  
Merge commit: `b1f8e6d6`  
PR to main: do not merge GitHub PR #54. Integration vehicle is this branch → `main`.
