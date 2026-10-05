# Invisibility particle world trail — 2026-10-05

## Goal

Accepted swirl particles were parented in local space, so a running player carried the whole cloud. They should stay where they spawned. Air HUD and the accepted particle look stay as they are.

## Result

`InvisibilityWorldParticles` still lives under `PlayerVisual.root`. Each slot stores a world origin. On update the emitter inverts the current parent matrix once and writes that world point back into local sprite position. Rise, drift, fade, size, tint, pool, and spawn rate are unchanged.

`PlayerVisual.update` no longer steps the emitter. `updateWorldParticles` runs after `applySeatVisualRoot` for the local player and for both remote interpolate paths, including the path with no sampled pose.

A parent move of at least 6 blocks clears the live slots and seeds the usual two swirls at the new place. Ordinary running does not.

Frame changes assign `material.map` only. `needsUpdate` is not set. The shared swirl maps stay for the page; the unused `invisibilitySwirlFramesLive` helper is gone.

The air DOM test now builds one `GameUI` and calls `updateHud` for each case.

## Changed files

- `src/rendering/InvisibilityWorldParticles.ts`
- `src/rendering/player/PlayerVisual.ts`
- `src/core/Game.ts`
- `src/net/RemotePlayerView.ts`
- `src/dev/PlayerQaHarness.ts`
- `tests/invisibility-world-particles.test.ts`
- `tests/remote-player-view.test.ts`
- `tests/air-hud-dom.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`

## Tests

Focused command, PASS, 9 files / 92 tests:

```
npx vitest run \
  tests/invisibility-world-particles.test.ts \
  tests/remote-player-view.test.ts \
  tests/remote-player-interpolation.test.ts \
  tests/potion-effects-hud.test.ts \
  tests/player-visual-animation.test.ts \
  tests/air-hud.test.ts \
  tests/air-hud-dom.test.ts \
  tests/survival-air.test.ts \
  tests/mobile-controls-sky-hud.test.ts
```

After the stub fix, `tests/remote-action-presentation.test.ts` and `tests/third-person-camera.test.ts` also pass. Those doubles now include `updateWorldParticles`.

`npm run typecheck:client`, `npm run typecheck:server`, `npm run check:boundaries`, `npm run build`, and `git diff --check` passed.

## Full suite baseline

Paired runs in this environment, feature first and then `origin/main` `1bf929c` in a detached worktree:

- First feature pass: 3099 tests, 3074 passed, 24 failed, 1 pending.
- `origin/main`: 3087 tests, 3063 passed, 23 failed, 1 pending.
- Second feature pass: 3099 tests, 3075 passed, 23 failed, 1 pending.

The second feature pass and `origin/main` fail the same 23 tests with the same messages: arrow panel UVs, classic combat presentation, fence jump height, menu icon PIL, two SFX pack counts, 13 remote breaking-overlay light stubs, two pet-hit timings, and the bow FIFO draw.

The extra miss on the first feature pass was `tests/urgent-block-mesh.test.ts` leaving `chunk.dirty === true` inside the urgent time budget. That file is not in this diff. Eight isolated reruns passed, and the second full pass did not fail it. No feature-only failure remains.

Result: BASELINE CONFIRMED.

## Visual QA

Chrome, Vite, `?qaPlayer=1`.

- Stationary invisibility, no armor: a few white swirls in one cluster. Draw count stayed at the ground plus those sprites.
- `path=1` looks across the X path from the side. At about 1.5 s the player has moved and swirls are just behind. At the hold, swirls are spread back along the path, not glued to the body. On the way back, the old swirls stay on the earlier stretch.
- `wall=1`: the gray wall covers the volume and no swirl pixels show through it.

A second online client was not opened.

## Git

Same branch `cursor/invisibility-particles-air-hud-5805`. Draft PR #119. Do not merge.
