# Player skin layer z-fighting stabilization

Date: 2026-09-09

Branch: `codex/fix-player-layer-zfighting`

Base: `origin/main` / `9eaec6ba16c0b2d15d63f1c541b99f46f7711007`

## Goal

Remove camera-dependent flicker from player skin base/outer layers, preserve legitimate translucent outer pixels, audit every armor material, and keep the established geometry, texture cache, first-person and invisibility contracts.

## Result

The world-player base no longer enters Three.js's transparent queue. Base and outer use separate entity-owned materials over the same ref-counted texture. Binary outer layers use opaque cutout; only four skins with real intermediate alpha in used outer UV islands enable blending. A follow-up on the same branch made all six part ranks unique and clarified the separate opaque/transparent queue model; see `2026-09-09_fully-ordered-translucent-skin-parts.md`.

## Root cause

Before the fix all twelve base/outer meshes shared one material:

| Property | Base | Outer |
|---|---:|---:|
| `alphaTest` | 0.01 | 0.01 |
| `transparent` | true | true |
| `depthTest` | true | true |
| `depthWrite` | true | true |
| `renderOrder` | 0 | 1 |

This placed even opaque base geometry in the blended queue. `renderOrder` distinguished only base from outer, not intersecting body/limb siblings, so camera-distance sorting could flip which surface won at shoulders, pants and boot seams.

After the fix:

| Property | Base | Binary outer | Translucent outer |
|---|---:|---:|---:|
| `alphaTest` | 0.01 | 0.01 | 0.01 |
| `transparent` | false | false | true |
| `depthTest` | true | true | true |
| `depthWrite` | true | true | true |

The base is always opaque/cutout. Translucent outer keeps depth writes. Opaque armor is drawn first in Three.js's opaque queue and writes depth; the later transparent outer must pass `depthTest`, so covered pixels remain hidden.

## Exact ordering and depth bias

| Part | Render rank | Depth bias | Skin base | Skin outer | Outer polygon offset | Armor base | Armor overlay |
|---|---:|---:|---:|---:|---|---:|---:|
| body | 0 | 0 | 0 | 10 | disabled, `0/0` | 20 | 30 |
| head | 1 | 0 | 1 | 11 | disabled, `0/0` | 20 | 30 |
| right leg | 2 | 1 | 2 | 12 | enabled, `-1/-1` | 21 | 31 |
| left leg | 3 | 2 | 3 | 13 | enabled, `-2/-2` | 22 | 32 |
| right arm | 4 | 1 | 4 | 14 | enabled, `-1/-1` | 21 | 31 |
| left arm | 5 | 2 | 5 | 15 | enabled, `-2/-2` | 22 | 32 |

Base skin has no polygon offset. No random epsilon, position, scale, inflate, UV, pivot or animation change was made.

The numeric ranges are namespaces. For a translucent skin, opaque armor is drawn before transparent outer despite armor's higher numbers; armor occlusion comes from its depth writes plus outer depth testing.

## Production skin alpha scan

`npm run assets:validate-player-skins` decodes all 45 shipped 64×64 PNGs and maps pixels to the exact Classic/Slim cuboid UV islands. `hasBinaryAlpha=true` means every PNG alpha value is 0 or 255; `hasIntermediateAlpha=true` means at least one pixel is 1..254 anywhere in the PNG.

| skin id | hasBinaryAlpha | hasIntermediateAlpha |
|---|---:|---:|
| 00f6338deb336a6e | false | true |
| 0edde60fa266fac7 | true | false |
| 0f15ad5e5c148f40 | false | true |
| 134f7844391b9382 | true | false |
| 1ea0cee32dd870ba | true | false |
| 24f3321d8a6ec3cf | true | false |
| 2cd5c775d21141bd | true | false |
| 2e8c98dab33b766f | true | false |
| 3095ca131afb5705 | true | false |
| 333971ad9949346f | true | false |
| frontier_explorer | true | false |
| 37e10d3fc9798c98 | true | false |
| 48458b73d1075c60 | true | false |
| 4c7afbcaeb250f76 | true | false |
| 55264c2ebdb9ed9d | false | true |
| 554ec16161f085c0 | true | false |
| 5620ef1df645276e | true | false |
| 5bc8ad7edfb7ee86 | false | true |
| 6119ea42953f535e | true | false |
| 7c6103b44dc95a65 | true | false |
| 7d729ce6664b4fdc | true | false |
| 803d711fa90035a7 | true | false |
| 8bb9550c824ce10e | true | false |
| 8bc8f731d8e5ca7c | true | false |
| 8cd9d4ce5d4d8abf | true | false |
| 960e4805666e1591 | true | false |
| 96680c9dd86bcabc | true | false |
| 985483b761dcaceb | true | false |
| ae1fddb72664eaf2 | true | false |
| b1ebc7b52d0c7f61 | true | false |
| b5db0069a126bbf3 | true | false |
| bc3e8672b6d7c821 | true | false |
| bc7db647674d1f01 | true | false |
| c026b7f8552098de | false | true |
| c6ffa466e0aa2e48 | true | false |
| c7e629b4f28c56a5 | true | false |
| d5f7c69c89edd405 | true | false |
| dce095dc5bddc925 | false | true |
| dcf537aec75f761d | true | false |
| dee6149d4583a54b | false | true |
| e126128225dccc51 | true | false |
| e203f6b2fd4c30dc | true | false |
| e3eb6f99ea1c3fe1 | true | false |
| e936712cae837a84 | true | false |
| f47ebc2553e02251 | true | false |

Intermediate pixel locations:

