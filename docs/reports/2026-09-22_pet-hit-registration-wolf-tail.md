# Pet hit registration, wolf tail, /spawnpet

## Goal

Fix remaining owner live-QA pet failures on `codex/wolves-cats-pets` without merging main: unreliable mob hit / Bone RMB, wolf tail hanging between the rear legs, and cats that are too rare to find during QA.

## Starting HEAD

`89312bf12e13d4f4fa186ca8633cf7cd983b5c02` on `codex/wolves-cats-pets`. Observed `origin/main`: `5d972cfc9c9bcdb407d0eccc61f1a3b89c74515c`. Feature branch was not synchronized with main.

## Result

Click rays for sequenced melee and `entity_use` use captured `action.yaw/pitch` with command-boundary eye position. `entity_use` freezes the target pose at packet receive like melee. Mob rewind is 8 ticks (400 ms); PvP rewind stays 5. Targeting AABB unions visual core with ± physical width/2. Wolf tail uses a Minecraft-like legacy pose through `legacyRotationToThree`. Operator `/spawnpet <wolf|cat>` exists for QA. Shared 3-feed taming was not rewritten.

## Implemented

- Click-time aim for sequenced LMB and pet RMB; server still raycasts.
- Receive-time `PendingEntityUse` freeze (`receivedServerTick` + rewind or live pose).
- `MAX_MOB_REWIND_TICKS = 8`; `MOB_POSE_HISTORY_TICKS = 16`; `MAX_PVP_REWIND_TICKS = 5`.
- Targeting-only union with `MobDefinition.width`; physics width/height unchanged.
- Wolf tail wild / angry / tamed-health / sitting pitch; lateral wag on legacy Y.
- Operator `/spawnpet` + `/petspawn`; player-only; `{ force: true }`; wild spawn.
- DEV `action_result.entityUse` + F3 `PetUse` line.

## Changed files

- `shared/playerActions.ts`, `shared/protocol.ts`
- `server/WorldInstance.ts`, `server/gameplay.ts`, `server/AnarchyServer.ts`
- `src/core/Game.ts`
- `src/entities/mobPoseHistory.ts`, `src/entities/mobTargetBounds.ts`, `src/entities/petPoses.ts`, `src/entities/EntityHost.ts`, `src/entities/MobManager.ts`, `src/entities/ThreeEntityHost.ts`
- `src/dev/MobQaHarness.ts`
- `tests/pets.test.ts`, `tests/visual-models.test.ts`, `tests/melee-action-intent.test.ts`, `tests/mob-pose-history.test.ts`, `tests/server/pets-anarchy.test.ts`, `tests/server/pet-hit-registration.test.ts`, `tests/server/spawnpet-command.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, this report

## Architecture decisions

CLIENT OWNS INTENT / SERVER OWNS RESULT is unchanged. Command-boundary pose owns eye XYZ, slot, movement, alive/dead. Action packet owns click yaw/pitch, `targetId` hint, `targetRenderTick` hint. Server proves the ray against the frozen/rewound AABB, reach, current-world LOS, inventory and taming. Player `controller.yaw/pitch` is not mutated to the click look. `targetId` is never accepted without a ray. Entity_use does not rewind the live mob and does not re-age the pose after FIFO wait.

## Tests

Focused suite (12 files): **171/171 PASS**.

Typecheck / client / server / sim / `check:boundaries` / `build` / `git diff --check`: PASS.

New tests that fail on `89312bf` (command look used for the ray; entity_use rewind at resolve tick): click-aim vs command-look LMB/RMB, inverse miss, pending entity_use after several wait ticks, `MAX_MOB_REWIND_TICKS === 8`.

## Manual QA

- Automated focused suite: PASS (171/171).
- qaMob `?qaMob=wolf&view=side|three-quarter&petState=wild` on local Vite: tail is behind the rump, not hanging vertically between the rear legs. Screenshot framing was a portrait crop of the canvas, but the visible tail direction is rearward.
- Live Anarchy `/spawnpet`, Bone/meat taming, moving hits, and network-throttled RTT: **MANUAL LIVE QA NOT PERFORMED** (no Anarchy server session in this environment).

## Git

Remain on `codex/wolves-cats-pets`. No merge/rebase/force-push.
