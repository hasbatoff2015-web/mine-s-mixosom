# Player skin side-face UV orientation

Date: 2026-10-07

Branch: `cursor/player-skin-side-uv-fix-5b99`

Base: `origin/main` / `c621d804a51004ecb53f214e8843b0022303dd27` (merge of PR #120)

## Goal

Stop Java 64×64 skin side faces from being horizontally mirrored. Ears, hair, sideburns and sleeve patterns must meet the model front on the front-adjacent column of their UV island.

## Result

Side faces of every player skin cuboid flip U inside the existing island. Front, back, top and bottom are unchanged. Armor, mobs and minecarts keep the previous whole-cuboid `mirror` behavior.

## Root cause

`playerSkinUvRects` already selected the canonical islands. For the head base layer:

| Face | Island |
|---|---|
| top | u 8..16, v 0..8 |
| bottom | u 16..24, v 0..8 |
| player right, geometry `left` / −X | u 0..8, v 8..16 |
| front | u 8..16, v 8..16 |
| player left, geometry `right` / +X | u 16..24, v 8..16 |
| back | u 24..32, v 8..16 |

`BASE_OFFSETS` and `OUTER_OFFSETS` were left as they were.

`createTexturedCuboidGeometry` applied one `rectUvs` corner order to every face. The +X corners walk the bottom edge back → front. The −X corners walk front → back. The same `u0 → u1` order therefore mirrored both side islands.

Model front is local −Z. Player right is −X (`rightArm.position.x < 0`). Player left is +X.

Head base before the fix:

| Side | Front edge (−Z) | Back edge (+Z) |
|---|---:|---:|
| player right / −X | u = 0 | u = 8 |
| player left / +X | u = 24 | u = 16 |

Head base after the fix:

| Side | Front edge (−Z) | Back edge (+Z) |
|---|---:|---:|
| player right / −X | u = 8 | u = 0 |
| player left / +X | u = 16 | u = 24 |

Hat uses offset `[32, 0]`, so the same rule puts −X front/back at u 40/32 and +X front/back at u 48/56.

## Implementation

`TexturedCuboidDefinition.faceUvFlipU` is an optional per-face horizontal flip. It is combined with the existing `mirror` flag by XOR:

```
flipU = (mirror === true) !== (faceUvFlipU[face] === true)
```

A definition that omits the map is unchanged, including `mirror: true` on armor left arm and left leg.

`playerSkinPartDefinition` sets `{ left: true, right: true }` for every part, layer and presentation. `left` / `right` are cuboid normals (−X / +X), not the player's limbs. The islands are not swapped.

## Consumers of TexturedCuboid

`createTexturedCuboidGeometry`:

- `src/rendering/player/PlayerSkinGeometry.ts`
- `src/rendering/player/PlayerArmorVisual.ts`
- `src/entities/voxelVisuals.ts` (`VoxelVisualFactory`, used by `LegacyModel` / mobs)
- `src/rendering/minecartGeometry.ts` (floor and wall)

`cuboidUvRects`:

- `PlayerSkinGeometry.playerSkinUvRects`
- `tests/visual-models.test.ts`
- `tests/pet-textures.test.mjs`

Only player skin definitions set `faceUvFlipU`.

## Coverage

Corrected through that one definition:

- head base and head outer
- body, both arms, both legs, base and outer
- Classic and Slim (slim right-arm +X front is `47/64`, classic is `48/64`)
- world and first-person (same logical U, different physical width)

## Regressions held

- Front, back, top and bottom UVs match a cuboid built from the same definition without `faceUvFlipU`. V on side faces is not flipped.
- Armor offsets, left-limb `mirror`, sizes, inflate, render order and materials are unchanged. Left-arm armor −X front stays `44/64` (the historical mirrored value).
- Generic cuboid without `faceUvFlipU` keeps the old side order. `mirror: true` still flips every face. XOR: local flip without mirror flips; mirror without local flip flips; both together cancel on that face.
- Player pivots, animator, network appearance and PNG files are unchanged.
- `SkinPortrait.ts` was not edited.

## Tests

Commands that passed:

- `npx vitest run` on player skins, skin selector, skin assets, skin texture URL, appearance network, remote appearance join, server player appearance, RemotePlayerView, remote player fire, remote interpolation, player visual animation, armor visual, armor network, third-person held item, third-person camera, visual models, sword blocking, held-item transform, invisibility particles, pet textures.
- Those files: 20 passed, 215 tests passed.
- `npx tsc --noEmit`
- `npx tsc -p tsconfig.client.json`
- `npx tsc -p tsconfig.server.json`
- `node scripts/check-import-boundaries.mjs`
- `npm run build`
- `npm run build:server`

Real `BufferGeometry` checks, not only `playerSkinUvRects`:

- `tests/player-skins.test.ts` reads `PlayerSkinGeometryCache` position, normal and uv. Head base and hat assert the exact fractions above on both top and bottom corners. Every part/layer/variant checks front/back correspondence against its island. First-person right arm matches world U and differs in width.
- `tests/visual-models.test.ts` locks historical unflipped sides, global `mirror`, and the three XOR cases.
- `tests/player-armor-visual.test.ts` compares armor cache UVs to a cuboid that has `mirror` and no `faceUvFlipU`.

`tests/classic-combat-integration.test.ts` had 2 failures in `Game.tick` / `mobileSneakAfterFlight` (`state.mode` of undefined). Those files were not part of this change. The other 16 tests in that file passed.

There is no GitHub Actions workflow in the repository. The commands above are local runs, not CI.

## Manual QA

Skin `8bc8f731d8e5ca7c` (classic hoodie). The outer head side islands put the white stripe on the back-adjacent columns (`u=32` on player right, high U on player left).

Checked in headless Chrome WebGL on `/?qaPlayer=1&armor=none`, which uses `PlayerVisual` and `FirstPersonRenderer`:

- Classic right profile: stripe sits behind the face.
- Classic left profile: stripe sits behind the face.
- Classic front: eyes and hoodie front unchanged relative to the sheet's front island.
- Slim right and left profiles: same head orientation, narrower arms.
- Hat/outer layer is the stripe; base head is the face underneath.
- First-person arm rendered. The default pose shows the green sleeve at the corner and does not present a clear side face. Side U for that mesh is the same buffer tested against the world arm.

`entity/player_uv_test` marks the min-U corner of each head island in white. It can check direction, not only which face. A software raster of the base head (same `BufferGeometry`) moved that mark from the model front to the model back on the player-right face, and from the back to the front on the player-left face. Front and back marks did not move.

Not opened as separate sessions: the main-menu DOM preview, the skin-selector screen, and a second online client. Those paths instantiate the same `PlayerSkinGeometryCache` / `PlayerVisual`. Remote appearance tests still pass. No production PNG was edited.

## Known issues

The QA sheet's outer head is an opaque frame, so hat-on views hide the base side corners. Base-only raster and the hoodie outer stripe were used instead.

## Deferred

No change to front/back/top/bottom orientation. No menu or network work.

## Next work

Wait for an explicit merge command.

## Git

Feature branch `cursor/player-skin-side-uv-fix-5b99`. HEAD `88939dff` plus the docs note for draft PR **#124**. Not merged.
