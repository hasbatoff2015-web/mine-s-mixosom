# Claim-anchor cubic volume and visible bounds

## Goal

1. Make block-claim boundary wires actually visible in live Anarchy without a second renderer.
2. Make block-claim volume a cube: the same inclusive ±radius on X, Y and Z, not full world height.

## Result

The PR #69 `show()` / `showAll()` calls were already correct. The packet reached the placing player. The client `ClaimBoundaryRenderer` did run. What it drew was a 21×256×21 tower (`minY=0`, `maxY=255`), so the player never saw a box around the iron/gold/diamond block.

`claimAnchorVolume` now uses `anchorY ± radius`, clamped to `MIN_WORLD_Y…MAX_WORLD_Y`. Protection, overlap and the wire all read that same `Claim.volume`. Load rebuilds the volume from `Claim.anchor` so old full-height JSON is not kept.

## Where the boundary bug actually was

Runtime path that already worked:

`blockPlace` / `blockPlaced` → Claims plugin → `ClaimBoundaryNetwork.show` / `showAll` → unicast `claim_boundary` → `WsSink` `encodeMessage` → `AnarchyClient.parseServerMessage` → `Game.handleOnlineMessage` → `ClaimBoundaryRenderer.show`.

PR #69 tests stopped at the server `MemorySink`. They never encoded the packet, never parsed it as the client does, and never checked the Y span of the geometry the renderer submits.

Why that geometry was invisible next to a working ordinary-claim deny:

- Ordinary `/claim create` boxes are a few blocks tall; all 12 edges sit near the player.
- Block-claims sent Y `0…255`. Horizontal edges sat at bedrock and build limit.
- Vertical edges were 256-block `LineSegments2` segments through solid terrain (`depthTest: true`) and past the sky. Fat-line clipping on those long segments does not leave a readable nearby wire.
- Same `show()` as a denied dirt place inside a small regular claim, which is why those wires still looked fine.

No extra `show()` was added. No renderer/style/protocol change.

## Implemented

- `claimAnchorVolume`: `minY/maxY = clamp(anchorY ± radius)`.
- `migrateClaim`: if `anchor` is present, volume is rebuilt from that anchor (old full-height saves included).
- Runtime test: `ClaimBoundaryNetwork` → encode → parse → `ClaimBoundaryRenderer` → scene mesh with cubic Y, 10s expiry.
- Anarchy: vertical iron spacing 20 overlaps, 21 is allowed; restart of a full-height JSON becomes cubic.

## Changed files

- `server/services/claimAnchors.ts`, `server/services/claims.ts`
- `tests/server/claim-anchors.test.ts`, `tests/server/claim-anchor-blocks.test.ts`, `tests/claim-boundary-runtime.test.ts`
- Docs: `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `TESTING.md`, this report, note on `2026-09-07_claim-anchor-blocks.md`

## Architecture decisions

- One `Claim.volume` for protection and the wire. No second AABB for the renderer.
- Inclusive min/max unchanged. X/Z radii unchanged. Y matches X/Z, then clamp to world.
- Regular claims without `anchor` keep their stored volume.

## Tests

- `claim-anchors` 9/9, `claim-anchor-blocks` 8/8, `claim-boundary` 2/2, `claim-boundary-runtime` 2/2.
- Related `anarchy-plugins` + `claims` + `plugin-platform` PASS.
- All four typechecks PASS. Boundaries PASS. Production build PASS.

## Visual QA

Not a live client pass. The runtime test drives the same encode/parse/renderer path as Anarchy.

## Performance

Unchanged. Smaller AABB, slightly cheaper overlap.

## Known issues

`/claim admin delete <name>` still matches every claim with that name.

## Deferred

Owner live look at the cubic wire after placing iron.

## Next work

Owner QA on a running Anarchy server: place iron/gold/diamond, confirm a cube around the block; overlap deny shows the existing cube.

## Git

Branch `cursor/claim-anchor-cube-bounds-3f93` from `cursor/claim-anchor-boundary-ux-3f93`.
