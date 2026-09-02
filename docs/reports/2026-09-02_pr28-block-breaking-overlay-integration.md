# PR #28 block breaking overlay integration

## Goal

Integrate the existing Draft PR #28 branch `cursor/block-breaking-overlay-3f86` with the current `origin/main` by an ordinary `--no-ff` merge, preserving both the visual block-breaking overlay and the server-authoritative Online Anarchy architecture. No rebase, reset, clean, force-push, replacement branch, or replacement PR.

## Result

- Pre-merge feature HEAD: `a7123954c6373f9091ab0ae8c7447fe163304ea8`.
- Integrated `origin/main`: `a305dc5b4c851defc5e1732e7893c50c479890e6`.
- Conflicts were limited to `src/core/Game.ts`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, and `docs/TESTING.md` and were resolved semantically.
- The overlay remains presentation-only. Singleplayer mining keeps the existing fixed-tick path. Online sends mining intent/request; `ServerGameplay.advanceMining` / `breakBlock` remain destruction authority and clients apply authoritative block messages.
- The existing PR branch and PR are retained. The resulting merge commit is this report's containing commit; its SHA is recorded in the PR/final handoff.

## Implemented

- Kept `Game.updateBreakingOverlay()` in the render path after merging the current `Game` lifecycle/online simulation.
- Reused the canonical Node-safe `world/blockGeometry.ts` shape/neighbor contract and the existing oriented rendering wrapper; no duplicate selection table or mining system.
- Added an exact repeated render-frame sample fast path to avoid repeated block-state/shape resolution and allocations while the target, block and progress are unchanged.
- Kept stage mapping `min(9, floor(progress * 10))` for `0 < progress < 1`; zero, completion, invalid target and Air hide the mesh.
- Retained one cached transparent overlay mesh below the selection outline, nearest-filter stage textures, geometry/material/texture reuse, and no chunk dirty/remesh.
- Replaced the texture test's arbitrary compressed-byte threshold with decoded RGBA8 dimensions and strictly increasing opaque-pixel coverage across all ten accepted masks.

## Changed files

Integration-specific edits:

- `src/core/Game.ts`
- `src/rendering/BlockBreakingOverlay.ts`
- `tests/block-breaking-overlay.test.ts`
- `tests/breaking-overlay-textures.test.mjs`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`
- this report

The merge also brings all server/shared/tooling files already present in `origin/main`; those are mainline history, not duplicate implementations made by this task.

## Architecture decisions

- Online authority was not moved into `Game` or the overlay. The client does not optimistically call `setBlock` when the local visual reaches completion.
- `GameSession.miningProgress` is still the local visual input. Server mining is advanced independently from network input and publishes the authoritative result.
- `world/blockGeometry.ts` owns selection AABBs, stair/fence neighbor resolution and shape keys. `specialBlockGeometry.ts` remains a Three.js-oriented rendering adapter.
- The overlay is owned by `WorldRenderer`, remains independent of `ChunkMesher`, and performs no gameplay/world tick.

## Tests

- `npm run typecheck`: PASS.
- `npm run check:boundaries`: PASS.
- `npm run smoke:sim`: PASS.
- `npm run smoke:server`: PASS.
- `npm run test:sim`: PASS, 9 files / 42 tests.
- `npm run test:server -- --maxWorkers=2 --silent --reporter=dot`: PASS, 5 files / 73 tests.
- Overlay/mining pack after final cache test: PASS, 3 files / 17 tests.
- Broad overlay + geometry + gameplay + online/network + Anarchy pack: PASS, 17 files / 232 tests, including 13/13 overlay behavior assertions.
- `npm run build`: PASS, Vite transformed 185 modules.
- `npm run check:size`: PASS, 3.66 MiB / 231 production files.
- `npm run check:archive`: PASS, 3.66 MiB / 231 unpacked production files, below the 100 MB Yandex limit and internal 20 MiB budget.

Full `npm run check` reached the full Vitest suite after typecheck/boundary checks and stopped there as expected on existing/load-sensitive failures: 104/114 files passed, 1205/1231 tests passed, 26 failed, with 2 Vitest worker RPC timeouts. Overlay tests were green. The failure classes were the CRLF-sensitive Minecraft reference extractor, stale generated-item source fingerprint, high-load timeouts in fire/minecart/worldgen/server/lighting suites, and pre-existing streaming thresholds.

Detached `origin/main` baseline at exact SHA `a305dc5` reproduced the same classes: 100/112 files passed, 1188/1217 tests passed, 29 failed, with 2 identical worker RPC timeouts. The baseline had three additional environmental/load failures: two authored-item tests could not read source assets absent from the isolated worktree and one more load-sensitive test failed. The integration therefore introduces no overlay-attributable full-suite regression. A temporary detached worktree was removed after the comparison.

## Visual QA

The real WebGL DEV harness `/?qaBreaking=1` was inspected in the in-app browser:

- cube stage 0 and stage 9;
- slab, stairs, connected fence, and door stage 9;
- overlay below the yellow selection outline;
- no browser console warnings or errors.

Native gameplay acceptance (desktop Survival/Creative, mobile landscape, and two simultaneous Anarchy clients) remains for the owner because this environment did not run that interactive multi-client flow.

## Performance

- No per-frame geometry or texture construction.
- An unchanged target/block/progress sample exits before state and shape resolution.
- Stage texture, material and geometry caches remain bounded by the ten stages and encountered selection shape keys.
- No new world scan, chunk dirty flag, remesh, lighting job, network tick, or second mining timer.
- Production size remains 3.66 MiB / 231 files.

## Known issues

- Full-suite baseline contains existing CRLF/fingerprint, CPU-timeout, RPC-timeout and streaming-threshold failures described above; they are not hidden by this integration.
- The Vite build retains the existing large-chunk warning for the ~1.07 MB minified main JS asset and the existing non-module `/sdk.js` notice.
- The legacy HUD mining bar intentionally remains alongside the overlay.

## Deferred

- Owner native QA: singleplayer Survival/Creative mining, release/target-switch reset, desktop pointer lock, landscape mobile controls, two-client Online Anarchy authority/visibility, and reconnect/pause/background checks.
- Any cleanup of unrelated baseline flakes, source fingerprint, line-ending extractor, or bundle splitting belongs to separate work.

## Next work

Review the pushed Draft PR #28 and execute the manual acceptance checklist. Do not create another branch or PR for this integration.

## Git

- Branch: `cursor/block-breaking-overlay-3f86`.
- Merge strategy: `git merge --no-ff origin/main`.
- Parents: previous feature HEAD `a7123954c6373f9091ab0ae8c7447fe163304ea8` plus integrated main `a305dc5b4c851defc5e1732e7893c50c479890e6`.
- Merge commit: this report's containing commit; see PR #28 / `git log -1`.
- Push target: the same remote branch, without force.
