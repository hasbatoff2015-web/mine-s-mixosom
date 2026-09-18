# 2026-09-18 Totem particle spread / quieter sound

## Goal

On `codex/utility-items-v1` only: make the accepted Totem burst travel about twice as far, spawn more smaller particles with a slight upward lift, and halve `totem.activate` gain.

## Result

Done. Bed occupancy/rest/icons and Totem protocol/HUD/AudioManager architecture were not changed.

## Implemented

- Burst count `28 → 48`; spawn radius unchanged (`0.16` / `0.26`); speed `1.15` / `1.55` → `2.3` / `3.1`.
- Pitch min `0.18 → 0.26`; extra Y `0.45–1.00 → 0.72–1.42`. Lifetime still `0.55–0.9`. Palette unchanged.
- `PointsMaterial.size` `0.08 → 0.05`. Cap remains 4 bursts (192 points).
- Catalog volume `0.45 → 0.225`; `startOffsetSeconds = 0.7`.

## Changed files

- `src/gameplay/totemBurst.ts`, `src/rendering/TotemParticles.ts`, `src/audio/soundCatalog.ts`
- `tests/totem-burst.test.ts`, `tests/audio-sfx.test.ts`
- docs: `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `TESTING.md`, this report

## Architecture decisions

Speed, not spawn radius, is the spread control. Extra Y is additive so first-person vs remote horizontal velocity still scales exactly with the speed constants.

## Tests

Focused: **3 files / 50 tests PASS**. `typecheck`, `typecheck:client`, `typecheck:server`, `check:boundaries`, `build`, `check:size`, `check:archive` — PASS. Production **4.39 MiB / 368 files**.

## Visual QA

Not run as live two-client PvP in this pass.

## Performance

192-point cap, one Points object.

## Deferred

Live two-client spread/volume QA.

## Git

Branch `codex/utility-items-v1` only.
