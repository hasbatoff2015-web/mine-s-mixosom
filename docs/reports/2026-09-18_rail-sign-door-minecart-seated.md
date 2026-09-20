# 2026-09-18 Rail corners, sign, door hinge, minecart visual, seated pose

## Goal

Fix five live bugs on `codex/entity-special-visual-fixes` after the origin/main sync: mirrored corner rails, oversized/offset signs, door swinging from the handle, primitive minecart mesh, standing pose in carts.

## Result

Semantic fixes on the feature branch only. OakSign stays **165**. `main` was not changed.

## 1. Feature HEAD before this work

`5836d6244a9b9e491e51d43365aba4bbffd87492`

## Root causes

### Rails

`railRenderQuads` treated identity UV `[0,0,1,1]` as `north_east`. `ChunkMesher.addQuad` maps v=0 to the **bottom** of the atlas tile, and `rail_corner.png` authors the L on image **left+bottom**, which is the **south+west** edges. Every corner was a 180° mismatch vs `resolveRailShape` / `railPath` (those names were already correct: NE connects north+east). Carts followed the true neighbors while the texture showed the opposite L, so corners looked mirrored and unrideable.

Fix: identity UV = `south_west`; U-flip = `south_east`; V-flip = `north_west`; 180 = `north_east`. Pathing unchanged. Loop test: cart visits all four cells of a 2×2 corner square.

### Sign

`signVisualParts` used board size `[1.2, 0.6, 0.1]` (wider than a block). Wall center z was `+0.24`, so a south-facing wall sign sat ~0.74 from the attached north face. Selection was a near-full cube `0.05–0.95`.

Fix: board `16×8×2` px, post `2×8×2`, wall center z = `-0.5 + 1/16`. `signLocalBoxes` matches that slab/post.

### Door

`occupiedDoorFacing` swapped Minecraft hinge sides. Outside-left (`hinge: left`) on a south door must pivot on the **west** edge and occupy **west** when open; the code occupied **east** (the handle). Mesh and collision both use this helper.

Fix: swap left/right open mappings. Placement now sets hinge from click via `doorHingeFromPlacement` (left/right half as seen from outside).

### Minecart visual

`MinecartVisualFactory` built gray BoxGeometry floor/lining/wheels and stretched one `entity/minecart` panel (`textureOffset [0,0]`, size 16×8×2 or 20×8×2) onto every outer wall. The sheet is a ModelMinecart unfold (walls at 0,0; floor at 0,10), so the cart read as a dark primitive box.

Fix: floor cuboid 20×16×2 at (0,10) rotated X π/2; four 16×8×2 walls at (0,0). DoubleSide, no gray interior, no fake wheels. Ride/TNT logic unchanged (`MinecartManager` hitbox constants stay 0.98×0.62).

### Seated pose

No sit state existed. Passenger Y is `cart.y + 0.2` with the standing animator, so third-person showed a standing player.

Fix: reusable `PlayerAnimationState.seated`. Local: `session.ridingCartId`. Remote: snapshot `ridingEntityId`. Folded legs, lowered hip, rest arms. Bed rest, walk, bow, attack still take their existing priority.

## Changed files

- `src/rendering/specialBlockGeometry.ts` — corner UV, sign mesh
- `src/world/blockGeometry.ts` — `signLocalBoxes`
- `src/blocks/placement.ts` — `occupiedDoorFacing`, `doorHingeFromPlacement`
- `src/gameplay/useInteraction.ts` — hinge from click
- `src/rendering/SignRenderer.ts` — text plane sized to board
- `src/rendering/minecartGeometry.ts` — ModelMinecart visual
- `src/rendering/player/PlayerVisualAnimator.ts` — seated pose
- `src/core/Game.ts`, `src/net/RemotePlayerView.ts` — seated flag
- tests: `entity-special-block-rendering`, `sign-entity-model`, `special-block-items`, `player-visual-animation`, `fire-contact-sunlight-minecart` (floor), `rail-corner-path.ts` (new)
- docs: PROJECT_STATE, ROADMAP, TESTING, ARCHITECTURE, this report

## Tests / typecheck / build

- rail/sign/door/seated + 165/unknown + anarchy: PASS (including `rail-corner-path` 3/3, `anarchy-gameplay` 35/35)
- Isolated minecart floor visual: PASS
- Full `fire-contact-sunlight-minecart` file still host-timeout prone (pre-existing)
- `typecheck`, `typecheck:sim`, `typecheck:client`, `typecheck:server` — PASS
- `check:boundaries`, `build`, `check:size`, `check:archive` — PASS, **4.75 MiB / 404 files**

## Manual QA

- `/?qaSpecial=rails`: four corner L orientations visible (camera is distant in the harness).
- `/?qaSign=1`: standing post+board in-cell; wall board flush to north of its cell (harness has no backing block).
- Still owner-live: ride all four corners; place wall sign on a real block; left/right door swing around hinges; sit in a minecart in third person (local + remote).

## Git

Feature-only commit and push to `origin/codex/entity-special-visual-fixes`. No rebase, no force-push, `main` unchanged.
