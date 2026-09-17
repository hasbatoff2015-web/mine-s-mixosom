# Utility Items: pillow, Sign, Totem and Firework follow-up — 2026-09-14

## Goal

Resolve the four issues from live QA on `codex/utility-items-v1`: the White Bed pillow, Sign entity model, separation of Totem presentation and activation, and predominantly white Firework bursts. Trace the reported missing Totem sound through the actual runtime path. Keep `main`, PlayerCommand FIFO/ack/replay, local aim, PvP authority, 20 TPS and existing HUD behaviour intact.

## Result

The Bed head-top UV now puts the pillow at the outer head edge without moving either block. Standing and wall Signs use the complete `128×64` entity sheet and distinct face UVs; the text lies on the board front. A selected Totem is visible in the main hand, but only an offhand Totem prevents death in Singleplayer or Anarchy. Bursts contain 70 white and 18 evenly placed particles in one accent colour. The rocket texture URL is base-safe.

The supplied Totem MP3 is present and playable in the tested browser path. A dev probe decoded it and started an `AudioBufferSource` after parsing a `world_sound` packet; server integration tests show one owner cue, one nearby cue and none for a distant player. This local investigation did **not** reproduce the reported failure in a real two-client Anarchy session, so it cannot identify a confirmed break in that live environment. The one URL inconsistency found, `AudioManager` using a raw relative SFX base instead of Vite `BASE_URL`, was corrected for nested deployments.

## Implemented

| Area | Confirmed code cause | Change |
| --- | --- | --- |
| Bed pillow | `HEAD_BODY.up` sampled the correct source rectangle but rotated it 180°. The mesher's top quad already maps the source pillow end toward the head; the extra rotation put it near the seam. | Removed only that top-face rotation. Head/foot model, placement, collision, drops and the other face UVs remain unchanged. |
| Sign | `addSign` stretched one quarter-sheet rectangle across all board faces, used `block/oak_planks` for the post, and `TextureAtlas` had no full sign sheet registration. | Registered `entity/sign` as a contiguous `128×64` sheet; added ModelSign-proportion board and post with separate front/back/top/bottom/edge source texels; reused `ChunkMesher.addQuad` and atlas material. Wall sign omits the post. `SignRenderer` text plane follows the new front surface. |
| Totem | `FirstPersonRenderer` and `PlayerVisual` explicitly suppressed a selected main-hand Totem. Both death-protection hooks checked the selected slot before offhand. | Removed the visual suppression. A shared Node-safe `consumeOffhandTotem` helper consumes exactly one from `Inventory.offhand` in both hooks; main-hand presence does not grant protection. |
| Sound | No break was reproduced on the local server→packet→browser decode/play path. The default SFX URL did not explicitly include Vite `BASE_URL`, unlike texture URLs. | SFX URL now resolves under `BASE_URL`. `/?qaAudio=1` can inspect file/catalog/decode/WebAudio state and start a parsed test packet. No old WAV or duplicate local multiplayer playback was introduced. |
| Firework | All 88 particles received the chosen saturated colour, and the rocket sprite used a hard-coded `/textures/...` URL. | Every fifth particle gets one burst accent; the remaining 70 are white. Sprite loads through `TextureAtlas.url`. Material, caps, flight/interpolation and simulation remain unchanged. |

