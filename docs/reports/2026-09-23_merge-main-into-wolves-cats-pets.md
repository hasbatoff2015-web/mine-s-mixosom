# Merge origin/main into wolves-cats-pets

## Goal

Synchronize `codex/wolves-cats-pets` with current `origin/main` using a `--no-ff` merge commit, keep both the pets feature and all newer main systems, validate, then merge the feature into `main` with a normal merge commit (no rebase, squash, or force-push).

## Starting HEADs (verified after fetch)

- Feature `origin/codex/wolves-cats-pets`: `bf6820097715fb02c376725a16fcd882879342d0`
- Main `origin/main`: `5d972cfc9c9bcdb407d0eccc61f1a3b89c74515c`
- Merge base: `717fee7357bc7326130cc07aa2ccd11220de55fa`
- Relation: feature 6 ahead / 53 behind (diverged)
- PR for this head before work: none (`[]` from GitHub API)

## Result

`origin/main` was merged into `codex/wolves-cats-pets` with a merge commit. Pets (taming, ownership, receive-time `entity_use` freeze, click-time aim, `/spawnpet`, models) and current-main (Worldgen V3, playable border, world-events overlays, sword blocking, always-run/crouch/KeyC) both remain. Owner live QA of pets was already done before this sync.

## Conflict files

Exact content conflicts:

