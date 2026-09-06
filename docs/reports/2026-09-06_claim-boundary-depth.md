# 2026-09-06 — Claim boundary: thinner lines + depth test

## Goal

Make denied-claim AABB wires about 2× thinner and occlude behind blocks (depth buffer), matching a thin red box that disappears behind world geometry. Do not change claims, protocol, mining, or gameplay.

## Result

Done. Only `ClaimBoundaryRenderer` material/mesh flags plus docs/tests.

## Why lines drew on top

`LineMaterial` was created with `depthTest: false` and `depthWrite: false`, and each `LineSegments2` used `renderOrder = 50`. That is an overlay pass: the GPU never compared the wire to the chunk depth buffer, so the box was visible through terrain.

## Implemented

- Width `6` → `3` CSS pixels (`worldUnits: false` unchanged).
- `depthTest: true`, `depthWrite: true`.
- Removed overlay `renderOrder = 50` (default order, same as ordinary meshes).
- Color `#ff0000`, 12-edge AABB, fog/toneMapped off — unchanged.

## Changed files

- `src/rendering/ClaimBoundaryRenderer.ts`
- `tests/claim-boundary.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Tests

- Existing 12-edge AABB positions.
- New: `depthTest`/`depthWrite` true, linewidth 3.

## Visual QA

Owner: denied break/place in Anarchy. Thin red box visible in open air; hidden where a block is between the camera and the edge. Mining lifecycle unchanged.

## Git

Branch `cursor/claim-boundary-depth-3f93` from `cursor/mining-finish-zero-progress-3f93`.
