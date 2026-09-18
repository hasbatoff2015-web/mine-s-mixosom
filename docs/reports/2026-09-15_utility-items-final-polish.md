# Utility Items final polish — 2026-09-15

## Goal

On fetched `codex/utility-items-v1`, make bed rest immediately use a temporary third-person-back presentation, reduce the existing Totem sample gain by half and skip its initial 0.7 seconds, and visually separate the HUD offhand slot from the centered hotbar. Preserve accepted bed pose, Totem voice admission/retry and server routing. Do not merge into `main`.

## Result

Bed rest uses effective `thirdPersonBack` from the first rendered resting frame and restores the stored first-person or third-person-front preference after exit. Totem catalog gain is `0.45` instead of `0.9`, and Web Audio starts the decoded sample at offset `0.7s` immediately. HUD offhand sits 12 CSS px farther left, yielding a 20px gap from the main hotbar. Focused tests, browser audio probe and responsive HUD measurements passed. The interactive two-client bed/Totem run was unavailable in the in-app browser because pointer lock could not be acquired; no human audibility claim is made for a 10-activation series.

## Implemented

- `effectiveCameraPerspective(preferred, resting)` returns `thirdPersonBack` while `session.restingBed` is active and otherwise returns the stored F5 preference. Both `Game.updateFirstPerson` and `Game.updatePlayerPresentation` use it on the same frame. Resting shows the world model and hides first-person hands/items. Camera travel and front look use the effective value; F5 cycles are ignored during rest. The stored `cameraPerspective` is never overwritten on bed entry/exit.
- `SoundEventProfile.startOffsetSeconds?` is forwarded by the existing `named()` catalog helper. Only `totem.activate` sets `0.7`; its volume changes `0.9 → 0.45`. `AudioManager.startBuffer` calls `source.start(0, 0.7)` for a finite decoded sample longer than that offset plus a 0.001s safety margin. All other events and short/invalid buffers call `source.start(0)`. No timer or audio scheduling delay is added.
- The existing `#offhand-hud` right-edge expression keeps its hotbar-relative positioning; its gap changed `8px → 20px`. Hotbar, inventory offhand, icon and slot dimensions were not changed.

## Changed files

- Camera: `src/rendering/player/ThirdPersonCamera.ts`, `src/core/Game.ts`, `tests/third-person-camera.test.ts`.
- Audio: `src/audio/soundEvents.ts`, `src/audio/soundCatalog.ts`, `src/core/AudioManager.ts`, `tests/audio-sfx.test.ts`.
- HUD: `src/style.css`.
- Handoff: `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, this report.

## Architecture decisions

The forced bed camera is a derived render perspective, not a mutation of user preference or a new bed/network state. The first-person viewmodel is updated before world render and reads the same effective value as the world player/camera. The audio offset is metadata on the canonical catalog profile and is consumed in the existing one-shot start path, retaining priority, voice stealing, retry and single authoritative sound delivery. HUD spacing stays anchored to half the actual centered hotbar width.

## Tests

- Test-first run showed 4 expected red regressions: old Totem volume/offset, unconditional `source.start(0)`, missing effective camera helper and F5 changing stored preference during rest.
- Final focused camera/bed/audio/UI/server-authority suite: **11 files, 123/123 tests passed**. The Game-level frame test calls `updateFirstPerson` and `updatePlayerPresentation` in frame order: no-rest hands visible/world model hidden, first bed frame hands hidden/world model visible/camera behind, exit restores first person; third-person-front preference likewise resumes after rest. Audio test verifies one `source.start(0, 0.7)` and volume `0.45`, ordinary `player.hurt` stays `start(0)`, and 0.2s buffer safely falls back to `start(0)`. Existing owner/nearby combat admission and transient retry tests remain green.
- `test:sim`: **12 files, 66/66 passed**. `typecheck`, `typecheck:client`, `typecheck:server`, `typecheck:sim`, `check:boundaries`, `build`, `check:size`, `check:archive`, `smoke:sim` and `smoke:server` passed. Production size **4.39 MiB / 367 files**. Vite's `/sdk.js` and large-chunk messages remain warnings.
- Full `npm test -- --maxWorkers=2 --testTimeout=15000 --silent --reporter=dot`: **234 files passed / 4 failed, 2289 tests passed / 8 failed**, plus one Vitest worker `onTaskUpdate` timeout. The failing files were `minecraft-reference-extractor.test.mjs` (existing syntax error), `chat-layout.test.ts` (Windows CRLF source-string expectation), `fire-contact-sunlight-minecart.test.ts` (host-sensitive timeout) and `server/tick-load-flight.test.ts` (existing <80ms performance threshold, 122–134ms on visible retries). These failure groups also appeared before this polish. Chat and fire/minecart code and all four failing test files were not changed; the only CSS edit is the offhand gap. The full suite is **not claimed green**. The relevant new and existing camera/audio/bed/UI tests passed in both focused and full runs.

## Visual QA

- Browser at 1280×720, 1920×1080, 2560×1440 and 960×600: main hotbar center equalled viewport center; measured HUD offhand gap was 20–20.03 CSS px, with the slot left of hotbar. The 1920×1080 screenshot also showed the slot visually distinct.
- Browser `/?qaAudio=1`: `totem-sound.mp3` returned HTTP 200 and decoded with 27/27 catalog buffers. Parsed one `world_sound` event; `AudioContext` became `running`, `recentPlays` held one `totem.activate` with volume `0.45`, and `recentDrops`, missing/permanent and transient lists were empty. The profile displayed `startOffsetSeconds: 0.7`; the two-argument Web Audio call is asserted by the unit test.
- Interactive bed enter/Space exit and the 10 owner+nearby Totem activations were **not** completed in this in-app browser. Its `document.pointerLockElement` stayed null and the game's pointer-lock fallback remained visible after clicking, so mouse-look/bed placement/PvP could not be driven reliably. Frame-order and sound-source tests are not substituted for a human audible two-client run.

## Performance

The effective camera perspective is a constant-time branch per frame. Audio uses the same one-shot source and sample; archive size is unchanged at 4.39 MiB. HUD change is one CSS gap value and adds no elements or animation.

## Known issues

The requested in-world first-person-to-bed visual transition and 10-event two-client audible QA require a browser with working pointer lock and two controllable game clients. The pre-existing full-suite baseline contains Windows line-ending, extractor syntax and CPU-sensitive timeout/load tests; the exact non-green result is listed in Tests above.

## Deferred

No changes to bed body pose/visual offset/head/UV, camera pivot or server state, Totem priority/voice stealing/retry, server `world_sound`, item HUD animation, inventory offhand or unrelated utility items. No `main` merge.

## Next work

In two real Anarchy clients, start in first person, enter/leave a bed repeatedly, press F5 while resting and confirm no hand flash and exact preference restoration; repeat from third-person front. Trigger at least 10 Totem activations with owner and nearby listener, confirming one audible cue per client on each activation and prompt onset at the new half-gain level. Capture `recentDrops` if any event is silent.

## Git

Fetched `origin` before edits; local and remote `codex/utility-items-v1` started at `795bbc9ac1761e09755c75454edd88d09498db38`. Delivery is one ordinary commit and push on this branch; the final SHA is in `git log` and the task response. No main merge, reset, rebase, force push or git config change.