- `src/entities/MobManager.ts`
- `docs/ARCHITECTURE.md`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/TESTING.md`

Auto-merged (inspected, both families present):

- `src/core/Game.ts`
- `server/WorldInstance.ts`
- `server/gameplay.ts`
- `server/AnarchyServer.ts`
- `server/services/permissions.ts`
- `shared/protocol.ts`
- `src/combat/PlayerArrowManager.ts`
- `src/main.ts`

Untracked and left alone: `assets/minecraft/textures/entity/chest/event_chest.png`.

## Semantic resolutions

### `src/entities/MobManager.ts`

Union, not ours/theirs:

- Keep main playable-border spawn: `!force && !isInsidePlayableBlock(...)` returns undefined.
- Keep pets wild cap: `!tamed && countWildMobs() >= maxMobs` (tamed pets do not fill `maxMobs`). Do not use main’s `this.mobsById.size`.
- Force spawn (`/spawnpet`) still evicts farthest/oldest, then re-checks `countWildMobs()`.
- Natural spawn already used `isInsidePlayableBlock` in `randomSpawnColumn` (auto-merged).

### Docs

Keep both prefixes: pets 2026-09-22/20 sections plus current-main Worldgen V3 / border / world-events / sword blocking / clans. Deduped a repeated tameable-wolves checklist in ROADMAP. Added this merge as the latest pass.

### Auto-merged high-risk files

| File | Pets kept | Main kept |
| --- | --- | --- |
| `Game.ts` | `resolvePetUseTarget`, `trySendOnlinePetUse`, `entity_use` / `lastEntityUseDiag` | `WorldBorderRenderer`, `gameplayMayMutateBlock`, `syncLocalCombatUse` |
| `WorldInstance.ts` | `pendingEntityUses`, receive-time `capturePendingEntityUse`, click look, `/spawnpet` + `/petspawn` | `WORLDGEN_VERSION`, `networkModifications` / `networkChunkModifications`, world-events |
| `gameplay.ts` | `useEntity`, `raycastMobTarget`, clickLook | `gameplayMayMutateBlock`, `isPlayerCenterInsidePlayableWorld` |
| `protocol.ts` | `EntitySnapshot.ownerId/sitting/angry`, `action_result.entityUse` | world-events / clans / economy / current messages |
| `permissions.ts` | `pet_plus` / `pet_master`, `pets.limit.3/5` | `events.*` and current admin/default/vip |
| `PlayerArrowManager.ts` | `ownerId` on mob hits | `isInsidePlayableBlock` / `isInsidePlayablePoint` |
| `AnarchyServer.ts` | `entity_use` → `handleSequencedEntityUse` | current routing |
| `main.ts` | `qaMob` / `petState` | `PlayerQaHarness`, `UiQaHarness`, `ArrowQaHarness` |

Critical pet architecture verified after merge: `capturePendingEntityUse` freezes pose against `receivedServerTick`; `resolveSequencedEntityUse` uses `pending.target.pose` plus `clickLookFromAction`; it does not call `rewindPose(..., currentTick)` after FIFO wait. `MAX_MOB_REWIND_TICKS = 8`; `MAX_PVP_REWIND_TICKS = 5`.

## Extra integration edits (not conflict hunks)

- `src/core/Game.ts`: `damagePlayerFromMob` calls `session.mobs?.assignOwnedWolfTarget(...)`. The pets wolf-assist path must not crash Game stubs that omit `mobs` (`tests/shield-removal.test.ts`).
- `tests/worldgen-v3.test.ts`: the 8-seed gourd-subset sampler exceeds Vitest’s 5s default on this Windows host (~6.6s). Timeout set to 30s. Assertions unchanged (`GOURD_PATCH_DENSITY === 0.25`, subset equality, 0.20–0.30 ratio).
- `tests/server/anarchy-plugins.test.ts`: listener counts updated to current-main plugins (claims + autoMine + wand + world-events): `blockBreak` 4, `blockPlace` 2, extra deny plugin 5. Reload-still-same-count contract unchanged.

## Owner manual QA (before this sync)

Owner confirmed on the pet branch:

- hit registration works;
- wolf taming/feeding works;
- pet interaction registration works;
- latest visual fixes accepted.

Not re-invented here.

## Cursor post-sync integration smoke

Not run at report time (no live Anarchy client session after sync). Do not treat as PASS.

## Validation

### Pets (PASS)

```text
npx vitest run tests/pets.test.ts tests/pets-performance.test.ts tests/visual-models.test.ts tests/entities.test.ts tests/entity-snapshot-interpolation.test.ts tests/melee-action-intent.test.ts tests/mob-pose-history.test.ts tests/server/pets-anarchy.test.ts tests/server/pet-hit-registration.test.ts tests/server/spawnpet-command.test.ts --maxWorkers=2
```

**10 files / 120 tests PASS.**

```text
npx vitest run tests/pet-textures.test.mjs --maxWorkers=2
```

**1 file / 2 tests PASS.** (`node tests/pet-textures.test.mjs` is not the runner; the file is a Vitest module.)

### Current-main regressions

```text
npx vitest run tests/worldgen-v3.test.ts tests/worldgen-v2.test.ts tests/worldgen-terrain.test.ts tests/world-border.test.ts tests/world-border-interactions.test.ts tests/minecart-world-border.test.ts tests/server/world-border-authority.test.ts tests/server/world-events.test.ts tests/server/world-events-plugin.test.ts tests/server/world-events-v3-migration.test.ts tests/sword-blocking-visual.test.ts tests/classic-combat-integration.test.ts tests/player-main-integration.test.ts tests/player-visual-animation.test.ts tests/remote-action-presentation.test.ts tests/server/remote-presentation.test.ts --maxWorkers=2
```

First pass: 15 passed / 1 failed — gourd subset **timed out at 5s**. Isolated with 30s timeout: **PASS in 6641ms**, assertions intact.

### Typecheck / boundaries / build

- `npm run typecheck` PASS
- `npm run typecheck:client` PASS
- `npm run typecheck:server` PASS
- `npm run typecheck:sim` PASS
- `npm run check:boundaries` PASS
- `npm run build` PASS (`dist/assets/index-ByNb7gH_.js` 1,566.75 kB)
- `npm run check:size` / `check:archive` PASS — production **4.90 MiB / 416 files**

### Server suite

`npm run test:server` under default workers had load timeouts plus stale plugin listener counts. Isolated `--maxWorkers=1` after the count fix: **anarchy-plugins, anarchy-server, fs-world-store, clan-roles-ranking, import-schematic, tick-latency, tnt-minecart PASS**. `tick-load-flight` still **111–130ms vs <80ms** — documented host baseline.

`tests/shield-removal.test.ts` crashed on merged `session.mobs.assignOwnedWolfTarget`. Optional call; isolated **6/6 PASS**.

### Full `npx vitest run --maxWorkers=2`

**285 passed / 11 failed files; 2801 passed / 16 failed tests** (376s). Failure classes:

- Host baseline: `minecraft-reference-extractor` parse, `chat-layout` CRLF, `tick-load-flight` <80ms, `tick-latency` under load, `game-menu-gui` `python3` ENOENT.
- Load/timing: `automine-reset-pipeline` 41.67 vs 40 (isolated PASS).
- Isolated still red, **not touched by pet commits**: `arrow-visual-cleanup` minecart geometry reuse; creeper-fence jump y 1.80 vs 1.9; lighting leftover jobs. Treated as current-main/host, not a pets overlay.

`npm run check` is **not claimed green** because it embeds the full Vitest run.

## Git

- Method: `git merge --no-ff origin/main`
- No rebase, squash, or force-push.
- Working branch: `codex/wolves-cats-pets` only (not `main`).
