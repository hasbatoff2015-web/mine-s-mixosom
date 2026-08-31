# Player skins, character model and third-person camera

## Goal

Add Minecraft-compatible modern Java 64×64 player appearance, a reusable articulated character renderer, skin-aware first-person arm, F5 first/back/front presentation camera with real world collision, animation/held item/light feedback, and a DEV QA path. Preserve 20 TPS gameplay authority and prepare clean future UI/server seams without merging the parallel UI/server branches.

## Result

Implemented on `cursor/player-skins-third-person` from stable `origin/main` base `a056e6f5d4b7f2e206b697f0a774ece921cbbefa`. The production player now uses a shared `PlayerAppearance`; the world model and first-person arm swap together without a world reload. Third-person camera is render-frame presentation only and collision-clips through canonical block collision boxes. No server stack, UI PR #22, or block-breaking PR #28 code was integrated.

The supplied archive contained 46 RGBA PNG files. All were 64×64; two filenames contained the same bytes, so 45 unique production skins were imported (71,029 bytes total). Standard transparent arm-unused regions classified 20 Classic and 25 Slim. `35e2e51ca4c72af7.png` is exposed as the friendly default id/path `frontier_explorer` (Classic). A separate original `player_uv_test.png` is DEV QA data. The earlier ImageGen explorer concept influenced palette review only, remains ignored under `.local/player-skin-concept.png`, and is neither shipped nor committed.

## Implemented

- Data-only `PlayerAppearance`, immutable layer defaults and runtime normalization.
- Exact 64×64 validator; explicit 64×32 rejection; future validated registration seam.
- Built-in registry for 45 supplied skins plus UV QA skin; stable `skinId`, path and Classic/Slim metadata.
- Ref-counted texture cache: one sRGB nearest/no-mipmap/clamped `THREE.Texture` per active skin id.
- Cached canonical base/outer cuboid geometry for head/body/right+left arms/right+left legs.
- Modern independent left arm/leg UV islands; outer hat/jacket/sleeves/pants islands.
- 1.8-block feet-origin rig; Classic 4 px arms; Slim 3 px arms and 0.5 model-pixel lower shoulder pivot.
- Render-frame animator: independent bounded head yaw/body follow, gait, sprint, sneak, airborne, swing/mining, food, sword block and bow.
- Third-person held sword/tool/block/bow/food models from the existing `ItemVisualFactory`, with no parallel item renderer.
- World entity lighting, bounded hurt-red multiply and invisibility that hides skin but retains held item.
- First-person right arm and sleeve use the current shared appearance and correct Classic/Slim geometry/UV.
- F5 cycle only when `InputCallbacks.canCapture()` is true; browser refresh remains available in menus/overlays.
- Four-block back/front camera, eight swept corner probes, real authored collision boxes and smooth clearance restore.
- `?qaPlayer=1` standalone WebGL harness with skin/model/layers/poses/items/look/hurt/invisibility/camera controls.

## Changed files

- Runtime: `src/core/Game.ts`, `src/input/InputManager.ts`, `src/main.ts`, `src/rendering/FirstPersonRenderer.ts`.
- Appearance: `src/player/appearance/PlayerAppearance.ts`, `MinecraftSkin.ts`.
- Player rendering: `src/rendering/player/PlayerSkinGeometry.ts`, `PlayerVisual.ts`, `PlayerVisualAnimator.ts`, `ThirdPersonCamera.ts`.
- DEV: `src/dev/PlayerQaHarness.ts`.
- Assets: `public/textures/player/skins/*.png` (45), `public/textures/entity/player_uv_test.png`.
- Tests: `player-skins`, `player-skin-assets`, `player-visual-animation`, `third-person-camera`.
- Docs: `PROJECT_STATE`, `ROADMAP`, `ARCHITECTURE`, `TESTING`, this report.

## Architecture decisions

1. `PlayerController` remains feet-position/fixed-tick authority. `PlayerVisual` never writes controller state.
2. Render camera consumes the freshest input yaw/pitch every RAF; raycast/mining/combat still consume player eye/view paths already present in `Game`.
3. One registry/cache is owned by `Game`; first-person and world visuals hold independent references to one shared skin texture.
4. Geometry is shared and immutable; each player instance owns only its material and transform hierarchy, which allows independent lighting/hurt tint.
5. Outer layers are geometry overlays, not painted armor. Armor rendering remains deferred.
6. Third-person collision queries `blockCollisionBoxes`; it does not create another solidity table and does not generate missing chunks.
7. Held items reuse `ItemVisualFactory`; model changes happen on item id or bow texture stage, not per frame.
8. Supplied skins are technically integrated but not automatically cleared for publication. Asset rights remain an explicit release gate.

## Reference audit