The Sign coordinates follow the 64×32 logical texture layout and 24×12×2 board / 2×14×2 post described by the [legacy SignModel source](https://git.minecraftlegacy.com/MinecraftConsole/src/src/commit/cbcf3de358f97ae1f687f3ffa47fcdb910e39bcb/Minecraft.Client/SignModel.cpp). The shipped `sign.png` is a 2× image (128×64). The actual asset and browser output were used for QA.

## Changed files

- Bed/Sign atlas and geometry: `src/rendering/TextureAtlas.ts`, `specialBlockGeometry.ts`, `ChunkMesher.ts`, `SignRenderer.ts`, `src/dev/SignQaHarness.ts`, `src/main.ts`.
- Totem: `src/rendering/FirstPersonRenderer.ts`, `src/rendering/player/PlayerVisual.ts`, `src/gameplay/totemDeathProtection.ts`, `src/core/Game.ts`, `server/WorldInstance.ts`.
- Audio: `src/audio/soundCatalog.ts`, `src/core/AudioManager.ts`, `src/dev/AudioQaHarness.ts`.
- Firework: `src/rendering/FireworkVisuals.ts`.
- Tests: `tests/bed-texture-atlas.test.ts`, `special-block-items.test.ts`, `sign-entity-model.test.ts`, `firework-burst-colors.test.ts`, `utility-items.test.ts`, `server/utility-items-authority.test.ts`, `item-rendering.test.ts`, `remote-player-view.test.ts`, `audio-sfx.test.ts`.
- Handoff: `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, this report.

## Architecture decisions

The existing atlas now has a short list of differently sized entity sheets, with the same gutter extrusion; no parallel texture or mesh system was created. Bed and Sign face quads share one mesher helper. Sign text continues to be `SignRenderer`'s on-change CanvasTexture, and sign state/network/save/editing were not changed. Totem eligibility stays in the existing pre-death hook and uses the same offhand inventory slot in both runtimes; the server still owns the Anarchy result. The owner-only `totem_activate` packet remains HUD-only; `world_sound` is the sole multiplayer audio cue. Firework colour lives in the visual layer.

## Tests

- Focused run: 9 files / **109 tests passed** (`--maxWorkers=2 --silent`). Includes four Bed facings and UV, real Sign atlas and face UV, floor/wall mesh and orientations, main/offhand/both-hand Totem damage and presentation, owner/nearby/distant sound routing, SFX catalog/base path, and 70/18 Firework allocation.
- `npm run typecheck`, `typecheck:client`, `typecheck:server`, `typecheck:sim`, `check:boundaries`, `build`, `check:size`, `check:archive` passed. Production build: **4.38 MiB / 367 files**; `index.html` is at archive root. Vite reports its existing large-chunk advisory and the intentional `/sdk.js` non-module warning; neither fails the build.
- A wider `npm test -- --maxWorkers=2 --testTimeout=15000 --silent` run was stopped after unrelated failures appeared in `lighting-scheduler` (an assertion and a 15-second streaming timeout), `server/tick-load-flight` (80 ms performance threshold exceeded on this loaded host) and `chat-layout` (literal LF expectations against CRLF CSS on Windows). None of those files or subsystems was edited here. The targeted 109 tests were rerun successfully, and all requested type/build/archive gates passed. The full suite has **not** been claimed green.

## Visual QA

- `/?qaBed=1`: inspected the production atlas/mesher in browser before and after. The pillow moved to the outer head edge; white surface, wood frame/legs and seam remained intact. Four facings are covered by a UV/mesh regression test; only the default browser view was visually inspected.
- `/?qaSign=1`: browser inspected standing and wall variants, standing rotations including the back, wall facing change, text on the front and wood on the back/side. No magenta fallback was visible.
- `/?qaAudio=1`: browser fetched `http://127.0.0.1:4173/audio/sfx/totem-sound.mp3` with HTTP 200, decoded 4.33054s at 48 kHz (RMS 0.181, first-second RMS 0.155), loaded 27/27 catalog buffers with no missing files/events. A parsed `world_sound` test packet gave `recentPlays: totem.activate / totem-sound.mp3`, `voiceCount: 1` and `contextState: running`. The tool cannot verify what a human heard through the output device. A true two-client audible Anarchy test was not completed here.
- Existing `/?qaPlayer=1`: browser showed the selected Totem attached to the right/main-hand model in third-person and visible in first-person. Remote snapshot tests separately cover right hand, left hand and both together.

## Performance

The Sign adds one `128×64` atlas region and no per-sign material. Sign meshes use 12 or 6 quads (standing/wall), generated through existing budgeted meshing. Fireworks retain 88 particles per burst, one `PointsMaterial`, 512 particle/32 rocket caps and 20 TPS. Totem offhand check is one inventory-slot lookup; multiplayer sound retains the existing 32-block listener filter.

## Known issues

The original sound complaint was not reproducible via the local browser probe and server integration test. A real two-client Anarchy session with speakers/headphones is still required to verify audibility, owner duplication and distance behaviour on the user's setup. Manual inspection of all four Bed facings and all 16 Sign rotations is also outstanding; automated geometry/UV tests cover them. The wider test suite remains non-green for unrelated assertion, timing and Windows line-ending cases described above.

## Deferred

No other Bed colours, advanced Sign features, Totem main-hand activation, new SFX system, Firework dye metadata or new multiplayer protocol were added.

## Next work

Manual QA checklist before merge review:

1. Place White Bed north/east/south/west; check centred pillow at the outer head, uninterrupted head/foot seam and unchanged frame.
2. Place standing and wall Signs; rotate standing through 16 positions and try all wall facings; read front text, inspect back/side wood, confirm no magenta fallback and that wall signs have no post.
3. Equip Totem in selected main hand: verify first-person, local third-person and remote right-hand visuals; lethal damage must still kill without consuming it for protection (ordinary death/drop rules still apply). Equip only offhand: remote left hand visible, lethal damage consumes it and triggers the existing HUD. Equip both: only offhand is consumed.
4. In two nearby Anarchy clients, activate one offhand Totem; both should hear the supplied sample, the owner once. Move the second client beyond 32 blocks and repeat: only the owner should hear it. Use `?audioDebug=1` and `?qaAudio=1` if a failure persists; inspect `missingFiles`, `missingEvents`, `recentPlays` and context state.
5. Launch several Fireworks: each burst should be mostly white with a clearly visible, evenly scattered red/blue/purple/green/gold/cyan accent, never all-colour or washed-out all-white.

## Git

Started from fetched `origin/codex/utility-items-v1` at `dfda58c734185010f1455297a63857998b8573ec`. The changes are committed and pushed normally to that feature branch; obtain the final SHA via `git log -1`. `main` was not checked out, merged or pushed. No rebase, reset, force push or git config change.
