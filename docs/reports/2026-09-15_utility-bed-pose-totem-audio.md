# Utility Items: bed pose and Totem audio admission — 2026-09-15

## Goal

On `codex/utility-items-v1`, correct the player lying face-down and hovering above the bed, and make the existing one-shot Totem sound reliable when combat voices saturate or a sample load fails temporarily. Keep the existing authoritative bed position, server sound routing, bed UV, Firework, Sign, Book and combat rules. Do not merge into `main`.

## Result

The canonical player rig now lies face-up on the mattress with its head at the pillow for north/east/south/west. A Totem activation can displace a lower-priority combat voice within the same full bus, and transient sample failures can be retried after bounded backoff. Per-event debug drops identify why playback was rejected. The automated owner sequence starts Totem exactly once. **The requested live two-client audible 10+5 activation series has not been performed; audio acceptance remains open.**

## Implemented

- The old `lies face-up` test used local `+Z`, which is the model's **back** (`front = -Z` in `TexturedCuboid`). It therefore asserted back-up/face-down and passed the bad `rotation.x = -π/2`. The test was corrected first and failed in all four facings on the old implementation. `PlayerVisual` now uses `+π/2`; its front transforms to world `+Y`, back to `-Y`. Adding `π` to bed yaw retains head toward bed head/pillow and feet toward foot in every facing.
- `bedRestPosition` still returns `rest.y + 0.81`. The player visual alone uses `restPoseRoot.position.y = 9/16 + 2*(1.8/32) + 0.01 - 0.81 = -0.125`: mattress top plus torso half-depth and small clearance, relative to the authoritative anchor. The torso bottom is about `0.01` above the mattress; the deeper head may enter it by about `0.1025`, avoiding a floating torso. Rest-root rotation and position return to zero on exit.
- Old combat owner state: `player.hurt` (priority 8) and `combat.hit` (7) already occupy two voices, while incoming `totem.activate` (9) has combat `maxConcurrent = 2`. The former admission rule stole a bus voice only for priority `>=10`, so Totem was silently rejected despite being the strongest. New admission compares incoming priority with the **lowest active voice of that bus** when it is full, and steals only a strictly weaker one. Global saturation uses the lowest global voice. The oldest matching minimum breaks ties. No extra server event or `totem_activate` local sound fallback was added.
- HTTP 404/410 and confirmed corrupt encoded data (`EncodingError`/`DataError`) remain permanent missing assets. Network exceptions, HTTP 408/429/5xx and other temporary fetch/decode errors record `failureCount`, `lastFailureAt` and `nextRetryAt`, with delay from 250 ms to 30 s. The next real play after backoff retries; successful fetch/decode clears the transient state. In-flight fetch/decode deduplication and the first async one-shot path remain intact.
- `AudioDebugSnapshot` exposes bounded `recentDrops` (24 records) with event/file, reason, context state, bus count/limit and priority, plus `permanentMissingFiles` and `transientFailures`. Existing `missingFiles` stays as a permanent-only compatibility field. Drops include mute, pause, zero volume, stopped AudioContext, distance, bus/global admission, permanent/transient asset, pending cap and playback failure. `recentPlays` is recorded after actual `source.start()`.

## Changed files

