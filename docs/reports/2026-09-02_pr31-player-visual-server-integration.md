# PR #31 player visual integration with authoritative main

## Goal

Integrate the existing Draft PR #31 branch with the exact server-authoritative `origin/main`, preserve PR #28 block breaking overlay and all shared/server ownership, replace the online remote-player placeholder with canonical `PlayerVisual`, and deliver the result on the same PR branch without merging the PR.

## Result

Ordinary no-ff merge completed against `57724f6ed6d16fdec77664e74bae4061eeb84031`. Local and remote presentation now share the Classic/Slim rig, geometry/texture caches, animator, lighting and item factory while Online gameplay remains server-authoritative. The network protocol remains unchanged and uses a safe default-appearance/empty-hand fallback.

## Implemented

- Semantically combined server `Game` lifecycle/input/network/render paths with local `PlayerVisual`, F5 camera and PR #28 overlay.
- Replaced `RemotePlayerView` `BoxGeometry` with interpolated canonical `PlayerVisual`.
- Fed only authoritative snapshot fields into remote animation; did not infer held item from `selectedSlot`.
- Kept `PlayerAppearance` Node-safe and moved Three-dependent skin loading to `src/rendering/player/MinecraftSkin.ts`.
- Added F5 active/repeat/typing/non-F5 edge tests plus architectural guards for Online ownership, targeting and overlay coexistence.

## Changed files

Integration-owned edits are centered in `src/core/Game.ts`, `src/input/InputManager.ts`, `src/net/RemotePlayerView.ts`, `src/rendering/player/MinecraftSkin.ts`, player rendering imports, `tests/player-main-integration.test.ts`, `tests/remote-player-view.test.ts`, `tests/third-person-camera.test.ts`, and project docs. The merge also carries all files already present on either PR #31 or main.

## Architecture decisions

1. Server snapshots remain gameplay authority; client player visuals never tick Online world simulation.
2. Remote interpolation stays owned by `RemotePlayerView`; `PlayerVisualAnimator` consumes the interpolated presentation sample.
3. No protocol expansion until a product decision exists for selector, rights and appearance persistence. Future sync is rare metadata, never raw image bytes or per-tick payload.
4. Camera perspective cannot affect player-eye targeting, reach, movement semantics or network sequence.
5. PR #28 overlay remains a presentation consumer of the existing mining target/progress path.

## Tests

- Focused player: 41/41.
- Expanded player/server/network/overlay: 236/236.
- Shared sim: 42/42; server: 73/73.
- All four typechecks, import boundaries and Node smokes: PASS.
- Full comparable two-worker run: integration 1238/1253 in 115/119 files; exact main 1214/1231 in 109/114 files. No new failure class; known CPU timeouts/hash/parse/RPC failures remain.
- Build/size/archive: PASS, 3.75 MiB / 277 files.

## Visual QA

Merged DEV build checked through `/?qaPlayer=1` for Classic/Slim, outer layers, all poses, held categories, look sliders and three perspectives. First-person arm/pickaxe, sprint+sword and bow were visually inspected. `/?qaBreaking=1` also rendered progressive cube cracks and all special-block samples.

## Performance

Skin texture and geometry remain shared and stable: one texture for the active appearance references, 14 geometry entries per model variant, no per-frame GPU resource construction. A fully layered player is about 13 draws plus a representative held item; 10 players are roughly 130–140 player draws and 25 roughly 325–350. One/tens are within the desktop alpha budget; 25 visible players requires native GPU soak before acceptance.

## Known issues

The full repository suite is not green on exact main or this integration on the Windows runner. The supplied skins still require owner rights/provenance approval. Native pointer-lock, landscape mobile and real two-visible-client visual acceptance are pending.

## Deferred

Appearance metadata/event, selector/custom PNG persistence, armor visuals, GPU batching/LOD and any server-side skin hosting.

## Next work

Run the owner manual camera/two-client/mobile checklist. After separate product approval, add a rare validated appearance metadata flow without changing tick snapshots.

## Git

- Branch: `cursor/player-skins-third-person`.
- Old PR HEAD: `b5875ab21a0c399cd08ce366f561d316eeb0f6a4`.
- Integrated main: `57724f6ed6d16fdec77664e74bae4061eeb84031`.
- Merge method: ordinary `git merge --no-ff origin/main`.
- Conflicts: five (`Game.ts` plus four project docs), all resolved semantically.
- Delivery: one merge commit pushed to the existing PR #31 branch; PR remains open Draft and is not merged.
