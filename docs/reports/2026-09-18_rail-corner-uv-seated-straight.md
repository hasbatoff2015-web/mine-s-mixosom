# 2026-09-18 Rail corner UV south-east + straight seated pose

## Goal

On `codex/entity-special-visual-fixes`, fix remaining live-QA issues: corner rail textures still oriented wrong, and seated pose should be a 90° hip with straight legs sitting toward the rear of the minecart. Do not rewrite rail topology.

## Result

Pixel decode of `rail_corner.png` shows the authored L on **image bottom+right**, not top+right and not left+bottom. Identity UV is therefore **south_east**. The previous SW identity was a horizontal flip. The requested NE identity would have been a vertical flip of the real asset. Seated pose is `π/2` at the hip with a presentation-only seat root offset. Topology was not rewritten. `main` was not merged.

## 1. Feature HEAD before this work

`36d295133c20354d89035c3411f1de6081b855ef`

## 2–5. Rail corner UV

Decoded RGBA8 `public/textures/block/rail_corner.png` (32×32, color type 6): opaque track on **bottom + right** (bottom-edge ink 61 vs top 4; right 60 vs left 4). PNG y=0 is file top and is empty.

`addQuad` identity: v0 = image bottom = world south, u1 = image right = world east → identity = **SOUTH_EAST**.

Old `RAIL_CORNER_UV`: SW `[0,0,1,1]`, SE `[1,0,0,1]`, NW `[0,1,1,0]`, NE `[1,1,0,0]`.

New: SE identity `[0,0,1,1]`, SW horizontal flip `[1,0,0,1]`, NE vertical flip `[0,1,1,0]`, NW 180° `[1,1,0,0]`. Geometry corners unchanged.

The previous test encoded `south_west = identity` from a left+bottom assumption. A NE=identity table would encode a top+right assumption. Pixel probe now requires bottom/right ink ≫ top/left, then `railRenderQuads('south_east')` identity UV.

Topology (`railEndDirections`, reciprocal `nextRail`, `entryProgress`, π/4 curve length, bounded refresh) was not rewritten.

## 6–10. Seated pose and seat

Old seated: legs `+1.18`, arms `+0.42`, `bodyPitch` 0.06, `bodyYOffset` −0.38 (upper-body only). New: legs `π/2`, arms 0, `bodyPitch` 0, `bodyYOffset` 0. Geometric test: `(0,-1,0)` rotated +X by π/2 has `z < 0` and `y ≈ 0`.

Seat is `applySeatVisualRoot` / `MINECART_SEAT_VISUAL`:

- `yOffset = MINECART_FLOOR_TOP − 0.2 − PLAYER_SEAT_HIP_HEIGHT` (12px hip)
- `backwardOffset = 0.25` along local +Z (`sin(yaw)`, `cos(yaw)`)
- gameplay rider remains `cart.y + 0.2`
- local: cart origin when `ridingCartId` is set; remote: same offset on `visual.root` from snapshot rider anchor

## Implemented

- Flip `RAIL_CORNER_UV`; PNG orientation test.
- Straight seated pose; reusable seat visual helper.
- Local/remote presentation apply; seated QA side camera.

## Changed files

- `src/rendering/specialBlockGeometry.ts`
- `src/rendering/player/PlayerVisualAnimator.ts`
- `src/rendering/player/seatVisual.ts` (new)
- `src/core/Game.ts`
- `src/net/RemotePlayerView.ts`
- `src/dev/SpecialBlockQaHarness.ts` (ThreeEntityHost so the cart mesh actually spawns)
- `tests/entity-special-block-rendering.test.ts`
- `tests/player-visual-animation.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`

## Architecture decisions

- Do not rewrite rail topology.
- Do not change `MinecartVisualFactory` or gameplay rider Y.
- Do not sit by deforming `upperBody` with `bodyYOffset`.

## Tests

Focused entity-special, rail-corner-path, player-visual-animation, tnt-minecart, 165/unknown. Typecheck ×4, boundaries, build, size/archive.

## Visual QA

DEV harnesses in the in-app Chromium (Vite `localhost:4173`):

- `/?qaSpecial=rails&row=tracks` — NE (north+east L) and NW (north+west L) join the incoming NS and outgoing EW. SE/SW sit in the near foreground as EW exits.
- `/?qaSpecial=seated` — side/slightly-above: cart mesh present, torso upright, 90° hip, pelvis toward the rear wall, legs along the interior, not hovering above the floor.

Harness now passes `ThreeEntityHost` into `MinecartManager` (a raw `THREE.Scene` is not an EntityHost).

## Performance

No new per-frame systems. Seat offset is a root translation. Production **4.75 MiB / 404 files**.

## Known issues

Full `fire-contact-sunlight-minecart.test.ts` still hangs on this host (pre-existing).

## Deferred

Owner live Anarchy ride; lock body yaw to cart if free look later pokes legs through walls.

## Next work

Owner visual confirmation. Do not merge `main`.

## Git

Feature branch `codex/entity-special-visual-fixes` only. No merge to `main`, no rebase, no force push.

- Before: `36d295133c20354d89035c3411f1de6081b855ef`
- After: `9c6c00bbce347e74b275d91f3d8e0cf2455dc51e`
- `origin/main` unchanged: `ce6facdb328321b5b2113196aa9ee277469b3341`
