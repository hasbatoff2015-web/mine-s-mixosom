# 2026-09-08 — Online/Anarchy gameplay polish (fire, death, sounds, recipes)

## Goal

Six small Anarchy UX/gameplay gaps vs Singleplayer: first-person fire overlay, death-item scatter, player death animation, death screen + explicit respawn, full sound audit, recipe-book selection without ingredients. Reuse existing SP systems. Do not invent parallel PlayerVisual / RemotePlayerView / SurvivalSystem / inventory / crafting / audio pipelines. Do not change PR #74 skin selector or nameplates.

## Result

Online now drives the existing SP fire overlay from authoritative `health.fire` / `player_state.onFire`, scatters death loot like SP/Minecraft, keeps the corpse dead until `respawn`, plays the zombie/humanoid death pose on `PlayerVisual`, shows «Вы умерли» / «Возродиться», broadcasts catalog `world_sound` events, and lets the recipe book ghost missing ingredients while the server still rejects empty crafts.

## Implemented

### 1. Fire / lava screen overlay

SP: `FirstPersonRenderer` + `SharedFireTexture.createFirstPersonOverlay()` (`public/textures/block/fire.png`), opacity `FP_FIRE_OVERLAY_OPACITY = 0.76`, binary visibility from `SurvivalSystem.isOnFire` (`contactFire || fireTicks || arrowFireTicks`). Wired in `Game.updateFirstPerson`.

Online already sent `ServerHealthMessage.fire` and `PlayerSnapshot.onFire` but the client ignored them (`restore()` never applied fire; `tickOnline` does not run `survival.tick`).

Fix: `SurvivalSystem.syncNetworkFire(boolean)` + `networkOnFire` OR-ed into `isOnFire`. Client applies `message.fire` and `local.onFire`. No new protocol field. Overlay renderer and assets unchanged. Clears on respawn with the rest of survival state.

### 2. Death item scatter

SP death used `spawnDroppedStack` + `dropScatterVelocity` `[(r-0.5)*1.4, 2.2, (r-0.5)*1.4]`, origin feet + 0.35, whole stacks, no split.

Online death used `dropFromPlayer` (Q-toss along look, same origin) → pile.

Fix: shared `dropScatterOrigin` (~±0.25 xz, y+0.35). Server `scatterDeathDrop` uses scatter velocity, `merge: false`, pickup delay 1.25s. Loot still drops once via `deathLootDropped`. Same slots as before (inventory, armor, offhand, cursor, craft). SP `Game.spawnDroppedStack` also uses origin jitter.

### 3. Player death animation

Zombie/mob death: `MOB_DEATH_ANIMATION_SECONDS = 0.7`, linear `rotation.z = progress * π/2`, `scale = 1 - progress*0.25` in `ThreeEntityHost.syncMob`.

Shared `src/entities/humanoidDeath.ts`. `RemotePlayerView` starts the clock on the dead **edge** only. `PlayerVisual.update` applies the same tilt/scale and suppresses idle/walk overlays while `deathProgress > 0`. Snapshot `dead: true` is now visible because the server no longer auto-respawns the same tick.

### 4. Death screen

Existing `GameUI.showDeath` («Вы умерли» / «Возродиться»). Online `handleDeath` used to return immediately. Now it shows that screen. Button sends `{ type: 'respawn' }` once (`onlineRespawnPending`). Server `respawnPlayer` rejects if not dead. Successful health packet `dead: false` still uses `restoreOnlinePlayingFromRespawn`.

### 5. Sounds

One catalog: `soundEvents.ts` + `soundCatalog.ts` + `AudioManager`. 26 SFX files. No Three on the server.

New `ServerWorldSoundMessage` `{ type: 'world_sound', sounds: [{ event, x, y, z, pitch?, volume? }] }`, flushed like `entity_event`. Client `playWorld` via `resolveCatalogEvent`.

Full table is in the Sound audit section below.

### 6. Recipe book

Bug was not the optional `craftableOnly` filter. Online `handleRecipeClick` sent `recipe` and returned without `ghostCraft`. Server `applyRecipe` with no ingredients returns an empty grid.

Fix: client always sets `ghostCraft = ghostFromRecipe(...)` then submits. Real stacks from inventory sync take precedence; empty grid shows ghost/missing red. `applyAuthoritativeCursor` clears ghost only when any craft slot is non-null. Craft still server-validated (`click result` / `takeCraftOutput`).

## Changed files

- `src/survival/SurvivalSystem.ts` — `syncNetworkFire`
- `src/core/Game.ts` — fire sync, death screen, respawn request, world_sound, Online footsteps/eat
- `src/core/onlineRespawn.ts` — comment only (existing restore path)
- `src/gameplay/random.ts` — `dropScatterOrigin`
- `src/entities/humanoidDeath.ts` — shared death pose
- `src/entities/MobManager.ts`, `src/entities/ThreeEntityHost.ts`, `src/entities/index.ts` — reuse shared pose
- `src/rendering/player/PlayerVisual.ts` — death tilt/scale
- `src/net/RemotePlayerView.ts` — dead-edge clock
- `src/ui/GameUI.ts` — recipe ghost on Online click
- `server/gameplay.ts` — death loot scatter, no auto-respawn, `respawnPlayer`, world sounds
- `server/WorldInstance.ts` / `server/AnarchyServer.ts` — `respawn`, flush `world_sound`
- `shared/protocol.ts` — `ClientRespawnMessage`, `ServerWorldSoundMessage`, `RemotePlayerInfo.dead?`
- Tests: `tests/online-gameplay-polish.test.ts`, `tests/server/online-gameplay-polish.test.ts`, plus anarchy-gameplay / anarchy-plugins / random-source
- Docs: PROJECT_STATE, ROADMAP, ARCHITECTURE, TESTING, this report

