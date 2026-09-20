# Always-run WASD, Shift crouch, KeyC camera

## Goal

Make default WASD always run at previous walk speed × 1.25, bind Shift to the existing crouch with crouch speed × 1.25, keep jump-from-crouch and diagonal hypot normalization, and move the 1P/3P camera cycle from F5 to physical `KeyC`. Do not rewrite movement, crouch visuals/hitbox, or server-authoritative prediction.

## Result

Done in code. Speeds are derived from the previous constants, not invented. Client and server share `PlayerController` + `src/core/constants.ts`. F5 is unbound. Merge was not requested.

## Found speeds

| Role | Old value | New value |
| --- | --- | --- |
| Default ground WASD | `WALK_SPEED = 4.317` | `PLAYER_MOVE_SPEED = 4.317 × 1.25 = 5.39625` |
| Crouch/sneak | `SNEAK_SPEED = 1.295` | `SNEAK_SPEED = 1.295 × 1.25 = 1.61875` |
| Java 1.9 sprint leftover | `SPRINT_SPEED = 5.612` | unused for default WASD |
| Minecart cap | `WALK_SPEED × 1.5` | unchanged (`WALK_SPEED` stays 4.317) |

## Implemented

- `PLAYER_MOVE_SPEED_MULTIPLIER = 1.25`, `PLAYER_MOVE_SPEED`, `SNEAK_SPEED_REFERENCE = 1.295`.
- Ground speed: `sneaking ? SNEAK_SPEED : PLAYER_MOVE_SPEED`. No `SPRINT_SPEED` on WASD.
- Desktop Shift → sneak + fly descend. Desktop sprint key removed; touch sprint remains.
- Camera: `DESKTOP_CAMERA_TOGGLE_CODE = 'KeyC'` via `event.code`. F5 does nothing.
- Minecart dismount rising edge reads sneak (Shift), not KeyC/sprint.
- Prediction/diagnostics/hidden-tab/streaming probes that represented player travel now use `PLAYER_MOVE_SPEED`.

## Architecture decisions

- Keep `WALK_SPEED` as the historical Java 1.9 walk number so minecarts do not inherit the 1.25× player bump.
- Do not auto-set `this.sprinting` from WASD: that flag still drives FOV/bob/animation, which this pass must not change.
- Physical key: `event.code === 'KeyC'`, never `event.key === 'c'` / `'с'`.

## Changed files

- `src/core/constants.ts`, `src/player/PlayerController.ts`, `src/input/InputManager.ts`
- `src/core/Game.ts`, `server/WorldInstance.ts`, `src/entities/MinecartManager.ts`
- Prediction/diag/streaming: `predictionTimeline.ts`, `moveSimCompare.ts`, `hiddenTabMotion.ts`, `correctionDiagnostics.ts`, `streamingSim.ts`
- UI/docs: `src/ui/menuModel.ts`, `README.md`, `ThirdPersonCamera.ts` comment, `PlayerQaHarness.ts`
- Tests listed below
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, this report

## Tests

Focused set (recorded after the run):

```text
npx vitest run tests/player-physics.test.ts tests/lighting-physics-interaction.test.ts tests/third-person-camera.test.ts tests/player-main-integration.test.ts tests/menu-model.test.ts tests/prediction-timeline.test.ts tests/pred-isolation-matrix.test.ts tests/local-motion-pipeline.test.ts tests/correction-diag-dump.test.ts tests/hidden-tab-motion.test.ts tests/creative-flight.test.ts --maxWorkers=2
npx vitest run tests/fire-contact-sunlight-minecart.test.ts -t "binds dismount" --maxWorkers=1
npm run typecheck
npm run build
```

## Visual QA

Not run in a pointer-lock gameplay client this pass. Owner should confirm WASD always-run, Shift crouch+slow, jump while crouched, KeyC camera, F5 refresh-only.

## Deferred

Owner live Anarchy prediction QA at the new ground speed.

## Next work

Owner review; do not merge.

## Git

Branch `cursor/player-run-crouch-camera-d1a5`. PR created as draft. No merge.
