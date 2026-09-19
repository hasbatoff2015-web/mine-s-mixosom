# 2026-09-20 Merge latest main into entity-special-visual-fixes

## Goal

Synchronize `codex/entity-special-visual-fixes` with current `origin/main` via a normal merge (no rebase/force-push), keep both latest main gameplay and finished entity/special/minecart logic, then merge the verified feature into `main`.

## Result

Semantic union of `origin/main@5521d46` into the feature at `cf4da28`. Production third-person held items stay on main `thirdPersonHeldItem.ts` (`/moveitems`, sword/tool/axe). Feature minecart occupancy/controls, visual interpolation, rails/doors/seated QA, seated pose, and fire overlay remain. Feature history was not rewritten.

## Git before

- FEATURE_HEAD_BEFORE: `cf4da28608548339c2fd411997423a811d1a4ed6`
- MAIN_HEAD_BEFORE: `5521d46d373182e31faee15bf8a5acea14f47f41`
- MERGE_BASE: `6d2c79f63e5587030b00bfd726706efb8fbb3b44`
- Safety: local `backup/entity-special-visual-fixes-pre-merge` at feature HEAD
- Untracked left in place: `assets/minecraft/textures/entity/chest/event_chest.png`

## Conflicts

Real conflicts (no wholesale ours/theirs):

- `src/main.ts` — union: `/moveitems` first, then `qaSpecial=rails|doors|seated|lights`
- `src/rendering/player/PlayerVisual.ts` — main held-item API + feature seated/fire overlay
- `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/TESTING.md` — both chronologies

Auto-merged high-risk files reviewed: `server/WorldInstance.ts`, `server/gameplay.ts`, `src/core/Game.ts`, `src/net/RemotePlayerView.ts`, `src/rendering/ChunkMesher.ts`. Single `minecarts.update` + per-cart `controls`; seated + `onFire`; no duplicate interpolation/seat offsets.

## Tests

Focused 15 files / **170 PASS**. Isolated fire-contact W/S **PASS**. Full `tests/fire-contact-sunlight-minecart.test.ts` not run to completion (known host hang / lighting harness). `typecheck` ×4, `check:boundaries`, `build` PASS.

`git diff --check`: inherited trailing whitespace on three incoming main reports (`moveitems`, axe flip, sword-tool). No conflict markers.

## Architecture decisions

- One production third-person pose path: `thirdPersonHeldItem.ts`. Feature `THIRD_PERSON_ITEM_POSES` remains as catalog data; `PlayerVisual` does not apply both.
- Occupancy/control and visual interpolation stay on shared `MinecartManager`.
- CLIENT OWNS INTENT / SERVER OWNS RESULT unchanged.

## Deferred

Owner live two-client minecart QA. Feature branch is not deleted automatically.
