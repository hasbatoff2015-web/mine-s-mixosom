# Claim-anchor blocks

## Goal

Add iron, gold and diamond **block-claims** to the existing Anarchy Claims plugin. Placing the block creates a cuboid region. Breaking the stored anchor cell deletes that claim. No second protection system.

## Result

Implemented. `diamond_block` keeps id `149`. New `gold_block` (`159`) and `iron_block` (`160`). User pixel-art sheets were nearest-mode downsampled to 16×16 (sources were large chat-scaled PNGs, not native 16×16 files).

## Implemented

- Registry + Russian names «Алмазный блок» / «Золотой блок» / «Железный блок».
- Shaped 3×3 recipes from `diamond` / `gold_ingot` / `iron_ingot`.
- `Claim.anchor?: { x, y, z, block }` and `ClaimStore.blockClaimSeq`.
- Place → `blockPlace` overlap deny + `blockPlaced` create. Break → `blockBroken` lookup by stored coords.
- Radii: iron 10, gold 20, diamond 30 on X/Z; Y `MIN_WORLD_Y…MAX_WORLD_Y` (0…255).
- Block-claim ∩ block-claim always denied (own/foreign/priority ignored). Regular `/claim create` overlap unchanged.
- Per-owner names `"1"`, `"2"`, …; deleted numbers are not reused.
- `/claim info` adds Type / Anchor / Radius when `anchor` is set.
- Flags `{}` so current `DEFAULT_CLAIM_FLAGS` apply (`pvp` false, `block-break`/`block-place` false, …).

## Changed files

- `src/blocks/types.ts`, `src/blocks/registry.ts`, `src/i18n/ru.ts`, `src/crafting/recipes.ts`
- `src/world/import/blockMapper.ts`, `scripts/import-assets.mjs`
- `public/textures/block/{diamond,gold,iron}_block.png`
- `server/services/claims.ts`, `server/services/claimAnchors.ts`, `server/builtin-plugins/claims.ts`
- Tests: `tests/server/claim-anchors.test.ts`, `tests/server/claim-anchor-blocks.test.ts`, `tests/claim-anchor-textures.test.mjs`, plus crafting/registry/anarchy-plugins
- Docs: `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `PLUGINS.md`, `TESTING.md`

## Architecture decisions

- Helpers live in `server/services/claimAnchors.ts`; only the Claims plugin wires events. Same `ClaimStore` / `/claim` commands / owner key `name.toLowerCase()`.
- Create after successful place (`blockPlaced`). Pre-check on `blockPlace` plus a race re-check that `setBlock(Air)`s and returns the item in survival.
- Do not scan the world for leftover mineral blocks on load. Old claims without `anchor` stay ordinary regions.
- Inclusive AABB: two irons 20 apart on X share a plane and are denied; 21 apart is allowed.

## Tests

Unit: radii, inclusive overlap, sequence, migration. Anarchy: radii/flags/names, foreign deny, owner break of one anchor, leftover `/claim delete`, overlap deny including own diamond vs iron, iron inside own regular claim, regular overlay create, restart without dupes, reconnect, OP break, survival race rollback.

## Visual QA

Not a client gameplay pass. Textures are 16×16 RGBA with distinct cyan / yellow / gray palettes. Atlas already nearest-scales any tile to 32px.

## Performance

No extra tick work. Overlap is a linear scan of the existing claim list, same as `claimsAt`.

## Known issues

- TNT / `ExplosionQueue` voxel destroy does not emit `blockBroken`. Default `explosions: true` can remove the physical anchor and leave a ghost claim until `/claim delete`.
- `/claim admin delete <name>` still deletes every claim with that name (pre-existing, now more visible because many players share `"1"`).

## Deferred

- Explosion-destroyed anchors.
- Reverse recipes (block → 9 ingots).
- Owner live two-client Anarchy QA.

## Next work

Owner QA on a live Anarchy server: craft, place three radii, overlap deny, two players, restart, OP break.

## Git

Branch `cursor/claim-anchor-blocks-3f93` from `origin/main`.
