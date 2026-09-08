# Claim-anchor boundary UX

## Goal

Show the existing Claims boundary wire when a player successfully places an iron/gold/diamond block-claim, and when a place is denied because the future volume overlaps another block-claim. Reuse `ClaimBoundaryNetwork` / `ClaimBoundaryRenderer`. Do not change radii, overlap rules, or ordinary claims.

## Result

Implemented. Successful `blockPlaced` calls `claimBoundaries.show` with the created claim. Overlap deny on `blockPlace` and the race rollback on `blockPlaced` call `showAll` with the **existing** overlapping block-claims.

## Implemented

- Iron ±10 / gold ±20 / diamond ±30 come from stored `Claim.volume`, same packets as denied build.
- Overlap message unchanged. No new claim, no leftover block.
- Multiple overlapping block-claims: one `claim_boundary` per existing claim (`showAll`).
- Foreigner denied inside a claim still uses `protectionSources` (unchanged).

## Changed files

- `server/builtin-plugins/claims.ts`
- `tests/server/claim-anchor-blocks.test.ts`
- Docs: `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `TESTING.md`, this report

## Architecture decisions

- No new renderer, protocol type, duration, or color. Unicast `claim_boundary` only.
- Show the stored existing AABB on overlap, never a preview of the rejected volume.
- Race rollback uses the same `showAll` path as the pre-cancel overlap.

## Tests

Covered in `claim-anchor-blocks` plus existing `anarchy-plugins` deny-build boundary cases.
- `claim-anchor-blocks` 7/7. Related (`claim-anchors` 8, `claims` 10, `anarchy-plugins` 36) combined **61/61**.
- All four typechecks PASS. Boundaries PASS. Production build PASS.

## Visual QA

Server packet assertions only. Client wire is the existing red 3px `LineSegments2`.

## Performance

At most one extra unicast per created claim, or one per overlapping existing claim on deny.

## Known issues

None added. `/claim admin delete <name>` still matches every claim with that name.

## Deferred

- Owner live Anarchy look at the wire after place / overlap.

## Next work

Owner QA: place iron, see ±10 box; attempt a second iron 20 apart, see the first box only.

## Git

Branch `cursor/claim-anchor-boundary-ux-3f93` from `cursor/claim-anchor-blocks-3f93`.
