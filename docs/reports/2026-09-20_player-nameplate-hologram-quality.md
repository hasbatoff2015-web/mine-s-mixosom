# Player nameplate: no background, pixel font, 2× size, hologram text quality

## Goal

Rework the remote-player nameplate hologram (nick + HP) to match ordinary hologram text quality: no background plate, Press Start 2P, 2× visual size, supersampled canvas so close-up is not a stretched low-res bitmap. Keep nick/HP/hide/distance/appearance logic.

## Result

Done. `PlayerNameplate` stays a `THREE.Sprite` on `RemotePlayerView`. It now rasterizes through the same canvas/texture helpers as `HologramRenderer`. Ordinary holograms keep their background plane, world size, and quality path.

## Implemented

- No `fillRect` / panel behind nameplate glyphs. Transparent canvas only.
- Font: hologram `display` → `hologramCanvasFont('display', 'bold', px)` → `"Press Start 2P", "Arial Black", sans-serif` (existing `@font-face` in `src/uiTokens.css`).
- World size 2×: sprite `2.1 × 0.84` (was `1.05 × 0.42`). Canvas glyphs 44px nick / 36px HP (was 22 / 18). Head offset stays `2.15`.
- Quality: logical atlas `512×205` (sprite aspect), physical × `hologramTextCanvasScale(dpr)` clamped 2–4, `setTransform(scale)`, `LinearFilter` mag, `LinearMipmapLinearFilter` min, mipmaps, `texture.needsUpdate` after paint.
- HP color unified `#ff1f1f`. Nick stays `#fff7c2`.
- Shared helper extracted so holograms and nameplates do not duplicate filter/canvas/font-load code: `src/rendering/hologramTextCanvas.ts`.

## Changed files

- `src/rendering/hologramTextCanvas.ts` — new shared canvas/texture/font-load helper
- `src/rendering/HologramRenderer.ts` — uses the helper; draw path unchanged
- `src/rendering/player/PlayerNameplate.ts` — visual rewrite
- `shared/hologramStyle.ts` — `hologramTextPhysicalSize` for any logical atlas
- `tests/player-nameplate.test.ts`, `tests/hologram-timer.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, this report

## Architecture decisions

- Do **not** render player nameplates through `HologramRenderer` (world Group + optional background plane + yaw/timer). Nameplates remain camera-facing Sprites with existing distance fade.
- Reuse hologram **text** machinery: `hologramCanvasFont`, `hologramTextCanvasScale`, `configureHologramTextTexture`, `createHologramTextCanvas`, `ensureHologramTextCanvasResolution`, `loadHologramCanvasFonts`.
- Heart `❤` is not in Press Start 2P unicode-range; canvas fallback (`Arial Black` / sans) still supersamples. Digits and nick use the pixel face.

## Tests

- `npx vitest run tests/player-nameplate.test.ts tests/hologram-timer.test.ts tests/hologram-style.test.ts tests/hologram-hit.test.ts` — 29/29 PASS (`player-nameplate` 8, `hologram-timer` 10, `hologram-style` 8, `hologram-hit` 3).
- `npm run typecheck` PASS
- `npm run build` PASS (`tsc --noEmit && vite build`)

## Visual QA

Not run against a live two-client Anarchy session in this cloud pass (needs a second player). Owner should walk up to a remote nameplate: no gray plate, pixel nick, 2× size, sharp close-up, bright-red HP; ordinary holograms unchanged.

## Performance

One CanvasTexture per remote player, max ~2048×820 (dpr scale 4 × 512×205). No extra hologram meshes.

## Known issues

Heart glyph falls back out of Press Start 2P. Acceptable: same font stack holograms already use.

## Deferred

Live two-client close-up QA.

## Next work

Owner review of PR #96; do not merge without owner.

## Git

Branch `cursor/clan-roles-rating-d1a5`. Latest commit after this report update. Draft PR https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/96. No merge.
