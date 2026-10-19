# Mega Zombie loot, piles, and death-frame cost

## Goal

Retune Mega Zombie rewards, split multi-count resources into separate server item entities, double the horizontal scatter, and cut the synchronous client work when the boss dies.

## Result

Ruby ingots are always 3. The repair potion is gone from this table. Every kill also drops cooked chicken ×10, oak planks ×64, stone ×64, and 30 pickup firework rockets. Counts above 1 are split into several piles on the server. Those piles spawn inside a 0.9-block axis radius and leave with about twice the previous horizontal speed. Upward speed is unchanged. The client builds at most 6 dropped-item meshes per frame. The three death rockets use flights 1, 2, and 3.

Browser frame time was not measured. Headless Chrome in this environment still cannot create WebGL.

## Implemented

- Loot edits are only the rows named above. Other chest-copied rows, chances, and the `requiredCount + 5` backfill gap stay as they were. New rows are `required`, so they do not depend on backfill.
- `splitMegaZombieCount` / `splitMegaZombieStacks` run inside `scatterBossLoot`. A count of 1 stays one pile. A larger count becomes `min(count, max(2, ceil(count / 8)), 8)` piles, or more when `maxStack` requires it. Pieces are positive, sum to the rolled count, and never exceed `maxStack`.
- Boss piles set `lockMerge`. `mergeNearby` skips them and also skips network replicas, so a client does not glue server piles together and then respawn them from the next snapshot. Ordinary drops do not set the flag.
- `MEGA_ZOMBIE_LOOT_ORIGIN_RADIUS` 0.45 → 0.9. `MEGA_ZOMBIE_LOOT_HORIZONTAL_SCALE` 3.2 → 6.4. `MEGA_ZOMBIE_LOOT_UP_MIN` stays 7.5 and `UP_SPAN` stays 2.5. Gravity and collision stay in `DroppedItemManager`.
- `DroppedItemManager` keeps a visual queue. The first 6 visuals in a burst are created immediately; `interpolateVisuals` (once per render frame, online and offline) creates 6 more. Pickup uses the entity, not the mesh. Headless server spawns never queue.
- Firework particle tint reuses one `THREE.Color`. Burst particle count is still 88. The three rockets no longer share flight 1, so their bursts are not the same tick.

## What the death hitch is

Server scatter does not build meshes. A full minimum roll is 18 stacks, 246 items, 46 piles. In Node that scatter took about 0.7–0.9 ms.

The client used to call `createDroppedItemVisual` for every new snapshot item inside one `applyEntitySnapshots` pass. Geometries and materials were already cached. Each pile still allocates meshes. Those 46 piles are 83 visual copies. Building all of them in one call took about 6.1 ms in Node with a cold factory, and about 4.0 ms after one warmup. The budgeted path created 6 visuals during spawn (about 0.94 ms) and 6 more on the next `interpolateVisuals` (about 0.51 ms). Seven interpolate calls finished the queue.

Three firework bursts together took about 0.38 ms in Vitest. That is smaller than the mesh build. Staggering the fuses keeps that work off one tick. It was not the larger measured cost.

These numbers are CPU time in Node, not a browser frame. They do not prove the visible hitch is gone.

## Changed files

`src/entities/megaZombieLoot.ts`, `src/entities/megaZombie.ts`, `src/entities/DroppedItemManager.ts`, `src/net/applyEntitySnapshots.ts`, `src/rendering/FireworkVisuals.ts`, `server/gameplay.ts`, mega zombie tests, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`.

## Architecture decisions

Split on the server before `drops.spawn`, not as client-only copies. Visual deferral never decides inventory or pickup. `lockMerge` is serialized; `replica` is not.

## Tests

`tests/mega-zombie.test.ts`, `tests/mega-zombie-network.test.ts`, `tests/server/mega-zombie-service.test.ts`, `tests/server/mega-zombie-world.test.ts`, plus firework burst colors, entity host, and dropped-item merge tests.

## Visual QA

Not run in a GPU browser. Dev-server checks still needed: pile spread and landing, three staggered rockets, death pose, and a real FPS capture of the kill.

## Performance

See the numbers above. No browser profile.

## Known issues

- Node timings are not a frame-time profile.
- A headless browser here still cannot show the model.

## Deferred

No change to ordinary mob loot tables, global item physics, or the entity snapshot cap.

## Next work

Profile one boss kill on the dev server in a GPU browser and compare the heaviest frame with these Node numbers.

## Git

Feature branch `cursor/mega-zombie-boss-62a5`. Draft PR #128. Not merged.