## Architecture decisions

- Fire overlay stays in `FirstPersonRenderer`. Online only feeds `SurvivalSystem.isOnFire`.
- Death stay-dead is a host-policy change, not a second survival system. `respawnIfDead` now means “handle death”, not “revive”.
- Player death pose is the mob humanoid pose on the existing `PlayerVisual`. No second player model.
- World sounds are catalog event ids + position, never assets/bytes.
- Recipe selection and craft validation stay split: ghost is client presentation; consume is server inventory.

## Sound audit

Catalog = 16 named events + 24 material events (`hit|break|place|step` × `stone|wood|dirt|sand|wool|glass`). Assets: all 26 mp3 files already in `public/audio/sfx/`. No `[MISSING ASSET]`.

| Sound | Singleplayer | Online before | Action | Online after |
|---|---|---|---|---|
| explosion | `playWorld` on `ExplosionQueue.onResolved` | no server emit (TNT silent for remotes/local Online) | added `emitWorldSound('explosion')` | OK (ordinary / powerful / destructive / minecart share one event) |
| bow.shoot | `playLocal` on local release | no server emit | added server emit on fire | OK |
| arrow.hit | `playWorld` on block hit | no server emit | added server emit | OK |
| combat.hit | melee/arrow player+mob | no server emit | added server emit | OK |
| player.hurt | `playLocal` on local damage | `health` packet already played local hurt | none | OK |
| item.pickup | `playLocal` on drop/arrow collect | no server emit; Online drops are snapshot-driven | added server emit | OK |
| food.eat | local cadence in world tick | Online food visual had no SFX | local cadence in `tickOnline` | OK |
| potion.drink | same as eat, drink asset | missing Online call | same local cadence | OK |
| door.open | `useInteraction` `playWorld` | server `effects.playWorld` was unset | wired `emitWorldSound` | OK |
| door.close | same | same | same | OK |
| chest.open | local `openBlockInventory` | same path via `openOnlineContainer` | none | OK (local GUI; remotes do not get a second emit) |
| chest.close | local close | same | none | OK |
| redstone.click | button/lever `playWorld` | server effects unset | wired `emitWorldSound` | OK |
| fire.ignite | flint `onFlintIgnite` | server flint had swing only | `emitWorldSound('fire.ignite')` | OK |
| water.splash | bucket `playWorld` | server effects unset | wired | OK |
| glass.break | named alias → `block.break.glass` | unused named id | none | NOT APPLICABLE (breaks use `block.break.glass`) |
| block.hit.{stone,wood,dirt,sand,wool,glass} | mining overlay hit | local mining overlay already | none | OK |
| block.break.{stone,wood,dirt,sand,wool,glass} | local break + `block_update` | `block_update` already | none | OK; TNT `block_batch` stays silent per voxel (explosion is the boom) |
| block.place.{stone,wood,dirt,sand,wool,glass} | local place + `block_update` | `block_update` already | none | OK |
| block.step.{stone,wood,dirt,sand,wool,glass} | `updateFootsteps` in world tick | `tickOnline` skipped footsteps | call after prediction | OK |
| block.break.stone (minecart break) | `playWorld` | no server emit | server emit | OK |
| lava / fire / water ambient loops | not in catalog | not in catalog | none | NOT APPLICABLE (no SP loop system) |
| sword swing whoosh | not in catalog (melee is `combat.hit`) | — | none | NOT APPLICABLE |
| player death SFX | not a separate catalog event | — | none | NOT APPLICABLE |
| mob hurt/death unique SFX | `combat.hit` only | — | reuse combat.hit | OK |
| UI slot/recipe clicks | not in catalog | — | none | NOT APPLICABLE |
| XP / potions / enchanting extra | out of scope | — | none | NOT APPLICABLE |
| portal chest | same `chest.open/close` | same | none | OK |

Statuses used: **ONLINE OK**, **MISSING CALL** (fixed this pass), **MISSING ASSET** (none), **ONLINE DIFFERENT** (`block_batch` explosions do not spam per-voxel break), **NOT APPLICABLE**.

## Tests

```text
npm run typecheck
npm run typecheck:client
npm run typecheck:server
npm run typecheck:sim
npm run check:boundaries
npm run test:sim
npm run test:server
npx vitest run tests/online-gameplay-polish.test.ts tests/server/online-gameplay-polish.test.ts tests/random-source.test.ts tests/server/anarchy-gameplay.test.ts --maxWorkers=2
npm run build
```

## Visual QA

Automated contracts cover fire flag, death stay-dead + duplicate respawn reject, scatter radius, explosion `world_sound`, recipe ghost vs server reject. Two-client live Anarchy (lava overlay, remote death pose, TNT boom, recipe red ghosts) remains owner QA; this cloud pass did not run a full in-browser Anarchy session.

## Performance

`world_sound` is event-batched, not per-tick. Death pose is one `rotation.z` + scale on the existing visual. Overlay is the existing shared fire strip.

## Known issues

- Remote players do not hear another player's chest open/close (local GUI path, same as before).
- TNT `block_batch` still has no per-voxel break SFX by design.
- Owner two-client visual acceptance is still required.

## Deferred

- Remote chest SFX
- Death-screen visual polish
- Stack-splitting death drops (SP also drops whole stacks)

## Next work

Owner live Anarchy: fire overlay, death scatter, remote death pose, death screen, TNT explosion SFX, recipe ghost with zero ingredients.

## Git

Branch `cursor/online-gameplay-polish-5fe9`
