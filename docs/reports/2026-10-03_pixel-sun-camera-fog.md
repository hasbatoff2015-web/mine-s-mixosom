# Pixel sun, camera anchor, distance haze — 2026-10-03

## Goal

Keep the current sky, stars, moon, and clouds. Replace the flat sun sphere with a pixel billboard, stop the sun and moon from stepping at 20 TPS while the camera interpolates, and turn the opaque distance fog into a light haze.

## Result

The sun is a 6.4 quad with a 16×16 nearest texture. Sun and moon offsets are computed from the render camera, so a camera translation does not change their screen angle. The directional light points along `sunDirection` with its target at the origin. At render distance 4 the fog blend is about 0.4% at 64 blocks and 12% at the far chunk corner.

## Implemented

- `createSunTexture` / `createSunMesh` in `SkyDome.ts`. Gold rim `#F1CF62`, body `#FFEDA0`, core `#FFF6C8`, four tone pixels. No second glow draw.
- `celestialOffset`, `celestialPositions`, `orientCelestialBillboard`, `sunlightPosition`. `CELESTIAL_DISTANCE = hypot(70, 15)`.
- `Game.updateEnvironment` anchors both meshes to `this.camera.position` and writes the light from `sunDirection` only.
- `distanceFogRange` / `applyDistanceFog` in `distanceFog.ts`. Near and far both follow render distance. `MAX_VISIBLE_FOG_BLEND = 0.12`.

## Changed files

- `src/rendering/SkyDome.ts`
- `src/rendering/distanceFog.ts`
- `src/core/Game.ts`
- `tests/celestial-distance-fog.test.ts`
- `tests/mobile-controls-sky-hud.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`

## Architecture decisions

The jitter was an anchor mismatch. `localRender.sample` moves the camera every frame. `session.player.position` moves on the 20 TPS tick. Putting the discs on the second coordinate made `sun - camera` jump every 50 ms. Lerping the discs would have added another smoother. Using the camera removes the jump.

The old light line was `sunlight.position.copy(sun.position)` with the default target at the origin. The shader direction is `light.matrixWorld` minus `target.matrixWorld`, so that direction included the player coordinate. The new position is `sunDirection * 100`. Chunk lighting does not read this light. It still uses `setDaylight`.

The old fog was `near = 38`, `far = renderDistance * 16 + 28`. At desktop distance 4, far is 92. Blend at 64 blocks is 26/54 ≈ 0.48, and at 90 blocks 52/54 ≈ 0.96. The new edge is the square chunk diagonal `(r + 1) * 16 * sqrt(2)`. For distance 4 that is ≈ 113.1, near ≈ 62.23, far ≈ 486.49. Fog stays on so the chunk edge is not a hard cut.

## Tests

`tests/celestial-distance-fog.test.ts` covers the sun texture, the moon quad, camera-invariant offsets, the old orbit, the light direction, and fog blends at distances 2, 4, and 8.

## Visual QA

Not run in a generated world in this pass. The texture math and the fog numbers are covered by the unit tests. A running look at the sun, the moon while sprinting, and a forest at the chunk edge is still owner QA.

## Performance

The sun sphere became one quad. Fog is the same `THREE.Fog` with different planes. No extra pass.

## Known issues

Lambert entities and the first-person arm take a direction whose length is now 100. It used to be the distance from the world origin to the sun mesh.

## Deferred

Owner playtest of jitter, third person, and night fog. No change to cloud masks, sky palette, or daylight curves.

## Next work

Phone and desktop look at the sun through clouds, a sprint under the moon, and render distances 2, 4, and 6.

## Git

Branch `cursor/mobile-controls-sky-hud-f726`. PR #115 stays draft.
