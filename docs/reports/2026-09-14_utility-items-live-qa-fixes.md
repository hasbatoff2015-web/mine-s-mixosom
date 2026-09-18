# Utility Items live QA fixes — 2026-09-14

## Goal

Finish the Utility Items V1 follow-up on `codex/utility-items-v1`: diagnose and fix Firework motion/collision/burst, WH outline and naming, Bed geometry, Sugar Cane generation, Totem presentation, offhand visibility and embedded network arrow direction. Preserve the existing simulation, networking and skin depth policy. Do not merge `main`.

## Result

The requested paths are corrected on the feature branch. Firework physics stays at 20 TPS while its sprite is interpolated at render FPS. The WH mark has one silhouette per base body part and survives a Classic/Slim rebuild. Bed and Cane now use the intended geometry and actual shoreline. Offhand and Totem feedback are visible in the existing UI. Network arrows retain their impact direction when embedded.

## Root causes and implemented fixes

| Symptom | Root cause | Fix |
| --- | --- | --- |
| Firework jerked and passed through roofs | `FireworkVisuals.sync` snapped a sprite only on snapshots; `FireworkManager.tick` advanced without collision | Collision raycast on each fixed movement step; local previous/current interpolation and Anarchy `EntityInterpolationBuffer` sampling. Stale entity packets no longer resync the firework visual. |
| Burst was small and monochrome | 28 pale particles at low speed for 0.7 s | 88 particles, six colours, wider velocity and longer life, within a 512-particle cap. Burst also appears when the first observed packet is already `burst`. |
| WH had a doubled/stale outline | The renderer outlined base *and* outer skin meshes and kept references to removed meshes after Classic/Slim mesh rebuild | Six base-only outlines, disposed/rebuilt only on model change, preserving mark visibility. No changes to skin render rank, depth bias, transparent queue or materials. |
| The arrow name was inconsistent across product identifiers | V1 used a different prefix for its item, mark packet and runtime class | Unified as WH across item ID, recipe, locale, protocol, asset import/runtime path, entity kind, code, tests and current documentation. No second protocol or alias was added. |
| Bed looked like separate slabs | The old mesh used generic block cuboids and sampled a thin, incorrect part of the source bed sheet for its pillow | Dedicated canonical head/foot parts with continuous frame and mattress seam, source-sheet UVs, pillow and headboard, rotated by existing facing state. Placement, collision 9/16 and single drop remain unchanged. |
| Sugar Cane was absent or could be placed near frozen water | Four random cell probes made a valid shoreline exceptionally unlikely; a height proxy was used instead of actual adjacent Water | Select from real Water-adjacent shore candidates, at most one 1–3-high stand per shoreline chunk using an independent deterministic RNG. Growth/support still use the existing farming path. |
| Totem feedback was easy to miss | A 180px image and a pitched item-pickup cue | Larger 1.7 s HUD animation with 12 reusable CSS sparks and a dedicated original procedural activation sound. |
| Offhand existed but was invisible | `Inventory.offhand` was supported by simulation and click handling, but omitted from hotbar HUD and equipment markup | Render the same offhand stack left of the hotbar and in the inventory equipment column. No second inventory slot/state. |
| Embedded network arrow changed angle | The unknown-ID network path called `spawn`, which reapplied random spread to zero velocity, and no impact velocity travelled with the snapshot | Server sends `state: embedded` plus `impactVx/Y/Z`; the client creates network arrows with exact velocity and retains `visualDirection` through zero-velocity snapshots/render interpolation. |

## Changed files

- Simulation/server/wire: `src/entities/FireworkManager.ts`, `src/world/Generator.ts`, `src/combat/{PlayerArrowManager,WhMarks}.ts`, `server/{gameplay,WorldInstance}.ts`, `shared/protocol.ts`, item/crafting/entity kind references.
- Render/UI/audio: `src/net/{applyEntitySnapshots,RemotePlayerView}.ts`, `src/rendering/{FireworkVisuals,ChunkMesher,specialBlockGeometry,ArrowVisualFactory}.ts`, `src/core/Game.ts`, `src/ui/GameUI.ts`, `src/style.css`, `src/audio/soundCatalog.ts`, `scripts/generate-core-sfx.mjs`, `public/audio/sfx/totem_activate.wav`.
- Asset naming/docs/tests: `public/textures/item/wh_arrow.png`, `scripts/import-assets.mjs`, `docs/{PROJECT_STATE,ROADMAP,ARCHITECTURE,TESTING}.md`, previous utility report, focused test suites.