- Bed pose: `src/rendering/player/PlayerVisual.ts`, `src/world/bed.ts`, `tests/player-visual-animation.test.ts`.
- Bed visual probe: `src/dev/BedQaHarness.ts` (`/?qaBed=1&pose=1&facing=north|east|south|west`, optional `model=slim&armor=1&held=1&offhand=1`). The production bed mesh/UV is unchanged.
- Audio: `src/audio/audioMath.ts`, `src/core/AudioManager.ts`, `src/core/Game.ts` (DEV audio overlay diagnostics), `tests/audio-sfx.test.ts`.
- Handoff: `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, this report.

## Architecture decisions

Bed gameplay and network state keep their prior anchor and prediction/reconciliation paths. All pose changes sit inside the existing `PlayerVisual` rest transform shared by local and remote presentation, Classic/Slim, armor and held items. Audio keeps the existing catalog, `AudioManager` voice list, one authoritative `world_sound` and bounded pending starts. No second player renderer, sound manager or protocol was introduced.

## Tests

- Focused bed/player/audio/utility/server authority: **6 files, 111/111 passed** after the final test edit. The exact owner test leaves `player.hurt` and `combat.hit` active, requests one `totem.activate`, verifies exactly one source start, `combat.hit` was stopped, hurt remains, active combat voices stay at 2, Totem appears in `recentPlays`, and no Totem rejection is in `recentDrops`. The nearby `combat.hit → totem.activate` case starts once; a lower-priority incoming sound against two active Totems is rejected as `bus_saturated` with expected diagnostics. Transient HTTP 503 during **preload** leaves the Totem file retryable; an actual play during backoff is diagnosed, the next play after injected clock backoff succeeds once, clears failure and uses cache afterward. HTTP 404 does not retry.
- `test:sim`: **12 files, 66/66 passed**. All four typechecks (`typecheck`, client, server, sim), `check:boundaries`, `build`, `check:size`, `check:archive`, `smoke:sim` and `smoke:server` passed. Production output: **4.39 MiB / 367 files**.
- `test:server`: **45 files passed, 2 failed; 489/491 tests passed**. `tick-latency` exceeded its 50 ms host-load threshold (95.33 ms) in the concurrent run; it passed when rerun alone. `tick-load-flight` exceeded its 80 ms threshold (173.57 ms in the broad run, 121.80 ms isolated). This unchanged CPU-sensitive baseline is already recorded in `docs/PROJECT_STATE.md`; no server tick/load code changed in this follow-up.
- Full `npm test -- --maxWorkers=2 --silent --reporter=dot` was **not green**: 233 files passed, 5 failed; 2275/2293 tests passed, 18 failed, with one Vitest worker timeout error. Failure groups were the already known reference-extractor syntax error, Windows CRLF expectations in `chat-layout`, 5-second timeouts in unchanged fire/minecart and worldgen tests, and the `tick-load-flight` <80 ms host performance threshold. None of those files was changed. The full run preceded the final preload-specific regression edit; the 111 focused tests and `typecheck` were rerun afterward and passed. It is not claimed as a passing full suite.

## Visual QA

- Browser dev scene with the real `ChunkMesher`, atlas and `PlayerVisual`: north/east/south/west inspected. In all four views, face/chest were up, head stayed at pillow, torso rested at mattress height and feet stayed at foot. Slim with iron armor, apple mainhand and Totem offhand inspected in the north scene; the objects remained attached.
- Browser `/?qaAudio=1` fetched `totem-sound.mp3` with HTTP 200, decoded all 27/27 catalog buffers and showed a nonzero sample RMS (`0.1809`). One parsed `world_sound` packet reached a running `AudioContext` with one `recentPlays: totem.activate`, one active voice, no missing/permanent/transient files and no `recentDrops`. This confirms browser sample start, not a two-client audible series.
- Exit to standing and remote client state were covered by geometry/transform and presentation tests, **not** by an interactive two-client bed run.
- Real Anarchy **10 owner+nearby Totem activations plus 5 after owner restart were not run**. No human audibility claim is made. The automated owner/nearby admission tests confirm `source.start()` counts and server delivery, not physical sound output on two devices. If one live activation is silent, inspect `audioDebug` `recentDrops`, `recentPlays`, permanent/missing files, transient failures and `contextState` before accepting.

## Performance

The rest offset is a single transform on the existing rig. Audio priority scanning uses the bounded active voice list; pending starts remain capped at 64 and diagnostic histories at 24 records. Transient retry is event-driven with a maximum 30-second delay, not a background polling loop. Production archive remains far below 100 MB.

## Known issues

Live two-client audible QA is the acceptance gap. The full server load threshold can fail on this host independently of these changes. Vite still prints its existing `/sdk.js` non-module and large JS chunk warnings while succeeding.

## Deferred

No bed physics/camera/prediction/UV changes; no local Totem sound fallback, second world sound, PvP/bow, Firework, Sign, Book or inventory redesign. Do not merge to `main` until the user accepts the pending live QA.

## Next work

In two nearby Anarchy clients, trigger 10 offhand Totems without reconnecting and 5 more after restarting the owner. For **each** activation confirm exactly one owner HUD animation, one audible owner sound and one audible nearby sound. Inspect diagnostics if any is missing; do not mark audio accepted if even one is silent. While both clients are open, check bed enter/Space exit and remote pose for all four facings.

## Git

Fetched `origin` before edits; local and remote `codex/utility-items-v1` both started at `59a83a2baf8e1324ca50170c7b01132b2ce75549`. Delivery consists of one ordinary commit on `codex/utility-items-v1`, pushed to `origin`; the resulting SHA is available in `git log` and the task response. `main` remains untouched; no reset, rebase, force push or git config change.
