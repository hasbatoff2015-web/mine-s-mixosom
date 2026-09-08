# Claim-anchor explosion cleanup

## Goal

When TNT / `ExplosionQueue` destroys an iron/gold/diamond claim-anchor voxel, the matching block-claim must be deleted. Nearby blast that does not destroy the stored anchor cell must leave the claim in place. No second claims system.

## Result

Fixed. `ServerGameplay.processExplosions` emits the existing post-observation `blockBroken` for each voxel the queue actually destroyed. The Claims plugin already deletes by stored `Claim.anchor` coords on that event.

## Implemented

- Collect `onContents` from `ExplosionQueue.process`, then emit `blockBroken` after the batch write (voxels are already Air).
- Omit `playerId` on explosion destroys; player mining still sets it.
- Claims handler unchanged: `findClaimByAnchor` on the stored cell only.

## Changed files

- `server/gameplay.ts`, `server/events.ts`
- `tests/server/claim-anchor-blocks.test.ts`
- Docs: `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `PLUGINS.md`, `TESTING.md`, this report, plus a note on `2026-09-07_claim-anchor-blocks.md`

## Architecture decisions

- Do not import claims into shared `ExplosionQueue` / `src/world`. Server gameplay is the adapter, same pattern as chest dumps on the singleplayer `Game` path.
- Emit for every destroyed cell, not a special mineral-block scan. Ordinary dirt/stone is a no-op in Claims; only a matching `Claim.anchor` is removed.
- Reuse `blockBroken` rather than a new `explosionDestroyed` event or a second claim store.
- Default `explosions: true` is unchanged: TNT is allowed inside a block-claim, and destroying the anchor is what clears protection.

## Tests

- New Anarchy case: place iron/gold/diamond; small blast destroys adjacent dirt and leaves the iron claim; far TNT-radius blast misses gold; primed TNT (fuse 0.05, same redstone → enqueue → process path) destroys iron then diamond; owner `tryBreak` still deletes gold; Bob can build only after that claim is gone.
- Existing owner/foreigner/OP break cases remain.
- `claim-anchor-blocks` 7/7. Related (`claim-anchors` 8, `claims` 10, `anarchy-plugins` 36, `plugin-platform` 19) combined **80/80**.
- All four typechecks PASS. Boundaries PASS. `test:sim` 42/42. Production build PASS.

## Visual QA

Not a client pass. Server voxel + plugin store only.

## Performance

One extra `blockBroken` dispatch per destroyed voxel in an already-budgeted explosion job. Linear claim lookup is the existing Claims scan.

## Known issues

- Pre-cancellable `explosion` still keys off the blast origin cell only. TNT lit outside a claim can still destroy blocks inside. Unchanged and out of this task.
- `/claim admin delete <name>` still deletes every claim with that name.

## Deferred

- Reverse recipes (block → 9 ingots).
- Owner live TNT QA on a running Anarchy server.

## Next work

Owner QA: place an iron block-claim, prime TNT next to the anchor, confirm the region is unprotected after the blast.

## Git

Branch `cursor/claim-anchor-blocks-3f93`.
