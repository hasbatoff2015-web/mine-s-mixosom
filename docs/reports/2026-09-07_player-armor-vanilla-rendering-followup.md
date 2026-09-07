# Player armor vanilla rendering semantics follow-up — 2026-09-07

## Goal

Correct two presentation-only semantics on `codex/player-armor-visuals`: invisibility must hide player skin but preserve worn armor and held items, and ordinary first-person must render no armor meshes. Keep third-person armor geometry/UV, authoritative equipment, networking and gameplay unchanged.

## Result

`PlayerVisual` now applies invisibility only to skin base/outer meshes. Armor visibility continues to be driven solely by equipped slots, while the held item remains visible. Because remote players use the same `PlayerVisual`, interpolated remote invisibility has identical behavior. `FirstPersonRenderer` no longer accepts equipment or constructs a chestplate sleeve; no helmet/body/leggings/boots/sleeve armor exists in its camera-space scene.

## Implemented

- Removed the invisibility-to-armor visibility call from `PlayerVisual.syncLayerVisibility()`.
- Preserved the existing held-item visibility path through invisibility transitions.
- Removed production equipment routing from `Game` and the player QA harness to `FirstPersonRenderer`.
- Removed the first-person armor resources, public `setArmor` integration and unused `FirstPersonArmorSleeve` helper.
- Added local false → true → false invisibility regression coverage with iron/diamond armor and a held item.
- Added remote interpolation coverage for invisible and visible-again skin with armor and held item retained.
- Replaced the old sleeve test with a full-set scene-graph regression requiring zero first-person armor objects.

## Changed files

- `src/rendering/player/PlayerVisual.ts`
- `src/rendering/FirstPersonRenderer.ts`
- `src/rendering/player/PlayerArmorVisual.ts`
- `src/core/Game.ts`
- `src/dev/PlayerQaHarness.ts`
- `tests/player-armor-visual.test.ts`
- `tests/remote-player-view.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/reports/2026-09-07_player-armor-visuals.md`

## Architecture decisions

The accepted third-person `PlayerArmorVisual` architecture is unchanged. This follow-up removes only the camera-space sleeve helper and routing. Equipment remains authoritative and continues to reach local third-person and remote views through their existing paths. No protocol, inventory, damage, movement, bow, consumable or mining behavior changed.

## Tests

- Focused armor/player run (6 files): **33/33 PASS**.
- `npm run typecheck`: PASS.
- `npm run typecheck:client`: PASS.
- `npm run typecheck:server`: PASS.
- `npm run typecheck:sim`: PASS.
- `npm run check:boundaries`: PASS.
- `npm run build`: PASS; 243 modules, JS 1,280.12 kB / 369.76 kB gzip, CSS 48.44 kB / 11.00 kB gzip.
- `git diff --check`: PASS; output contains only the repository's CRLF conversion advisories.

## Visual QA

The follow-up is covered by direct mesh-visibility and first-person scene-graph regressions. No new manual browser QA was required for this presentation-only correction.

## Performance

First-person construction no longer allocates armor geometry/material clones. Third-person shared caches and stable mesh sets are unchanged.

## Known issues

None introduced by this follow-up. Existing build warnings for `/sdk.js` bundling and the large main chunk remain unchanged.

## Deferred

None.

## Next work

No further armor rendering work is required for this follow-up.

## Git

- Starting HEAD: `24ecdd156dc55b2eb7847711d8d9b7097b6c8921`.
- Working tree intentionally remains uncommitted.
- No commit, push, merge, rebase or Git configuration change was performed.
