# 2026-09-09 — AutoMine plugin

## Goal

Add a server-side AutoMine plugin: admin-selected cuboid zones that fill with a fixed weighted block mix and periodically evacuate players, then regenerate through existing server batching.

## Result

Builtin plugin `automine` on the existing PluginManager. No second claims, teleport, network, or block registry. TitaniumOre remains 161; TNT ids stay 162/163.

## Implemented

1. **Selection.** `/automine wand` gives `wooden_axe`. First/second block click (interact or break, cancelled) store a private AutoMine selection. Corners are normalized; both endpoints are included (`10..24` → 15×15×15). Not Claims, not `PlayerSelectionService`.
2. **Storage.** `plugin-data/automine/automines.json` plus `plugin-data/automine/originals/<name>.json` (voxel snapshot at create). Delete restores that snapshot through the same workload, so spawn blocks are not left as random ore and are not replaced with air.
3. **Weighted generation.** Independent per-voxel pick from a cumulative table (weights in 0.01%). Not independent `Math.random() < p` trials.
4. **Chances (final, code-locked, sum 100%):**

   | Block | Weight | Chance |
   | --- | --- | --- |
   | Oak Log | 1800 | 18% |
   | Birch Log | 1400 | 14% |
   | Spruce Log | 1400 | 14% |
   | Stone | 2500 | 25% |
   | Gravel | 1000 | 10% |
   | Coal Ore | 500 | 5% |
   | Redstone Ore | 400 | 4% |
   | Gold Ore | 250 | 2.5% |
   | Iron Ore | 200 | 2% |
   | Obsidian | 500 | 5% |
   | Diamond Ore | 45 | 0.45% |
   | Titanium Ore | 5 | 0.05% |

   User-proposed numbers already summed to 100%. Obsidian = Coal. Titanium is the smallest weight. No setchance commands.

5. **Reset timer.** `/automine setinterval <name> <seconds>` (integer, min 5). `nextResetAt = resetFinishedAt + interval`. Auto-reset requires a teleport point. Overlapping reset is rejected. After restart, one overdue reset runs; missed intervals are not stacked.
6. **Evacuation.** `/automine setteleport <name>` stores worldId/x/y/z/yaw/pitch. Reset teleports same-world players whose feet block is inside the inclusive cuboid **before** block writes, via `TeleportService` (`reason: 'automine'`).
7. **Workload.** `AutoMineManager.tick` from `WorldInstance` (same place as RTP). Each tick `applyBlockBatch` up to 64 voxels (`skipSupport`, coalesced lighting), then the ordinary `flushBlockChanges` → `block_batch`.
8. **Restart.** Config + `nextResetAt` reload on enable. In-progress RESETTING is not persisted; a crash mid-fill becomes one overdue reset after boot.
9. **Permissions.** `automine.manage` (admin `automine.*`). OP bypasses. Default players cannot wand/create/interval/teleport/reset/delete.
10. **Commands.** `/automine wand|create|delete|list|info|reset|setinterval|setteleport` (+ `/am`).

## Architecture decisions

- Reuse `volumeFromCorners` / `volumeContains` helpers; keep AutoMine selection on the manager.
- Snapshot-on-create + restore-on-delete because the project has no generic cuboid undo. Safer for spawn than leaving generated ores or punching air.
- First fill after create does not require teleport. Timed/manual reset aborts with «Для авто-шахты не задана точка телепорта.»
- Wand is the existing wooden axe, not a new ItemId.

## Tests

Focused: `tests/server/auto-mine-core.test.ts` 15/15, `tests/server/auto-mine.test.ts` 3/3.
Related: plugin-boundaries, anarchy-plugins, plugin-platform, permissions.
`npm run test:sim` 44/44. `npm run test:server` 333/333 (includes AutoMine).

## Visual QA

Headless Anarchy `WorldInstance` covered wand clicks, create, fill, setteleport/setinterval, two players inside/outside, manual reset, delete-restore, and restart overdue timer. Interactive in-game Anarchy session was not available in this cloud agent (no running browser game client).

## Performance

15³ = 3375 voxels → 53 ticks at 64/tick (~2.7 s). Lighting is one coalesced `relightRegion` per batch, not per voxel `setBlock`. 15×15×15 fill test max batch size is 64.

## Known issues

- Survival LMB with the wand still plays mining overlay until `blockBreak` is cancelled; RMB/Creative LMB are instant.
- Local camera look stays client-authored after evacuation; server yaw/pitch apply to the controller/snapshot.

## Deferred

Per-mine composition commands (explicitly out of scope). Homes/TPA/economy unchanged.

## Next work

Owner live Anarchy: wand 15×15×15, interval 30, two players inside, break some blocks, restart server.

## Git

- Branch: `cursor/automine-plugin-1d56`
- Commit: `dec5fdac2289e75b03520f00e1ea9b5ea22f8878`
- PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/80
