# 2026-09-09 — Death drop scatter 3× and spatial world_sound

## Goal

Widen Online death-item scatter ~3× on X/Z, and stop `bow.shoot` / `item.pickup` playing when the local player did not shoot or pick up.

## Result

Death scatter multiplier is an explicit constant on the existing `scatterDeathDrop` path. World sounds are spatial and interest-filtered; catalog local profiles are unchanged for SP `playLocal`.

## Implemented

1. `DEATH_DROP_SCATTER_MULTIPLIER = 3` on origin span (0.5 → 1.5, ±0.75) and horizontal velocity (1.4 → 4.2, ±2.1). Vertical toss stays 2.2.
2. `worldSoundPlayOptions` forces `positional: true` for every `world_sound` packet.
3. `WorldInstance` sends `world_sound` per listener inside `worldSoundMaxDistance`, not `broadcast`.

## Root causes

**bow.shoot:** not jump/prediction/animation. Server emit on real `releaseBowWithAim` was correct. `WorldInstance.broadcast` + catalog `positional: false` played every shot on the map as a local one-shot. Rare while running because it needed someone (including yourself earlier, or another player) to actually fire that tick.

**item.pickup:** same path. RTP did not fake a pickup from snapshots. After teleport you still received global non-positional pickup packets from collects anywhere on the server that tick (often spawn). Entity snapshots still use `pickupDelaySeconds: 999` and never play SFX.

## Tests

`tests/random-source.test.ts`, `tests/world-sound-events.test.ts`, `tests/server/world-sound-events.test.ts`, death scatter assertions in `tests/server/online-gameplay-polish.test.ts`.

## Git

Branch `cursor/online-gameplay-polish-5fe9`
