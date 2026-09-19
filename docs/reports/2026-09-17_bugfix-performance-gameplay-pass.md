# 2026-09-17 — Bugfix / performance gameplay pass

## Goal

Fix six live Anarchy issues from current `origin/main` without workarounds: AutoMine FPS freeze, hotbar slot rollback, remote fire, skin default until reconnect, RTP one-shot fail, and 0-hearts-but-alive.

## Result

All six root causes are fixed in the existing services (AutoMineManager, command/input slot, SurvivalSystem, RemotePlayerView/PlayerVisual, RtpService, heart HUD). No second systems.

## #1 AutoMine FPS spike on reset

**Root cause.** Fill was already 64 blocks/tick, but each batch called `applyBlockBatch` with immediate region lighting. A 15×15×15 (3375) reset therefore paid cuboid relight ~53 times plus `block_batch` + client urgent remesh. The hitch was lighting + mesh, not “one giant setBlock”, but it still presented as a 2–3s freeze.

**Fix.** `fillVoxelAt` walks **top Y first**. Writes use `deferLighting: true`. After the last voxel, phase `lighting` queues one cuboid `queueLight` and `flushLighting()` on the **next** tick. Shared per-tick budget across jobs. `lastResetMetrics` logs ticks / maxBatch / relightMs / lightingTicks.

**Performance (test 3×3×3 @ 5/tick and 15×15×15 @ 64/tick).**

| Metric | Before (same 64/tick, immediate light) | After |
| --- | --- | --- |
| max blocks/tick | 64 | 64 (bounded) |
| lighting | every write batch | 1 flush after fill |
| 15³ duration | ~53 ticks + heavy relight each | 53 write ticks + 1 lighting tick (~2.7s at 20 TPS, no frame freeze) |
| network | 64-block `block_batch` / tick | unchanged, bounded |
| mesh | urgent remesh already 3 chunks / 2ms | unchanged |

## #2 Hotbar rollback on instant use

**Root cause.** 1–9 updates `session.selectedSlot` immediately. Interact still used the last **sent** `commandSeq`, whose command snapshot had the **old** slot. `useHeld` could run on the new slot (when `commandSeq === lastInputSeq`) but `flushPlayerInventory` echoed `player.selectedSlot` from the last applied input. Client `inventory` handler assigned that echo blindly. A queued command with the old slot could also overwrite a committed interact slot.

**Synchronization flow.** keyboard 1–9 → `selectHotbar` → `noteHotbarSelect` + slot-only input packet → interact/use with current `selectedSlot` → server `commitActionSelectedSlot` before inventory flush → apply-command keeps the override for that `commandSeq` → client `resolveHotbarSelection` ignores older inventory echoes until `lastAckedSeq >= sinceInputSeq+1` or the server slot matches.

**Fix.** Accept a newer action slot unless `commandSeq < lastInputSeq`. Commit server slot before flush. Client pending selection vs ack. Immediate command-stream input on select (zero locomotion, so no double-step).

## #3 Remote fire not visible

**Root cause.** `PlayerSnapshot.onFire` already existed and local first-person / mobs used `SharedFireTexture`. `RemotePlayerView` never read `onFire` or drew an overlay.

**Fix.** Discrete `onFire` on interpolation samples (not lerped). `PlayerVisual` reuses `SharedFireTexture.createScaledOverlay`. `remoteInfo()` includes `onFire` for join-while-burning.

## #4 Selected skin sometimes default until reconnect

**Root cause.** Resume after `player_left` broadcast only `player_appearance`. `applyOnlineAppearance` no-ops if the remote is gone. Later `player_state` spawn used `DEFAULT_PLAYER_APPEARANCE` because ticks omit appearance.

**Fix.** Resume/join always broadcast `player_joined` with `remoteInfo()` (includes appearance). Client buffers appearance-before-spawn and applies it on `spawnRemotePlayer`. `setAppearance` still updates live remotes. No polling.

## #5 RTP “could not find rtp location”

**Root cause.** `state.generates + generates >= generateBudget` treated `maxChunkGenerates` (default 1) as a **lifetime** cap. Skipped/unloaded columns still incremented `attempts`, so ~24 tries burned on generate-skips and the plugin returned the error while valid land existed.

**Fix.** Generate budget is **per `step()`**. Generate-skips do not consume `maxAttempts`. Duplicate columns are skipped via `tried`. Default `maxAttempts` 80. Exhaust only when attempts or unique-column area is truly spent.

## #6 0 hearts but still alive

**Root cause (HUD).** `heartHudIcons` used `remaining === 1` for a half heart. Armor-reduced 0.4–1.5 HP rendered as empty hearts while server health was still > 0.

**Root cause (life).** `restore({ health: 0, dead: false })` could keep a living player at 0 HP.

**Fix.** Half heart = `remaining > 0`. `enforceLifeInvariant()`: `health <= 0` ⇒ `health = 0` and `dead = true`. Health packets treat `health <= 0` as death.

## Changed files

- `server/services/autoMine.ts`, `server/services/rtp.ts`, `server/builtin-plugins/rtp.ts`, `server/builtin-plugins/rtpPortal.ts`
- `server/WorldInstance.ts`, `server/AnarchyServer.ts`
- `src/net/hotbarSelection.ts`, `src/net/remoteAppearance.ts`, `src/net/remotePlayerInterpolation.ts`, `src/net/RemotePlayerView.ts`
- `src/core/Game.ts`, `src/rendering/player/PlayerVisual.ts`, `src/ui/heartHud.ts`, `src/survival/SurvivalSystem.ts`
- `shared/protocol.ts`
- tests listed below; `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Tests

- `tests/server/auto-mine-core.test.ts` — top-down, bounded batch, no parallel reset, metrics
- `tests/hotbar-selection.test.ts`, `tests/server/hotbar-selection-authority.test.ts`
- `tests/remote-player-fire.test.ts`
- `tests/remote-appearance-join.test.ts`, `tests/server/player-appearance.test.ts` (resume `player_joined`)
- `tests/server/rtp-search.test.ts`
- `tests/survival-death-invariant.test.ts`

## Browser QA

See the PR comment / final agent report. Automated tests do not replace a two-client live pass (AutoMine FPS, 1–9+RMB, fire, skin join, RTP portal, lethal damage).

## Known limitations

- AutoMine still sends a 64-block `block_batch` each write tick (bounded; required for server authority). Lighting is one cuboid flush, which can still be a short hitch on a 32³ mine, not a multi-second freeze.
- Hotbar select injects a zero-move input so the new slot is in the command stream; a walking player may pause for one 50ms command.
- Fire overlay uses the shared mob/block fire strip; it is discrete on/off, not a per-player burn timer on the client.
- RTP can still fail if the configured rectangle has no safe stand (all lava/void) after the real attempt budget.

## Next work

Owner live two-client Anarchy QA of AutoMine reset FPS, hotbar, fire, skins, RTP portal, and lethal PvP/environment damage.

## Git

Branch: `cursor/bugfix-performance-gameplay-31b4` from `origin/main`.
