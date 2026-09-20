# Merge origin/main into always-run / KeyC (PR #98)

## Goal

Bring world-events `origin/main` (`6447556`) into `cursor/player-run-crouch-camera-d1a5` without dropping player speeds 7/2, KeyC camera, or the other developer's event work.

## Result

Semantic merge. Code conflicts: none. Docs conflicts: four files, both sides kept.

## Conflicts

| File | Resolution |
| --- | --- |
| `docs/PROJECT_STATE.md` | Both latest passes |
| `docs/ROADMAP.md` | Both latest passes |
| `docs/ARCHITECTURE.md` | Both latest passes |
| `docs/TESTING.md` | Both latest passes |

Auto-merged: `server/WorldInstance.ts`, `src/core/Game.ts`, `tests/hidden-tab-motion.test.ts`.
