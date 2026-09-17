# Utility Items: bed rest, Sign post, Totem SFX and Book — 2026-09-14

## Goal

Fix the four live-QA follow-ups on `codex/utility-items-v1`: usable White Bed, standing Sign post flicker/bleed, unreliable first Totem sample, and a Book editor reachable and usable in Anarchy. Preserve 20 TPS, PlayerCommand FIFO/ACK/replay, server ownership of outcomes, existing bed/Sign textures, and accepted Firework behaviour. Do not merge into `main`.

## Result

RMB on either half of a valid White Bed now enters a canonical horizontal rest pose in Singleplayer and Anarchy; Space exits to an adjacent safe cell. Standing Sign post geometry stops at the board underside. A sound requested before the Totem sample finishes loading now plays once after fetch/decode instead of being discarded. Book opens locally on RMB in both modes when no interactive block consumes use, supports draft pages and signing, and becomes read-only after the server signs it.

| Area | Root cause | Fix |
| --- | --- | --- |
| Bed | `performUseHeld` already resolved `use-bed`, but both host callbacks were no-ops (a decorative toast in Singleplayer, swing only on server). There was no rest state or pose. | Pass clicked coordinates to the callback; validate both bed halves; store rest in the game session or server player; hold physics while resting; use an applied jump command to exit; present the pose to local and remote views. |
| Sign | The floor post extended into the board, creating overlapping geometry and visible post through the board from some angles. | Shortened post to the board underside, cropped side UV to the actual height, and omitted touching cap faces. Wall Sign and text paths are unchanged. |
| Totem audio | On a cache miss, `playInternal` kicked off decode and returned, so that activation had no later `startBuffer`. A request before raw data arrived could also create a resolved decode task without a usable buffer. | Fetch each file once, share in-flight decode, retain one bounded pending start per activation, and call `startBuffer` after readiness and renewed playback checks. |
| Book | Singleplayer's use route opened the GUI, but online RMB went through `sendOnlineUse`, which had no Book branch. The editor exposed the title in draft mode and had no signing/read-only transition. | Use one `openSelectedBook` helper for both routes, preserve interactive-block precedence, add page/Done/Sign states, and let the server set author and lock from the authenticated player. |

