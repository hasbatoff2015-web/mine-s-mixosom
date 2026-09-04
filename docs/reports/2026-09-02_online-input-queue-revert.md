# Online Anarchy: remove movement input FIFO

Date: 2026-09-02  
Branch: `cursor/online-prediction-remesh-86e1` (PR **#37**)  
**Do not merge main.**

## Goal

The previous “server input queue” made localhost movement feel like 300–400 ms ping, rubber-banded the local player, delayed stop, and delayed bow release by 3–4 seconds (sometimes never firing). Restore latest-input movement state. Do not change GRAVITY / JUMP / WALK / SPRINT / FIXED_DT / 20 TPS / offline physics / urgent remesh.

## 1. Root cause of the 300–400 ms feel

`applyInput` pushed **every** `ClientInputMessage` into `inputQueue` (cap 64). Each 20 TPS tick dequeued **one** packet.

If the client ran slightly ahead or packets burst, the queue held 6–8 old WASD states → 300–400 ms of stale movement. The server was replaying history while local prediction was already on the latest state, so snapshots pulled the player backward then forward.

## 2. Why bow was delayed 3–4 seconds

`use` / mining / bow charge live on the **same** input packets as movement.

Queue cap 64 × 50 ms = **3.2 s**. Bow release sat behind leftover walk packets. `advanceUseHold(false)` ran seconds later → arrow spawned late.

Worse: old `use: false` packets still in the queue could run **after** `interact` started the bow (`bowUseTicks = 1`), immediately calling `releaseBow` with too little charge and zeroing ticks. Later `use: true` packets do **not** restart the bow (only `interact` does). Result: **no arrow at all**.

Attack / break / place were already separate immediate messages. They were not queued. Bow was.

## 3. New server input semantics

Movement is **state**, not a command backlog.

- `lastInput` = latest packet
- `lastInputSeq` = that packet’s seq
- Each 20 TPS tick: **one** `PlayerController.tick()` using latest movement
- `snapshot.inputSeq = lastInputSeq` (the state used this tick)
- No new packet: hold lastInput, same seq (client ignores duplicate ack)
- Skipped seqs are **not** simulated and **not** replayed

Jump pulse and bow/food **release** are latched across the window so a coalesced `jump:true` then `jump:false`, or `use:true` then `use:false`, is not lost. Latest WASD/sprint/sneak/descend still wins.

## 4. One-shot actions

| Action | Path |
| --- | --- |
| Attack | `{ type: 'attack' }` immediate |
| Break / place | `{ type: 'break_block' / 'place_block' }` immediate |
| Bow press | `{ type: 'interact' }` immediate → `bowUseTicks = 1` |
| Bow hold / release | `input.use` on latest state; `pendingUseRelease` if a false arrives while charging |
| Mining | `input.mining` latest hold |
| Jump pulse | `pendingJump` OR latest `jump` |

No protocol redesign.

## 5. Prediction

Client still predicts immediately every seq.

Ack compares `history[N]` to the snapshot for **latest** seq N. Match → no pose write. Mismatch → restore snapshot, replay **only seq > N** (not skipped movement seqs). Duplicate seq → ignore.

No second lerp/chase layer. Render stays `lerp(previousPosition, position, alpha)`. Small corrections still do not collapse `previousPosition`.

## 6. Diagnostics

- Server `FC_DEBUG_BOW=1`: `press_hold_received` / `release_received` / `server_press` / `server_fire` / `arrow_spawn` with timestamps
- Client `?bowDiag=1`: `client_press` / `client_release` with `performance.now()` and seq

Localhost delay should be ≤ one server tick (~50 ms).

## 7. Tests

- latest-input burst (3 packets → one physics step, seq=3)
- 64-packet burst → one step, not 3.2 s
- stop on latest idle
- jump latch
- creative flight + SHIFT descend latest-input
- bow press via `interact` is immediate (not behind movement ticks)
- bow charge then 40 mixed walk packets, last `use:false` → arrow on **next** tick
- prediction **24/24**, pipeline **5/5**, urgent remesh **4/4**, player-main **4/4**, anarchy-server **21/21**
- `typecheck` / `typecheck:sim` / `typecheck:client` / `typecheck:server` / `check:boundaries` PASS
- `test:sim` **42/42**, `test:server` **81/81**, `smoke:sim` / `smoke:server` PASS, `build` PASS

This environment did not run interactive localhost play (pointer-lock WASD / bow). Owner QA is still required.

## 8. Manual QA

Walk, sprint, jump, strafe, **stop immediately**, look, creative flight, fly+SHIFT. F3 `corr/s` near 0 on quiet localhost. Draw bow, release: arrow within a tick, not seconds. Place/break remesh still immediate.

## Git

Same PR branch. Do not merge main.
