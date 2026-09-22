# Pet geometry and cat targeting

## Goal

Fix live visual regressions on `codex/wolves-cats-pets` without merging main, rewriting taming, or weakening reach/LOS: wolf mane/collar in the middle of the torso, floating cat body, and unreliable cat RMB that could fall through to ordinary food use.

## Starting HEAD

`0392a36248954946087e7dcd2df192ee585df184` on `codex/wolves-cats-pets` (parent `717c5ac55375ef5737edf6b9fdbe7ae08a3c81da`). `origin/main` at audit time: `d2d45e6b19942425d166009dbe63d596e64e55a8`.

## Result

Wolf standing mane/collar sit on the neck. Cat torso is grounded against the legs. Cat targeting covers the visible muzzle. Shared 3-feed taming is unchanged. Client pet `entity_use` still wins over food when the rendered ray hits a pet.

## Implemented

### Wolf

- Restored body rest rotation to `[Math.PI / 2, 0, 0]`.
- Moved standing mane and collar pivots from `[-1, 14, 2]` to `[-1, 14, -3]` (same neck Z as sitting).
- Kept `faceUvRects.top = { u: 30, v: 14, width: 6, height: 6 }` because the pack's vanilla top island `(24,14)` is empty.

### Cat

- Restored body addBox origin from `[-2, 3, -4]` to `[-2, 3, -8]`.
- Left adapter-aware walk swing and sitting hind `+π/2` in `petPoses.ts`.

### Targeting / use priority

- `mobTargetBounds('cat').minZ` `-0.75 → -0.85` so muzzle z≈`-0.8125` is inside the volume.
- Extracted `resolvePetUseTarget` so a visible pet wins over food and a closer block/cart still wins.
- Physics `width/height` unchanged. No per-frame Box3.

### Tests

- Anatomical wolf head→mane→body→tail and collar-at-neck assertions.
- Cat leg-to-torso gap in stand / walk / sit (fails on the floating Z=-4 body).
- Anarchy mixed-meat cat `entity_use` (Beef → CookedChicken → Porkchop).
- Moving-cat RMB rewind and moving-cat LMB rewind with miss/stale/future/occluded/reach/dead.

## Changed files

`src/entities/mobModels.ts`, `src/entities/mobTargetBounds.ts`, `src/entities/petUseIntent.ts`, `src/entities/index.ts`, `src/core/Game.ts`, `tests/visual-models.test.ts`, `tests/pets.test.ts`, `tests/melee-action-intent.test.ts`, `tests/server/pets-anarchy.test.ts`, docs.

## Architecture decisions

- Fix the wolf neck by moving the mane pivot, not by reversing the torso.
- Do not change `legacyRotationToThree`.
- Do not duplicate cat taming; the client miss was targeting volume + food fallback.
- Client still sends intent; server still proves reach/LOS/rewind.

## Tests

Focused pet suite plus typecheck ×4, boundaries, build, `git diff --check`.

## Visual QA

qaMob harness viewed in a running browser (`http://127.0.0.1:5173`):

- Wolf side/front/rear/three-quarter: mane sits on the neck, body extends to the tail, no empty abdomen hole.
- Tamed wolf side: red collar wraps the neck/shoulder, not the torso midsection.
- Sitting wolf: collar stays on the neck; sit is sane.
- Cat side/front/rear/three-quarter/walk π/2 / 3π/2 / sitting: torso is not floating; legs meet the underside; feet stay near ground.

Live two-client Anarchy feeding/LMB was not run in this pass.

## Performance

No per-frame model traversal. Targeting stays constant AABBs.

## Known issues

Sitting cat remains a coarse ocelot sit. Collar is still the inflated mane overlay.

## Deferred

Owner two-client Anarchy meat/LMB session.

## Next work

Live Anarchy confirmation of mixed meats on a moving cat.

## Git

Feature branch only. No merge, rebase, or force-push.
