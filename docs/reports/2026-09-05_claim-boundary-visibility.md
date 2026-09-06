# Claim boundary visibility: pure red + overlapping regions

## Goal

Make denied-build claim outlines always bright `#ff0000` (no fog/sky washout, thicker lines) and show every overlapping claim that participates in that deny, not only the winning setter.

## Result

Done. `ClaimBoundaryNetwork` → `sendTo` unchanged. Per-flag allow/deny unchanged. Existing spawn+arena(`pvp` only) test still expects one Spawn packet.

## Implemented

- Client `LineSegments2` + `LineMaterial`: color `#ff0000`, `fog: false`, `toneMapped: false`, `depthTest: false`, screen-space width 6px.
- `protectionSources()` returns all untrusted overlapping claims with explicit `flag=false`, or all untrusted overlapping claims when nobody set the flag.
- Plugin calls `claimBoundaries.showAll(...)`. Each packet has its own `claimId` and 10s expiry; client reuses geometry and resets the timer.

## Changed files

- `server/services/claims.ts`, `server/services/claimBoundaries.ts`, `server/builtin-plugins/claims.ts`
- `src/rendering/ClaimBoundaryRenderer.ts`, `src/rendering/three-line-addons.d.ts`
- tests: `claims.test.ts`, `anarchy-plugins.test.ts`
- docs: `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`

## Tests

- Existing: denied break inside Spawn+Arena(`pvp` only) still sends one `claim_boundary` (Spawn).
- New: both claims `block-break=false` send two packets with distinct ids/AABBs; repeat deny sends two again (no extra client objects — server still unicasts refresh).

## Visual QA

Not exercised in a live Anarchy session in this pass.

## Git

Branch `cursor/claims-chat-holograms-3f93`.
