# Merge origin/main into sword-blocking PR #99

Дата: 2026-09-21  
Ветка: `cursor/sword-blocking-animation-7e91`  
Не force-push.

## Goal

Перед merge PR #99 подтянуть актуальный `origin/main` (`cd8ecf3`), сохранить sword-use animation и новые commits main.

## Result

Semantic merge `origin/main` в PR-ветку. Код автослился. Конфликты только в docs: сохранены оба прохода.

## New commits on main since PR base `9b8f785`

World events + event chest, reconnect overlay, persistence/streaming races, always-run WASD / Shift crouch / KeyC camera, `PLAYER_MOVE_SPEED = 7` / `SNEAK_SPEED = 2`. Merge commits #98 and world-events.

## Conflicts

- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/TESTING.md`

Разрешено: sword-blocking секции сверху, затем секции main. Маркеры удалены.

Автослияние без конфликта: `src/core/Game.ts`, `tests/player-main-integration.test.ts`, `docs/ARCHITECTURE.md`. `syncLocalCombatUse` и KeyC camera оба на месте.

## Git

Merge commit on the PR branch after this report. Do not force-push.
