# Merge unknown-block compat into Main Menu visual

## Goal

Bring PR #90 (`cursor/unknown-block-compat-31b4`) onto `cursor/main-menu-visual-31b4` so worlds with unregistered voxel ID 165 load, without dropping the Main Menu visual restyle.

## Result

Ordinary merge from merge-base `41bb511`. Menu chrome and unknown-ID placeholder both present. No new placeholder implementation.

## Conflicts

Only docs: `PROJECT_STATE.md`, `ROADMAP.md`, `TESTING.md`. Both feature sections kept. Code (`registry.ts`, `World.ts`, `LightEngine.ts`, tests) merged cleanly.

## Tests

Recorded after the merge commit in this report’s Git/Tests section.

## Git

Merge `origin/cursor/unknown-block-compat-31b4` into `cursor/main-menu-visual-31b4`. No rebase, no force push, no merge to `main`.
