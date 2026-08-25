# Potion invisibility arm, effect HUD, screen particles

## Goal

On `cursor/fluids-and-items-pass-935a`, extend existing invisibility/regeneration potions without rolling back accepted fluids/lighting/fire/spawn work:

1. Hide the first-person player arm while invisibility is active.
2. Show a small bottom-right HUD for active potion effects with a real-time countdown.
3. Add a soft lower-screen swirl particle overlay from `public/textures/particle/particles.png`.
4. Keep invisibility at 3 minutes and set regeneration potion to 1 minute.

## Result

Implemented on the current cursor branch. Draft PR #6 stays draft. `main` was not merged. No force push. Existing fluid, lighting, fire overlay, hurt flash, mob flash, minecart, chat, and potion *logic* paths were not replaced.

## Implemented

### Invisibility hides the first-person arm

`FirstPersonFrameState.invisible` is set from `SurvivalSystem.invisible`. `FirstPersonRenderer` shows the Steve arm only when the main hand is empty **and** invisibility is off. Holding an item still hides the arm (previous behavior); the held item can remain visible. When the effect ends, the empty-hand arm returns.

### Effect HUD

`src/ui/effectHud.ts` builds chips from remaining ticks:

| Effect | Name | Icon | Duration |
| --- | --- | --- | --- |
| invisibility | Невидимость | `potion_invisibility` | 3:00 (`3600` ticks) |
| regeneration | Регенерация | `potion_regeneration` | 1:00 (`1200` ticks) |

`GameUI` renders `#effect-hud` at the bottom-right. One chip if one effect; vertical stack if both. Hidden when ticks reach 0. Countdown is `M:SS` via `ceil(ticks / 20)`. Golden apple regen (amplifier 1, 100 ticks) is unchanged and will also show a short Регенерация chip if active.

### Screen particles

`src/rendering/potionParticles.ts` samples the 8 swirl frames in `particle/particles.png` (16px tiles, row 8, columns 0–7). Up to 7 small additive quads rise from the lower view, keep `|x| ≥ 0.16` and tops ≤ −0.10 so the crosshair stays clear, max opacity 0.32 (much softer than the fire overlay at 0.76). Cooler tint for invisibility, warmer for regeneration.

### Durations

- `POTION_INVISIBILITY_DURATION_TICKS = 3600` (already 3 min)
- `POTION_REGENERATION_DURATION_TICKS = 1200` (was 900 / 45 s)

## Changed files

- `src/items/registry.ts`
- `src/rendering/FirstPersonRenderer.ts`
- `src/rendering/potionParticles.ts` (new)
- `src/ui/effectHud.ts` (new)
- `src/ui/GameUI.ts`
- `src/style.css`
- `src/core/Game.ts`
- `tests/potion-effects-hud.test.ts` (new)
- `tests/item-rendering.test.ts`
- `tests/content-pass.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`
- `docs/ROADMAP.md`
- `docs/reports/2026-08-25_potion-invis-hud-particles.md`

## Architecture decisions

- Extend existing potion/status-effect/first-person/HUD paths. No second inventory, overlay, or effect system.
- Particle overlay lives on the first-person scene (same place as the fire overlay), not on the bobbing arm root.
- HUD is DOM, matching the rest of GameUI; icons reuse `itemIconResolver`.
- Effects remain unsaved (reload still clears timers).

## Tests

Targeted: potion HUD/durations/particles, first-person arm hide, content-pass regen duration.

`npm run check`: typecheck, **535 tests / 58 files**, production **119 modules**, **1.16 MiB / 180 files**.

## Visual QA

Not run in-browser in this pass (no interactive play session). Please verify locally:

- Drink invisibility with empty hand → arm gone, swirl particles, HUD 3:00…; effect end restores the arm.
- Drink invisibility while holding an item → arm gone, item may remain, HUD + particles.
- Drink regeneration → HUD 1:00…, particles, no arm hide.
- Both potions → two stacked chips, countdown, particles until both end.
- Crosshair / center view stay readable; particles much weaker than fire overlay.

## Performance

Seven small camera-space planes, no remesh, shared atlas. HUD DOM updates only when chip HTML changes (10 Hz refresh already).

## Known issues / deferred

- Golden apple regeneration shares the Регенерация chip (same effect id).
- Potion particles are a shared overlay for both effects (tint only).
- Status effects still not serialized.
- No brewing stand.

## Next work

Local playtest of the four visual checks above. Keep PR #6 draft.

## Git

Branch `cursor/fluids-and-items-pass-935a`. See commit after push.
