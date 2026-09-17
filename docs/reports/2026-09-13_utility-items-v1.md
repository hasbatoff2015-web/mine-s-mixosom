# Utility Items V1 — 2026-09-13

## Goal

Add Paper/Sugar Cane, editable Book, text Sign, decorative two-block Bed, Milk Bucket, decorative Firework Rocket, private WH Arrow and Totem of Undying on `codex/utility-items-v1`, without altering the 20 TPS simulation, established PvP pipeline, current plugin platform or `main`.

## Result

All eight requested mechanics are wired into Singleplayer and the authoritative Anarchy server. Core text/save/network paths are additive. Server-only temporary state (rockets and WH marks) is not written to permanent saves. Interactive three-client visual QA remains open; the automated three-client privacy assertion passed.

## Minecraft reference and intentional deviations

| Item | Java 1.9-style reference | Frontier Cubes V1 |
| --- | --- | --- |
| Paper/Book/Sign | Cane → Paper; Paper + Leather → Book; planks + stick → Signs | Same ingredient family; bounded, editable plain-text pages/signs. |
| Sugar Cane | Wet sand/dirt/grass, vertical growth to three | Same support/height rule; rare deterministic shore generation in the compact world. |
| Bed | Two cells, sleep/time and respawn behavior | Two cells and one item drop, **decorative use only**. No sleep, home, `spawnPoint` or time skip. |
| Milk | Cow + Bucket; drink clears potion effects, returns Bucket | Same effect clearing through existing 32-tick consumption. It does not extinguish physical fire state; also clears private WH marks. |
| Firework | Gunpowder controls flight; optional stars/colors | Flights 1/2/3, neutral trail/burst; no dyes/stars, Elytra, damage or TNT coupling. |
| Spectral Arrow | Glowing generally visible to observers | Custom **WH** mark visible only to the shooter; 10 seconds, expensive recipe. |
| Totem | Held hand saves from ordinary lethal damage; void exception | Selected mainhand then offhand; exact 1 HP + Regen II 900 + Fire Resistance I 800 + Absorption II 100; also clears private WH marks. |

## Implemented

- `ItemId`: `paper`, `firework_rocket`, `wh_arrow`, `totem_of_undying`, `milk_bucket`. `BlockId`: `SugarCane=164`, `OakSign=165`. Existing White Bed and Book IDs are reused. Totem has no recipe; current Buyer NPC buys player goods and is not a trader selling Totems. Acquisition awaits a dedicated trader feature; Creative/admin/test can obtain it now.
- Recipes: 3 Cane → 3 Paper; 3 Paper + Leather → Book; 6 planks + stick → 3 Oak Signs; White Bed existing recipe unchanged; Paper + 1/2/3 Gunpowder → 3 Rockets with Flight 1/2/3; 4 Arrows + Glowstone block + Diamond + 2 Redstone Dust → 4 WH Arrows. No Glowstone Dust item was added.
- Firework metadata: `{ firework: { flight: 1|2|3 } }`; reserved nested object can later gain shapes/colors/trail/twinkle without changing the stack format. Different flights do not merge. Server validates selected Rocket, consumes one in Survival, spawns from hit face or eye. `FireworkManager` applies 20 TPS upward acceleration, flight-dependent fuse, one-tick burst, cap 32. `FireworkVisuals` uses the rocket asset, capped 256 trail/burst particles. Nearby clients receive entity snapshots. No damage, knockback or block mutation.
- Book metadata: `{ book: { pages: string[], title?: string, author?: string, locked?: boolean } }`; 32 pages, 1024 chars/page, 64-char title. Newlines/unicode remain text, controls/unpaired surrogates are stripped. Server validates/sanitizes `book_update`; content reaches inventory, chests, portal chest, drops and auction through canonical `ItemStack.metadata`. Editing one from a blank stack splits one; locked books are read-only.
- Sign text: exactly four lines, at most 32 chars each. `VoxelWorld.signs` is saved with world records and sent in chunk payloads; `sign_update` checks active player, reach, sign identity and `playerInteract` cancellation. `SignRenderer` caches CanvasTexture by changed state, never recreates textures per frame. Floor rotation and four wall facings use existing block state; breaking/replacing clears text.
- Bed: validates both cells and both supports/Claims before one batch placement; stores `bedPart` and `facing`. Breaking either half removes both and drops one item; detached support cleanup also emits one drop. Using a Bed emits only a decorative response. No Bed path calls spawn/home/time setters.
- Sugar Cane: wet soil support, stacked growth capped at three, deterministic separate worldgen RNG namespace after ore/tree decoration, bounded `FarmingSystem` tick. Ore/tree RNG streams are untouched.
- Milk: Cow raycast from empty Bucket in SP/server; non-cow does not fill. Drink takes the existing 32-tick food timeline, returns Bucket, calls canonical `clearEffects` (including absorption hearts, regeneration timer and Fire Resistance), leaves HP/hunger/fire timers alone, and removes all viewer marks targeting the drinker.
- WH: `ArrowKind='normal'|'fire'|'wh'` extends the existing `PlayerArrowManager`. Priority Fire → WH → normal in both bow paths. WH uses captured release boundary, projectile catch-up, historical target AABB, collision, Claims/plugin `playerDamage`, armor and HurtResistance. Only accepted player damage creates/refreshed `(viewer,target)` in `WhMarks` to `now+200`. The server sends `wh_marks` per viewer, never in broadcast `player_state`. Death/disconnect/Milk/Totem/expiry clear it. Spectral entity texture and bright reusable `EdgesGeometry` render through depth without changing skin material or global invisibility. Embedded pickup returns WH Arrow.
- Totem: `SurvivalSystem.damage` pre-death hook runs after armor/absorption and before `dead=true`/death callbacks. The hand is inspected only when lethal, mainhand before offhand, void excluded. Activation clears old effects, sets HP 1 and exact buffs; no death event/drop/respawn. The saved player receives `totem_activate`; one reusable HUD image animates with a bounded spark halo and activation sound.

