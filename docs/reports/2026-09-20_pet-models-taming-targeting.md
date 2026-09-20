# Pet models, deterministic taming, and rendered melee

## Goal

Fix five audited bugs on `codex/wolves-cats-pets` without rewriting mobs/combat or weakening reach/LOS: missing wolf torso, cat legs through the back, silent RNG taming, moving-pet LMB misses, and undersized targeting AABB.

## Starting HEAD

`717c5ac55375ef5737edf6b9fdbe7ae08a3c81da` on `codex/wolves-cats-pets`.

## Result

Wolf body meets the head, cat legs stay under the torso, taming is exactly three accepted feeds with chat/toast progress, online melee rewinds the hinted mob pose, and targeting uses a shared yaw-aware volume that is larger than physics `width/height` for wolf/cat only.

## Implemented

### Visual

- Wolf body stores `rotation = [-π/2, 0, 0]` so the shared Y-down adapter applies `+π/2` and the asymmetric `addBox` extrudes toward the head. Mane/collar keep vanilla `+π/2` so the collar stays on the shoulders.
- Wolf body `faceUvRects.top` remaps the empty vanilla island `(24,14)` to the painted underside `(30,14)`.
- Cat body origin Z `-8 → -4` so `Rx(-π/2)` places the sausage on the chest instead of under the shoulders.
- Cat sitting hind-leg angle is `+π/2` in legacy space (the previous `-π/2` double-negated through the adapter). Walk swing uses `legacyRotationToThree` and is capped at `0.55`.

### Taming

- Removed `PET_TAME_CHANCE`. `PET_TAME_REQUIRED_FEEDS = 3`. Each valid feed succeeds.
- `MobEntity.tameProgress` / `tameProgressPlayerId` (0..2, one candidate). A different player resets progress to `1/3`.
- Limit/capacity checked before any feed. Creative feeds do not consume. Survival consumes exactly one accepted item per step.
- SP toast + Anarchy system chat: `Волк/Кот: приручение 1/3`, `2/3`, then `приручён.`
- Serialized on the existing `SerializedMob` path.

### Targeting / melee

- Shared `mobTargetBounds` / `raycastMobTarget` for client render raycast, `entity_use`, and mob melee rewind.
- Online LMB captures `targetId` + `targetRenderTick` from `raycastRendered` for mobs the same way as remote players.
- Server pending melee target is `player | mob`. Rewind is hit-test only; damage applies to the live entity via existing `CombatSystem`.
- `MAX_MOB_REWIND_TICKS` stays 5 (`ENTITY_INTERP_DELAY_MS = 80` fits).
- Physics `MobDefinition.width/height` unchanged (`wolf` 0.6×0.85, `cat` 0.6×0.7).

## Changed files

Client/sim: `petConstants.ts`, `petTaming.ts`, `petPoses.ts`, `mobModels.ts`, `MobManager.ts`, `mobTargetBounds.ts`, `index.ts`, `Game.ts`, `petLimit.ts`, `gameplay/index.ts`, `MobQaHarness.ts`, `main.ts`.

Shared/server: `playerActions.ts`, `gameplay.ts`, `WorldInstance.ts`.

Tests/docs: `pets.test.ts`, `pets-anarchy.test.ts`, `visual-models.test.ts`, `pet-textures.test.mjs`, `melee-action-intent.test.ts`, `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `TESTING.md`.

## Architecture decisions

- CLIENT OWNS INTENT / SERVER OWNS RESULT. Client never writes `tameProgress` or damage.
- One candidate player, not a per-player map. New feeder becomes `1/3`.
- Targeting bounds are ray-only. Collision/separation still uses definition AABB.
- Wolf rotation compensation is pet-local. The global legacy adapter is unchanged.

## Tests

Exactly-three wolf bones; all six cat meats plus mixed meats; two-player reset; creative no consume; persist/clamp; muzzle vs 0.6 AABB; moving rendered melee hit + knockback on current pose; stale/future/occluded/reach/dead; wolf head–torso continuity + UV coverage; cat legs under torso stand/±walk/sit.

## Visual QA

DEV `?qaMob=` on `http://localhost:4173`:

Wolf: side (torso continuous), front, rear, three-quarter, sitting, tamed (collar on shoulders).

Cat: side walking, `walkPhase=1.57` / `4.71`, sitting, three-quarter, front, rear. Legs stay under the body.

## Performance

No new per-frame systems. Pose history and rewind window unchanged.

## Known issues

Sitting cat is grounded but still a coarse ocelot sit. Wolf tail is a thin cuboid. Collar is the inflated mane overlay, not a separate ring.

## Deferred

Breeding, names, dye, ocelot gameplay.

## Next work

Owner live two-client QA of 3-click tame feedback and moving-pet LMB.

## Git

Follow-up commit on `codex/wolves-cats-pets`. No merge to `main`.
