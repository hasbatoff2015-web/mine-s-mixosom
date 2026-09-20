# Fixed player speeds: run 7 / crouch 2

## Goal

Replace the previous walk×1.25 derived speeds with literal `PLAYER_MOVE_SPEED = 7` and `SNEAK_SPEED = 2`. Keep always-run WASD, existing crouch mechanics, diagonal hypot, KeyC/F5, and minecart `WALK_SPEED`.

## Result

Done. Multiplier constants removed. Client and server still share `src/core/constants.ts` via `PlayerController`.

## Speeds

| Role | Previous (this PR) | New |
| --- | --- | --- |
| Default WASD / always-run | `4.317 × 1.25 = 5.39625` | `7` |
| Crouch | `1.295 × 1.25 = 1.61875` | `2` |
| Minecart cap | `WALK_SPEED × 1.5` (`4.317`) | unchanged |

Removed: `PLAYER_MOVE_SPEED_MULTIPLIER`, `SNEAK_SPEED_REFERENCE`.

## Changed files

- `src/core/constants.ts`
- `tests/player-physics.test.ts`
- docs + this report

`PlayerController` already reads the shared constants; no mechanic change.

## Tests

```text
npx vitest run tests/player-physics.test.ts tests/local-motion-pipeline.test.ts tests/prediction-timeline.test.ts tests/pred-isolation-matrix.test.ts tests/correction-diag-dump.test.ts tests/hidden-tab-motion.test.ts tests/minecart-controls.test.ts tests/move-sim-compare.test.ts tests/creative-flight.test.ts --maxWorkers=2
```

- player-physics **14/14** (`PLAYER_MOVE_SPEED === 7`, `SNEAK_SPEED === 2`, crouch stance, jump, hypot, `MINECART_MAX_SPEED = WALK_SPEED×1.5`)
- local-motion-pipeline **8/8**
- prediction-timeline **8/8**
- pred-isolation-matrix **9/9**
- correction-diag-dump **10/10**
- hidden-tab-motion **9/9**
- minecart-controls **13/13**
- move-sim-compare **6/6** (client/server lockstep)
- creative-flight **9/9**

`npm run typecheck` PASS. `npm run build` PASS (300 modules).

## Git

Branch `cursor/player-run-crouch-camera-d1a5`. PR #98. No merge.
