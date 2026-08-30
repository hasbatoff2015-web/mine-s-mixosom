# 2026-08-30 — Phase 3 shared block geometry

## Goal

Move simulation block geometry (collision AABB, selection AABB, placement normals, rail/stair/slab/fence/lantern/chain/button shapes) out of `src/rendering/specialBlockGeometry.ts` so the Anarchy server and world code do not import rendering. Rendering must keep using the same definitions — no second AABB table.

Do not start Phase 4+.

## Result

```text
                SIMULATION GEOMETRY
                       │
             ┌─────────┴─────────┐
             │                   │
           SERVER              CLIENT
             │                   │
        collision/AI       mesh generation
        raycast            visual geometry
        placement
```

- **Sim:** `src/world/blockGeometry.ts` — local boxes, neighbor stair/rail/fence, attachment normals as `{x,y,z}`, `selectionLocalBoxes`, button/lever AABB envelopes without Three.js.
- **Render:** `src/rendering/specialBlockGeometry.ts` — UV, torch matrices, outline geometry, lantern/chain mesh planes. Re-exports sim functions. `facingVector` / `attachmentNormal` stay THREE wrappers for outline tests.

Collision, selection, placement, `useInteraction`, ladders, rails, `Game`, and `ServerGameplay` import `world/blockGeometry`. ChunkMesher / ItemVisualFactory / WorldRenderer still import `specialBlockGeometry`.

Browser QA was **not** performed here. Owner local QA of Phase 1+2 (WASD, SP/Anarchy place/use) is the freeze baseline.

## Before

`server/gameplay.ts`, `world/collision.ts`, `world/selection.ts`, `world/placement.ts`, `gameplay/useInteraction.ts`, `player/ladderMotion.ts`, and `entities/railPath.ts` imported `src/rendering/specialBlockGeometry.ts`. Button/lever collision envelopes were `THREE.Box3.applyMatrix4` of mesh cuboids.

## After

Same numbers, one source. Button/lever sim envelopes are 8-corner AABBs of the same transforms the mesh uses. Door/cactus/chest collision offset the shared local boxes.

## Intentionally unchanged

- GameplayKernel order and Phase 2 `useInteraction` rules.
- Interpolation, fluids, block-state protocol, respawn/session WASD (#19/#20).
- Protocol. EntityHost. Server still uses `ItemVisualFactory` (Phase 4).
- Renderer folder layout. No greedy meshing / workers.

## Tests

- New `tests/block-geometry.test.ts`: import boundary (sim files must not mention `specialBlockGeometry`; `blockGeometry.ts` must not import `three` or `rendering/`); re-export identity; slab/stair/lantern/rail numbers; button/lever AABB vs THREE mesh envelopes.

Retained packs: `placement-support`, `glowstone-lantern-chain`, `block-selection-raycast`, `interaction-support-polish`, `ladder-climbing`, `stairs-slabs-icons`, `anarchy-gameplay`, `use-interaction`, `gameplay-kernel`.

Results filled after verification in this pass.

## Visual QA

Not run here (no gameplay browser pass). Owner: collision/selection on stairs/slabs/lanterns/chains/fences/rails/buttons/levers; place torch/door; death→respawn WASD; Anarchy→menu→Anarchy.

## Performance

No extra world scans. Button/lever envelopes still cached by attachment/facing/powered. Outline still uses existing THREE matrices.

## Known issues

None intended. Full suite baseline: authored ENOENT `bucket_empty.png`, minecart 5s timeouts, occasional vitest RPC (same class as PR #21).

## Deferred

- Phase 4 EntityHost (server still constructs THREE groups / ItemVisualFactory)
- Phase 5 persistence envelopes
- RNG / plugin architecture
- Moving renderer folders
- Dropping `Vector3` types from `useInteraction` player pose (not geometry)

## Next work

Owner local QA of this PR on top of #21. **Do not start Phase 4.** Do not merge main.

## Git

- Branch: `cursor/shared-block-geometry-bbb1` from PR #21 `7e67419`, **not** `origin/main`.
- Merge-base with `origin/main` remains `a056e6f`.
