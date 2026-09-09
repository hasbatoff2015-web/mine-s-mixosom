# Fully ordered translucent skin parts

Date: 2026-09-09

Branch: `codex/fix-player-layer-zfighting`

Parent: `14ac1ab183b36bcd037fc8d7d944e71aa0f960ea`

## Goal

Close the residual camera-Z tie between translucent outer meshes, source alpha policy from the registry descriptor actually acquired at runtime, and correct the documentation model for Three.js opaque versus transparent queues.

## Result

Every skin part now has a unique render rank. Classic, Slim and all translucent built-ins use base `0..5` and outer `10..15`, so transparent sorting never reaches camera-space Z for two player outer meshes. The small polygon depth bias remains a separate three-level seam tie-breaker. Runtime alpha metadata travels on `SkinTextureHandle`; custom registered descriptors work without a built-in lookup.

## Exact render ranks

| Part | `SKIN_PART_RENDER_RANK` | Base order | Outer order |
|---|---:|---:|---:|
| body | 0 | 0 | 10 |
| head | 1 | 1 | 11 |
| right leg | 2 | 2 | 12 |
| left leg | 3 | 3 | 13 |
| right arm | 4 | 4 | 14 |
| left arm | 5 | 5 | 15 |

`new Set(outerOrders).size === 6`. Specifically, head/body, right arm/right leg and left arm/left leg can no longer tie.

## Separate depth bias

| Parts | `SKIN_PART_DEPTH_BIAS` | Polygon offset |
|---|---:|---|
| body, head | 0 | disabled, factor/units `0/0` |
| right arm, right leg | 1 | enabled, `-1/-1` |
| left arm, left leg | 2 | enabled, `-2/-2` |

Render rank is painter ordering; depth bias is only a bounded second-line seam tie-breaker. Rank `3..5` does not create offsets `-3..-5`. Geometry positions, scale and inflate are unchanged.

## Opaque and transparent queues

The numeric namespaces remain base `0..5`, outer `10..15`, armor base `20/21/22`, armor overlay `30/31/32`. They are not a global queue-order promise:

- opaque skin, binary outer and all armor passes are sorted/drawn in the opaque queue;
- translucent outer is sorted/drawn later in the transparent queue regardless of lower numeric order;
- armor has already written depth, and translucent outer retains `depthTest=true`, so armor-covered skin pixels fail the depth test.

The `max skin outer < ARMOR_BASE_RENDER_ORDER` regression is documented as a namespace invariant only.

## Runtime alpha metadata

`MinecraftSkinRegistry.acquire()` now copies normalized `outerLayerAlpha` from its resolved descriptor into `SkinTextureHandle`. `PlayerVisual` reads the handle for construction and appearance switches. The global built-in helper remains useful for production asset validation but no longer controls runtime rendering.

A regression registers `custom_translucent` through `registerValidated(..., 64, 64)`, verifies the acquired handle metadata, and confirms opaque base plus transparent outer materials.

## Implemented

- Added `SkinTextureHandle.outerLayerAlpha` with omitted descriptor metadata normalized to `binary`.
- Replaced shared render priority with unique `SKIN_PART_RENDER_RANK`.
- Added independent `SKIN_PART_DEPTH_BIAS` and kept three outer material variants.
- Updated material sync to use acquired handle metadata.
- Added Classic/Slim/translucent uniqueness, pair inequality, namespace and custom registry tests.
- Added DEV-only camera orbit and distance controls for reproducible translucent QA.
- Corrected architecture, testing, state, roadmap and the original report's cross-queue explanation.

## Changed files

- `src/rendering/player/MinecraftSkin.ts`
- `src/rendering/player/PlayerVisual.ts`
- `src/dev/PlayerQaHarness.ts`
- `tests/player-skins.test.ts`
- `tests/player-armor-visual.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`
- `docs/reports/2026-09-09_player-skin-layer-zfighting.md`
- this report

## Tests

- Focused player/skin/armor/appearance/preview/network gate: 8 files, 50/50 PASS.
- `npm run assets:validate-player-skins`: PASS.
- `typecheck`, `typecheck:sim`, `typecheck:client`, `typecheck:server`: PASS.
- `npm run check:boundaries`: PASS.
- `npm run build`: PASS with established `/sdk.js` and chunk-size warnings only.
- `git diff --check`: PASS.

## Visual QA

`5bc8ad7edfb7ee86` (1488 used intermediate outer pixels) was checked in walk, sprint, jump, sneak, attack and bow poses; orbit `-180..180` in 60° steps; distance 2.0, 4.2 and 8.0; head yaw ±120° and pitch ±80°. Armor covered none, full Iron, Diamond, Ruby, Titanium, Leather and a mixed Iron/Diamond/Ruby/Titanium set.

`00f6338deb336a6e`, `0f15ad5e5c148f40` and `55264c2ebdb9ed9d` were each rotated through a full orbit while walk, attack or bow animation ran. Neck, shoulder, arm/leg hip, center pants and boot seams stayed stable. Console warn/error log was empty.

## Performance

Material count stays one base plus three depth-bias outer variants per `PlayerVisual`; unique rank is a mesh number, not a new material. One ref-counted texture remains shared. No per-frame allocation or simulation work was added.

## Known issues

- Translucent rendering is deterministic depth-tested blending, not order-independent transparency.
- Full-suite unrelated CPU timeout/performance and reference-extractor baseline failures from the parent report were not rerun; the requested focused and build gates are authoritative for this follow-up.
- Device/GPU coverage beyond the in-app Chromium renderer remains deferred.

## Deferred

- Custom user-uploaded skin UI/network/storage remains out of scope; only the existing registry extension contract was tested.

## Next work

No further player-layer ordering work is known. New custom/production descriptors must declare `outerLayerAlpha` consistently with validated PNG contents.

## Git

This is the second commit on the branch, named `fix: fully order translucent skin parts`, pushed to `origin/codex/fix-player-layer-zfighting`. It does not amend `14ac1ab` and is not merged.
