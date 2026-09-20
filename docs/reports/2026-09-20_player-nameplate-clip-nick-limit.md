# Player nameplate clipping, nick max 13, lower offset

## Goal

Stop long player nicks from being clipped on the nameplate, lower the plate slightly toward the head, and cap display nicknames at 13 characters. Keep the previous visual pass (Press Start 2P, no panel, 2× height, supersample, `#ff1f1f` HP).

## Result

Done. Clipping was a too-narrow logical canvas, not world-sprite size. Nickname max is 13 on client and server. Offset is `2.05`.

## Root cause

Nameplate drew 44px Press Start 2P (advance ≈ 1em) into a **fixed 512×205** atlas, centered. 13–14 glyphs need ~572–616 px plus stroke, so the first/last characters were rasterized past the canvas edge. Stretching the sprite would only enlarge the already-clipped texture.

## Implemented

- Logical width = `max(512, ceil(max(measureText(nick), measureText(HP), glyphEstimate) + stroke 6 + 2×32 pad))`.
- `measureText` is floored by a Press Start 2P estimate (`length × fontPx`) so missing fonts in tests/first paint cannot undersize the atlas.
- World **height** stays `0.84`. World **width** scales with logical width (`2.1 × logical/512`) so 44px glyphs keep the same world size. Short nicks stay on the 512 baseline (no regression).
- No `name.slice(0, 16)`.
- `MAX_PLAYER_NAME_LENGTH = 13`. `sanitizePlayerName` **rejects** longer names (no silent truncate). Account input `maxlength` uses the constant. Clan name 3–16 unchanged.
- `NAMEPLATE_HEIGHT_OFFSET` `2.15 → 2.05`.

## Changed files

- `src/rendering/player/PlayerNameplate.ts`
- `shared/config.ts`, `shared/playerName.ts`
- `src/ui/GameUI.ts`
- `tests/player-nameplate.test.ts`, `tests/player-nickname.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, this report

## Architecture decisions

- Still a `THREE.Sprite` on `RemotePlayerView`, still `hologramTextCanvas.ts`.
- Sprite width follows atlas aspect; that is not a substitute for a wide enough canvas.

## Tests

Focused nameplate + nickname tests, typecheck, build — filled in after the run.

## Visual QA

Not run two-client. Owner should check a 13-char nick: full glyphs, no plate, same 44px size, slightly lower.

## Deferred

Live Anarchy close-up QA.

## Next work

Owner review of PR #96; do not merge.

## Git

Branch `cursor/clan-roles-rating-d1a5`. Draft PR https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/96. No merge.