The editor follows the [official Minecraft Book and Quill guide](https://www.minecraft.net/zh-hans/article/book-and-quill) for use-to-open, Done-to-save and Sign-to-finalize; this project's existing 32-page/1024-character/64-character limits remain unchanged.

## Implemented

- Bed: `resolveBedRest`, `isBedRestValid`, rest/camera/exit positions in shared Node-safe `src/world/bed.ts`; matching foot/head clicks yield the same head anchor. Invalid halves, death, bed break, teleport, respawn, disconnect and world disposal clear rest. Resting does not change time, spawn or home. Exit searches side cells with floor and clearance before a fallback above the foot half.
- Anarchy: `ServerPlayer.restingBed` is authoritative. `tickConnectedPlayers` still dequeues `PlayerCommand`, updates `commandSeq`/ACK and look each tick. While resting it suppresses controller movement; only the **applied** command's `jump` exits, consuming that jump for the exit tick. Existing snapshots carry `presentation.bedRest`. The client continues normal command sending and history/reconciliation, while `PredictedMove.resting` prevents local locomotion until the authoritative exit. No new realtime packet or second pose channel was added.
- Rendering: an extra `PlayerVisual` rest transform lays the established Classic/Slim/armor rig face-up for four facings, independently of death tilt; a non-rest frame resets the transform. The local camera sits by the pillow. Bed geometry, sheet and pillow UV were untouched.
- Audio: preload and direct play share per-file in-flight fetch/decode. A pending activation captures its file, options, position and listener, then rechecks mute, pause, volume, distance and voice admission when ready. Pending starts are capped at 64; failed files are recorded without repeated retries. Existing `world_sound` owner/nearby routing and HUD-only `totem_activate` were not changed.
- Book: both RMB routes call the same editor. Chest, crafting table, furnace, bed, sign and other existing use-targets retain priority. A local Book open sends no unrelated online `interact`. Done persists a draft; Sign asks for title and confirmation. Online `book_update.sign` is only client intent: the server validates slot/content, uses `player.name` for author, locks metadata, and rejects later updates. Forged `author`/`locked` fields are not accepted by the parser. Signed pages show title/author and are read-only. Escape and Close restore controls.

## Changed files

- Bed gameplay and presentation: `src/world/bed.ts`, `src/gameplay/useInteraction.ts`, `server/gameplay.ts`, `server/WorldInstance.ts`, `shared/playerPresentation.ts`, `src/core/Game.ts`, `src/net/localPlayerPrediction.ts`, `src/net/RemotePlayerView.ts`, `src/rendering/player/PlayerVisual.ts`.
- Sign: `src/rendering/specialBlockGeometry.ts`.
- Audio: `src/core/AudioManager.ts`.
- Book: `src/items/book.ts`, `shared/protocol.ts`, `src/ui/GameUI.ts`, `src/style.css` and the shared `src/core/Game.ts` route above.
- Tests: `tests/audio-sfx.test.ts`, `tests/book-routing.test.ts`, `tests/local-player-prediction.test.ts`, `tests/player-visual-animation.test.ts`, `tests/remote-action-presentation.test.ts`, `tests/server/utility-items-authority.test.ts`, `tests/sign-entity-model.test.ts`, `tests/utility-items.test.ts`.
- Handoff: `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, this report.

## Architecture decisions

The bed uses existing block state and `PlayerCommand` intent, not a separate sleep simulation or network protocol. Its authoritative result comes through the same player snapshot/presentation and the same local prediction history, restore and unacked-command replay. The pose sits inside the existing player visual rig, so equipped items, armor, skin layers and WH presentation continue through that rig. Sign stays in the existing mesher/atlas. Audio still uses one catalog and one voice-admission path. Book content remains `ItemStack.metadata.book` in the ordinary inventory/save/network flow; there is no parallel book store or new item ID.

## Tests

- Final focused Vitest run: **9 files / 141 tests passed**. This includes four bed facings and head/foot canonicalization, blocked exits and invalidation, server movement suppression and FIFO jump exit/ACK, presentation and local prediction, Sign floor/wall geometry, delayed first/cached Totem playback and failures, owner/nearby/distant sound routing, Book SP/online routing, parser/server signing and lock rejection.
- `npm run typecheck`, `typecheck:client`, `typecheck:server`, `typecheck:sim`, `check:boundaries`, `build`, `check:size`, `check:archive` passed after the final code change. Production output is **4.38 MiB / 367 files**, below the platform archive limit. Vite's `/sdk.js` non-module and large-chunk messages are existing warnings, not build failures.
- A full `npm test -- --maxWorkers=2 --testTimeout=15000 --silent --reporter=dot` run was **not green**: 230 files passed, 7 failed; 2268 tests passed, 13 failed, with 2 worker timeout errors. Visible failure groups included `minecraft-reference-extractor.test.mjs` syntax parsing, Windows line-ending expectations in `chat-layout.test.ts`, a terrain test timeout, and `server/tick-load-flight.test.ts` host-load performance threshold. These files were not changed in this pass. Focused tests were rerun afterward and passed. The full suite is not claimed passing.

## Visual QA

- Local browser `/?qaBed=1`: confirmed the accepted white bed/pillow/frame still renders after the change. Resting gameplay and four in-world perspectives were verified by state/math tests, **not** by a complete interactive two-client visual run.
- Local browser `/?qaSign=1`: inspected floor and wall Signs, including a rotated floor Sign; the post no longer bleeds through the board in those views. Text and wall geometry remained visible. All 16 rotations were not manually examined.
- Temporary local Book harness using the real `GameUI.openBook`: entered two pages, opened Sign, cancelled back to the preserved draft, signed with a title, reopened and saw read-only text plus title/author. The harness was removed. Escape handling was inspected and fixed afterward; it was typechecked but not re-exercised visually.
- A real two-client audible Totem run and mobile landscape QA were not performed. Automated tests establish event delivery and WebAudio starts, not what a person hears through their device.

## Performance

Bed validation and exit selection are bounded local cell checks at 20 TPS. Resting skips controller physics but keeps FIFO command processing. The shorter Sign post emits fewer mesh vertices without a new material or pass. SFX starts are bounded to 64 pending events, deduplicate file fetch/decode, and retain the existing active-voice caps. The production archive size remains 4.38 MiB.

## Known issues

The true Anarchy two-client sound/pose and correction experience still needs a manual run; the local browser probes cannot establish audibility or absence of visible correction jitter in a real network session. If every normal side exit is obstructed, the bed helper falls back above the foot half; inspect cramped installations during QA. The full test suite has unrelated parsing, platform line-ending and timing failures listed above.

## Deferred

No sleeping/time skip/spawn setting, extra Book item IDs, second network protocol, new Sound system or Firework changes. Mobile landscape, all Sign rotations and real speaker/headphone tests remain manual QA.

## Next work

Manual checklist before merge review:

1. In Singleplayer and two Anarchy clients, RMB HEAD and FOOT on north/east/south/west beds; verify the same horizontal position, face up with head at pillow, and remote pose. Hold movement while lying; inspect corrections/jitter.
2. Press Space once: stand at a safe side cell without an ordinary jump on the exit tick, then walk normally. Break HEAD and FOOT in separate runs while resting; confirm immediate exit. Check death/teleport cleanup.
3. Slowly orbit a floor Sign and rotate it; verify no flicker or post through the board. Check wall Sign and front text. Repeat all 16 floor rotations when doing final visual review.
4. Trigger at least 10 offhand Totem activations with two nearby Anarchy clients without reload, then 5 after reload/reconnect. For each: HUD, one owner sound, one nearby sound, no silent first activation or duplicate; also verify distant silence. Inspect `audioDebug` `missingFiles`, `missingEvents`, `recentPlays` if a failure occurs.
5. Open blank/multipage Books in Singleplayer and Anarchy by RMB in air and on ordinary blocks; save/reopen, sign/reopen read-only, and reconnect to verify saved text. RMB with Book on chest and bed must keep those interactions. Verify Close/Escape returns movement and pointer lock behavior.
6. Check landscape mobile controls, modals and bed camera before merge review.

## Git

Started from fetched `origin/codex/utility-items-v1` at `3f823eff712a27511b6ab53539af22b022c43d5a`; fetched `origin/main` was `70e2afee2794e6bb0f662f984d659f993113bdfb`. Implementation commit: `658f705` (`Fix utility bed rest, sign post, Totem SFX and book flow`). This report is committed separately so its Git section can cite the implementation SHA. The branch is pushed normally to `origin/codex/utility-items-v1`; `main` is not merged or pushed. No rebase, reset, force push or git config change.