## Recipe table

| Output | Ingredients | Result |
| --- | --- | --- |
| Paper | 3 Sugar Cane in a row | 3 Paper |
| Book | 3 Paper + 1 Leather, shapeless | 1 Book |
| Oak Sign | 6 planks + 1 Stick | 3 Oak Signs |
| White Bed | Existing 3 wool + 3 planks recipe | 1 White Bed |
| Firework Rocket | 1 Paper + 1/2/3 Gunpowder | 3 Flight 1/2/3 Rockets, with distinct metadata |
| WH Arrow | 4 Arrows + 1 Glowstone block + 1 Diamond + 2 Redstone Dust | 4 WH Arrows |
| Totem / Milk | No crafting recipe | Creative/admin/test Totem; Cow + empty Bucket for Milk |

## Asset sources → runtime

`assets/minecraft/textures/items/{paper,reeds,book_normal,sign,bucket_milk,fireworks,spectral_arrow,totem}.png` → `public/textures/item/{paper,sugar_cane,book,oak_sign,milk_bucket,firework_rocket,wh_arrow,totem_of_undying}.png` (Book already existed); `assets/minecraft/textures/blocks/reeds.png` → `public/textures/block/sugar_cane.png`; existing plank source → `block/oak_sign.png`; `assets/minecraft/textures/entity/bed/white.png` → `public/textures/entity/bed/white.png`; `entity/sign.png` → `public/textures/entity/sign.png`; `entity/projectiles/spectral_arrow.png` → `public/textures/entity/spectral_arrow.png`. The import script carries the mapping. No Minecraft-branded assets or names are added to the product.

## Changed files

Gameplay/simulation: `src/items/*`, `src/crafting/*`, `src/blocks/*`, `src/world/{World,Generator,placement,bed,sign}.ts`, `src/farming/*`, `src/survival/SurvivalSystem.ts`, `src/combat/{PlayerArrowManager,WhMarks}.ts`, `src/entities/FireworkManager.ts`, `src/gameplay/useInteraction.ts`. Server/wire/save: `server/{gameplay,WorldInstance,AnarchyServer,persistence}.ts`, `shared/protocol.ts`, `src/save/*`. Client/UI: `src/core/Game.ts`, `src/net/{RemotePlayerView,applyEntitySnapshots}.ts`, `src/rendering/{ChunkMesher,WorldRenderer,SignRenderer,FireworkVisuals,ArrowVisualFactory}.ts`, `src/ui/GameUI.ts`, `src/style.css`, audio catalog. Assets: `scripts/import-assets.mjs`, selected `public/textures/*`. Tests: `tests/utility-items.test.ts`, `tests/server/utility-items-authority.test.ts`.

## Architecture decisions

