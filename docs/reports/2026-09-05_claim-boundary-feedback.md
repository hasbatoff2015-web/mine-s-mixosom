# Claim boundary wireframe feedback

## Goal

When a non-owner/non-member is denied `block-break` or `block-place` inside a claim, keep the existing chat deny and also show that player a temporary red wireframe of the claim that actually blocked the flag.

## Result

Done. No particle system, no second claims stack, no plugin `sendPacket`. Shared simulation stays Node-safe.

## Implemented

- `protectionSource(claims, flag, player)` returns the per-flag setter (or highest-priority untrusted overlapping claim when nobody set the flag).
- On denied break/place: cancel + `This land is claimed.` + `ClaimBoundaryNetwork.show(playerId, source)`.
- Protocol `claim_boundary` is unicast. Duration 10s. Repeat deny on the same claim reuses the LineSegments object and resets expiry.
- Client `ClaimBoundaryRenderer` draws 12 red edges over inclusive AABB `[min, max+1]`, then disposes geometry/material.

## Changed files

- `server/services/claims.ts`, `server/services/claimBoundaries.ts`, `server/builtin-plugins/claims.ts`, `server/builtin-plugins/context.ts`, `server/WorldInstance.ts`
- `shared/protocol.ts`
- `src/rendering/ClaimBoundaryRenderer.ts`, `src/core/Game.ts`
- tests: `claims.test.ts`, `anarchy-plugins.test.ts`, `anarchy-server.test.ts`, `claim-boundary.test.ts`
- docs: `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `PLUGINS.md`

## Architecture decisions

Plugins still cannot send raw packets. WorldInstance owns `ClaimBoundaryNetwork` and `sendTo`s one player, matching holograms. Visual source is the flag setter (Spawn `block-break=false` inside Arena `pvp=true` shows Spawn).

## Tests

Denied break/place inside overlapping spawn/arena sends `claim_boundary` with Spawn AABB to Bob only. Owner gets none. `protectionSource` unit tests cover setter vs highest-priority claim.

## Visual QA

Not exercised in a live Anarchy browser session in this pass. Wireframe is Anarchy-only (created on welcome).

## Performance

One `LineSegments` per visible claim id. No per-frame geometry rebuild. Dispose on expiry/session end.

## Known issues

Line width is 1px (WebGL `LineBasicMaterial`). Large claims may have edges far from the player; `depthTest` is off so the box stays visible through terrain.

## Deferred

Persistent claim visualization for owners. Particle outlines.

## Next work

Owner QA: stranger denied build sees the red box; a second nearby player does not.

## Git

Branch `cursor/claims-chat-holograms-3f93` from `cursor/nickname-console-3f93`.