- Official Minecraft skin article: modern Java imports a flat PNG and distinguishes Classic/Wide vs Slim: <https://www.minecraft.net/en-us/article/what-is-minecraft-skin>.
- Mojang mappings `PlayerModel`: canonical player part structure/overlays: <https://mappings.dev/1.21/net/minecraft/client/model/PlayerModel.html>.
- Yarn `PlayerEntityModel`: left/right sleeves, pants and jacket are separate parts; `thinArms` is explicit: <https://maven.fabricmc.net/docs/yarn-1.21+build.7/net/minecraft/client/render/entity/model/PlayerEntityModel.html>.
- Mapped Camera constants/methods (`DEFAULT_CAMERA_DISTANCE`, `getMaxZoom`/clip): <https://mappings.xhyrom.dev/1.21.4/net/minecraft/client/camera>.

These are numerical/format references only. No Minecraft code, name, or new Mojang player skin asset was copied into the production player pipeline.

## Tests

- `npm run typecheck`: pass.
- Final focused skin/asset/camera/animator/classic-combat/render gate: 7 files, 62 tests pass.
- `npm run build`: pass; Vite 155 modules, JS 1,030.29 kB / 291.22 kB gzip.
- `npm run check:size`: pass; 3.69 MiB, 267 files.
- `npm run check:archive`: pass; unpacked archive payload 3.69 MiB, 267 files.
- Full `npm test` attempted: 77/87 files, 974/1001 tests passed. One new minimal-session failure (`playerVisual` absent in a test double) was fixed with optional presentation hooks and classic combat reran 17/17. Remaining failures are unchanged-world CPU timeouts/thresholds, a pre-existing stale raw-source fingerprint, and a reference-extractor parse failure; no unrelated thresholds were weakened.

## Visual QA

In-app browser at `http://localhost:4174/?qaPlayer=1`:

- default Classic front: correct face/body/limb placement and feet origin;
- supplied Slim: narrower arms and lower shoulder pivot, walk gait and pickaxe visible;
- UV QA front/back: front red, back purple, side colors distinct, no flip/mirror;
- outer layer toggle: white overlay outlines disappear, draw calls 13 → 7;
- first-person: same UV QA skin on right arm; outer toggle shared;
- bow: both arms aim forward; held bow uses shared item model/texture stages;
- skin swaps: registry remains 1 texture with 2 refs (world + viewmodel);
- console warnings/errors: none.

## Performance

- Supplied production skins total 71,029 bytes; one duplicate excluded.
- Active appearance texture cache: 1 texture for local player + first-person handles.
- Geometry cache: 14 entries after one variant, 28 after Classic+Slim; stable on repeated swaps.
- Player QA: base-only 7 total scene draws including ground; base+outer 13; held item adds one draw for representative sprite items.
- No geometry/material/texture is created per animation frame. Camera probes allocate small temporary vectors only; no chunk generation or mesh work is triggered.

## Known issues

- Supplied archive contains visually recognizable third-party character skins. Technical integration is complete, but publication requires an explicit rights/provenance audit by the project owner.
- No production character selector UI by design; UI PR #22 conflict avoided.
- No remote-player wire integration by design; current main lacks the inspected server branch stack.
- Third-person camera/device comfort still needs real gameplay acceptance in tight caves, stairs/fences and landscape mobile.
- Bow/item third-person transforms are Minecraft-like approximations, not pixel-exact Java renderer matrices.
- Full-suite baseline is not clean on this Windows runner; see Tests. Feature and adjacent classic combat gates are clean.

## Deferred

- Armor meshes/materials and equipment slots.
- Custom local PNG picker + IndexedDB storage and preview UI.
- Server allowlist/upload/CDN for custom online skins.
- Remote `PlayerVisual` integration and network appearance-change message.
- Mobile perspective button placement after UI consolidation.

## Next work

1. After UI PR merge, add a thin Character/Skin panel that calls `Game.setPlayerAppearance()`, reuses `PlayerVisual` preview, stores built-in id/model/layers, and later validates local 64×64 PNG before IndexedDB storage.
2. In the server stack, replace `RemotePlayerView` box with one interpolated `PlayerVisual`. Welcome/join/appearance-changed sends `{ skinId, model, layers? }`; tick snapshots remain movement/state only. Missing ids fall back to `frontier_explorer`. Raw image bytes are never sent per tick.
3. Run desktop pointer-lock and landscape-mobile acceptance with a wall/slab/stair/fence course, verifying crosshair target does not change with camera pull-in.
4. Resolve asset provenance before Yandex publication.

## Git

- Branch: `cursor/player-skins-third-person`.
- Base: `origin/main` at `a056e6f5d4b7f2e206b697f0a774ece921cbbefa`.
- Planned commit subject: `feat: add player skins and third-person camera`.
- Delivery: push branch and open Draft PR to `main`; do not merge.
