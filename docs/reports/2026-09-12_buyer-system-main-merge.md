# 2026-09-12 — Merge Buyer System into main

## Goal

Merge `cursor/buyer-system-a8dc` (PR #86) into current `origin/main` with `--no-ff`, preserving teammate history.

## Result

- `origin/main` was still `5492846` (Clan System merge). No extra commits to merge into the buyer branch.
- Working-tree Buyer/hologram/PNG/cache-bust files were committed on the feature branch as `bdc7676` before the merge.
- `git merge --no-ff cursor/buyer-system-a8dc` produced `c4d0ca6`. No conflicts.
- Auction House, Economy, Worldgen V2 (PR #83), Clan System (PR #85), and Buyer NPCs all remain on `main`.
- `public/textures/player/skins/buyer_merchant.png` on `main` is the new 64×64 sheet, sha256 `69f4018a158b79b5ab6760b3a0609ff2e3cc080adb089ef885ffc0ad4796e850`. Live visual confirmation of that skin is deferred.

## Pre-merge gates

Four typechecks (`typecheck`, `typecheck:client`, `typecheck:server`, `typecheck:sim`) PASS. `test:server` **45 files / 470 tests PASS**. `check:boundaries` PASS. `npm run build` PASS.

## Git

Merge commit `c4d0ca6` on `main`. PR https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/86
