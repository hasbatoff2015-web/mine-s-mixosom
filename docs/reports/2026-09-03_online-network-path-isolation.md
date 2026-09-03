# Online network-path isolation

Date: 2026-09-03  
Branch: `cursor/online-prediction-remesh-86e1` (PR **#37**)  
**Do not merge main.**

## Goal

Manual A/B proved Normal Online still jitters while `?predNoNet=1` is perfectly smooth. Isolate whether the remaining jitter is incoming local `player_state`, outgoing movement send, another network callback, world/collision, or session lifecycle. Do **not** hide it with lerp, extra smoothing, larger tolerances, slower movement, or disabled server authority.

## Result

Isolation flags and a local-player network write trace are in. An accepted/ignored local snapshot is a **motion/render no-op**: look is not copied from the snapshot, riding/gamemode apply only when the value changes, and reconcile accept must not touch any PlayerController field. `predNoNet` is exactly `predNoSend + predNoState`; remotes stay enabled.

Physics constants, 20 TPS, render interpolation, correction tolerance, and urgent remesh are unchanged.

## Isolation flags (DEV only)

| Flag | Send input | Apply local `player_state` | Predict/render |
|---|---|---|---|
| (none) `online/normal` | yes | yes | yes |
| `?predNoState=1` | yes | **no** | yes |
| `?predNoSend=1` | **no** | yes | yes |
| `?predNoNet=1` | **no** | **no** | yes |

Production builds ignore every flag. F3 shows `Motion online/normal|noState|noSend|noNet send=on|OFF state=on|OFF` plus send/recv, net pos/vel/prev writes, mutation source counts, and collision-volume world hits.

### How to read the 4-mode matrix

Known: normal = jitter, noNet = smooth.

- **noState smooth** → incoming local `player_state` path.
- **noState still jitter** → send/server interaction or another online callback.
- **noSend still jitter** → incoming snapshots (or their side effects) are implicated.
- **noSend smooth** → outgoing input / server-side feedback is implicated.

`predNoSend` on a fresh session usually **ignores** snapshots as duplicate `inputSeq` (server never advances seq). If it is still jittery, the remaining writes are side effects of receiving `player_state`, not rewind.

## Local-player network writes traced

Every DEV mutation of local pose/velocity/previousPosition/onGround/flying/sneak/sprint/look/flight:

- `welcome` teleport
- `player_state` reconcile (accept/correct/snap) and riding/gamemode/respawn
- `health` respawn restore
- `inventory` gamemode → `creativeFlightAllowed`
- `block_update` / `block_batch` cells overlapping the player AABB (`world:volume`)
- `chunk_data` whose column overlaps the player

Not a PlayerController write (still received): remotes, entity snapshots, chat, time, ping.

## Accepted snapshot contract

`reconcilePredictedPlayer` on a matching ack still only updates `lastAckedSeq` / history. `applyLocalPlayerSnapshot` no longer writes yaw/pitch from the snapshot (look was already client-owned). Riding and gamemode apply only on actual change. If any motion field still changes, F3 `acceptMut` and `[acceptInvisible]` log it.

## Seq RTT (DEV)

Client `input.clientSentAt` → server stores recv/sim time → snapshot `netTiming` `{ clientSentAt, serverRecvAt, serverSimAt, serverSentAt }` → client recv time in the first-bad dump.

## First bad event

First Online frame with signed render delta `< 0` or `|rΔ| > 0.12` while moving prints `[firstBadEvent]`: frame index, pos/render/camera before→after, mutations since the previous frame, last `player_state` seq, last sent seq, whether reconcile ran, world updates, timestamps.

## 4-mode matrix (synthetic lockstep walk, 60 FPS, 2 s)

See `tests/pred-isolation-matrix.test.ts`. Lockstep server/client, flat stone, no blocks/mobs/combat.

| Mode | send | state | corr | acceptMut | vs noNet mean step |
|---|---|---|---|---|---|
| normal | ticks | yes | 0 | 0 | match |
| noState | ticks | 0 | 0 | — | match |
| noSend | 0 | yes (dup seq) | 0 | 0 | match |
| noNet | 0 | 0 | 0 | — | baseline |

Synthetic lockstep cannot reproduce the live localhost WS hitch; it proves accept is invisible and the flags compose. Owner localhost still has to walk/sprint/jump/strafe/flight/fly+SHIFT in all four modes and read F3 `neg/s` `big/s` `mut …` `vol/s`.

## Architecture decisions

- One prediction path. Isolation is boolean skips on send and on local snapshot apply, not a second controller.
- Do not early-return the whole `player_state` packet for `predNoState` / `predNoNet` — remotes stay on.
- Do not disable reconciliation in normal mode. Accept must be invisible instead.
- Trace every call site, not only `reconcilePredictedPlayer`.

## Tests

- flags **6/6**, isolation matrix **6/6**, prediction **24/24**, pipeline **8/8**, render-state **8/8**, remesh **4/4**, player-main **4/4**
- `typecheck` / `typecheck:sim` / `typecheck:client` / `typecheck:server` PASS
- `test:sim` **42/42**, `test:server` **83/83**, `check:boundaries` PASS, `build` PASS

## Visual QA

Not playable with pointer lock in this agent. Owner: four Anarchy URLs, F3 Motion line, first `[firstBadEvent]` if jitter remains.

## Performance

No extra lerp, no extra smoothing, no tick-rate change. Trace is DEV-only bounded rings.

## Known issues

- Live localhost jitter vs `predNoNet` still needs the 4-mode owner pass to name the winning half (A vs B).
- `predNoSend` duplicate-seq ignore means it is a weak test of *rewind* and a strong test of *side effects* of receiving snapshots.

## Deferred

Owner 4-mode live matrix; any follow-up that removes the remaining real write (if acceptMut/vol/firstBadEvent names it).

## Next work

If `predNoState` is smooth on localhost: inspect `[acceptInvisible]` / `mut player_state:*` / firstBadEvent for the write that still leaks. If `predNoSend` is smooth: inspect send/server tick/`netTiming`. Do not merge main.

## Git

Branch `cursor/online-prediction-remesh-86e1`. Continuation of PR #37.
