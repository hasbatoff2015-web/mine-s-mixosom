# Mega Zombie boss

## Goal

Add one server-authoritative Mega Zombie on a configured 3D arena, using the existing mob, damage, item, firework, chat, and plugin systems.

## Result

The boss is mob kind `mega_zombie`. AI, HP, revenge, death, and loot are decided on the server. The client renders the ported Mutant Zombie, a scaled fire overlay, the death pose, and a HUD health bar.

## Implemented

- Builtin plugin `mega-zombie` and `MegaZombieService`.
- Commands `/boss setspawn|setpos1|setpos2|info|spawn` for operators and `mega_zombie.admin` / `server.admin`.
- 30 minute cycle, warning 5 minutes before spawn, 30 minute lifetime, at most one boss.
- 3D AABB targeting, revenge for 4.5 s, arena clamp.
- HP 1500 and melee damage 5. God sword uses the existing lethal hit. Sunlight does not burn this boss. HP bar is within 30 blocks of the configured spawn. `/boss kill` uses the death lifecycle. Loot is tossed upward beside the corpse.
- Fixed loot copy, ±4 block item burst, three firework rockets.
- Mutant Zombie model and 128×128 texture. Death pose 1.25 s. HUD bar.

## Changed files

New: `src/entities/megaZombie.ts`, `megaZombieLoot.ts`, `megaZombieModel.ts`, `megaZombiePose.ts`, `server/services/megaZombie.ts`, `server/builtin-plugins/megaZombie.ts`, `public/textures/entity/mutant_zombie.png`, tests under `tests/mega-zombie*.ts` and `tests/server/mega-zombie-*.ts`.

Edited: `MobManager`, `mobDefinitions`, `mobModels`, `LegacyModel`, `ThreeEntityHost`, `fireTexture`, `applyEntitySnapshots`, `server/gameplay.ts`, `WorldInstance`, plugin index/context, `Game`, `GameUI`, `style.css`, `main.ts`, `MobQaHarness`, docs.

## Architecture decisions

Extend `MobManager` instead of a parallel entity or websocket. One service tick on `WorldInstance`, not a timer per player. Boss loot is a separate constant so a future chest edit does not change it. The active boss is not serialized.

## Tests

`tests/mega-zombie.test.ts`, `tests/mega-zombie-network.test.ts`, `tests/server/mega-zombie-service.test.ts`, `tests/server/mega-zombie-world.test.ts`.

`npx tsc --noEmit` passed. Import boundaries passed. These new tests passed, including a real `WorldInstance` configure/spawn/restart. The full suite still has 25 failures that also fail on unmodified `main` (bow draw ticks, pet use, WebGL overlay light, SFX count, menu PNG, god-sword generator).

## Visual QA

Headless Chrome in this environment cannot create a WebGL context (`BindToCurrentSequence failed`), so the dev harness could not paint the model. A Node build of the rig reports bounds about 2.29 × 3.79 × 1.30 blocks at scale 1.3, with all twelve parts parented (forearms on arms, arms and head on the chest, lower legs on thighs). The scaled inflate dipped 0.13 blocks below the feet, so the whole model is lifted by that amount and the parts are not resized. `npm run dev` starts; the QA URL is `/?qaMob=mega_zombie`.

## Performance

One boss, AI once per server tick, no per-player timer, no full-entity scan on the render frame. The boss snapshot is forced in so the 96-entity cap cannot drop it.

## Known issues

- A headless browser here cannot show the model.
- Daylight still burns a hostile mob, including this boss, at 1 HP per second through the existing fire tick. That does not replace the last player attacker.
- Interest radius stays 48 for other entities. The boss itself is always snapshotted.

## Deferred

No extra phases, summons, or ranged attacks.

## Next work

Operator configures an arena on a live server and confirms the model in a GPU browser.

## Git

Not committed. Waiting for an explicit request.
