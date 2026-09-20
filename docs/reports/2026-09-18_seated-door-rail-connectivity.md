# 2026-09-18 Seated pose sign, door outside facing, rail connectivity

## Goal

Fix three remaining live-QA bugs on `codex/entity-special-visual-fixes` without merging `main`: seated limbs folded backward, doors opening from the handle after a 90° turn, and rail corners still choosing/pathing the wrong shape.

## Result

Semantic fixes on the feature branch only. Previous entity visual work (minecart mesh, sign, Totem, bed, OakSign 165, arrows, skeleton) was not changed. `main` was not merged, rebased, or force-pushed.

## 1. Feature HEAD before this work

`3ebad77a242c79a96f0a7b94036da4a1bdedeb25`

## 2. Seated pose

Old X rotations: legs `-1.18`, arms `-0.42`. New: legs `+1.18`, arms `+0.42`.

Canonical PlayerVisual front is local **−Z**. A limb hangs down −Y, so **positive** X rotation moves the tip to −Z (forward); negative X is +Z (into the backrest). Attack swing already used positive `rightArmX` for a forward arm. The old seated signs were inverted.

Geometric test: apply seated X rotation to `(0, -1, 0)`; `tip.z` must be `< 0`. Both legs match, walk cycle stays off, hip still lowered, standing pose unchanged. Reusable `PlayerAnimationState.seated` / local `ridingCartId` / remote `ridingEntityId` kept.

## 3. Door

Placement used `doorFacingFromYaw` (player look). Occupancy, hinge, mesh and collision treated `facing` as the **closed-door outward normal**. Those conventions are opposites, so one orientation looked correct and a 90° turn hung the slab on the handle.

Canonical `BlockRenderState.facing` for doors is now the outward normal. Generic `doorFacingFromYaw` is unchanged (chest/furnace). `placeDoor` uses `doorOutsideFacingFromYaw` = opposite of look (look north → outside south).

`doorHingeEdge(facing, hinge)` is the physical hinge edge as viewed from outside:

| outside | left hinge | right hinge |
| --- | --- | --- |
| north | east | west |
| south | west | east |
| east | south | north |
| west | north | south |

`occupiedDoorFacing(open=true)` returns that hinge edge. Collision `doorLocalBox`, mesh `addDoor`, and handle UV all consume the same occupied edge.

## 4. Rails

The previous UV fix (`RAIL_CORNER_UV.south_west = identity`) matches authored L = left+bottom = west+south. It did not fix topology.

`resolveRailShape` no longer treats “neighbor rail block exists” as connected. `railEndDirections` / `railConnectsToward` are the single connection table. Two occupied neighbors still form an L or straight; three neighbors use reciprocal endpoints and the existing shape as tie-breaker (no automatic `east_west`). `refreshNeighborRails` does up to four local passes including Y±1.

`nextRail` requires a reciprocal endpoint. `entryProgress` returns `0 | 1 | undefined` after checking **both** ends. Curve length is `0.5 * π/2 = π/4`, not `π/2`.

## Implemented

- Flip seated limb X rotations; geometric animation test.
- Door outside-facing placement helper and `doorHingeEdge`.
- Canonical rail endpoints, reciprocal resolve/path, bounded neighbor refresh, curve length.
- QA: `/?qaSpecial=rails&row=tracks`, `/?qaSpecial=doors`, `/?qaSpecial=seated`.

## Changed files

- `src/rendering/player/PlayerVisualAnimator.ts`
- `src/blocks/placement.ts`
- `src/gameplay/useInteraction.ts`
- `src/world/blockGeometry.ts`
- `src/entities/railPath.ts`
- `src/entities/MinecartManager.ts`
- `src/rendering/ChunkMesher.ts`
- `src/rendering/specialBlockGeometry.ts`
- `src/dev/SpecialBlockQaHarness.ts`
- `src/main.ts`
- `tests/player-visual-animation.test.ts`
- `tests/special-block-items.test.ts`
- `tests/rail-corner-path.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`

## Architecture decisions

- Do not change generic `doorFacingFromYaw`.
- Do not per-facing door swap hacks.
- Do not flip `RAIL_CORNER_UV` again.
- Do not add a minecart-specific seated hack.
- Rail connection table lives in `blockGeometry` (Node-safe); `railPath` consumes it.

## Tests

```text
npx vitest run tests/player-visual-animation.test.ts tests/rail-corner-path.test.ts tests/special-block-items.test.ts tests/entity-special-block-rendering.test.ts tests/lighting-physics-interaction.test.ts tests/tnt-minecart.test.ts tests/block-registry.test.ts tests/unknown-block-load.test.ts tests/content-pass.test.ts tests/chest-model.test.ts tests/use-interaction.test.ts tests/server/anarchy-gameplay.test.ts --maxWorkers=2
```

Focused **player-visual-animation 16**, **rail-corner-path 10**, **special-block-items 13**, **entity-special-block-rendering 8**, **165/unknown 21**, **tnt-minecart 8**, **anarchy-gameplay** included in the 73-file related run. Full `fire-contact-sunlight-minecart.test.ts` skipped (known host hang); its NS/EW/L/slope topology cases were copied into `rail-corner-path`.

## Visual QA

DEV harnesses in the in-app Chromium (Vite `localhost:4173`):

- `/?qaSpecial=doors` — four facings, closed front row / open back row. Closed slabs sit on the outward edge; open slabs sit on the physical hinge edge; handle UV stays on the non-hinge side. Space toggles.
- `/?qaSpecial=rails&row=tracks` — four L tracks (NE/NW/SE/SW) with visible incoming NS and outgoing EW. Short carts finish the path quickly; geometry is the check.
- `/?qaSpecial=seated` — third-person back: hip lowered, legs fold away from the camera (local −Z / forward), not into the backrest.

## Performance

No new per-frame systems. Rail refresh is 4 local passes around the placed cell. Production **4.75 MiB / 404 files**.

## Known issues

Full `fire-contact-sunlight-minecart.test.ts` still hangs on this host (pre-existing).

## Deferred

Owner live Anarchy ride through player-placed rail corners.

## Next work

Owner visual confirmation of the three harnesses; then remaining entity visual review. Do not merge `main`.

## Git

Feature branch `codex/entity-special-visual-fixes` only. No merge to `main`, no rebase, no force push.

- Before: `3ebad77a242c79a96f0a7b94036da4a1bdedeb25`
- After: `f01f188ed636606c16efa7769ffefe88e4db0ca8`
- `origin/main` unchanged: `ce6facdb328321b5b2113196aa9ee277469b3341`