| skin id | base | outer | unused | Runtime outer policy |
|---|---:|---:|---:|---|
| 00f6338deb336a6e | 0 | 5 | 0 | translucent |
| 0f15ad5e5c148f40 | 9 | 11 | 0 | translucent |
| 55264c2ebdb9ed9d | 0 | 149 | 0 | translucent |
| 5bc8ad7edfb7ee86 | 0 | 1488 | 48 | translucent |
| c026b7f8552098de | 0 | 0 | 4 | binary cutout |
| dce095dc5bddc925 | 0 | 0 | 27 | binary cutout |
| dee6149d4583a54b | 0 | 0 | 12 | binary cutout |

The nine intermediate base pixels in `0f15ad5e5c148f40` remain opaque/cutout by design: Java skin base is the authoritative opaque layer. PNG files were not modified.

## Armor audit

No production armor code changed. Leather, chainmail, gold, iron, diamond, ruby and titanium layer 1/2 base materials, plus leather overlay, all retain `transparent=false`, `alphaTest=0.1`, `depthTest=true`, `depthWrite=true`. Their priorities remain `20/21/22` and `30/31/32`; polygon offset remains priority 0 disabled, then `-1/-1` and `-2/-2`. Tests cover full material matrices, mixed equipment, leather overlay and both Classic/Slim rigs.

## Implemented

- Added optional data-only outer-alpha metadata to built-in skin descriptors.
- Split `PlayerVisual` into one base and three outer depth-bias materials over a shared texture.
- Reused those material objects across appearance/model changes and released old handles.
- Added an exact PNG alpha scanner and fail-fast metadata validation command.
- Expanded the DEV harness from one all-outer switch to six independent layer controls.
- Added regression coverage for material/depth state, ordering, offsets, composition, layer toggles, appearance switching, first person, invisibility and armor.

## Changed files

- `src/rendering/player/PlayerVisual.ts`
- `src/rendering/player/MinecraftSkin.ts`
- `src/player/appearance/builtinSkins.ts`
- `src/dev/PlayerQaHarness.ts`
- `scripts/validate-player-skin-alpha.mjs`
- `package.json`
- `tests/player-skins.test.ts`
- `tests/player-skin-assets.test.mjs`
- `tests/player-armor-visual.test.ts`
- `tests/player-skin-selector.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`
- this report

## Tests

- Focused skin/armor/appearance/preview/network gate: 8 files, 49/49 PASS.
- `npm run assets:validate-player-skins`: PASS, 45/45 classified and metadata matched.
- `typecheck`, `typecheck:sim`, `typecheck:client`, `typecheck:server`: PASS.
- `npm run check:boundaries`: PASS.
- `npm run build`: PASS; established `/sdk.js` non-module and >500 KiB chunk warnings remain.
- Full `npm test`: 188/201 files and 1903/1933 tests PASS. The 30 failures are independent CPU-heavy timeout/performance classes in worldgen/fluid/fire/minecart/server suites plus the pre-existing `minecraft-reference-extractor.test.mjs` parse failure; no player skin/armor/appearance suite failed.

## Visual QA

In-app Chromium `/?qaPlayer=1` and the real menu selector were used. The representative matrix was:

- `00f6338deb336a6e` Slim translucent outer: no armor sprint/back and full Iron/front.
- `5bc8ad7edfb7ee86` Slim, 1488 used outer intermediate pixels: no armor idle, every outer layer disabled independently, and first-person arm/sleeve.
- `frontier_explorer` Classic binary: full Diamond, walk, front/back/oblique.
- `55264c2ebdb9ed9d` Slim translucent: full Ruby, sneak, oblique side.
- `0f15ad5e5c148f40` Slim base+outer intermediate: full Titanium, sword attack.
- `dce095dc5bddc925` Classic, intermediate only unused: mixed Ruby/Titanium/Iron/Diamond, jump.
- `5620ef1df645276e` Classic binary: full Leather overlay, bow pose, invisibility.

Shoulders, center pants, boots, jacket/sleeve and helmet/hat seams remained stable. Invisibility hid base/outer while armor and held bow remained. The actual `PlayerAppearancePreview` continuously rotated both default Classic and selected `5bc8ad7edfb7ee86` Slim through 360°. Console warning/error logs were empty.

## Performance

Skin material count changes from one to four per `PlayerVisual` (one base plus three depth-bias variants), but all use one registry texture. Materials are created per entity, reused on appearance changes and disposed with the visual. No per-frame texture/material allocation or new simulation work was added.

## Known issues

- Translucent outer shells use deterministic painter order plus depth writes, not order-independent transparency. This is deliberate for stable skin/armor composition; arbitrary future skins still require scanner metadata review.
- `0f15ad5e5c148f40` has nine intermediate pixels in a used base island. Base remains opaque/cutout per the required Java-skin contract.
- First-person retains its separate single material for arm+sleeve. Tests and WebGL QA show no regression; it was not folded into the world-player material policy.
- Full-suite CPU budget/timeouts and the reference extractor parse failure remain outside this rendering task.

## Deferred

- Device/GPU matrix beyond the in-app Chromium renderer.
- Any custom user-uploaded PNG flow; production remains the built-in validated whitelist.

## Next work

No renderer follow-up is required for this fix. When a production skin is added, run `npm run assets:validate-player-skins` and explicitly classify any used outer intermediate alpha.

## Git

Initial delivery is commit `14ac1ab` (`fix: stabilize player skin layer rendering`). A second non-amended follow-up, `fix: fully order translucent skin parts`, closes the residual equal-rank and registry-metadata risks. No merge is part of this task.
