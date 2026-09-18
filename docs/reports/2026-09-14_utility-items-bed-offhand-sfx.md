# Utility Items: Bed sheet, offhand Totem, burst colour and world SFX — 2026-09-14

## Goal

Fix the four concrete live-QA regressions on `codex/utility-items-v1` without merging `main`: Bed entity-sheet rendering, per-burst Firework colour, remote offhand Totem presentation, and nearby authoritative Totem sound. Preserve PlayerCommand FIFO/ack/replay, local aim, adaptive interpolation, PvP/Claims, 20 TPS simulation, existing HUD activation, and item icon paths.

## Result

White Bed now renders from its real 128×128 entity sheet with continuous head/foot upholstery and wooden frame/legs. Firework bursts have one saturated colour each. Remote third-person players hold a Totem in the left hand while keeping the selected item in the right; first person shows no held Totem model. A server Totem activation emits one positional `world_sound` to the owner and other listeners within 32 blocks; the owner-only `totem_activate` packet drives only the HUD animation. Singleplayer plays the replacement MP3 locally once.

## Implemented

| Symptom | Root cause | Correction |
| --- | --- | --- |
| Bed showed pink/black and incorrect upholstery | `entity/bed/white` was absent from `TextureAtlas` block-derived keys; its fallback was the magenta checker. The old `addCuboid` repeated one UV rectangle on all faces and used unrelated oak cuboids. | Reserve a contiguous 128×128 sheet region in the existing mip-safe atlas, then use face-specific source-sheet rectangles/rotations for head/foot body, end caps, underside and four legs. No second material or block texture registration system. |
| Firework bursts looked white and multicoloured | Particle index cycled six pale colours inside one burst, while additive blending washed overlaps out. | Randomly select one saturated palette entry when a burst starts, apply it to all 88 particles, and use normal blending on the shared material. |
| Other players could not see an offhand Totem | `Inventory.offhand` never entered the authoritative player presentation snapshot; `PlayerVisual` had only a right-hand attachment. | Replicate optional `offhandItemId` from the server inventory in the existing presentation, attach a Totem model to the canonical left arm, and clear it on an empty/new snapshot. Classic/Slim reuses the current pivots. Mainhand/bow stays on the right; Totem is suppressed as a first-person/right-hand model. |
| Totem sound was local and could double for its owner | `totem_activate` packet caused local playback only; the old procedural WAV was catalogued as UI, with no server world event. | Use the supplied `totem-sound.mp3` in the catalog, emit one server `world_sound` at activation position, retain the owner packet for animation only, and use existing listener filtering/attenuation. Remove the unused generated WAV and generator entry. |