No second inventory, bow, arrow, damage, chunk mesher or text renderer pipeline. Shared simulation imports remain Node-safe. Protocol additions (`sign_*`, `book_update`, `wh_marks`, `totem_activate`, `firework` entity kind) are optional/additive; old world saves remain readable. Book/sign text is server-sanitized and inserted into UI via `.value`/text nodes, never interpreted as HTML. Runtime WH state is never item metadata or a global glowing bit.

## Tests

- New focused suites: 26 core cases and 9 server authority cases passed. Server cases cover real accepted/cancelled WH hit, three-player privacy with invisible target, server book validation, sign edit cancellation, rocket visibility, 32-tick Milk and Totem hand priority/activation packet. `tests/item-rendering.test.ts` 27/27 passed after correcting utility block texture registry keys. `tests/entities.test.ts` 9/9 passed after preserving the existing normal-arrow mesh name. Combined focused run: 71/71.
- `npm run typecheck`, `typecheck:sim`, `typecheck:client`, `typecheck:server`, `check:boundaries`, `build`, `check:size`, `check:archive` passed. Production build: 4.27 MiB, 366 files, below the 100 MB platform limit.
- Unbounded parallel `npm test` returned 218/234 files, 2197/2234 tests passing. Most failures were performance/timeouts under severe worker contention. `tests/server/tick-load-flight.test.ts` failed its 80ms threshold even when run alone on archived `main@1c802ab` (110–121ms), establishing that particular failure as baseline on this host. A second full run with `--maxWorkers=2 --silent` was stopped as impractical: `tests/fire-contact-sunlight-minecart.test.ts` alone ran 282 seconds with 17 timeouts. It exposed a normal-arrow mesh-name regression, which was fixed and isolated `tests/entities.test.ts` now passes. `tests/lighting-scheduler.test.ts` run alone passed 18/19; the radius-6 flight exceeded its 15-second test timeout. Other full-suite failures remain unclassified until isolated comparison; they are not declared baseline solely from these runs.

## Visual QA

A fresh, separate Creative world launched in the local browser. The terrain rendered; Creative catalog and hotbar showed Book, Paper, Firework Rocket, WH Arrow, Totem and Milk Bucket icons. The in-app browser's pointer-lock fallback stayed over the canvas, so right-click use and three-client in-game appearance could not be inspected there. Automated snapshots prove that only the marked shooter receives `wh_marks` and that another client receives the Firework entity. Through-wall silhouette, invisible target outline, sign readability, rocket burst and Totem animation still require interactive inspection in a browser with pointer lock. The browser-only QA world is named `Utility Items QA 2026-09-13`; the isolated temporary Anarchy server data was removed after stopping the QA servers.

## Performance

Fireworks: 32 active rocket cap and 256 particle cap; no permanent save. WH: per-viewer maps bounded by connected players and cleaned on lifecycle edges; outline geometry/material built once per remote player, never per frame. Sign text canvas updates only on sign/version/visibility changes. Book UI is constructed only when opened. Four typechecks and boundary check passed.

## Known issues

- Full parallel suite has host-sensitive timing failures plus Windows CRLF comparison failures. The reference-extractor Vitest failure remains unclassified; report exact failures rather than treating them all as utility regressions.
- `tests/server/tick-load-flight` max-80ms threshold fails in both feature and archived main on this host; profiling/threshold calibration is a separate task.
- WH outline uses edge lines on the animated player rig, rather than a stencil/postprocess silhouette. Interactive quality needs review on opaque and invisible skins.
- The Totem activation sound reuses a pitched existing pickup clip; a dedicated licensed sound can replace it later without changing the event.

## Deferred

Trader sell availability for Totem, Firework stars/colors, advanced fireworks, Elytra/crossbow and global spectral Glowing are outside this stage.

## Next work

Perform three-client manual QA in a pointer-lock-capable browser and quiet isolated regression checks for remaining full-suite failures. After the branch is reviewed, merge through the normal repository workflow.

## Git

Base `main@1c802ab1010bf0aae1073998154cce69275fae1c`; feature branch `codex/utility-items-v1`. Commits before this documentation commit: `bf34c87` (`fix: repair entity visuals and projectile behavior`, already pushed during implementation), `6e85278` (`fix: complete utility item visuals and authority checks`). `origin/main` advanced to `70e2afe` during the task with the separate crafting UI work; this feature was neither rebased nor merged into `main`. No force push.
