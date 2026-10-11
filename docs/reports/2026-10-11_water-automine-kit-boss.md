# Water speed, automine composition, throw distance, kits, Mega Zombie knockback

## Goal

Raise settled swim speed to about 0.8× ground speed, retune the automine table, find why a live automine can stop resetting, double player throw distance, add a builtin `/kit`, and stop Mega Zombie attack knockback.

## Result

Swim speed settles at 5.6 blocks/s, which is 0.8× the unchanged ground speed of 7. Lava, air, sneak, and ladders keep their previous caps. Automine weights still sum to 10 000. A reset now completes when its own light token commits, so a leftover region-light job cannot leave the mine in `RESETTING`. Player Q throws use twice the horizontal speed and the same vertical hop. `/kit` gives `start` once on the first join and stores kits in plugin-data. Mega Zombie takes damage without knockback; other mobs still take it.

## Implemented

### Water

`WATER_MOVE_SPEED = PLAYER_MOVE_SPEED * 0.8`. The water branch no longer multiplies XZ by 0.8 after the blend. That second factor was pulling the steady speed to about half of whatever cap was set. Vertical water drag, lava's `WATER_SPEED * 0.55`, and lava's 0.5 drag are unchanged. Sprint in water stays off. Sneak does not replace the water cap.

### Automine composition

The wooden rows are logs, shown as «Дубовое бревно», «Берёзовое бревно», and «Еловое бревно». They are not planks. Each log weight is half of the previous value. Iron ore moved from 200 to 500, matching coal and obsidian. The rest of the freed weight went to stone.

| Block | Weight | Percent |
| --- | ---: | ---: |
| OakLog | 900 | 9% |
| BirchLog | 700 | 7% |
| SpruceLog | 700 | 7% |
| Stone | 4500 | 45% |
| Gravel | 1000 | 10% |
| CoalOre | 500 | 5% |
| RedstoneOre | 400 | 4% |
| GoldOre | 250 | 2.5% |
| IronOre | 500 | 5% |
| Obsidian | 500 | 5% |
| DiamondOre | 45 | 0.45% |
| TitaniumOre | 5 | 0.05% |
| **Sum** | **10000** | **100%** |

`/automine info` and `/automine create` still print `formatAutoMineCompositionLines()`, so they show these percents.

### Why a reset could stop

`stepLighting` used to call `finishJob` only when `world.hasQueuedRegionLight` was false. That flag is true whenever any region-light job is queued or a region flood is active. The server sets `deferredLighting = false` for ordinary `setBlock`, but fluids, buckets, beds, and world events call `applyBlockBatch` with `deferLighting: true` and enqueue region jobs. Nothing else on the server drains that queue except the automine lighting slice. After the mine's own job committed, a fluid job left behind — or a new one queued in the same tick — kept `hasQueuedRegionLight` true. `tick()` then skipped the mine because a job still existed, so `nextResetAt` never moved. The mine stayed `RESETTING` until a process restart dropped the in-memory job.

The fix stores the token returned by `queueLight` and finishes when that token's job commits, including when the region was merged into an older job. Unrelated jobs can stay queued. If the token is still open after 400 ticks, the schedule is released and a log line names the queue length. A world-id mismatch, or a missing interval, teleport, or `nextResetAt`, is logged at most once every 30 seconds. There is no second timer.

`https://megacraft.agariobrainrot.ru/status` returned HTTP 200: world `anarchy`, mode `anarchy`, ready, tickRate 20, 1 player online. The status payload does not include automine records, plugin-data, or server logs. Those files were not read from production, and no reset was sent to the live mine.

### Player throw

`playerDropVelocity` scales XZ by 6.4 and Y's look component by the old 3.2, then adds 1.6. Looking straight up does not double the hop. Count, pickup delay 1.25, pickup radius, and mob-loot scatter are unchanged.

### /kit

Commands: `/kit help`, `/kit start`, `/kit <name>`, `/kit create <name>`, `/kit delete <name>`, `/kit give <player> <name>`.

`/kit create` copies the creator's main inventory, armor, and offhand. Empty slots and unknown items are skipped. The creator keeps every stack. An empty inventory creates an empty kit. Duplicate and illegal names are rejected. `help`, `create`, `delete`, and `give` are reserved. Data file: `plugin-data/kit/store`.

`/kit <name>` gives that kit to any player. `/kit start` is separate: the first join grants it when the kit has items, and `/kit start` grants it once if it was not received yet. Reconnect, death, and respawn do not grant it again. A failed delivery stays pending and is retried. Create, delete, and give require operator, `kit.admin`, or `server.admin`. `deliverKit` gives in `maxStack` batches so a full inventory uses `PlayerView.give`'s leftover drop.