## Architecture decisions

All gameplay remains on fixed 20 TPS; only visuals interpolate per frame. Shared simulation imports remain Node-safe and continue using `VoxelWorld`, `ChunkMesher`, `PlayerArrowManager`, `Inventory.offhand` and `PluginManager` paths. No separate combat, redstone, UI inventory or protocol was introduced. WH is viewer-private; the remote silhouette is attached to the current animated rig and has bounded geometry ownership. The Totem sound is generated in-repository, not copied from Minecraft assets.

## Tests

- Focused client/simulation/server suites: 8 files, 106 tests passed, including real shore Cane determinism, four Bed mesh orientations, ceiling collision, Classic/Slim WH outline rebuild, server/client embedded arrow direction and Firework interpolation.
- Audio catalog: 20 tests passed with the new 27-file bounded source pack.
- `npm run typecheck`, `typecheck:sim`, `typecheck:client`, `typecheck:server`, `check:boundaries`, `build`, `check:size`, `check:archive`: passed. Production output: 4.32 MiB / 367 files, well below the 100 MB unpacked platform limit.
- The entire `npm test` suite was not repeated in this pass. The previous utility report records host-sensitive timing and CRLF failures; this pass ran the affected paths and adjacent regressions with two workers.

## Visual QA

Code/geometry tests inspected all four Bed orientations, outline mesh count/lifecycle and HUD/sound wiring. Interactive visual QA was not performed in this pass; the earlier local browser was blocked at pointer lock. Manual checklist for a pointer-lock-capable browser:

1. In a fresh Creative Singleplayer world, launch Flight 1/2/3 rockets into open sky and from below a solid roof. Confirm smooth travel at varied FPS, collision burst below the roof, large multicolour particles and no block/damage effect.
2. Place a White Bed in north/east/south/west directions. Check joined mattress/frame, pillow/headboard on the head, texture orientation, support removal and exactly one item drop; using it must not change time or respawn.
3. Visit a newly generated liquid-water shore and a snowy frozen shore. Cane should appear sparsely only by Water, at height 1–3, then obey wet-soil growth/placement rules.
4. Put a Totem or another item in offhand. Check the left hotbar slot and inventory equipment slot in desktop and landscape mobile layouts. Trigger a lethal non-void hit and verify the large spark animation, audible unique cue, 1 HP and correct hand consumption.
5. Connect shooter, target and observer to one Anarchy server. Hit target with a WH arrow: only shooter sees one through-wall rim, including on an invisible target. Change target between Classic and Slim while marked and check rim remains single, correctly attached and free of outer-skin z-fighting. Expiry, Milk, Totem and disconnect should remove it.
6. Embed arrows in walls and floors from two clients. Confirm both clients see the same fixed impact angle and the arrow does not rotate while its live velocity is zero. Verify WH pickup returns the WH item.

## Performance

Fixed simulation and separate render interpolation remain intact. Fireworks cap at 32 rockets/512 particles; colour conversion happens at particle birth, not per frame. WH edge geometries rebuild only on Classic/Slim change and are disposed on replacement/removal. Bed geometry is chunk-meshed; Cane decoration scans only the local 14×14 interior of a generated chunk. HUD reuses one Totem element and a fixed 12-spark set. The procedural Totem WAV is 45.3 KiB.

## Known issues

- The checklist above still needs interactive pointer-lock QA, especially three-client wall/invisibility rendering and mobile offhand spacing.
- Full-suite host-sensitive timeouts and CRLF failures from the previous utility pass have not been reclassified here.
- The previous public item/protocol names have intentionally changed without a compatibility alias. This branch has not yet been released; clients and server must run the same version.

## Deferred

Trader availability for Totem, Firework stars/dyes and advanced fireworks remain outside this task. No new game mode, account system or second network protocol was added.

## Next work

Run the manual checklist in a pointer-lock-capable browser before merge review. Keep the branch isolated until the normal review/merge workflow.

## Git

Work stayed on `codex/utility-items-v1` (starting HEAD `a51d6a8`, `origin/main` observed at `70e2afe`). No rebase, force push or merge into `main`.