The bed face coordinates follow the head/foot/leg nets from the [vanilla-template reconstruction](https://www.codefactor.io/repository/github/agentitoe/bedrocktools/source/main/scripts/extract-data.mjs) and were checked against the actual `public/textures/entity/bed/white.png` and live mesher render. That reconstruction is a reference for UV coordinates; the shipped image and local geometry are the runtime source of truth.

## Changed files

- Bed: `src/rendering/{TextureAtlas,specialBlockGeometry,ChunkMesher}.ts`, `src/dev/BedQaHarness.ts`, `src/main.ts`, `tests/{bed-texture-atlas,utility-items,special-block-items}.test.ts`.
- Firework: `src/rendering/FireworkVisuals.ts`, `tests/firework-burst-colors.test.ts`.
- Player presentation: `shared/playerPresentation.ts`, `server/WorldInstance.ts`, `src/net/RemotePlayerView.ts`, `src/rendering/player/PlayerVisual.ts`, `src/rendering/FirstPersonRenderer.ts`, `src/core/Game.ts`, `src/dev/PlayerQaHarness.ts`, `tests/{remote-player-view,remote-action-presentation,item-rendering,server/utility-items-authority}.test.ts`.
- Audio: `src/audio/soundCatalog.ts`, `scripts/generate-core-sfx.mjs`, `public/audio/sfx/totem-sound.mp3` (user-supplied), removed `public/audio/sfx/totem_activate.wav`, `tests/audio-sfx.test.ts`.
- Handoff: `docs/{PROJECT_STATE,ROADMAP,ARCHITECTURE}.md` and this report.

## Architecture decisions

Block tiles remain 32px with 4px extruded gutters; the entity sheet has one contiguous 128px atlas region. The existing `ChunkMesher.addQuad`, per-vertex lighting, rotation by `facing`, and world block state continue to own bed rendering. Firework palette selection lives only in the visual layer. `PlayerPresentationState.offhandItemId` is derived by the server, never claimed by the client. Totem sound uses the existing bounded `ServerGameplay.emitWorldSound` queue and `worldSoundMaxDistance` listener filter. No command protocol, gameplay tick, save format, projectile authority, or Claims code changed.

## Tests

- Focused tests: 9 files / 113 tests passed with two workers. These cover Bed UV/mesh/orientation and runtime atlas registration, Firework shared-colour particle buffer, remote offhand/mainhand/cleanup and first-person suppression, audio catalogue, and three-player server Totem routing. The remote action presentation test double was updated for the new `PlayerVisual` method, with an assertion for equip, clear and reset.
- `npm run typecheck`, `typecheck:sim`, `typecheck:client`, `typecheck:server`, `check:boundaries`, `smoke:sim`, `smoke:server`, `build`, `check:size`, `check:archive` passed. Production output: 4.38 MiB / 367 files, with `index.html` at root and no invalid archive paths.
- An unrestricted `npm run check` was attempted. Typecheck and boundaries passed, but the full parallel Vitest run had 44 failures out of 2,259 tests across 17 files, including a test-double incompatibility now corrected and 5-second timeouts/timing-threshold assertions in heavy suites (including `fire-contact-sunlight-minecart` and `server/tick-load-flight`). It stopped before build; build and archive checks were run separately and passed. A later full two-worker run still encountered 5-second timeouts in two unrelated `worldgen-terrain` tests and was stopped early. All 113 affected tests passed in the bounded repeat.

## Visual QA

- Browser dev scene `http://127.0.0.1:4173/?qaBed=1` used the actual atlas and `ChunkMesher`: pillow, sheet, wooden sides/end/legs rendered correctly; no magenta/black placeholder or stretched whole-sheet face.
- Existing `?qaPlayer=1` scene now has held/offhand selectors. Classic and Slim browser views showed sword in right hand and Totem in left; switching to first-person with Totem selected did not show the item model. Regression tests separately verify state cleanup and bow continuity.
- Firework colour buffer was inspected in a deterministic test. The server test confirms exactly one world cue to the owner and a nearby observer and none to a distant observer. An audible three-client PvP session was not run in this pass.

## Performance

The bed sheet occupies a single additional atlas region; chunk meshing remains budgeted and uses fewer bed faces than before (30 across both halves). Fireworks retain one shared material, 32 rocket/512 particle caps and fixed 20 TPS physics. Player offhand visual is allocated only when a Totem appears and reused until it changes. Sound remains a short event in the existing 32-event server queue and 32-block filtered broadcast. The supplied MP3 is 104,577 bytes.

## Known issues

- Three interactive clients with audible PvP and mobile landscape spacing still need real-device QA. The network routing, render-state and catalogue paths are covered by automated tests.
- The full Vitest run is sensitive to this host's concurrent scheduling and the default 5-second per-test timeout; repeat the whole-project gate with a suitable timeout before merge review. Focused two-worker suites and build passed.
- Sign uses an older entity-sheet path and was only consulted as a reference; sign rendering was outside this Bed-specific correction.

## Deferred

No bed colours beyond the existing White Bed, Firework stars/dyes, advanced fireworks, second-hand items other than Totem, or new multiplayer features were added.

## Next work

Run the remaining manual three-client/mobile QA before merge review. Keep this branch isolated; do not merge `main` as part of this task.

## Git

Started from fetched `origin/codex/utility-items-v1` at `6d692421b4f49c14e859336ba5fd6b924208c71e`. Work remained on `codex/utility-items-v1`; no rebase, force push or merge into `main`.
