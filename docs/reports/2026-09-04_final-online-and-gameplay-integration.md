# Final Online + gameplay integration audit

**Date:** 2026-09-04  
**Decision:** **DO NOT MERGE to main.** Live QA is incomplete; farming work was not found in the repository.

## 1. Final branch

`cursor/online-networking-v2-integrated-3ff8` (draft PR #42). No extra release branch: there is no separate farming branch to combine.

## 2–3. SHAs

| Role | Ref | SHA |
|---|---|---|
| main (unchanged) | `origin/main` | `4d803e5de22e551e3f71941c0abb03c91e78cf4c` |
| BASE PR #40 | `cursor/online-networking-v2-3ff8` | `1f5aafe93b699ee0e77fa4ecfa5eaed4c4070ed5` |
| DONOR PR #41 | `codex/online-command-pipeline-v2` | `aa2ae9e625bacf704a7f0f64c2e5689966e1a3d4` |
| Integration HEAD | PR #42 | `a85e9d9` (includes `dev:anarchy` JS fix) |
| Merge-base with main | | `4d803e5` (no unique main commits missing from #42) |

Online chain HEADs (unchanged):

| PR | Head | SHA |
|---|---|---|
| #37 | `cursor/online-prediction-remesh-86e1` | `fd02b67` |
| #38 | `cursor/remote-player-interpolation-86e1` | `ade7113` |
| #39 | `cursor/local-aim-desync-86e1` | `c5fba74` |
| #40 | `cursor/online-networking-v2-3ff8` | `1f5aafe` |
| #42 | `cursor/online-networking-v2-integrated-3ff8` | `a85e9d9` |

## 4. Networking architecture (one production stack)

Contained in #42; #37–#40 are linear ancestors, not parallel production:

- Movement: FIFO `PlayerCommandQueue`, `ackCommandSeq`, `history[ack]`. Accepted ACK does not mutate live pose. Donor latest-input is **not** production.
- Actions: explicit intent, `actionSeq` ≠ `commandSeq`, A or reject.
- Remote: one `RemoteInterpolationBuffer` (`serverTick`, 12 samples, delay grows only after underflow, recovery ≤100 ms).
- Aim: one `localInteractionAim`.
- `predNo*` is DEV-only (`import.meta.env.DEV === false` disables it).
- Protocol: `PROTOCOL_VERSION = 3`. World schema: `WORLD_SCHEMA_VERSION = 1` (no farming fields).

## 5. Farming audit

**No farming implementation exists in this GitHub repository.**

Searched: all remotes after `git fetch --all --prune`, all open/closed PRs, all commit messages, collaborators `ViBeMiXoS1K` and `hasbatoff2015-web`, cloud-agent runs visible to this principal, `BlockId`/`ItemId`, file names (`farmland`, `potato`, `carrot`, `wheat`, `hoe`).

AGENTS.md and `docs/ASSET_AUDIT.md` still **exclude** farming from scope. Starter inventory is dirt/cobble/planks/stone/log/apple. No crop blocks, no growth tick, no hoe.

Therefore: nothing to merge, nothing overwritten by networking, nothing to delete. If the collaborator has unpushed local work, it is **not in GitHub** and must not be assumed lost from #42.

## 6. Overlap files

No farming vs networking overlap. Shared files in #42 vs main are the networking chain only (`Game.ts`, `WorldInstance.ts`, `protocol.ts`, prediction, interpolation, tests, docs).

## 7. Conflicts

No merge with a farming branch was performed. No ours/theirs.

Incidental fix: `scripts/dev-anarchy.mjs` had a TypeScript `: void` annotation (also on **main**), so `npm run dev:anarchy` could not start. Fixed on the integration branch.

## 8. Tests

| Check | Result |
|---|---|
| typecheck / client / server / sim | PASS |
| check:boundaries | PASS |
| test:sim | 42/42 |
| test:server | 113/113 |
| smoke:sim / smoke:server | PASS |
| build + check:size + check:archive | PASS, 3.96 MiB / 284 files |
| node --check scripts/dev-anarchy.mjs | PASS after fix |
| npm test --maxWorkers=2 | **1522 passed / 7 failed / 1529** |

Known failures (pre-existing class, documented on earlier PRs, **not introduced by #42**):

1–2. `tests/authored-item-assets.test.mjs` — ENOENT `assets/minecraft/textures/items/bucket_empty.png` (source pack not in this checkout; runtime uses `public/textures`).
3–7. `tests/fire-contact-sunlight-minecart.test.ts` — 5× 5s timeouts (minecart physics). Same class as historical PR reports.

Focused networking suites previously: 188/188.

## 9. Two-client live QA

Attempted on this VM with Chrome + `npm run dev:anarchy`.

**Environment caveat:** F3 showed **FPS ≈ 4**, `pred/s` 7–71, `pend` up to **64** (queue cap), remote `delay=180ms` (max), jitter p95 378–495 ms, frequent `capped` / `under/s`. This is **not** a representative desktop. Smoothness conclusions from this host are invalid.

What was actually observed:

- Two Anarchy connections: F3 `Remote ec901ab2` with `n=12` samples; later `sess join=2 resume=1 socks=1`.
- Client A movement (W/sprint/jump/strafe) worked; `corr/s=0` and `errXZ/errY=0` in several captures; other captures showed `Pred corrected` with zero pose error while `pend=64` (starved 4 FPS client).
- Dirt place: `Block … id=2 face=0,1,0 accepted`.
- Reconnect: `/gamemode creative` + inventory survived; one socket.
- Remote **visual** smoothness and freeze-step: **not proven** (night, 4 FPS, buffer underflow, delay pegged at 180 ms).
- Hidden-tab: not a clean dedicated test (`hiddenDurationMs=194341` appeared as a side effect).

## 10. Bow 20-shot

**Not passed as live acceptance.**

Starter inventory has no bow. After `/give bow` and `/give arrow 64`, F3 repeatedly showed `release-sent spawn=0` and `rejected=charge`. Unit tests still cover 20 consecutive draw→release and captured aim. Live 20/20 on this host is **not** confirmed (4 FPS makes charge timing unreliable).

## 11. Block A-or-reject

Live: at least one standing dirt place **accepted** with `targetBlockId` and unit-axis face. Stale/wrong-face/LOS matrix was **not** fully exercised live. Unit tests cover A vs B / stale / face / hit.

## 12. Persistence

- `WORLD_SCHEMA_VERSION = 1`, no destructive migration, IndexedDB not cleared.
- Headless smoke created/saved a temp world.
- Live `dev:anarchy` created `server/data/worlds/anarchy/` (procedural). Reconnect kept creative + items (`resume=1`).
- No crop state exists to persist.

## 13–15. PRs and branches

**Closed:** none (code not on main).  
**Deleted:** none.  
**Keep open:**

| Item | Why |
|---|---|
| PR #42 | Integration candidate; stays **draft** |
| PR #37–#40 | Superseded by #42 **after** a successful main merge only |
| PR #41 donor | Latest-input; rejected as production; close only after #42 is on main |
| PR #36 Radmin bind | **Unique**, not in #42 |

Do not delete farming branches: **none exist**.

## 16. Known issues

- Cloud-agent live host is too slow for remote-interpolation / bow-charge acceptance.
- FIFO `pend=64` under 4 FPS (cap); compaction is designed for bursts, not a 4 FPS client.
- Adaptive remote delay hit 180 ms + underflow here; LAN smoothness still relies on delay staying 100 ms when jitter is low (unit-tested).
- Attack/pickup still lack full captured-aim payloads.
- Remote animator mining/bow flags still 0.

## 17. Final architecture

One movement, one reconciliation (`history[ackCommandSeq]`), one remote interpolator, one action validator, no farming implementation. CLIENT OWNS INTENT / SERVER OWNS RESULT.

## 18. Merge status

**Not merged.** Criteria 6 (two-client QA), 7 (bow 20-shot live), and 2 (farming integration of collaborator work that is not in git) are unmet.

Next work: owner two-client QA on a 60 FPS desktop; if farming exists only on a teammate machine, they must push a branch before any main merge that claims to include it.