### AutoMine hologram

`/holograms automine <hologram> <mine>` stores the mine name on the existing hologram and marks it as a timer. The network snapshot carries `timerEndsAt` from that mine's `nextResetAt`. The client renders `Обновление шахты через: MM:SS` and holds `00:00` after the deadline instead of starting its own loop. `noteAutomineSchedule` runs from the existing world tick and broadcasts only when `nextResetAt` changes. `/holograms automine <hologram> clear` unlinks it. A missing schedule shows `Обновление шахты: нет расписания`. Ordinary timers omit `timerEndsAt`.

### Mega Zombie

`MobManager.damage` skips knockback, extra knockback, and `meleeKnockback` when `kind === 'mega_zombie'`. Projectile and explosion impulses use that same branch, so they skip too. Fire still damages and ignites. HP, death, and loot are unchanged. `update` still runs `updateMegaZombie` while `hurtSeconds` is positive, so a stream of hits does not pause the attack cycle. Other mobs keep knockback and the hurt pause. Boss chase and attack damage are unchanged.

## Changed files

`src/core/constants.ts`, `src/player/PlayerController.ts`, `src/world/World.ts`, `src/entities/DroppedItemManager.ts`, `src/entities/MobManager.ts`, `server/services/autoMine.ts`, `server/services/kit.ts`, `server/services/permissions.ts`, `server/builtin-plugins/kit.ts`, `server/builtin-plugins/index.ts`, `server/events.ts`, `server/WorldInstance.ts`, tests listed below, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/PLUGINS.md`.

## Architecture decisions

One movement class, one automine tick, one kit store, one mob damage function. The light token is an id on the existing edit-light job, not a second scheduler. `firstJoin` is a field on the existing join event.

## Tests

Focused: `tests/player-physics.test.ts`, `tests/player-drop-distance.test.ts`, `tests/server/auto-mine-core.test.ts`, `tests/server/auto-mine.test.ts`, `tests/server/kit.test.ts`, `tests/mega-zombie.test.ts` — pass.

`npm run typecheck`, `tsc -p tsconfig.server.json`, `tsc -p tsconfig.client.json`, `npm run check:boundaries`, `npm run build`, and `npm run build:server` pass.

`npm test`: 3363 passed, 26 failed, 1 skipped, 361 files. The previously recorded set is still here: arrow panel UVs, classic combat presentation (2), fence jump, production MP3 count (2), remote breaking overlays (13), pet hit registration (2), bow draw FIFO. Two more fail because this environment has no Pillow (`game-menu-gui` icon alpha, `god-sword-texture` generator). `ui-main-integration` looks for an inventory `submitAction` string that is not in the current UI source. `tests/server/god-sword.test.ts` expects a zombie to survive a God Sword hit, while `ServerGameplay.meleeMob` already passes `lethal: true` for that sword. Neither file was edited here.

Water: settled water/land is inside 0.75–0.85, land stays on 7, lava stays under 1.2, air after 12 ticks is still above the swim cap. Throw: level flight is inside 1.8–2.2× the old 3.2 horizontal speed; up and down do not scale the hop by 2. Automine: a fluid job requeued whenever the region queue empties does not block `READY`; a no-op `processLighting` releases after the tick cap and logs. Kit: one grant, nested busy, failed give stays pending, reconnect and restart do not grant again, claim permission, full inventory spills the remainder. Boss: melee, extra knockback, projectile, explosion, and fire leave velocity at 0 while HP falls; a zombie still gains velocity; the boss still deals 5 damage.

## Visual QA

Not run in a browser. Headless physics and server tests cover the numbers. A live swim, a Q throw, and an automine reset on the dev server are still worth a look.

## Performance

No new per-frame work. Automine lighting still uses the 8 ms slice. The token check is a set lookup.

## Known issues

Production automine JSON and server logs were not available from this environment. The status endpoint only shows that the Anarchy process is up. If a mine's saved `worldId` is not `anarchy`, or `intervalSeconds` / `teleport` / `nextResetAt` is null, the new log line names that on the server. The light-token fix is the code path that can freeze `RESETTING` without a bad save.

## Deferred

No payment flow for donate kits. Claim nodes are `kit.claim.<name>` and are not granted by default.

## Next work

On the live host, read `plugin-data/automine/automines.json` and the automine log lines after deploy. `/automine info <name>` shows world, interval, teleport, and status without resetting the mine.

## Git

Feature branch `cursor/water-automine-kit-boss-d00d`. Draft PR **#130**. Not merged.
