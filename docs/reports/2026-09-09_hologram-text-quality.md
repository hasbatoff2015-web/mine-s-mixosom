# Hologram close-up text quality

## Goal

Make existing hologram text stay sharp when the player walks up to it, without changing world-space size, background, timer, orientation, protocol, or persistence.

## Result

Done. Text canvas is supersampled (logical 512×256, physical ×2…×4). Close-up uses linear magnification instead of nearest-neighbour. World-space plane scale is unchanged.

## Root cause

`HologramRenderer` drew into a **512×256** canvas at **36px**, then stretched that texture over a ~2.6×0.77 world plane. `magFilter` was `NearestFilter`, so approaching the hologram nearest-neighbour-upscaled a low-res bitmap → pixelated/blurry. Distance looked fine because `minFilter` was already linear.

## Implemented

- Logical canvas stays 512×256. Physical size = logical × `hologramTextCanvasScale(devicePixelRatio)`.
- Scale formula: `clamp(round(dpr × 2), 2, 4)` → 1024×512 on a 1× display, 2048×1024 on retina, never larger.
- `ctx.setTransform(scale, …)` so glyphs rasterize at the higher density; world `text.scale` still uses `hologramSpriteWidth/Height`.
- Texture: `magFilter = LinearFilter`, `minFilter = LinearMipmapLinearFilter`, `generateMipmaps = true`. Mipmaps only affect distance; close-up uses magFilter.
- Timer still redraws the **same** canvas when the displayed second changes (`needsUpdate`). One `CanvasTexture` per hologram, created in `sync`.

## Changed files

- `shared/hologramStyle.ts` — scale helpers and logical canvas constants
- `src/rendering/HologramRenderer.ts`
- `tests/hologram-timer.test.ts`
- docs

## Tests

- `tests/hologram-timer.test.ts` — physical > logical, scale clamp 2–4, world-space size unchanged, one CanvasTexture, Linear magFilter, no NearestFilter.
- Existing hologram style/hit/editor tests unchanged.

`npm run test:sim` 65/65. `npm run test:server` 324/324. Typechecks, `check:boundaries`, `build` PASS.

## Visual QA

Not run against a live Anarchy client in this cloud pass. Owner should walk up to a hologram: far still clean, close much sharper; timer/fixed/bg on-off unchanged in world size.

## Performance

Max texture 2048×1024 per hologram. Timer does not allocate a new canvas each second.

## Git

Branch `cursor/hologram-text-quality-5fe9` from `cursor/hologram-bg-timer-5fe9`.
