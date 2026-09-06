# 2026-09-06 — Integrate remote actions into plugin/mining line

## Goal

Produce one integration branch that keeps the current plugin/claims/mining working line and adds Networking V2 remote-player action presentation from PR #54. Do not merge PR #54 into `main`. Do not file-takeover conflicting sources.

## Result

Merge of `codex/remote-action-presentation-v2` (`63e8358e`) into `cursor/claim-boundary-depth-3f93` (`9c92b176`) on branch `cursor/integrate-remote-actions-3f93`. Functional union, not cherry-pick.

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

Directed mining/claims/presentation/Anarchy plus `typecheck*` / `test:sim` / `test:server` / `build` / `check:boundaries`. Compare any VM-flake names (`tick-latency`, `tick-load-flight`) to prior baseline; do not weaken thresholds.

## Visual QA

Two-client interactive checklist (held item, cracks, swing, bow, food, block, disconnect/reconnect, shared/different targets, claim 3px occlusion) remains owner/live QA. Cloud/SwiftShader is not a substitute for native two-Chrome Anarchy.

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
