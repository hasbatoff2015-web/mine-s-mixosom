# Auction House → main merge

## Goal

Finish Auction House and merge `cursor/auction-house-a8dc` (PR #82) into `main` without rewriting teammate history.

## Result

`origin/main` had moved after the Auction branch base. Worldgen V2 (PR #83) was merged into the Auction branch first (`28b63be`). Auction is then merged into `main` with `--no-ff`.

## Teammate commits on main after Auction base

Merge-base with Auction: `d1a33d4` (`merge: stabilize player skin rendering`).

New on `origin/main`:

- `3b515fa` `feat: add snowy biome and cave deposits`
- `e4d43ff` `Merge pull request #83 from hasbatoff2015-web/codex/snowy-biome-cave-deposits`

Worldgen V2: biome `snowy_plains`, mixed forest trees, cave Gravel/Clay deposits, additive `WORLDGEN_VERSION = 2` (no `WORLD_SCHEMA_VERSION` bump).

## Overlap / conflicts

Both sides changed vs `d1a33d4`:

- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md` (auto-merged)
- `server/WorldInstance.ts` (auto-merged)
- `src/core/Game.ts` (auto-merged)

Auction-only files (`auction.ts`, `auctionGui.ts`, `itemTooltip.ts`, `style.css`, `protocol.ts`, EconomyService, tests) did not conflict.

Conflicts after `git merge origin/main` into `cursor/auction-house-a8dc`:

- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`

Resolution: keep both Worldgen V2 and Auction House / Economy sections. Code kept snowy spawn + `worldgenVersion` together with Auction/Economy wiring.

## Tests (after merging Worldgen V2 into the Auction branch)

- auction `tests/server/auction.test.ts`: **24/24 PASS**
- auction-plugin `tests/server/auction-plugin.test.ts`: **9/9 PASS**
- auction-gui `tests/auction-gui.test.ts`: **6/6 PASS**
- economy `tests/server/economy.test.ts`: **15/15 PASS**
- `test:server`: **41 files / 420 tests PASS**
- worldgen-v2 + world-snapshot: **2 files / 11 tests PASS**
- `typecheck` / `typecheck:client` / `typecheck:server` / `typecheck:sim`: PASS
- `check:boundaries`: PASS
- `npm run build`: PASS (production Vite build)

Live browser Anarchy QA was **not** run.

## Git

- Auction merge-in: `28b63be` `Merge origin/main into cursor/auction-house-a8dc`
- History preserved (no rebase, squash, reset --hard, or force push)
