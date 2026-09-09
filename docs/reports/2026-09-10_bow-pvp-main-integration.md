# Bow PvP integration into current main

Date: 2026-09-10

Feature branch: `codex/bow-pvp-timeline-v2`

## Goal

Integrate the published bow PvP timeline and release-boundary fix with the latest main without losing either line's behavior, then deliver the integrated feature branch and main without rebasing or force-pushing.

## Inputs

- `origin/main`: `27778cf31795ca8454a5a6384092658b20ede067`
- `origin/codex/bow-pvp-timeline-v2`: `fef667762d86443f00e39fae30ad27f808f24d80`
- merge-base: `eb82417b70fb81932c6ba140b9a809b456d52dec`
- divergence before merge: 18 main-only commits, 4 feature-only commits

## Result

Current main and the complete bow timeline coexist. The feature still captures release intent on the render edge and resolves it against the actual last-sent input state; the server still resolves exact authoritative command boundaries, freezes release draw state, validates render timeline at receive time and catches projectiles up through the canonical physics kernel.

Main's AutoMine, hologram editor/background/timer/text quality, online death/respawn and scatter, spatial world sounds, appearance selector/sync/nameplates, diagnostics, networking and tests remain present. No bow balance, hitbox or damage tuning changed.

## Conflict resolution

| File | Feature side retained | Main side retained | Integrated decision |
|---|---|---|---|
| `server/gameplay.ts` | `CombatActionDiagnostics`, `combatPoseHistory`, `BowReleaseBoundary`, historical arrow options | `WorldSoundEvent`, death loot state, combat/minecart sounds | Combined fields/imports; canonical historical arrow options also emit main's player-hit sound; sequenced spawn emits one `bow.shoot` event. |
| `src/net/RemotePlayerView.ts` | `lastRenderedPose` and read-only `lastRenderTick` | appearance, nameplate, invisibility and dead-edge animation state | Both state machines and public consumers remain active. |
| `docs/ARCHITECTURE.md` | melee/bow ownership and timeline sections | hologram, online polish, sound and appearance architecture | Preserved both histories and added this integration decision. |
| `docs/PROJECT_STATE.md` | bow/melee handoff state | current main feature state | Preserved both and added a current integration summary. |
| `docs/ROADMAP.md` | bow/melee completed work | main plugin/hologram/polish work | Preserved all entries. |
| `docs/TESTING.md` | bow/melee gates | main feature gates | Preserved all commands/contracts and recorded the combined gate. |

## Bow invariants retained

- Client owns aim/timeline intent; server owns origin, draw/charge, collision, damage and result.
- After sent `N/use=true`, release references `N+1`; after sent `N/use=false`, release references `N`.
- Render release does not mutate `online.inputSeq` or synthesize an input command.
- `MAX_PVP_REWIND_TICKS = 5`, `MAX_PENDING_BOW_TICKS = 8`, `COMBAT_HISTORY_TICKS = 20`.
- Origin is authoritative post-physics boundary eye plus muzzle offset `0.35`; direction is captured release yaw/pitch.
- Pending wait does not grow charge. Catch-up is stepwise whole-segment canonical arrow physics with historical player AABB and current voxels.
- Existing `projectileHit`, Claims/plugins, armor, blocking, HurtResistance, knockback, FireArrow, attacker attribution and death pipeline remain shared.

## Main invariants retained

- AutoMine remains a builtin PluginManager plugin with its batched reset/service path.
- Hologram editor, styles, backgrounds, timer and fixed orientation remain on the existing network/plugin/renderer path.
- Online death is explicit-respawn, one-shot loot scatter; remote death pose, appearance and nameplates remain active.
- `world_sound` stays spatial and interest-filtered; successful sequenced bow release emits exactly one authoritative `bow.shoot`.
- Existing main tests and documentation were retained rather than replaced by feature versions.

## Tests

- Targeted integration: 28 files, 259/259 tests PASS.
- Shared simulation: 12 files, 65/65 tests PASS.
- `typecheck`, `typecheck:sim`, `typecheck:client`, `typecheck:server`: PASS.
- Import boundaries: PASS.
- Production build: PASS with established `/sdk.js` and chunk-size warnings.
- Size/archive: PASS, 4.14 MiB and 353 files.
- Conflict marker scan and `git diff --check`: PASS.
- Full suite: 212/216 files, 2016/2033 tests PASS.

## Full-suite baseline failures

- `minecraft-reference-extractor.test.mjs`: unchanged parse failure.
- `worldgen-terrain.test.ts`: two existing 5-second CPU timeouts, reproduced alone.
- `fire-contact-sunlight-minecart.test.ts`: load-sensitive 5-second timeouts, reproduced alone.
- `server/tick-load-flight.test.ts`: existing `<80 ms` maximum threshold miss; isolated samples were 102–150 ms.

No test timeout or performance threshold was relaxed, and none of these files is modified by the bow feature or conflict resolution.

## Visual QA

The user explicitly confirmed before integration that live bow release/spawn now works. This merge changed no input feel, projectile tuning or rendering path, so that acceptance remains the live gate; automated integration tests cover the merged code paths.

## Performance

The merge adds no new per-tick bow system. Timeline storage remains bounded, pending queues retain their caps, and compensated catch-up uses the existing canonical step loop. Production archive remains well below the platform limit.

## Known issues

- Full-suite baseline timeout/performance/extractor failures remain as listed above.
- Live two-client moving-target/latency matrix remains useful future PvP acceptance, but release/spawn reliability has already been accepted by the user.

## Deferred

- No rebalance, alternate damage pipeline, new protocol, matchmaking or unrelated feature work was included.

## Next work

Monitor bow diagnostics after main integration. Address baseline CPU/extractor tests in dedicated tasks rather than weakening their assertions during this merge.

## Git

The feature integration is a normal merge of main into `codex/bow-pvp-timeline-v2`, followed by integration of that branch into main. No rebase, amend, force push or history rewrite is used.
